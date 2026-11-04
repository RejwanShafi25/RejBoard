#pragma once

namespace RejBoard
{
    // A draw list from the core (rb_draw_paper / rb_draw_dry / rb_draw_wet), decoded. Owns nothing from the core.
    struct DrawList
    {
        std::vector<int> ops;
        std::vector<double> args;
        std::vector<std::wstring> texts;

        bool empty() const { return ops.empty(); }
        // Takes a buffer from the core (and frees it with rb_free_doubles).
        static DrawList Take(double* buffer, int count);
    };

    // Plays a DrawList on a Direct2D device context: the desktop's canvas calls (paths, dashes, alpha, clip, text) in
    // Direct2D terms. [base] is the transform the list's coordinates are drawn under (view transform for board space).
    // Approximations for now: the soft brush's glow is a wider faint stroke, the pencil's grain a lighter stroke.
    class D2DReplay
    {
    public:
        D2DReplay(ID2D1DeviceContext* ctx, ID2D1Factory* factory, IDWriteFactory* dwrite);
        void Play(DrawList const& list, D2D1::Matrix3x2F const& base);

    private:
        struct Seg { int kind; float p[6]; }; // 0 line (p0,p1), 1 quad, 2 cubic, 3 arc to (p0,p1) radius p2
        // hasStart: the subpath has a current point (moveTo / closePath); without one, the first lineTo only sets it (canvas rules)
        struct Figure { D2D1_POINT_2F start{}; std::vector<Seg> segs; bool closed = false; bool hasStart = false; };
        struct State
        {
            D2D1::Matrix3x2F m = D2D1::Matrix3x2F::Identity();
            D2D1_COLOR_F fill = D2D1::ColorF(0, 0, 0, 1);
            D2D1_COLOR_F stroke = D2D1::ColorF(0, 0, 0, 1);
            bool grain = false;
            float width = 1;
            int cap = 0, join = 0;
            std::vector<float> dash;
            float alpha = 1;
            float shadowBlur = 0;
            int layers = 0; // clips pushed at this save level
        };

        Figure& Current();
        winrt::com_ptr<ID2D1PathGeometry> Geometry();
        ID2D1StrokeStyle* Style();
        void Apply(D2D1::Matrix3x2F const& base);
        void Text(std::wstring const& t, float x, float y, float size, int font, int align, int baseline, D2D1::Matrix3x2F const& base);

        ID2D1DeviceContext* m_ctx;
        ID2D1Factory* m_factory;
        IDWriteFactory* m_dwrite;
        winrt::com_ptr<ID2D1SolidColorBrush> m_brush;
        std::map<std::wstring, winrt::com_ptr<ID2D1StrokeStyle>> m_styles;
        std::map<int, winrt::com_ptr<IDWriteTextFormat>> m_formats;
        std::vector<Figure> m_figs;
        State m_st;
        std::vector<State> m_stack;
    };
}
