#pragma once

#include "MainWindow.g.h"
#include "BoardRenderer.h"

namespace winrt::RejBoardNative::implementation
{
    struct MainWindow : MainWindowT<MainWindow>
    {
        MainWindow() = default;

        // XAML elements exist only after this (see the C++/WinRT InitializeComponent notes)
        void InitializeComponent();

        winrt::fire_and_forget OnOpenFile(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnBoardSelected(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        void OnBrushChanged(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        void OnEraserClick(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSizeChanged(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::Controls::Primitives::RangeBaseValueChangedEventArgs const& args);
        void OnUndo(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRedo(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnFingerToggle(winrt::Windows::Foundation::IInspectable const& sender, Microsoft::UI::Xaml::RoutedEventArgs const& args);

    private:
        void RefreshList(std::string const& select = {});
        void SetStatus(winrt::hstring const& text);
        void ApplyTool();
        void SetSliderFor(double size);
        void ScheduleSave();

        std::vector<std::string> m_ids;
        std::unique_ptr<::RejBoard::BoardRenderer> m_renderer;
        winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer m_saveTimer{ nullptr };
        bool m_storeOpen = false;
        bool m_editorOpen = false;
        bool m_ready = false;
        std::string m_color = "#111111";
        double m_brushSize = 6;
        double m_eraserSize = 16;
    };
}

namespace winrt::RejBoardNative::factory_implementation
{
    struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
    {
    };
}
