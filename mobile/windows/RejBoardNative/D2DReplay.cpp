#include "pch.h"
#include "D2DReplay.h"
#include "CoreApi.h"

using namespace winrt;

namespace RejBoard
{
    namespace
    {
        // opcodes, as in DrawList.kt
        enum Op
        {
            SAVE, RESTORE, TRANSLATE, SCALE, BEGIN, MOVE, LINE, QUAD, BEZIER, ARC, RECT, CLOSE, FILL, STROKE, CLIP, FILL_RECT,
            FILL_COLOR, STROKE_COLOR, STROKE_GRAIN, LINE_WIDTH, LINE_CAP, LINE_JOIN, LINE_DASH, ALPHA, SHADOW, TEXT
        };

        D2D1_COLOR_F Argb(double v)
        {
            auto c = static_cast<uint32_t>(static_cast<uint64_t>(v));
            return D2D1::ColorF(((c >> 16) & 0xFF) / 255.0f, ((c >> 8) & 0xFF) / 255.0f, (c & 0xFF) / 255.0f, ((c >> 24) & 0xFF) / 255.0f);
        }

        D2D1_COLOR_F WithAlpha(D2D1_COLOR_F c, float a)
        {
            c.a *= a;
            return c;
        }
    }

    DrawList DrawList::Take(double* b, int count)
    {
        DrawList d;
        if (!b) return d;
        if (count >= 3)
        {
            size_t nOps = static_cast<size_t>(b[0]), nArgs = static_cast<size_t>(b[1]), nTexts = static_cast<size_t>(b[2]);
            size_t k = 3;
            if (3 + nOps + nArgs <= static_cast<size_t>(count))
            {
                d.ops.reserve(nOps);
                for (size_t i = 0; i < nOps; i++) d.ops.push_back(static_cast<int>(b[k++]));
                d.args.assign(b + k, b + k + nArgs);
                k += nArgs;
                for (size_t t = 0; t < nTexts && k < static_cast<size_t>(count); t++)
                {
                    size_t n = static_cast<size_t>(b[k++]);
                    std::wstring s;
                    for (size_t j = 0; j < n && k < static_cast<size_t>(count); j++) s.push_back(static_cast<wchar_t>(b[k++]));
                    d.texts.push_back(std::move(s));
                }
            }
        }
        rb_free_doubles(b);
        return d;
    }

    D2DReplay::D2DReplay(ID2D1DeviceContext* ctx, ID2D1Factory* factory, IDWriteFactory* dwrite) : m_ctx(ctx), m_factory(factory), m_dwrite(dwrite)
    {
        check_hresult(m_ctx->CreateSolidColorBrush(D2D1::ColorF(D2D1::ColorF::Black), m_brush.put()));
    }

    D2DReplay::Figure& D2DReplay::Current()
    {
        if (m_figs.empty()) m_figs.emplace_back();
        return m_figs.back();
    }

    com_ptr<ID2D1PathGeometry> D2DReplay::Geometry()
    {
        com_ptr<ID2D1PathGeometry> g;
        check_hresult(m_factory->CreatePathGeometry(g.put()));
        com_ptr<ID2D1GeometrySink> sink;
        check_hresult(g->Open(sink.put()));
        sink->SetFillMode(D2D1_FILL_MODE_WINDING);
        for (auto const& f : m_figs)
        {
            if (f.segs.empty()) continue;
            sink->BeginFigure(f.start, D2D1_FIGURE_BEGIN_FILLED);
            for (auto const& s : f.segs)
            {
                switch (s.kind)
                {
                case 0: sink->AddLine({ s.p[0], s.p[1] }); break;
                case 1: sink->AddQuadraticBezier(D2D1::QuadraticBezierSegment({ s.p[0], s.p[1] }, { s.p[2], s.p[3] })); break;
                case 2: sink->AddBezier(D2D1::BezierSegment({ s.p[0], s.p[1] }, { s.p[2], s.p[3] }, { s.p[4], s.p[5] })); break;
                case 3: sink->AddArc(D2D1::ArcSegment({ s.p[0], s.p[1] }, D2D1::SizeF(s.p[2], s.p[2]), 0, D2D1_SWEEP_DIRECTION_CLOCKWISE, D2D1_ARC_SIZE_SMALL)); break;
                }
            }
            sink->EndFigure(f.closed ? D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END_OPEN);
        }
        check_hresult(sink->Close());
        return g;
    }

