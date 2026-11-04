#include "pch.h"
#include "BoardRenderer.h"
#include "CoreApi.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using Microsoft::UI::Input::PointerDeviceType;
using Microsoft::UI::Input::PointerPoint;

namespace RejBoard
{
    namespace
    {
        constexpr int TOOL_PEN = 0, TOOL_ERASER = 1, TOOL_TOUCH = 2, TOOL_MOUSE = 3;

        D2D1::Matrix3x2F ViewTransform()
        {
            double v[3] = { 0, 0, 1 };
            rb_view_get(v);
            return D2D1::Matrix3x2F::Scale(static_cast<float>(v[2]), static_cast<float>(v[2])) *
                D2D1::Matrix3x2F::Translation(static_cast<float>(v[0]), static_cast<float>(v[1]));
        }

        DrawList Fetch(double* buffer, int count) { return DrawList::Take(buffer, count); }
    }

    // Turns the exception being handled into a message for the user (status line / error bar).
    void BoardRenderer::ReportCurrent(wchar_t const* where)
    {
        try { throw; }
        catch (hresult_error const& e) { Report(where, e.code(), std::wstring(e.message())); }
        catch (std::exception const& e) { Report(where, E_FAIL, std::wstring(to_hstring(e.what()))); }
        catch (...) { Report(where, E_FAIL, L"unknown error"); }
    }

    void BoardRenderer::Report(wchar_t const* where, hresult code, std::wstring const& detail)
    {
        wchar_t hr[32];
        swprintf_s(hr, L"0x%08X", static_cast<uint32_t>(code.value));
        std::wstring text = std::wstring(where) + L" failed (" + hr + L"): " + detail;
        if (text == m_lastError) return;
        m_lastError = text;
        if (onError) onError(text);
        else if (startupError.empty()) startupError = text;
    }

