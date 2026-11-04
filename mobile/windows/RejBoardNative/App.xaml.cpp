#include "pch.h"
#include "App.xaml.h"
#include "MainWindow.xaml.h"
#include "Diagnostics.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;

namespace winrt::RejBoardNative::implementation
{
    App::App()
    {
        // In every build: an exception nothing else caught is logged to LocalState\rejboard-native.log and shown, and the
        // app keeps running where it can, instead of ending with a bare "stowed exception" crash.
        UnhandledException([](winrt::Windows::Foundation::IInspectable const&, UnhandledExceptionEventArgs const& e)
        {
            wchar_t hr[16];
            swprintf_s(hr, L"0x%08X", static_cast<uint32_t>(e.Exception().value));
            ::RejBoard::ShowError(L"Unexpected error", std::wstring(hr) + L" " + std::wstring(e.Message()));
#if defined _DEBUG
            if (IsDebuggerPresent()) __debugbreak();
#endif
            e.Handled(true);
        });
    }

    void App::OnLaunched([[maybe_unused]] LaunchActivatedEventArgs const& e)
    {
        ::RejBoard::Log(L"Start", L"launching");
        try
        {
            window = make<MainWindow>();
            window.Activate();
            ::RejBoard::Log(L"Start", L"window shown");
        }
        catch (...)
        {
            ::RejBoard::ShowError(L"RejBoard Native could not start", ::RejBoard::CurrentError());
            Exit();
        }
    }
}
