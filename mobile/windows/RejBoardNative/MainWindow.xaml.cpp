#include "pch.h"
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif
#include "CoreApi.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Windows::Data::Json;

namespace
{
    struct BrushInfo { const char* key; const wchar_t* name; double size; };
    // DEF in index.html
    const BrushInfo BRUSHES[] = {
        { "fount", L"Fountain pen", 6 }, { "calli", L"Calligraphy", 8 }, { "soft", L"Soft brush", 14 }, { "ball", L"Ballpoint", 3 },
        { "pencil", L"Pencil", 3 }, { "hsq", L"Highlighter", 18 }, { "hch", L"Chisel highlighter", 18 }, { "hrd", L"Round highlighter", 18 },
    };
    const char* COLORS[] = { "#111111", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ffffff" };

    // The desktop's log size slider (szFromR / szToR, same as BrushSize in the core): 0..1000 -> lo..hi px.
    double SizeFromSlider(double r, double lo, double hi)
    {
        double v = lo * std::pow(hi / lo, std::clamp(r, 0.0, 1000.0) / 1000.0);
        return v < 10 ? std::floor(v * 10 + 0.5) / 10 : std::floor(v + 0.5);
    }
    double SliderFromSize(double v, double lo, double hi)
    {
        return std::floor(1000 * std::log(std::clamp(v, lo, hi) / lo) / std::log(hi / lo) + 0.5);
    }

    winrt::Windows::UI::Color ParseColor(std::string const& hex)
    {
        auto c = static_cast<uint32_t>(std::stoul(hex.substr(1), nullptr, 16));
        return winrt::Windows::UI::Color{ 255, static_cast<uint8_t>(c >> 16), static_cast<uint8_t>(c >> 8), static_cast<uint8_t>(c) };
    }
}

namespace winrt::RejBoardNative::implementation
{
    void MainWindow::InitializeComponent()
    {
        MainWindowT::InitializeComponent();
        // the RejBoard logo in the title bar and Alt+Tab (the Electron app's icon.ico)
        try { AppWindow().SetIcon(L"Assets\\AppIcon.ico"); } catch (...) {}
        m_renderer = std::make_unique<::RejBoard::BoardRenderer>(BoardPanel());
        m_renderer->onChanged = [this] { ScheduleSave(); };
        m_renderer->onError = [this](std::wstring const& text)
        {
            ErrorBar().Message(winrt::hstring(text));
            ErrorBar().IsOpen(true);
            SetStatus(winrt::hstring(text));
        };
        if (!m_renderer->startupError.empty()) m_renderer->onError(m_renderer->startupError);

        for (auto const& b : BRUSHES)
        {
            BrushBox().Items().Append(winrt::box_value(winrt::hstring(b.name)));
            bool hl = b.key[0] == 'h';
            m_brushes.push_back({ b.size, 30, 60, std::string(b.key) == "hch" ? 45.0 : 135.0, hl ? 35.0 : 100.0 });
        }
        m_meterTimer = DispatcherQueue().CreateTimer();
        m_meterTimer.Interval(std::chrono::milliseconds(50));
        m_meterTimer.Tick([this](auto&&, auto&&)
        {
            if (!m_editorOpen) return;
            double p = rb_last_pressure();
            PressureMeter().Value(p);
            wchar_t buf[32];
            swprintf_s(buf, L"Pressure %.2f", p);
            PressureMeterText().Text(buf);
        });
        m_meterTimer.Start();
        for (auto c : COLORS)
        {
            Controls::Button sw;
            sw.Width(28);
            sw.Height(28);
            sw.Padding(ThicknessHelper::FromUniformLength(0));
            sw.Background(Media::SolidColorBrush(ParseColor(c)));
            std::string color = c;
            sw.Click([this, color](auto&&, auto&&)
            {
                m_color = color;
                EraserButton().IsChecked(false);
                ApplyTool();
            });
            Swatches().Children().Append(sw);
        }

        m_saveTimer = DispatcherQueue().CreateTimer();
        m_saveTimer.Interval(std::chrono::milliseconds(1500));
        m_saveTimer.IsRepeating(false);
        m_saveTimer.Tick([this](auto&&, auto&&)
        {
            if (m_editorOpen && rb_editor_dirty() == 1) rb_editor_save(::RejBoard::NowMs());
        });
        Closed([this](auto&&, auto&&) { if (m_editorOpen) rb_editor_close(::RejBoard::NowMs()); });

        // Boards live only in this package's own LocalState folder, never in the Electron app's data.
        auto folder = winrt::to_string(Windows::Storage::ApplicationData::Current().LocalFolder().Path());
        m_storeOpen = rb_store_open(folder.c_str(), ::RejBoard::NowMs()) == 1;
        auto version = ::RejBoard::Take(rb_version()).value_or("?");
        m_ready = true;
        BrushBox().SelectedIndex(0);
        if (!m_storeOpen)
        {
            SetStatus(L"Could not open the board database: " + winrt::hstring(::RejBoard::LastError()));
            return;
        }
        SetStatus(L"Core " + winrt::to_hstring(version) + L". Boards are stored in this app only.");
        RefreshList();
        // open the first board right away, so the canvas never starts empty
        if (BoardList().Items().Size() > 0) BoardList().SelectedIndex(0);
    }