    ID2D1StrokeStyle* D2DReplay::Style()
    {
        // Direct2D dash lengths are in line widths; the canvas's are in user units
        std::wstring key = std::to_wstring(m_st.cap) + L"/" + std::to_wstring(m_st.join);
        std::vector<float> dashes;
        for (float d : m_st.dash) { dashes.push_back(d / std::max(m_st.width, 0.001f)); key += L"/" + std::to_wstring(dashes.back()); }
        auto& s = m_styles[key];
        if (!s)
        {
            auto cap = m_st.cap == 1 ? D2D1_CAP_STYLE_ROUND : m_st.cap == 2 ? D2D1_CAP_STYLE_SQUARE : D2D1_CAP_STYLE_FLAT;
            auto props = D2D1::StrokeStyleProperties(cap, cap, cap, m_st.join == 1 ? D2D1_LINE_JOIN_ROUND : D2D1_LINE_JOIN_MITER_OR_BEVEL, 10.0f,
                dashes.empty() ? D2D1_DASH_STYLE_SOLID : D2D1_DASH_STYLE_CUSTOM, 0.0f);
            check_hresult(m_factory->CreateStrokeStyle(props, dashes.empty() ? nullptr : dashes.data(), static_cast<UINT32>(dashes.size()), s.put()));
        }
        return s.get();
    }

    void D2DReplay::Apply(D2D1::Matrix3x2F const& base)
    {
        m_ctx->SetTransform(m_st.m * base);
    }

