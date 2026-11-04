#pragma once
#include "D2DReplay.h"

namespace RejBoard
{
    // The board's ink surface: a SwapChainPanel drawn with Direct2D, fed by the core's editor (rb_* in rejboard_core.h).
    // - Dry ink (paper excepted) is recorded once per change into an ID2D1CommandList and replayed under the view transform.
    // - Wet ink (the stroke being drawn) is replayed from the core on every pen sample, presented without waiting for vsync.
    // - Pen (Windows Ink: Surface pen, Wacom, MPP/USI): pressure, tilt, twist, barrel button (erases while held) and the
    //   eraser end (inverted pen), with every intermediate point. XAML hands these over from WM_POINTER (POINTER_PEN_INFO).
    // - Palm rejection: once a pen has been used, touch never draws; one finger pans, two fingers pan and zoom.
    //   Mouse: left draws, right or middle button pans, wheel scrolls, Ctrl+wheel zooms.
    class BoardRenderer
    {
    public:
        explicit BoardRenderer(winrt::Microsoft::UI::Xaml::Controls::SwapChainPanel const& panel);

        // a board was opened with rb_editor_open
        void BoardOpened();
        void BoardClosed();
        // the board changed outside the panel (undo / redo)
        void Invalidate();
        void Render();

        bool fingerDraws = true;
        // called after a stroke or erase changed the board
        std::function<void()> onChanged;

    private:
        void CreateDevice();
        void CreateSwapChain();
        void Resize();
        void RebuildDry();
        void Sample(winrt::Microsoft::UI::Input::PointerPoint const& p, int tool, bool begin);

        winrt::Microsoft::UI::Xaml::Controls::SwapChainPanel m_panel;
        winrt::com_ptr<ID3D11Device> m_d3d;
        winrt::com_ptr<ID2D1Factory1> m_factory;
        winrt::com_ptr<ID2D1Device> m_d2dDevice;
        winrt::com_ptr<ID2D1DeviceContext> m_ctx;
        winrt::com_ptr<IDXGISwapChain1> m_swapChain;
        winrt::com_ptr<ID2D1Bitmap1> m_target;
        winrt::com_ptr<IDWriteFactory> m_dwrite;
        winrt::com_ptr<ID2D1CommandList> m_dry;
        std::unique_ptr<D2DReplay> m_replay;

        bool m_open = false;
        bool m_fitted = false;
        int m_dryVersion = -1;
        float m_scaleX = 1, m_scaleY = 1;   // composition scale (DPI)
        float m_width = 0, m_height = 0;    // panel size in DIPs

        // input
        bool m_penSeen = false;
        uint32_t m_inkPointer = 0;
        bool m_inking = false;
        int m_inkTool = 0;
        winrt::Windows::Foundation::Point m_lastInkPos{};
        std::map<uint32_t, winrt::Windows::Foundation::Point> m_pans; // pointers panning / zooming
    };
}