    void MainWindow::SetStatus(winrt::hstring const& text)
    {
        Status().Text(text);
    }

    void MainWindow::ScheduleSave()
    {
        m_saveTimer.Stop();
        m_saveTimer.Start();
    }

    void MainWindow::SetSliderFor(double size)
    {
        bool er = EraserButton().IsChecked() && EraserButton().IsChecked().Value();
        SizeSlider().Value(er ? SliderFromSize(size, 0.5, 80) : SliderFromSize(size, 0.1, 60));
    }

    // Sends the chosen brush (or the eraser) to the core.
    void MainWindow::ApplyTool()
    {
        if (!m_ready) return;
        bool er = EraserButton().IsChecked() && EraserButton().IsChecked().Value();
        double size = er ? m_eraserSize : m_brushSize;
        wchar_t buf[32];
        swprintf_s(buf, size < 10 ? L"%.1f px" : L"%.0f px", size);
        SizeText().Text(buf);
        if (!m_editorOpen) return;
        if (er)
        {
            bool whole = EraseWholeCheck().IsChecked() && EraseWholeCheck().IsChecked().Value();
            bool hl = EraseHighlighterCheck().IsChecked() && EraseHighlighterCheck().IsChecked().Value();
            rb_set_eraser_ex(m_eraserSize, whole ? 1 : 0, hl ? 1 : 0);
        }
        else
        {
            int k = std::max(0, BrushBox().SelectedIndex());
            auto& b = m_brushes[k];
            b.size = m_brushSize;
            rb_set_brush_ex(BRUSHES[k].key, b.size, m_color.c_str(), b.stab, b.pressure, b.angle, b.opacity);
        }
    }

    void MainWindow::OnBrushChanged(winrt::Windows::Foundation::IInspectable const&, Controls::SelectionChangedEventArgs const&)
    {
        if (!m_ready) return;
        int k = std::max(0, BrushBox().SelectedIndex());
        m_brushSize = m_brushes[k].size;
        EraserButton().IsChecked(false);
        SetSliderFor(m_brushSize);
        ShowBrushSettings();
        ApplyTool();
    }

    // Puts the selected brush's settings into the flyout's sliders (Opacity only where the desktop shows it).
    void MainWindow::ShowBrushSettings()
    {
        int k = std::max(0, BrushBox().SelectedIndex());
        auto const& b = m_brushes[k];
        m_loadingSettings = true;
        StabSlider().Value(b.stab);
        PressureSlider().Value(b.pressure);
        AngleSlider().Value(b.angle);
        OpacitySlider().Value(b.opacity);
        std::string key = BRUSHES[k].key;
        bool opacity = !(key == "fount" || key == "calli" || key == "ball" || key == "pencil");
        OpacitySlider().Visibility(opacity ? Visibility::Visible : Visibility::Collapsed);
        OpacityText().Visibility(opacity ? Visibility::Visible : Visibility::Collapsed);
        m_loadingSettings = false;
        wchar_t buf[64];
        swprintf_s(buf, L"Stabiliser %.0f", b.stab); StabText().Text(buf);
        swprintf_s(buf, L"Pressure %.0f", b.pressure); PressureText().Text(buf);
        swprintf_s(buf, L"Nib angle %.0f\u00B0", b.angle); AngleText().Text(buf);
        swprintf_s(buf, L"Opacity %.0f%%", b.opacity); OpacityText().Text(buf);
    }

    void MainWindow::OnBrushSetting(winrt::Windows::Foundation::IInspectable const&, Controls::Primitives::RangeBaseValueChangedEventArgs const&)
    {
        if (!m_ready || m_loadingSettings) return;
        int k = std::max(0, BrushBox().SelectedIndex());
        auto& b = m_brushes[k];
        b.stab = std::round(StabSlider().Value());
        b.pressure = std::round(PressureSlider().Value());
        b.angle = std::round(AngleSlider().Value());
        b.opacity = std::round(OpacitySlider().Value());
        EraserButton().IsChecked(false);
        ShowBrushSettings();
        ApplyTool();
    }

    void MainWindow::OnEraserOption(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        EraserButton().IsChecked(true);
        SetSliderFor(m_eraserSize);
        ApplyTool();
    }

