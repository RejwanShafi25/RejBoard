// Electron main process: opens the app and proxies handwriting recognition.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const lanShare = require('./lan');
const path = require('path');
const fs = require('fs');
// The app used to be called "Rejwan Whiteboard". Electron stores boards in a folder named after the app,
// so keep using the old folder when it exists; otherwise renaming would make existing boards disappear.
try { const old = path.join(app.getPath('appData'), 'Rejwan Whiteboard'), cur = path.join(app.getPath('appData'), 'RejBoard');
  if (fs.existsSync(old) && !fs.existsSync(cur)) app.setPath('userData', old); } catch (e) {}
const URL_ = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8'; // unofficial; swap for another engine if needed
ipcMain.handle('hw', async (_e, d) => {
  const body = { options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: d.w, writing_area_height: d.h }, ink: d.ink, language: d.lang === 'zh' ? 'zh_CN' : d.lang }] };
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  return j[0] === 'SUCCESS' ? j[1][0][1][0] : '';
});
// ---- Word / PowerPoint -> PDF, so the renderer can import them as rendered pages (same as a PDF) ----
const { execFile } = require('child_process');
const os = require('os');
const DOC_EXT = ['docx', 'doc', 'odt', 'rtf'], SLIDE_EXT = ['pptx', 'ppt', 'odp'];
function findSoffice() {
  const c = [process.env.SOFFICE,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice'];
  for (const x of c) { try { if (x && fs.existsSync(x)) return x; } catch (e) {} }
  return process.platform === 'win32' ? null : 'soffice'; // on mac/linux fall back to PATH lookup
}
const run = (cmd, args, opts) => new Promise((res, rej) => execFile(cmd, args, Object.assign({ timeout: 180000, windowsHide: true }, opts), (e, so, se) => e ? rej(new Error((se || e.message || '').toString().trim().slice(0, 300))) : res(so)));
async function viaLibreOffice(inp, dir) {
  const so = findSoffice(); if (!so) throw new Error('LibreOffice not found');
  const prof = require('url').pathToFileURL(path.join(dir, 'lo-profile')).href; // private profile: works even if LibreOffice is already open
  await run(so, ['--headless', '--norestore', '--nolockcheck', '-env:UserInstallation=' + prof, '--convert-to', 'pdf', '--outdir', dir, inp]);
  const out = path.join(dir, path.basename(inp).replace(/\.[^.]+$/, '') + '.pdf');
  if (!fs.existsSync(out)) throw new Error('LibreOffice did not produce a PDF');
  return out;
}
async function viaOffice(inp, dir, slides) { // Windows only: Microsoft Word / PowerPoint through COM
  if (process.platform !== 'win32') throw new Error('Microsoft Office is only available on Windows');
  const out = path.join(dir, 'office.pdf');
  const ps = slides
    ? "$ErrorActionPreference='Stop';$a=New-Object -ComObject PowerPoint.Application;try{$d=$a.Presentations.Open($env:WB_IN,-1,0,0);$d.SaveAs($env:WB_OUT,32);$d.Close()}finally{$a.Quit()}"
    : "$ErrorActionPreference='Stop';$a=New-Object -ComObject Word.Application;$a.Visible=$false;$a.DisplayAlerts=0;try{$d=$a.Documents.Open($env:WB_IN,$false,$true);$d.SaveAs2($env:WB_OUT,17);$d.Close(0)}finally{$a.Quit()}";
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { env: Object.assign({}, process.env, { WB_IN: inp, WB_OUT: out }) });
  if (!fs.existsSync(out)) throw new Error('Microsoft Office did not produce a PDF');
  return out;
}
ipcMain.handle('doc:toPdf', async (_e, name, data) => {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (![...DOC_EXT, ...SLIDE_EXT].includes(ext)) return { ok: false, error: 'Unsupported document type' };
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rejboard-'));
    const inp = path.join(dir, 'in.' + ext); // plain ASCII name avoids Unicode / spaces problems in the converters
    fs.writeFileSync(inp, Buffer.from(data));
    const errs = []; let out = null;
    try { out = await viaLibreOffice(inp, dir); } catch (e) { errs.push(e.message); }
    if (!out) { try { out = await viaOffice(inp, dir, SLIDE_EXT.includes(ext)); } catch (e) { errs.push(e.message); } }
    if (!out) return { ok: false, error: 'No converter worked (' + errs.filter(Boolean).join(' / ') + ')' };
    return { ok: true, pdf: fs.readFileSync(out) };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (dir) fs.rm(dir, { recursive: true, force: true }, () => {}); }
});
ipcMain.handle('image:fetch-remote', async (_e, rawUrl) => {
  try {
    const u = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false };
    const response = await fetch(u, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return { ok: false };
    const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) return { ok: false };
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 12 * 1024 * 1024) return { ok: false };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) return { ok: false };
    return { ok: true, type, data: bytes.toString('base64') };
  } catch (_) { return { ok: false }; }
});
ipcMain.handle('browser:clear', async () => { try { const ses = require('electron').session.fromPartition('rejboard-ephemeral'); await ses.clearStorageData(); await ses.clearCache(); return true; } catch (_) { return false; } });
function createWindow() {
  const w = new BrowserWindow({ width: 1320, height: 860, title: 'RejBoard', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#fff7fa',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true, nodeIntegration: false, sandbox: true } });
  w.setMenuBarVisibility(false);
  lanShare.register(ipcMain, w);
  w.loadFile('index.html');
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(createWindow);
// The renderer uses a non-persistent partition for embedded browsing. Clear its in-memory
// cookies/cache/storage when the app exits; this cannot erase data a website has on its servers.
let finalCleanupStarted = false;
app.on('before-quit', (event) => {
  if (finalCleanupStarted) return;
  event.preventDefault(); finalCleanupStarted = true;
  (async () => { try { const ses = require('electron').session.fromPartition('rejboard-ephemeral'); await ses.clearStorageData(); await ses.clearCache(); } catch (_) {} finally { app.quit(); } })();
});
app.on('window-all-closed', () => app.quit());
