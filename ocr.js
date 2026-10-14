'use strict';
/*
 * On-device handwriting -> text (main process). NO network, NO API keys, NO files written.
 *
 * The renderer draws the selected strokes to a small black-on-white PNG and sends the bytes over IPC.
 * The bytes go straight into a BUNDLED Tesseract.js worker (WebAssembly), so the image only ever lives in RAM
 * and is garbage-collected right after. The same engine is used on Windows, macOS and Linux, and every build
 * ships it (resources/ocr/node_modules + resources/ocr/tessdata/eng.traineddata), so it works offline with
 * zero downloads. During development it is read from ./ocr-engine (run `npm run libs` once).
 */
const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // refuse anything bigger: a handwriting crop is never this large
const MAX_TEXT = 4000;
const IDLE_KILL_MS = 30000;               // the worker is released after 30 s idle to free RAM

// app language code -> Tesseract language code. Only the languages whose .traineddata is in ocr-engine/tessdata are used;
// anything else falls back to English.
const LANGS = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', pt: 'por', it: 'ita', ru: 'rus', tr: 'tur', zh: 'chi_sim', ja: 'jpn',
  ko: 'kor', hi: 'hin', ar: 'ara', bn: 'ben', ur: 'urd'
};
const langOf = l => LANGS[String(l || 'en').slice(0, 2)] || LANGS.en;

/* ---------- helpers ---------- */
const isPng = b => b && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const pngSize = b => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) }); // IHDR: no image decoding needed
const clean = t => String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT);

/* ---------- Tesseract.js (bundled: resources/ocr in packaged builds, ./ocr-engine in development) ---------- */
function tessJsRoot() {
  const c = [process.resourcesPath && path.join(process.resourcesPath, 'ocr'), path.join(__dirname, 'ocr-engine')];
  for (const d of c) { try { if (d && fs.existsSync(path.join(d, 'node_modules', 'tesseract.js', 'package.json'))) return d; } catch (_) {} }
  return null;
}
let worker = null, workerLang = '', idleTimer = null;
async function killWorker() { clearTimeout(idleTimer); const w = worker; worker = null; workerLang = ''; if (w) { try { await w.terminate(); } catch (_) {} } }
async function viaTesseractJs(png, lang) {
  const root = tessJsRoot();
  if (!root) throw new Error('the bundled OCR engine is missing (development: run "npm run libs" once)');
  let T; try { T = require(path.join(root, 'node_modules', 'tesseract.js')); } catch (e) { throw new Error('could not load the bundled OCR engine: ' + ((e && e.message) || e)); }
  const dir = path.join(root, 'tessdata');
  let code = langOf(lang);
  if (!fs.existsSync(path.join(dir, code + '.traineddata'))) code = 'eng'; // only English ships by default
  if (!fs.existsSync(path.join(dir, code + '.traineddata'))) throw new Error('eng.traineddata is missing from the bundled OCR data');
  if (!worker || workerLang !== code) { // language data is read from disk next to the app: no download, no cache files
    await killWorker();
    /* Inside Electron, Tesseract.js treats `langPath` as a web address and tries to download it ("Only absolute URLs are
       supported"). Its cache is read straight from disk instead, so point the cache at our bundled tessdata folder and
       make it read-only: the traineddata file is found locally and nothing is ever fetched or written.
       errorHandler keeps a worker error from becoming an uncaught exception (it still rejects the promise we await). */
    worker = await T.createWorker(code, 1, { cachePath: dir, cacheMethod: 'readOnly', langPath: dir, gzip: false, errorHandler: () => {} }); workerLang = code;
  }
  const { w, h } = pngSize(png);
  try { await worker.setParameters({ tessedit_pageseg_mode: h && w / h > 4 ? '7' : '6' }); } catch (_) {} // 7 = single text line, 6 = block of text
  const r = await worker.recognize(Buffer.from(png));
  clearTimeout(idleTimer); idleTimer = setTimeout(killWorker, IDLE_KILL_MS);
  return r.data.text;
}

/* ---------- entry point ---------- */
async function recognize(png, lang) {
  try { return { ok: true, engine: 'Tesseract.js', text: clean(await viaTesseractJs(png, lang)) }; }
  catch (e) { return { ok: false, error: 'On-device recognition is unavailable (' + ((e && e.message) || e) + ').' }; }
}

function register(ipcMain, app) {
  let busy = false; // one OCR job at a time keeps CPU and RAM flat
  ipcMain.handle('ocr:recognize', async (_e, data, lang) => {
    try {
      const png = data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : data instanceof ArrayBuffer ? Buffer.from(data) : null;
      if (!isPng(png)) return { ok: false, error: 'Invalid image' };
      if (png.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Selection is too large to recognize' };
      if (busy) return { ok: false, error: 'Still recognizing the previous selection' };
      busy = true;
      try { return await recognize(png, lang); } finally { busy = false; }
    } catch (e) { return { ok: false, error: (e && e.message) || 'Recognition failed' }; }
  });
  app.on('before-quit', () => { killWorker(); });
}

module.exports = { register, recognize, _test: { clean, isPng, pngSize, langOf, viaTesseractJs, killWorker, tessJsRoot } };