    BoardRenderer::BoardRenderer(Controls::SwapChainPanel const& panel) : m_panel(panel)
    {
        try { CreateDevice(); } catch (...) { ReportCurrent(L"Creating the Direct3D / Direct2D device"); }

        m_panel.SizeChanged([this](auto&&, SizeChangedEventArgs const& e)
        {
            m_width = e.NewSize().Width;
            m_height = e.NewSize().Height;
            try { Resize(); } catch (...) { ReportCurrent(L"Creating the swap chain"); }
        });
        m_panel.CompositionScaleChanged([this](Controls::SwapChainPanel const& p, auto&&)
        {
            m_scaleX = p.CompositionScaleX();
            m_scaleY = p.CompositionScaleY();
            try { Resize(); } catch (...) { ReportCurrent(L"Resizing the swap chain"); }
        });

        m_panel.PointerPressed([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            if (!m_open) return;
            auto p = e.GetCurrentPoint(m_panel);
            auto type = e.Pointer().PointerDeviceType();
            auto props = p.Properties();
            int tool = TOOL_TOUCH;
            bool draws = false;
            if (type == PointerDeviceType::Pen)
            {
                m_penSeen = true;
                tool = props.IsEraser() || props.IsInverted() ? TOOL_ERASER : TOOL_PEN;
                draws = true;
            }
            else if (type == PointerDeviceType::Mouse)
            {
                tool = TOOL_MOUSE;
                draws = props.IsLeftButtonPressed();
            }
            else draws = fingerDraws && !m_penSeen && m_pans.empty();

            if (draws && !m_inking)
            {
                m_panel.CapturePointer(e.Pointer());
                m_inkPointer = e.Pointer().PointerId();
                m_inkTool = tool;
                Sample(p, tool, true);
            }
            else if (!draws || type == PointerDeviceType::Touch)
            {
                // a second finger while a finger draws: that stroke was the start of a pinch
                if (m_inking && m_inkTool == TOOL_TOUCH)
                {
                    rb_ink_cancel();
                    m_inking = false;
                    m_pans[m_inkPointer] = m_lastInkPos;
                }
                if (m_inking) return; // palm or extra finger while the pen draws
                m_panel.CapturePointer(e.Pointer());
                m_pans[e.Pointer().PointerId()] = p.Position();
            }
            e.Handled(true);
        });

        m_panel.PointerMoved([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            if (!m_open) return;
            uint32_t id = e.Pointer().PointerId();
            if (m_inking && id == m_inkPointer)
            {
                // every sample since the last event, oldest first
                std::vector<PointerPoint> pts;
                for (auto const& q : e.GetIntermediatePoints(m_panel)) pts.push_back(q);
                std::sort(pts.begin(), pts.end(), [](PointerPoint const& a, PointerPoint const& b) { return a.Timestamp() < b.Timestamp(); });
                for (auto const& q : pts) Sample(q, m_inkTool, false);
                if (rb_wet_incremental() == 1) { try { UpdateWet(); } catch (...) { ReportCurrent(L"Drawing the stroke"); } Render(); }
                else if (m_inkTool == TOOL_ERASER || rb_ink_version() != m_lastInkVersion) RequestRender(); // erasing changes the board
                else Render();
                e.Handled(true);
                return;
            }
            auto it = m_pans.find(id);
            if (it == m_pans.end()) return;
            auto np = e.GetCurrentPoint(m_panel).Position();
            if (m_pans.size() == 1)
            {
                rb_view_pan(np.X - it->second.X, np.Y - it->second.Y);
            }
            else
            {
                // two pointers: pan by the centroid, zoom by the change in distance
                auto other = std::find_if(m_pans.begin(), m_pans.end(), [&](auto const& q) { return q.first != id; })->second;
                float cx0 = (it->second.X + other.X) / 2, cy0 = (it->second.Y + other.Y) / 2;
                float cx1 = (np.X + other.X) / 2, cy1 = (np.Y + other.Y) / 2;
                float d0 = std::hypot(it->second.X - other.X, it->second.Y - other.Y), d1 = std::hypot(np.X - other.X, np.Y - other.Y);
                rb_view_pan(cx1 - cx0, cy1 - cy0);
                if (d0 > 1 && d1 > 1) rb_view_zoom(d1 / d0, cx1, cy1);
            }
            it->second = np;
            RequestRender();
            e.Handled(true);
        });

        auto finish = [this](Input::PointerRoutedEventArgs const& e, bool cancelled)
        {
            uint32_t id = e.Pointer().PointerId();
            if (m_inking && id == m_inkPointer)
            {
                m_inking = false;
                if (cancelled) rb_ink_cancel();
                else if (rb_ink_end() == 1 && onChanged) onChanged();
                Render();
            }
            m_pans.erase(id);
            m_panel.ReleasePointerCapture(e.Pointer());
        };
        m_panel.PointerReleased([finish](auto&&, Input::PointerRoutedEventArgs const& e) { finish(e, false); });
        m_panel.PointerCanceled([finish](auto&&, Input::PointerRoutedEventArgs const& e) { finish(e, true); });
        m_panel.PointerCaptureLost([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            uint32_t id = e.Pointer().PointerId();
            if (m_inking && id == m_inkPointer) { m_inking = false; rb_ink_cancel(); Render(); }
            m_pans.erase(id);
        });

        m_panel.PointerWheelChanged([this](auto&&, Input::PointerRoutedEventArgs const& e)
        {
            if (!m_open) return;
            auto p = e.GetCurrentPoint(m_panel);
            int delta = p.Properties().MouseWheelDelta();
            bool ctrl = (static_cast<uint32_t>(e.KeyModifiers()) & static_cast<uint32_t>(Windows::System::VirtualKeyModifiers::Control)) != 0;
            if (ctrl) rb_view_zoom(std::pow(1.0015, delta), p.Position().X, p.Position().Y);
            else if (p.Properties().IsHorizontalMouseWheel()) rb_view_pan(-delta, 0);
            else rb_view_pan(0, delta);
            RequestRender();
            e.Handled(true);
        });
    }

