#include "pch.h"
#include "MainWindow.xaml.h"
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif
#include "CoreApi.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Windows::Data::Json;

namespace winrt::RejBoardNative::implementation
{
    void MainWindow::InitializeComponent()
    {
        MainWindowT::InitializeComponent();
        m_renderer = std::make_unique<::RejBoard::BoardRenderer>(BoardPanel());

        // Boards live only in this package's own LocalState folder, never in the Electron app's data.
        auto folder = winrt::to_string(Windows::Storage::ApplicationData::Current().LocalFolder().Path());
        m_storeOpen = rb_store_open(folder.c_str(), ::RejBoard::NowMs()) == 1;
        auto version = ::RejBoard::Take(rb_version()).value_or("?");
        if (!m_storeOpen)
        {
            SetStatus(L"Could not open the board database: " + winrt::hstring(::RejBoard::LastError()));
            return;
        }
        SetStatus(L"Core " + winrt::to_hstring(version) + L". Boards are stored in this app only.");
        RefreshList();
    }

    void MainWindow::SetStatus(winrt::hstring const& text)
    {
        Status().Text(text);
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
        auto scene = ::RejBoard::Take(rb_board_scene(m_ids[k].c_str()));
        if (!scene)
        {
            m_renderer->Clear();
            SetStatus(winrt::hstring(::RejBoard::LastError()));
            return;
        }
        m_renderer->SetScene(*scene);
        SetStatus(L"Read-only view. Drag to pan, mouse wheel to zoom.");
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