    // Pressure sensitivity, tilt shading, pressure feel and the pen button, as on the desktop's pen panel.
    void MainWindow::ApplyPen()
    {
        if (!m_ready || !m_editorOpen) return;
        rb_set_pen(PressureToggle().IsOn() ? 1 : 0, TiltToggle().IsOn() ? 1 : 0, std::round(CurveSlider().Value()), BarrelToggle().IsOn() ? 1 : 0);
        double c = std::round(CurveSlider().Value());
        CurveText().Text(c < 50 ? L"Pressure feel: soft" : c > 50 ? L"Pressure feel: firm" : L"Pressure feel: raw");
    }

    void MainWindow::OnPenSetting(winrt::Windows::Foundation::IInspectable const&, Controls::Primitives::RangeBaseValueChangedEventArgs const&)
    {
        ApplyPen();
    }

    void MainWindow::OnPenToggle(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        ApplyPen();
    }

    void MainWindow::OnEraserClick(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        bool er = EraserButton().IsChecked() && EraserButton().IsChecked().Value();
        SetSliderFor(er ? m_eraserSize : m_brushSize);
        ApplyTool();
    }

    void MainWindow::OnSizeChanged(winrt::Windows::Foundation::IInspectable const&, Controls::Primitives::RangeBaseValueChangedEventArgs const& e)
    {
        if (!m_ready) return;
        bool er = EraserButton().IsChecked() && EraserButton().IsChecked().Value();
        if (er) m_eraserSize = SizeFromSlider(e.NewValue(), 0.5, 80);
        else m_brushSize = SizeFromSlider(e.NewValue(), 0.1, 60);
        ApplyTool();
    }

    void MainWindow::OnUndo(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        if (m_editorOpen && rb_undo() == 1) { m_renderer->Invalidate(); ScheduleSave(); }
    }

    void MainWindow::OnRedo(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        if (m_editorOpen && rb_redo() == 1) { m_renderer->Invalidate(); ScheduleSave(); }
    }

    void MainWindow::OnFingerToggle(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        m_renderer->fingerDraws = FingerToggle().IsChecked() && FingerToggle().IsChecked().Value();
    }

    void MainWindow::RefreshList(std::string const& select)
    {
        auto json = ::RejBoard::Take(rb_store_list());
        if (!json)
        {
            SetStatus(L"Could not list boards: " + winrt::hstring(::RejBoard::LastError()));
            return;
        }
        m_ids.clear();
        auto items = BoardList().Items();
        items.Clear();
        int selectIndex = -1;
        for (auto const& v : JsonArray::Parse(winrt::to_hstring(*json)))
        {
            auto o = v.GetObject();
            auto id = winrt::to_string(o.GetNamedString(L"id"));
            auto title = o.GetNamedString(L"title");
            bool locked = o.GetNamedBoolean(L"locked", false);
            if (id == select) selectIndex = static_cast<int>(m_ids.size());
            m_ids.push_back(id);
            items.Append(winrt::box_value(locked ? L"\U0001F512 " + title : title));
        }
        if (selectIndex >= 0) BoardList().SelectedIndex(selectIndex);
    }

    void MainWindow::OnBoardSelected(winrt::Windows::Foundation::IInspectable const&, Controls::SelectionChangedEventArgs const&)
    {
        int k = BoardList().SelectedIndex();
        if (k < 0 || k >= static_cast<int>(m_ids.size())) return;
        m_saveTimer.Stop();
        if (rb_editor_open(m_ids[k].c_str(), ::RejBoard::NowMs()) != 1)
        {
            m_editorOpen = false;
            m_renderer->BoardClosed();
            auto err = L"Opening the board failed: " + ::RejBoard::LastError();
            ErrorBar().Message(winrt::hstring(err));
            ErrorBar().IsOpen(true);
            SetStatus(winrt::hstring(err));
            return;
        }
        ErrorBar().IsOpen(false);
        m_editorOpen = true;
        ApplyTool();
        ApplyPen();
        m_renderer->BoardOpened();
        SetStatus(L"Write with a pen, mouse or finger. Pen side button or eraser end erases. Right-drag or two fingers to pan; Ctrl+wheel zooms.");
    }

    winrt::fire_and_forget MainWindow::OnOpenFile(winrt::Windows::Foundation::IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        if (!m_storeOpen) co_return;

        Windows::Storage::Pickers::FileOpenPicker picker;
        picker.FileTypeFilter().Append(L".rjwb");
        // a desktop (non-UWP) window must hand its HWND to the picker
        HWND hwnd{};
        check_hresult(this->try_as<::IWindowNative>()->get_WindowHandle(&hwnd));
        picker.as<::IInitializeWithWindow>()->Initialize(hwnd);

        auto file = co_await picker.PickSingleFileAsync();
        if (!file) co_return;
        auto text = co_await Windows::Storage::FileIO::ReadTextAsync(file);
        auto id = ::RejBoard::Take(rb_store_import(winrt::to_string(text).c_str(), ::RejBoard::NowMs()));
        if (!id)
        {
            SetStatus(L"Could not open " + file.Name() + L": " + winrt::hstring(::RejBoard::LastError()));
            co_return;
        }
        RefreshList(*id);
    }
}