    void BoardRenderer::Sample(PointerPoint const& p, int tool, bool begin)
    {
        auto pos = p.Position();
        m_lastInkPos = pos;
        auto props = p.Properties();
        double pressure = tool == TOOL_PEN || tool == TOOL_ERASER ? props.Pressure() : 0.0;
        int buttons = props.IsBarrelButtonPressed() ? 1 : 0;
        double t = static_cast<double>(p.Timestamp()) / 1000.0; // microseconds -> ms
        if (begin)
        {
            m_inking = rb_ink_begin(pos.X, pos.Y, pressure, props.XTilt(), props.YTilt(), props.Twist(), t, tool, buttons) == 1;
            Render();
        }
        else rb_ink_move(pos.X, pos.Y, pressure, props.XTilt(), props.YTilt(), props.Twist(), t, tool, buttons);
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
        check_hresult(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<::IUnknown**>(m_dwrite.put())));
        m_replay = std::make_unique<D2DReplay>(m_ctx.get(), static_cast<ID2D1Factory*>(m_factory.get()), m_dwrite.get());
        m_chunks.clear();
        m_dryGeneration = -1;
        m_wet = nullptr;
        m_wetGeneration = -1;
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
        CreateWetLayer();
        if (m_open && !m_fitted) { rb_view_fit(m_width, m_height); m_fitted = true; }
        Render();
    }

    void BoardRenderer::BoardOpened()
    {
        m_open = true;
        m_fitted = false;
        m_inking = false;
        m_pans.clear();
        m_chunks.clear();
        m_dryGeneration = -1;
        m_wetGeneration = -1;
        if (m_width > 0 && m_height > 0) { rb_view_fit(m_width, m_height); m_fitted = true; }
        Render();
    }

    void BoardRenderer::BoardClosed()
    {
        m_open = false;
        m_chunks.clear();
        m_dryGeneration = -1;
        Render();
    }

    void BoardRenderer::Invalidate()
    {
        RequestRender();
    }

    void BoardRenderer::RequestRender()
    {
        if (m_renderQueued) return;
        m_renderQueued = true;
        // low priority: runs after the pending input events, so a burst of moves costs one redraw
        m_panel.DispatcherQueue().TryEnqueue(Microsoft::UI::Dispatching::DispatcherQueuePriority::Low, [this]
        {
            m_renderQueued = false;
            Render();
        });
    }

    // The kept wet layer: a bitmap the size of the swap chain, in the same DPI, so it is drawn 1:1.
    void BoardRenderer::CreateWetLayer()
    {
        m_wet = nullptr;
        m_wetGeneration = -1;
        UINT w = std::max(1u, static_cast<UINT>(m_width * m_scaleX));
        UINT h = std::max(1u, static_cast<UINT>(m_height * m_scaleY));
        auto props = D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_TARGET,
            D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96.0f * m_scaleX, 96.0f * m_scaleY);
        check_hresult(m_ctx->CreateBitmap(D2D1::SizeU(w, h), nullptr, 0, &props, m_wet.put()));
    }

    // Adds the segments of the stroke that became final since the last call to the kept wet layer.
    void BoardRenderer::UpdateWet()
    {
        if (!m_wet || !m_target) return;
        int gen = rb_wet_generation();
        bool clear = gen != m_wetGeneration;
        m_wetGeneration = gen;
        int count = 0;
        auto list = Fetch(rb_draw_wet_new(&count), count);
        if (!clear && list.empty()) return;
        m_ctx->SetTarget(m_wet.get());
        m_ctx->BeginDraw();
        try
        {
            m_ctx->SetTransform(D2D1::Matrix3x2F::Identity());
            if (clear) m_ctx->Clear(D2D1::ColorF(0, 0, 0, 0));
            if (!list.empty()) m_replay->Play(list, ViewTransform());
        }
        catch (...)
        {
            m_ctx->EndDraw();
            m_ctx->SetTarget(m_target.get());
            throw;
        }
        HRESULT hr = m_ctx->EndDraw();
        m_ctx->SetTarget(m_target.get());
        check_hresult(hr);
    }

    // Records the core's dry-ink chunks into command lists (board space), so panning and zooming only replay them.
    // While the core's dry generation stays the same, earlier chunks are unchanged: only the new ones are recorded.
    void BoardRenderer::RebuildDry()
    {
        int gen = rb_dry_generation();
        int n = rb_dry_chunk_count();
        if (gen != m_dryGeneration || n < static_cast<int>(m_chunks.size()))
        {
            m_chunks.clear();
            m_dryGeneration = gen;
        }
        for (int k = static_cast<int>(m_chunks.size()); k < n; k++)
        {
            int count = 0;
            auto list = Fetch(rb_draw_dry_chunk(k, &count), count);
            com_ptr<ID2D1CommandList> cl;
            check_hresult(m_ctx->CreateCommandList(cl.put()));
            com_ptr<ID2D1Image> old;
            m_ctx->GetTarget(old.put());
            m_ctx->SetTarget(cl.get());
            m_ctx->BeginDraw();
            try { m_replay->Play(list, D2D1::Matrix3x2F::Identity()); }
            catch (...)
            {
                // a Direct2D draw left open would make every later frame fail: end it, put the target back, report
                m_ctx->EndDraw();
                m_ctx->SetTarget(old.get());
                throw;
            }
            HRESULT hr = m_ctx->EndDraw();
            m_ctx->SetTarget(old.get());
            check_hresult(hr);
            check_hresult(cl->Close());
            m_chunks.push_back(cl);
        }
        m_lastInkVersion = rb_ink_version();
    }

    void BoardRenderer::Render()
    {
        try { RenderFrame(); }
        catch (...) { ReportCurrent(L"Drawing the board"); }
    }

    void BoardRenderer::RenderFrame()
    {
        if (!m_target || !m_ctx) return;
        if (m_open)
        {
            try { RebuildDry(); }
            catch (...) { ReportCurrent(L"Preparing the board's ink"); }
        }
        m_ctx->BeginDraw();
        try
        {
        m_ctx->SetTransform(D2D1::Matrix3x2F::Identity());
        m_ctx->Clear(D2D1::ColorF(0.93f, 0.94f, 0.96f));
        if (m_open)
        {
            int count = 0;
            auto paper = Fetch(rb_draw_paper(m_width, m_height, &count), count);
            if (paper.empty()) Report(L"Getting the paper from the core", E_FAIL, LastError());
            m_replay->Play(paper, D2D1::Matrix3x2F::Identity());
            auto view = ViewTransform();
            m_ctx->SetTransform(view);
            for (auto const& cl : m_chunks) m_ctx->DrawImage(cl.get());
            count = 0;
            if (m_inking && rb_wet_incremental() == 1)
            {
                // the kept final segments, then the provisional end (and nothing is repainted twice)
                m_ctx->SetTransform(D2D1::Matrix3x2F::Identity());
                if (m_wet && m_wetGeneration == rb_wet_generation()) m_ctx->DrawImage(m_wet.get());
                auto tail = Fetch(rb_draw_wet_tail(&count), count);
                if (!tail.empty()) m_replay->Play(tail, view);
            }
            else
            {
                auto wet = Fetch(rb_draw_wet(&count), count);
                if (!wet.empty()) m_replay->Play(wet, view);
            }
            m_ctx->SetTransform(D2D1::Matrix3x2F::Identity());
        }
        }
        catch (...)
        {
            m_ctx->EndDraw();
            throw;
        }
        HRESULT hr = m_ctx->EndDraw();
        if (hr == D2DERR_RECREATE_TARGET)
        {
            // device lost: rebuild everything; the next event draws again
            m_ctx->SetTarget(nullptr);
            m_target = nullptr;
            m_swapChain = nullptr;
            m_d3d = nullptr; m_factory = nullptr; m_d2dDevice = nullptr; m_ctx = nullptr; m_dwrite = nullptr; m_replay = nullptr;
            CreateDevice();
            Resize();
            return;
        }
        check_hresult(hr);
        // while inking, present at once instead of waiting for the next vertical blank: lower latency
        m_swapChain->Present(m_inking ? 0 : 1, 0);
    }
}
