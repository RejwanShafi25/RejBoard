'use strict';
/*
 * On-device handwriting -> text (main process). NO network, NO API keys, NO files written.
 *
 * The renderer draws the selected strokes to a small black-on-white PNG and sends the bytes over IPC.
 * Here the bytes are piped straight into the operating system's own OCR engine through stdin, so the
 * image only ever lives in RAM (a few KB - a few hundred KB) and is garbage-collected right after.
 *
 *   macOS    Apple Vision  (VNRecognizeTextRequest, "accurate" level) via a tiny built-in JXA script
 *   Windows  Windows.Media.Ocr via a built-in PowerShell script
 *   fallback `tesseract` binary if installed (stdin -> stdout), then a BUNDLED tesseract.js (Linux builds ship it
 *            in resources/ocr together with eng.traineddata, so it works offline with zero downloads)
 *
 * Nothing is bundled: the OS does the heavy lifting, so the installer does not grow.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // refuse anything bigger: a handwriting crop is never this large
const MAX_TEXT = 4000;
const TIMEOUT_MS = 30000;
const IDLE_KILL_MS = 30000;               // tesseract.js worker is released after 30 s idle

// app language code -> [BCP-47 for Windows/Vision, Tesseract code]
const LANGS = {
  en: ['en-US', 'eng'], es: ['es-ES', 'spa'], fr: ['fr-FR', 'fra'], de: ['de-DE', 'deu'], pt: ['pt-BR', 'por'],
  it: ['it-IT', 'ita'], ru: ['ru-RU', 'rus'], tr: ['tr-TR', 'tur'], zh: ['zh-Hans', 'chi_sim'], ja: ['ja-JP', 'jpn'],
  ko: ['ko-KR', 'kor'], hi: ['hi-IN', 'hin'], ar: ['ar-SA', 'ara'], bn: ['bn-BD', 'ben'], ur: ['ur-PK', 'urd']
};
const langOf = l => LANGS[String(l || 'en').slice(0, 2)] || LANGS.en;

/* ---------- helpers ---------- */
const isPng = b => b && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const pngSize = b => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) }); // IHDR: no image decoding needed

// Run a command, write `input` to its stdin, return stdout. Output is capped and the process is killed on timeout.
function runStdin(cmd, args, input, env) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: Object.assign({}, process.env, env || {}) }); }
    catch (e) { return reject(e); }
    const out = [], err = []; let outLen = 0, done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); fn(v); };
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} finish(reject, new Error('OCR timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', d => { outLen += d.length; if (outLen < 256 * 1024) out.push(d); });
    child.stderr.on('data', d => { if (err.length < 20) err.push(d); });
    child.on('error', e => finish(reject, e));
    child.stdin.on('error', () => {}); // child may exit before reading everything (EPIPE) - the exit code tells the story
    child.on('close', code => {
      const so = Buffer.concat(out).toString('utf8'), se = Buffer.concat(err).toString('utf8').trim().slice(0, 300);
      code === 0 ? finish(resolve, so) : finish(reject, new Error(se || ('exit code ' + code)));
    });
    child.stdin.end(input);
  });
}

const clean = t => String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT);

/* ---------- macOS: Apple Vision through JXA (ships with every Mac, no Xcode needed) ---------- */
const MAC_JXA = [
  "ObjC.import('Foundation');ObjC.import('Vision');",
  "function run(){",
  " var data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;",
  " if(!data||data.length===0)throw new Error('no image');",
  " var req=$.VNRecognizeTextRequest.alloc.init;",
  " req.recognitionLevel=0;",                // 0 = accurate (this is the level that reads handwriting well)
  " req.usesLanguageCorrection=true;",
  " var lg=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('WB_LANG'));",
  " if(lg&&lg.indexOf('en')!==0){try{req.recognitionLanguages=$([lg,'en-US'])}catch(e){}}",
  " var h=$.VNImageRequestHandler.alloc.initWithDataOptions(data,$({}));",
  " var err=Ref();",
  " if(!h.performRequestsError($([req]),err))throw new Error('Apple Vision could not read the image');",
  " var r=req.results,rows=[];",
  " for(var i=0;i<r.count;i++){var o=r.objectAtIndex(i),c=o.topCandidates(1);if(c.count>0){var y=0,x=0;try{y=o.boundingBox.origin.y;x=o.boundingBox.origin.x}catch(e){}rows.push({y:y,x:x,s:ObjC.unwrap(c.objectAtIndex(0).string)})}}",
  " rows.sort(function(a,b){return Math.abs(b.y-a.y)>0.02?b.y-a.y:a.x-b.x});", // Vision's origin is bottom-left: larger y = higher on the page
  " return rows.map(function(q){return q.s}).join('\\n')",
  "}"
].join('\n');
const viaMac = (png, lang) => runStdin('osascript', ['-l', 'JavaScript', '-e', MAC_JXA], png, { WB_LANG: langOf(lang)[0] });

