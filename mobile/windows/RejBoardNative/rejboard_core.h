// C ABI of the shared RejBoard core (rejboard_core.dll, built by Kotlin/Native for mingwX64).
// Kept in step with mobile/core/src/mingwX64Main/kotlin/com/rejwan/rejboard/core/CApi.kt; CI checks the names against the
// header Kotlin/Native generates (rejboard_core_api.h).
// Strings are UTF-8. Every returned string is owned by the caller and must be released with rb_free; NULL means failure and
// rb_last_error() says why. Call from one thread (the UI thread).
#pragma once

#ifdef __cplusplus
extern "C" {
#endif

char* rb_version(void);
void rb_free(char* p);
char* rb_last_error(void);

// Opens (or creates) the board database in `folder` (the app's package LocalState). now_ms: current time, ms since 1970.
// 1 = ok, 0 = failed.
int rb_store_open(const char* folder, long long now_ms);
// JSON array of {"id","title","updated","locked","items"}, newest first.
char* rb_store_list(void);
// Imports the text of a .rjwb file; returns the board id.
char* rb_store_import(const char* rjwb_text, long long now_ms);
// The board's drawing scene as JSON: {"bg":argb,"bounds":[x0,y0,x1,y1],"prims":[{"k":"line"|"rect"|"text",...}]}.
char* rb_board_scene(const char* board_id);
char* rb_board_title(const char* board_id);

#ifdef __cplusplus
}
#endif
