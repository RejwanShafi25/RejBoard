#pragma once
// Crash and error reporting for the preview: anything that goes wrong is written to
// %LOCALAPPDATA%\Packages\com.rejwan.rejboard.native_<id>\LocalState\rejboard-native.log and can be shown in a plain
// Win32 message box (which works even when XAML itself is broken), so a failed test run says what failed.

namespace RejBoard
{
    // The exception being handled, as text (call inside a catch block).
    inline std::wstring CurrentError()
    {
        try { throw; }
        catch (winrt::hresult_error const& e)
        {
            wchar_t hr[16];
            swprintf_s(hr, L"0x%08X", static_cast<uint32_t>(e.code().value));
            return std::wstring(hr) + L" " + std::wstring(e.message());
        }
        catch (std::exception const& e) { return std::wstring(winrt::to_hstring(e.what())); }
        catch (...) { return L"unknown error"; }
    }

    inline std::wstring LogPath()
    {
        try { return std::wstring(winrt::Windows::Storage::ApplicationData::Current().LocalFolder().Path()) + L"\\rejboard-native.log"; }
        catch (...) { return L""; }
    }

    // Appends a line to the log (never throws).
    inline void Log(std::wstring const& where, std::wstring const& what)
    {
        try
        {
            auto path = LogPath();
            if (path.empty()) return;
            SYSTEMTIME t{};
            GetLocalTime(&t);
            wchar_t stamp[64];
            swprintf_s(stamp, L"%04u-%02u-%02u %02u:%02u:%02u ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
            auto line = winrt::to_string(std::wstring(stamp) + where + L": " + what) + "\r\n";
            HANDLE h = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (h == INVALID_HANDLE_VALUE) return;
            DWORD written = 0;
            WriteFile(h, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
            CloseHandle(h);
        }
        catch (...) {}
    }

    // Logs and shows a message box (never throws).
    inline void ShowError(std::wstring const& where, std::wstring const& what)
    {
        Log(where, what);
        std::wstring text = where + L"\n\n" + what + L"\n\nDetails are in " + LogPath();
        MessageBoxW(nullptr, text.c_str(), L"RejBoard Native (preview)", MB_OK | MB_ICONERROR);
    }

    // Runs a XAML event handler body; an exception is logged and shown in the window's status instead of escaping into
    // XAML (an exception escaping a handler ends the app with a "stowed exception" crash).
    template <typename F>
    inline void Guard(wchar_t const* where, F&& body, std::function<void(std::wstring const&)> const& report = {})
    {
        try { body(); }
        catch (...)
        {
            auto what = CurrentError();
            Log(where, what);
            if (report) { try { report(std::wstring(where) + L": " + what); } catch (...) {} }
        }
    }
}
