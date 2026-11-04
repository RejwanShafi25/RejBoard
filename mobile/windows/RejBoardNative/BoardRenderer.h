#pragma once

namespace RejBoard
{
    // One drawing primitive of the core's scene (see Scene.kt), ready for Direct2D.
    struct Prim
    {
        enum class Kind { Line, Rect, Text } kind = Kind::Line;
        D2D1_COLOR_F color{};          // line / outline / text colour
        D2D1_COLOR_F fill{};           // rect fill
        bool hasFill = false;
        bool hasStroke = false;
        bool ellipse = false;
        float width = 1;               // line width or outline width
        D2D1_RECT_F rect{};            // rect bounds, or text origin in left/top
        float size = 16;               // text size
        std::wstring text;
        std::vector<D2D1_POINT_2F> points;
        winrt::com_ptr<ID2D1PathGeometry> geometry; // built once per line
    };

    // Draws a board's scene into a SwapChainPanel with Direct2D (read-only: drag to pan, wheel to zoom).
    // Phase 2 adds the wet-ink layer and pen input here. Lives as long as its window, so its panel event handlers are never removed.
    class BoardRenderer
    {
    public:
        explicit BoardRenderer(winrt::Microsoft::UI::Xaml::Controls::SwapChainPanel const& panel);

        void SetScene(std::string const& sceneJson);
        void Clear();

    private:
        void CreateDevice();
        void CreateSwapChain();
        void Resize();
        void FitToView();
        void Render();
        IDWriteTextFormat* TextFormat(float size);

        winrt::Microsoft::UI::Xaml::Controls::SwapChainPanel m_panel;
        winrt::com_ptr<ID3D11Device> m_d3d;
        winrt::com_ptr<ID2D1Factory1> m_factory;
        winrt::com_ptr<ID2D1Device> m_d2dDevice;
        winrt::com_ptr<ID2D1DeviceContext> m_ctx;
        winrt::com_ptr<IDXGISwapChain1> m_swapChain;
        winrt::com_ptr<ID2D1Bitmap1> m_target;
        winrt::com_ptr<ID2D1SolidColorBrush> m_brush;
        winrt::com_ptr<ID2D1StrokeStyle> m_round;
        winrt::com_ptr<IDWriteFactory> m_dwrite;
        std::map<int, winrt::com_ptr<IDWriteTextFormat>> m_formats;

        std::vector<Prim> m_prims;
        std::string m_sceneJson;
        D2D1_COLOR_F m_background = D2D1::ColorF(D2D1::ColorF::White);
        D2D1_RECT_F m_bounds{ 0, 0, 800, 600 };
        bool m_hasScene = false;

        float m_scaleX = 1, m_scaleY = 1;   // composition scale (DPI)
        float m_width = 0, m_height = 0;    // panel size in DIPs
        float m_zoom = 1;
        D2D1_POINT_2F m_pan{ 0, 0 };
        bool m_fitted = false;
        bool m_dragging = false;
        winrt::Windows::Foundation::Point m_last{};
    };
}
