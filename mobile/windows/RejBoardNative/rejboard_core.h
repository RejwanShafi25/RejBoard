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

// ---- editing and ink (InkApi.kt). One board is open for editing at a time; positions are view DIPs. ----
// Draw lists come back as malloc'ed doubles, freed with rb_free_doubles:
//   [nOps, nArgs, nTexts, ops..., args..., then per text: length n and n UTF-16 code units]  (opcodes: DrawList.kt)
void rb_free_doubles(double* p);
int rb_editor_open(const char* board_id, long long now_ms);   // 1 = ok (saves and closes the previous board)
int rb_editor_close(long long now_ms);                        // saves if changed
int rb_editor_save(long long now_ms);
int rb_editor_dirty(void);
int rb_view_fit(double width, double height);
int rb_view_pan(double dx, double dy);
int rb_view_zoom(double factor, double cx, double cy);
int rb_view_get(double* out_ox_oy_zoom);
int rb_set_brush(const char* tool, double size, const char* color); // tool: fount calli soft ball pencil hsq hch hrd
int rb_set_eraser(double size, int whole);
// tool: 0 pen, 1 eraser tip, 2 touch, 3 mouse; buttons: 1 barrel button, 2 eraser; t in ms; tilt in degrees
int rb_ink_begin(double x, double y, double pressure, double tilt_x, double tilt_y, double twist, double t, int tool, int buttons);
int rb_ink_move(double x, double y, double pressure, double tilt_x, double tilt_y, double twist, double t, int tool, int buttons);
int rb_ink_end(void);      // 1 when the board changed
int rb_ink_cancel(void);
int rb_undo(void);
int rb_redo(void);
int rb_ink_version(void);  // changes whenever the items change
double* rb_draw_paper(double width, double height, int* count); // view space
double* rb_draw_dry(int* count);                                // board space
double* rb_draw_wet(int* count);                                // board space

// faster drawing: dry ink in chunks (a finished stroke adds one), wet ink in pieces on a kept layer
int rb_dry_generation(void);              // changes when every chunk must be drawn again
int rb_dry_chunk_count(void);
double* rb_draw_dry_chunk(int index, int* count);   // board space
int rb_wet_incremental(void);             // 1: draw rb_draw_wet_new on a kept layer and rb_draw_wet_tail on top each frame
int rb_wet_generation(void);              // changes when the kept wet layer must be cleared
double* rb_draw_wet_new(int* count);      // board space
double* rb_draw_wet_tail(int* count);     // board space (also the eraser ring)
// the desktop brush panel: size px, stabiliser 0..100, pressure 0..100, nib angle 0..180, opacity 5..100
int rb_set_brush_ex(const char* tool, double size, const char* color, double stab, double pressure, double angle, double opacity);
int rb_set_eraser_ex(double size, int whole, int only_highlighter);
int rb_set_pen(int pressure_on, int tilt_on, double curve, int barrel_erases);
double rb_last_pressure(void);

#ifdef __cplusplus
}
#endif
