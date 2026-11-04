#include "pch.h"
#include "BoardRenderer.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Windows::Data::Json;

namespace RejBoard
{
    namespace
    {
        // 0xAARRGGBB (sent as a JSON number) to a Direct2D colour
        D2D1_COLOR_F Argb(double v)
        {
            auto c = static_cast<uint32_t>(static_cast<uint64_t>(v));
            return D2D1::ColorF(((c >> 16) & 0xFF) / 255.0f, ((c >> 8) & 0xFF) / 255.0f, (c & 0xFF) / 255.0f, ((c >> 24) & 0xFF) / 255.0f);
        }

        float Num(JsonObject const& o, wchar_t const* key, double fallback = 0)
        {
            return static_cast<float>(o.GetNamedNumber(key, fallback));
        }
    }

    BoardRenderer::BoardRenderer(Controls::SwapChainPanel const& panel) : m_panel(panel)
    {
        CreateDevice();

        m_panel.SizeChanged([this](auto&&, SizeChangedEventArgs const& e)
        {
            m_width = e.NewSize().Width;
            m_height = e.NewSize().Height;
            Resize();
        });
        m_panel.CompositionScaleChanged([this](Controls::SwapChainPanel const& p, auto&&)
        {
            m_scaleX = p.CompositionScaleX();
            m_scaleY = p.CompositionScaleY();
            Resize();
        });
        m_panel.PointerPressed([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            m_dragging = m_panel.CapturePointer(e.Pointer());
            m_last = e.GetCurrentPoint(m_panel).Position();
        });
        m_panel.PointerMoved([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            if (!m_dragging) return;
            auto p = e.GetCurrentPoint(m_panel).Position();
            m_pan.x += p.X - m_last.X;
            m_pan.y += p.Y - m_last.Y;
            m_last = p;
            Render();
        });
        m_panel.PointerReleased([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            m_dragging = false;
            m_panel.ReleasePointerCapture(e.Pointer());
        });
        m_panel.PointerWheelChanged([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            auto pt = e.GetCurrentPoint(m_panel);
            float factor = std::pow(1.0015f, static_cast<float>(pt.Properties().MouseWheelDelta()));
            float z = std::clamp(m_zoom * factor, 0.05f, 20.0f);
            auto c = pt.Position();
            // keep the board point under the cursor where it is
            m_pan.x = c.X - (c.X - m_pan.x) * (z / m_zoom);
            m_pan.y = c.Y - (c.Y - m_pan.y) * (z / m_zoom);
            m_zoom = z;
            Render();
            e.Handled(true);
        });
    }