    void D2DReplay::Text(std::wstring const& t, float x, float y, float size, int font, int align, int baseline, D2D1::Matrix3x2F const& base)
    {
        if (!(size > 0)) return;
        int key = static_cast<int>(std::lround(size * 2)) * 4 + font * 2 + (align == 1 ? 1 : 0);
        auto& f = m_formats[key];
        if (!f)
        {
            check_hresult(m_dwrite->CreateTextFormat(font == 1 ? L"Georgia" : L"Segoe UI", nullptr,
                font == 1 ? DWRITE_FONT_WEIGHT_BOLD : DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL,
                std::max(0.5f, std::lround(size * 2) / 2.0f), L"", f.put()));
            f->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
            f->SetTextAlignment(align == 1 ? DWRITE_TEXT_ALIGNMENT_CENTER : DWRITE_TEXT_ALIGNMENT_LEADING);
        }
        f->SetParagraphAlignment(baseline == 1 ? DWRITE_PARAGRAPH_ALIGNMENT_CENTER : DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
        const float big = 100000.0f;
        D2D1_RECT_F r = align == 1 ? D2D1::RectF(x - big, y, x + big, y) : D2D1::RectF(x, y, x + big, y);
        if (baseline == 1) { r.top = y - size * 2; r.bottom = y + size * 2; } else { r.bottom = y + big; }
        Apply(base);
        m_brush->SetColor(WithAlpha(m_st.fill, m_st.alpha));
        m_ctx->DrawText(t.c_str(), static_cast<UINT32>(t.size()), f.get(), r, m_brush.get());
    }

    void D2DReplay::Play(DrawList const& d, D2D1::Matrix3x2F const& base)
    {
        m_st = State{};
        m_stack.clear();
        m_figs.clear();
        size_t k = 0, t = 0;
        auto a = [&]() { return k < d.args.size() ? d.args[k++] : 0.0; };
        auto f = [&]() { return static_cast<float>(a()); };
        // gives the current subpath a start point if it has none; returns false when it had none (canvas: lineTo then only moves)
        auto pt = [&](float x, float y) {
            auto& fig = Current();
            if (fig.hasStart) return true;
            fig.start = { x, y };
            fig.hasStart = true;
            return false;
        };
        for (int op : d.ops)
        {
            switch (op)
            {
            case SAVE: m_stack.push_back(m_st); m_st.layers = 0; break;
            case RESTORE:
                for (int i = 0; i < m_st.layers; i++) m_ctx->PopLayer();
                if (!m_stack.empty()) { m_st = m_stack.back(); m_stack.pop_back(); }
                break;
            case TRANSLATE: { float x = f(), y = f(); m_st.m = D2D1::Matrix3x2F::Translation(x, y) * m_st.m; break; }
            case SCALE: { float x = f(), y = f(); m_st.m = D2D1::Matrix3x2F::Scale(x, y) * m_st.m; break; }
            case BEGIN: m_figs.clear(); break;
            case MOVE: { float x = f(), y = f(); m_figs.emplace_back(); m_figs.back().start = { x, y }; m_figs.back().hasStart = true; break; }
            case LINE: { float x = f(), y = f(); if (pt(x, y)) Current().segs.push_back({ 0, { x, y } }); break; }
            case QUAD: { float cx = f(), cy = f(), x = f(), y = f(); pt(cx, cy); Current().segs.push_back({ 1, { cx, cy, x, y } }); break; }
            case BEZIER: { float c1x = f(), c1y = f(), c2x = f(), c2y = f(), x = f(), y = f(); pt(c1x, c1y); Current().segs.push_back({ 2, { c1x, c1y, c2x, c2y, x, y } }); break; }
            case ARC:
            {
                float x = f(), y = f(), r = f(); a(); a(); // the core only draws whole circles
                if (r > 0)
                {
                    Figure c;
                    c.start = { x + r, y };
                    c.hasStart = true;
                    c.segs.push_back({ 3, { x - r, y, r } });
                    c.segs.push_back({ 3, { x + r, y, r } });
                    c.closed = true;
                    m_figs.push_back(std::move(c));
                    m_figs.emplace_back(); // what follows starts a new subpath
                }
                break;
            }
            case RECT:
            {
                float x = f(), y = f(), w = f(), h = f();
                Figure c;
                c.start = { x, y };
                c.hasStart = true;
                c.segs.push_back({ 0, { x + w, y } });
                c.segs.push_back({ 0, { x + w, y + h } });
                c.segs.push_back({ 0, { x, y + h } });
                c.closed = true;
                m_figs.push_back(std::move(c));
                m_figs.emplace_back();
                break;
            }
            case CLOSE:
                if (!m_figs.empty() && !m_figs.back().segs.empty())
                {
                    auto start = m_figs.back().start;
                    m_figs.back().closed = true;
                    m_figs.emplace_back();
                    m_figs.back().start = start;
                    m_figs.back().hasStart = true;
                }
                break;
            case FILL:
            {
                auto g = Geometry();
                Apply(base);
                m_brush->SetColor(WithAlpha(m_st.fill, m_st.alpha));
                m_ctx->FillGeometry(g.get(), m_brush.get());
                break;
            }
            case STROKE:
            {
                auto g = Geometry();
                Apply(base);
                float alpha = m_st.alpha * (m_st.grain ? 0.75f : 1.0f);
                if (m_st.shadowBlur > 0)
                {
                    // the soft brush's glow, approximated: a wider, faint stroke underneath
                    m_brush->SetColor(WithAlpha(m_st.stroke, alpha * 0.25f));
                    m_ctx->DrawGeometry(g.get(), m_brush.get(), m_st.width + m_st.shadowBlur, Style());
                }
                m_brush->SetColor(WithAlpha(m_st.stroke, alpha));
                m_ctx->DrawGeometry(g.get(), m_brush.get(), m_st.width, Style());
                break;
            }
            case CLIP:
            {
                auto g = Geometry();
                Apply(base);
                m_ctx->PushLayer(D2D1::LayerParameters1(D2D1::InfiniteRect(), g.get()), nullptr);
                m_st.layers++;
                break;
            }
            case FILL_RECT:
            {
                float x = f(), y = f(), w = f(), h = f();
                Apply(base);
                m_brush->SetColor(WithAlpha(m_st.fill, m_st.alpha));
                m_ctx->FillRectangle(D2D1::RectF(x, y, x + w, y + h), m_brush.get());
                break;
            }
            case FILL_COLOR: m_st.fill = Argb(a()); break;
            case STROKE_COLOR: m_st.stroke = Argb(a()); m_st.grain = false; break;
            case STROKE_GRAIN: m_st.stroke = Argb(a()); m_st.grain = true; break;
            case LINE_WIDTH: { double w = a(); if (std::isfinite(w) && w > 0) m_st.width = static_cast<float>(w); break; }
            case LINE_CAP: m_st.cap = static_cast<int>(a()); break;
            case LINE_JOIN: m_st.join = static_cast<int>(a()); break;
            case LINE_DASH:
            {
                int n = static_cast<int>(a());
                std::vector<float> ds;
                bool ok = true;
                for (int i = 0; i < n; i++) { double v = a(); if (!std::isfinite(v) || v < 0) ok = false; ds.push_back(static_cast<float>(v)); }
                m_st.dash = ok ? ds : std::vector<float>{};
                break;
            }
            case ALPHA: { double v = a(); if (std::isfinite(v)) m_st.alpha = static_cast<float>(std::clamp(v, 0.0, 1.0)); break; }
            case SHADOW: { a(); double b = a(); m_st.shadowBlur = std::isfinite(b) ? static_cast<float>(std::max(0.0, b)) : 0.0f; break; }
            case TEXT:
            {
                float x = f(), y = f(), size = f();
                int font = static_cast<int>(a()), align = static_cast<int>(a()), bl = static_cast<int>(a());
                if (t < d.texts.size()) Text(d.texts[t], x, y, size, font, align, bl, base);
                t++;
                break;
            }
            }
        }
        // clips left open at the top level
        for (int i = 0; i < m_st.layers; i++) m_ctx->PopLayer();
        while (!m_stack.empty())
        {
            m_st = m_stack.back();
            m_stack.pop_back();
            for (int i = 0; i < m_st.layers; i++) m_ctx->PopLayer();
        }
        m_ctx->SetTransform(base);
    }
}