/* ---------- Windows: Windows.Media.Ocr through PowerShell (-EncodedCommand keeps stdin free for the image) ---------- */
const BT = "'+[char]96+'"; // PowerShell has no clean way to write a backtick inside a literal
const WIN_PS = [
  "$ErrorActionPreference='Stop'",
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]",
  "$null=[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]",
  "$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]",
  "$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation" + BT + "1')})[0]",
  "function Await($op,$t){$k=$asTask.MakeGenericMethod($t).Invoke($null,@($op));$k.Wait(-1)|Out-Null;$k.Result}",
  "$ms=New-Object System.IO.MemoryStream;[Console]::OpenStandardInput().CopyTo($ms);$ms.Position=0",
  "if($ms.Length -eq 0){throw 'no image'}",
  "$ras=[System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)",
  "$dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])",
  "$bmp=Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])",
  "$eng=$null",
  "try{$l=New-Object Windows.Globalization.Language($env:WB_LANG);if([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)){$eng=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l)}}catch{}",
  "if(-not $eng){$eng=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()}",
  "if(-not $eng){throw 'No Windows OCR language pack is installed (Settings > Time & language > Language)'}",
  "$res=Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])",
  "$lines=@($res.Lines|ForEach-Object{$_.Text})",
  "[Console]::Out.Write([string]::Join([Environment]::NewLine,$lines))"
].join('\n');
const WIN_ENC = Buffer.from(WIN_PS, 'utf16le').toString('base64');
const viaWin = (png, lang) => runStdin('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', WIN_ENC], png, { WB_LANG: langOf(lang)[0] });

/* ---------- Tesseract: system binary (stdin -> stdout, no temp files) ---------- */
function findTesseract() {
  const c = [process.env.TESSERACT,
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe', 'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
    '/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/usr/bin/tesseract', '/snap/bin/tesseract'];
  for (const x of c) { try { if (x && fs.existsSync(x)) return x; } catch (_) {} }
  return 'tesseract'; // fall back to PATH lookup (ENOENT -> handled by the caller)
}
async function viaTesseractBin(png, lang) {
  const { w, h } = pngSize(png), psm = h && w / h > 4 ? '7' : '6'; // 7 = single text line, 6 = block of text
  return runStdin(findTesseract(), ['stdin', 'stdout', '-l', langOf(lang)[1], '--psm', psm], png);
}

/* ---------- Tesseract.js (bundled in Linux builds under resources/ocr; in dev under ./ocr-linux) ---------- */
function tessJsRoot() {
  const c = [process.resourcesPath && path.join(process.resourcesPath, 'ocr'), path.join(__dirname, 'ocr-linux')];
  for (const d of c) { try { if (d && fs.existsSync(path.join(d, 'node_modules', 'tesseract.js', 'package.json'))) return d; } catch (_) {} }
  return null;
}
let worker = null, workerLang = '', idleTimer = null;
async function killWorker() { clearTimeout(idleTimer); const w = worker; worker = null; workerLang = ''; if (w) { try { await w.terminate(); } catch (_) {} } }
async function viaTesseractJs(png, lang, userData) {
  const root = tessJsRoot();
  let T; try { T = root ? require(path.join(root, 'node_modules', 'tesseract.js')) : require('tesseract.js'); } catch (_) { throw new Error('tesseract.js is not bundled in this build'); }
  const code = langOf(lang)[1];
  let opts;
  if (root) { // bundled: language data is read from disk next to the app. No download, no cache files.
    const dir = path.join(root, 'tessdata');
    if (!fs.existsSync(path.join(dir, code + '.traineddata'))) throw new Error('only English is bundled with the built-in Tesseract; install the system Tesseract with the "' + code + '" language pack');
    opts = { langPath: dir, gzip: false, cacheMethod: 'none' };
  } else opts = { cachePath: path.join(userData, 'ocr-cache') }; // dev fallback if installed globally
  if (!worker || workerLang !== code) { await killWorker(); worker = await T.createWorker(code, 1, opts); workerLang = code; }
  const r = await worker.recognize(Buffer.from(png));
  clearTimeout(idleTimer); idleTimer = setTimeout(killWorker, IDLE_KILL_MS); // free the RAM when not in use
  return r.data.text;
}

/* ---------- dispatcher ---------- */
async function recognize(png, lang, userData) {
  const native = process.platform === 'darwin' ? ['Apple Vision', viaMac] : process.platform === 'win32' ? ['Windows OCR', viaWin] : null;
  const chain = [native, ['Tesseract', viaTesseractBin], ['Tesseract.js', (p, l) => viaTesseractJs(p, l, userData)]].filter(Boolean);
  const errors = [];
  for (const [name, fn] of chain) {
    try { return { ok: true, engine: name, text: clean(await fn(png, lang)) }; }
    catch (e) { errors.push(name + ': ' + (e && e.code === 'ENOENT' ? 'not installed' : (e && e.message) || e)); }
  }
  const hint = process.platform === 'linux' ? ' Install Tesseract (e.g. "sudo apt install tesseract-ocr") to enable on-device recognition.' : '';
  return { ok: false, error: 'On-device recognition is unavailable (' + errors.join(' | ') + ').' + hint };
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
      try { return await recognize(png, lang, app.getPath('userData')); } finally { busy = false; }
    } catch (e) { return { ok: false, error: (e && e.message) || 'Recognition failed' }; }
  });
  app.on('before-quit', () => { killWorker(); });
}

module.exports = { register, recognize, _test: { clean, isPng, pngSize, langOf, WIN_PS, MAC_JXA, runStdin, viaTesseractJs, killWorker, tessJsRoot } };