    void BoardRenderer::CreateDevice()
    {
        UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
        D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0 };
        HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels, ARRAYSIZE(levels), D3D11_SDK_VERSION, m_d3d.put(), nullptr, nullptr);
        if (FAILED(hr)) // no usable GPU (e.g. a VM): software rendering
            check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags, levels, ARRAYSIZE(levels), D3D11_SDK_VERSION, m_d3d.put(), nullptr, nullptr));

        D2D1_FACTORY_OPTIONS options{};
        check_hresult(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, __uuidof(ID2D1Factory1), &options, m_factory.put_void()));
        auto dxgi = m_d3d.as<IDXGIDevice>();
        check_hresult(m_factory->CreateDevice(dxgi.get(), m_d2dDevice.put()));
        check_hresult(m_d2dDevice->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE, m_ctx.put()));
        check_hresult(m_ctx->CreateSolidColorBrush(D2D1::ColorF(D2D1::ColorF::Black), m_brush.put()));

        D2D1_STROKE_STYLE_PROPERTIES round = D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND, D2D1_LINE_JOIN_ROUND);
        check_hresult(static_cast<ID2D1Factory*>(m_factory.get())->CreateStrokeStyle(round, nullptr, 0, m_round.put()));
        check_hresult(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<::IUnknown**>(m_dwrite.put())));
    }

    void BoardRenderer::CreateSwapChain()
    {
        DXGI_SWAP_CHAIN_DESC1 desc{};
        desc.Width = std::max(1u, static_cast<UINT>(m_width * m_scaleX));
        desc.Height = std::max(1u, static_cast<UINT>(m_height * m_scaleY));
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc.Count = 1;
        desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
        desc.BufferCount = 2;
        desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
        desc.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED;

        auto dxgiDevice = m_d3d.as<IDXGIDevice>();
        com_ptr<IDXGIAdapter> adapter;
        check_hresult(dxgiDevice->GetAdapter(adapter.put()));
        com_ptr<IDXGIFactory2> factory;
        check_hresult(adapter->GetParent(__uuidof(IDXGIFactory2), factory.put_void()));
        check_hresult(factory->CreateSwapChainForComposition(m_d3d.get(), &desc, nullptr, m_swapChain.put()));
        check_hresult(m_panel.as<ISwapChainPanelNative>()->SetSwapChain(m_swapChain.get()));
    }

    void BoardRenderer::Resize()
    {
        if (m_width <= 0 || m_height <= 0) return;
        m_ctx->SetTarget(nullptr);
        m_target = nullptr;
        UINT w = std::max(1u, static_cast<UINT>(m_width * m_scaleX));
        UINT h = std::max(1u, static_cast<UINT>(m_height * m_scaleY));
        if (!m_swapChain) CreateSwapChain();
        else check_hresult(m_swapChain->ResizeBuffers(2, w, h, DXGI_FORMAT_B8G8R8A8_UNORM, 0));

        // the swap chain is in physical pixels; tell the panel to scale it back to DIPs
        DXGI_MATRIX_3X2_F inverse{};
        inverse._11 = 1.0f / m_scaleX;
        inverse._22 = 1.0f / m_scaleY;
        check_hresult(m_swapChain.as<IDXGISwapChain2>()->SetMatrixTransform(&inverse));

        com_ptr<IDXGISurface> surface;
        check_hresult(m_swapChain->GetBuffer(0, __uuidof(IDXGISurface), surface.put_void()));
        auto props = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
            D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96.0f * m_scaleX, 96.0f * m_scaleY);
        check_hresult(m_ctx->CreateBitmapFromDxgiSurface(surface.get(), &props, m_target.put()));
        m_ctx->SetTarget(m_target.get());
        m_ctx->SetDpi(96.0f * m_scaleX, 96.0f * m_scaleY);
        if (m_hasScene && !m_fitted) FitToView();
        Render();
    }

    void BoardRenderer::Clear()
    {
        m_prims.clear();
        m_sceneJson.clear();
        m_hasScene = false;
        m_background = D2D1::ColorF(D2D1::ColorF::White);
        Render();
    }

    void BoardRenderer::SetScene(std::string const& sceneJson)
    {
        m_sceneJson = sceneJson;
        auto root = JsonObject::Parse(to_hstring(sceneJson));
        m_background = Argb(root.GetNamedNumber(L"bg", 4294967295.0));
        auto b = root.GetNamedArray(L"bounds");
        m_bounds = D2D1::RectF(static_cast<float>(b.GetNumberAt(0)), static_cast<float>(b.GetNumberAt(1)),
            static_cast<float>(b.GetNumberAt(2)), static_cast<float>(b.GetNumberAt(3)));

        m_prims.clear();
        for (auto const& v : root.GetNamedArray(L"prims"))
        {
            auto o = v.GetObject();
            auto kind = o.GetNamedString(L"k");
            Prim p;
            p.color = Argb(o.GetNamedNumber(L"c", 4278190080.0));
            if (kind == L"line")
            {
                p.kind = Prim::Kind::Line;
                p.width = Num(o, L"w", 1);
                auto a = o.GetNamedArray(L"p");
                for (uint32_t k = 0; k + 1 < a.Size(); k += 2)
                    p.points.push_back({ static_cast<float>(a.GetNumberAt(k)), static_cast<float>(a.GetNumberAt(k + 1)) });
                if (p.points.size() >= 2)
                {
                    check_hresult(static_cast<ID2D1Factory*>(m_factory.get())->CreatePathGeometry(p.geometry.put()));
                    com_ptr<ID2D1GeometrySink> sink;
                    check_hresult(p.geometry->Open(sink.put()));
                    sink->BeginFigure(p.points[0], D2D1_FIGURE_BEGIN_HOLLOW);
                    sink->AddLines(p.points.data() + 1, static_cast<UINT32>(p.points.size() - 1));
                    sink->EndFigure(D2D1_FIGURE_END_OPEN);
                    check_hresult(sink->Close());
                }
            }
            else if (kind == L"rect")
            {
                p.kind = Prim::Kind::Rect;
                float x = Num(o, L"x"), y = Num(o, L"y");
                p.rect = D2D1::RectF(x, y, x + Num(o, L"w"), y + Num(o, L"h"));
                p.fill = Argb(o.GetNamedNumber(L"f", 0));
                p.hasFill = p.fill.a > 0;
                p.width = Num(o, L"lw", 1);
                p.hasStroke = p.color.a > 0 && p.width > 0;
                p.ellipse = o.GetNamedBoolean(L"e", false);
            }
            else if (kind == L"text")
            {
                p.kind = Prim::Kind::Text;
                p.rect = D2D1::RectF(Num(o, L"x"), Num(o, L"y"), Num(o, L"x") + 100000.0f, Num(o, L"y") + 100000.0f);
                p.size = std::max(1.0f, Num(o, L"s", 16));
                p.text = std::wstring(o.GetNamedString(L"t"));
            }
            else continue;
            m_prims.push_back(std::move(p));
        }
        m_hasScene = true;
        m_fitted = false;
        if (m_target) FitToView();
        Render();
    }

    void BoardRenderer::FitToView()
    {
        const float margin = 24;
        float bw = std::max(1.0f, m_bounds.right - m_bounds.left);
        float bh = std::max(1.0f, m_bounds.bottom - m_bounds.top);
        m_zoom = std::clamp(std::min((m_width - 2 * margin) / bw, (m_height - 2 * margin) / bh), 0.05f, 4.0f);
        m_pan = { margin - m_bounds.left * m_zoom, margin - m_bounds.top * m_zoom };
        m_fitted = true;
    }

    IDWriteTextFormat* BoardRenderer::TextFormat(float size)
    {
        int key = static_cast<int>(std::lround(size * 2)); // half-point steps
        auto& f = m_formats[key];
        if (!f)
        {
            check_hresult(m_dwrite->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL, key / 2.0f, L"", f.put()));
            f->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
        }
        return f.get();
    }

    void BoardRenderer::Render()
    {
        if (!m_target) return;
        m_ctx->BeginDraw();
        m_ctx->SetTransform(D2D1::Matrix3x2F::Identity());
        m_ctx->Clear(m_hasScene ? m_background : D2D1::ColorF(0.93f, 0.94f, 0.96f));
        m_ctx->SetTransform(D2D1::Matrix3x2F::Scale(m_zoom, m_zoom) * D2D1::Matrix3x2F::Translation(m_pan.x, m_pan.y));
        for (auto const& p : m_prims)
        {
            switch (p.kind)
            {
            case Prim::Kind::Line:
                m_brush->SetColor(p.color);
                if (p.geometry) m_ctx->DrawGeometry(p.geometry.get(), m_brush.get(), p.width, m_round.get());
                else if (!p.points.empty()) m_ctx->FillEllipse(D2D1::Ellipse(p.points[0], p.width / 2, p.width / 2), m_brush.get());
                break;
            case Prim::Kind::Rect:
            {
                auto e = D2D1::Ellipse(D2D1::Point2F((p.rect.left + p.rect.right) / 2, (p.rect.top + p.rect.bottom) / 2),
                    (p.rect.right - p.rect.left) / 2, (p.rect.bottom - p.rect.top) / 2);
                if (p.hasFill)
                {
                    m_brush->SetColor(p.fill);
                    if (p.ellipse) m_ctx->FillEllipse(e, m_brush.get()); else m_ctx->FillRectangle(p.rect, m_brush.get());
                }
                if (p.hasStroke)
                {
                    m_brush->SetColor(p.color);
                    if (p.ellipse) m_ctx->DrawEllipse(e, m_brush.get(), p.width); else m_ctx->DrawRectangle(p.rect, m_brush.get(), p.width);
                }
                break;
            }
            case Prim::Kind::Text:
                m_brush->SetColor(p.color);
                m_ctx->DrawText(p.text.c_str(), static_cast<UINT32>(p.text.size()), TextFormat(p.size), p.rect, m_brush.get());
                break;
            }
        }
        HRESULT hr = m_ctx->EndDraw();
        if (hr == D2DERR_RECREATE_TARGET)
        {
            // device lost: rebuild everything and draw again on the next event
            m_ctx->SetTarget(nullptr);
            m_target = nullptr;
            m_swapChain = nullptr;
            m_formats.clear();
            m_d3d = nullptr; m_factory = nullptr; m_d2dDevice = nullptr; m_ctx = nullptr; m_brush = nullptr; m_round = nullptr; m_dwrite = nullptr;
            CreateDevice();
            Resize();
            if (m_hasScene) SetScene(std::string(m_sceneJson)); // geometries belonged to the old factory: build them again
            return;
        }
        check_hresult(hr);
        m_swapChain->Present(1, 0);
    }
}
