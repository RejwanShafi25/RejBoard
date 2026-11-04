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

    private:
        void RefreshList(std::string const& select = {});
        void SetStatus(winrt::hstring const& text);

        std::vector<std::string> m_ids;
        std::unique_ptr<::RejBoard::BoardRenderer> m_renderer;
        bool m_storeOpen = false;
    };
}

namespace winrt::RejBoardNative::factory_implementation
{
    struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
    {
    };
}
