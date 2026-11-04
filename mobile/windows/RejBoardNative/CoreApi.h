#pragma once
// Small C++ helpers over rejboard_core.h: owned strings and UTF-8 / UTF-16 conversion.
#include "rejboard_core.h"

namespace RejBoard
{
    // Takes ownership of a string returned by the core; empty optional for NULL.
    inline std::optional<std::string> Take(char* p)
    {
        if (!p) return std::nullopt;
        std::string s(p);
        rb_free(p);
        return s;
    }

    // Milliseconds since 1970, the core's time stamps
    inline long long NowMs()
    {
        return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    }

    inline std::wstring LastError()
    {
        auto e = Take(rb_last_error());
        return e ? std::wstring(winrt::to_hstring(*e)) : std::wstring(L"unknown error");
    }
}
