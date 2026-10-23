// Electron main process: opens the app and proxies handwriting recognition.
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard, dialog } = require('electron');
const lanShare = require('./lan');
const ocr = require('./ocr'); // on-device handwriting OCR (no network, no files)
const backupStore = require('./backup-store'); // automatic daily backups into <app data>/backups
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { canAutoUpdate, canInstallNow, RELEASES_URL } = require('./update-policy');
// The app used to be called "Rejwan Whiteboard". Electron stores boards in a folder named after the app,
// so keep using the old folder when it exists; otherwise renaming would make existing boards disappear.
try { const old = path.join(app.getPath('appData'), 'Rejwan Whiteboard'), cur = path.join(app.getPath('appData'), 'RejBoard');
  if (fs.existsSync(old) && !fs.existsSync(cur)) app.setPath('userData', old); } catch (e) {}
// End-to-end smoke test (npm run test:smoke): development checkouts only, always on a throw-away profile so real boards are never touched.
const SMOKE = process.env.REJBOARD_SMOKE === '1' && !app.isPackaged;
const SPLASH_TEST = SMOKE && process.env.REJBOARD_SMOKE_SPLASH === '1'; // smoke test of the start-up window: the page is loaded late on purpose
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'rejboard-smoke-')));
const URL_ = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8'; // unofficial; swap for another engine if needed
ipcMain.handle('hw', async (_e, d) => {
  const body = { options: 'enable_pre_space', requests: [{ writing_guide: { writing_area_width: d.w, writing_area_height: d.h }, ink: d.ink, language: d.lang === 'zh' ? 'zh_CN' : d.lang }] };
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  return j[0] === 'SUCCESS' ? j[1][0][1][0] : '';
});
ocr.register(ipcMain, app);
backupStore.register(ipcMain, app, shell);
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
// Language packs: downloaded once by the renderer's request, then cached in the app (localStorage).
const PACK_BASE = 'https://raw.githubusercontent.com/RejwanShafi25/RejBoard/main/locales/';
ipcMain.handle('i18n:fetch', async (_e, file) => {
  if (!/^(index|[a-z]{2,3}(-[A-Za-z]{2,4})?)\.json$/.test(String(file))) throw new Error('bad file');
  // 1) the pack bundled with the app (works offline, never 404s)
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', String(file)), 'utf8')); } catch (_) {}
  // 2) otherwise download it from GitHub; if that fails too, answer null instead of throwing so nothing is logged as a crash
  try {
    const r = await require('electron').net.fetch(PACK_BASE + file);
    if (r.ok) return await r.json();
  } catch (_) {}
  return null;
});
ipcMain.handle('browser:clear', async () => { try { const ses = require('electron').session.fromPartition('rejboard-ephemeral'); await ses.clearStorageData(); await ses.clearCache(); return true; } catch (_) { return false; } });

/* ---- shared sync folder (OneDrive / Google Drive / Dropbox / Nextcloud ...): per-board backup files + a lock file.
   The renderer never sends a path: the folder is picked in a native dialog and remembered here, and file names are validated. ---- */
const syncCfg = () => path.join(app.getPath('userData'), 'syncfolder.json');
const syncDir = () => { try { const d = JSON.parse(fs.readFileSync(syncCfg(), 'utf8')).dir; return d && fs.statSync(d).isDirectory() ? d : ''; } catch (_) { return ''; } };
const syncName = n => typeof n === 'string' && n.length > 0 && n.length < 200 && n !== '.' && n !== '..' && !/[\/:*?"<>|\u0000-\u001f]/.test(n) && (/\.rjwb$/i.test(n) || n === '.rejboard-lock.json');
ipcMain.handle('sync:get', () => ({ dir: syncDir(), host: os.hostname() }));
ipcMain.handle('sync:choose', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Choose your synced folder (OneDrive, Google Drive, Dropbox, Nextcloud...)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { dir: syncDir(), host: os.hostname() };
  fs.writeFileSync(syncCfg(), JSON.stringify({ dir: r.filePaths[0] }));
  return { dir: r.filePaths[0], host: os.hostname() };
});
ipcMain.handle('sync:list', () => {
  const d = syncDir(); if (!d) return null;
  return fs.readdirSync(d).filter(n => /\.rjwb$/i.test(n)).map(n => { try { const st = fs.statSync(path.join(d, n)); return { name: n, size: st.size, mtime: st.mtimeMs }; } catch (_) { return null; } }).filter(Boolean);
});
ipcMain.handle('sync:read', (_e, name) => { const d = syncDir(); if (!d || !syncName(name)) return null; try { return fs.readFileSync(path.join(d, name), 'utf8'); } catch (_) { return null; } });
ipcMain.handle('sync:write', (_e, name, text) => { // write to a temp file first so a sync client never uploads a half-written board
  const d = syncDir(); if (!d || !syncName(name) || typeof text !== 'string') return false;
  const tmp = path.join(d, '.' + name + '.tmp'); try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, path.join(d, name)); return true; } catch (_) { try { fs.unlinkSync(tmp); } catch (__) {} return false; }
});
ipcMain.handle('sync:remove', (_e, name, ownerId) => { const d = syncDir(); if (!d || !syncName(name)) return false; try {
  const p = path.join(d, name);
  if (ownerId) { // lock files: only delete our own, never one another PC took over
    let cur = null; try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return false; }
    if (!cur || cur.id !== ownerId) return false;
  }
  fs.unlinkSync(p); return true; } catch (_) { return false; } });
// ---- Secure in-app updates ----
let macSigned = false;
if (process.platform === 'darwin' && app.isPackaged) { try { require('child_process').execFileSync('codesign', ['--verify', '--deep', '--strict', path.resolve(path.dirname(process.execPath), '..', '..')], { stdio: 'ignore' }); macSigned = true; } catch (_) {} }
const updatePolicy = canAutoUpdate({ platform: process.platform, env: process.env, isPackaged: app.isPackaged, macSigned });
let updateWindow = null, updateState = { status: 'idle', version: app.getVersion(), policy: updatePolicy, releasesUrl: RELEASES_URL }, updateActivity = { recording: false, lanTransfer: false, unsavedChanges: false };
let updateCheckRunning = false, updateReady = false;
function updateStatus(patch) {
  updateState = { ...updateState, ...patch };
  try { if (updateWindow && !updateWindow.isDestroyed()) updateWindow.webContents.send('updates:status', updateState); } catch (_) {}
}
const writeUpdateLog = (level, args) => { try { const dir = app.getPath('logs'); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'updates.log'), new Date().toISOString() + ' [' + level + '] ' + args.map(v => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { return String(v); } }).join(' ') + '\n'); } catch (_) {} };
if (updatePolicy.enabled && app.isPackaged) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: (...a) => { console.info('[electron-updater]', ...a); writeUpdateLog('info', a); }, warn: (...a) => { console.warn('[electron-updater]', ...a); writeUpdateLog('warn', a); }, error: (...a) => { console.error('[electron-updater]', ...a); writeUpdateLog('error', a); }, debug: (...a) => { console.debug('[electron-updater]', ...a); writeUpdateLog('debug', a); } };
  autoUpdater.on('checking-for-update', () => updateStatus({ status: 'checking' }));
  autoUpdater.on('update-available', info => updateStatus({ status: 'available', availableVersion: info.version }));
  autoUpdater.on('update-not-available', () => updateStatus({ status: 'up-to-date' }));
  autoUpdater.on('download-progress', p => updateStatus({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent || 0)))}));
  autoUpdater.on('update-downloaded', info => { updateReady = true; updateStatus({ status: 'ready', availableVersion: info.version }); });
  autoUpdater.on('error', err => {
    const msg = String(err && err.message || '');
    const reason = /rate.?limit|API rate limit/i.test(msg) ? 'rate-limit' : /checksum|sha512|digest/i.test(msg) ? 'checksum' : /ENOTFOUND|offline|network|ECONN|ETIMEDOUT/i.test(msg) ? 'offline' : 'failed';
    updateStatus({ status: 'error', reason });
    console.warn('[updates]', reason, msg.slice(0, 300));
  });
}
ipcMain.handle('updates:version', () => app.getVersion());
ipcMain.handle('updates:check', async () => {
  if (!updatePolicy.enabled || !app.isPackaged) return { ok: false, reason: updatePolicy.reason, releasesUrl: RELEASES_URL };
  if (updateCheckRunning) return { ok: true, status: updateState.status };
  updateCheckRunning = true;
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, reason: 'failed' }; }
  finally { updateCheckRunning = false; }
});
ipcMain.handle('updates:download', async () => {
  if (!updatePolicy.enabled || !app.isPackaged) return { ok: false, reason: updatePolicy.reason, releasesUrl: RELEASES_URL };
  try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (_) { return { ok: false, reason: 'failed' }; }
});
ipcMain.handle('updates:activity', (_e, activity) => {
  updateActivity = { recording: !!activity?.recording, lanTransfer: !!activity?.lanTransfer, unsavedChanges: !!activity?.unsavedChanges };
  if (updatePolicy.enabled) autoUpdater.autoInstallOnAppQuit = canInstallNow(updateActivity);
  return canInstallNow(updateActivity);
});
ipcMain.handle('updates:install', async () => {
  if (!updateReady) return { ok: false, reason: 'not-ready' };
  if (!canInstallNow(updateActivity)) return { ok: false, reason: 'busy' };
  // Flush autosave before asking electron-updater to restart.
  try { updateWindow && !updateWindow.isDestroyed() && updateWindow.webContents.send('updates:flush-save'); } catch (_) {}
  setTimeout(() => { if (canInstallNow(updateActivity)) autoUpdater.quitAndInstall(false, true); }, 350);
  return { ok: true };
});
ipcMain.on('updates:renderer-ready', e => { updateWindow = BrowserWindow.fromWebContents(e.sender); e.sender.send('updates:status', { ...updateState, policy: updatePolicy, releasesUrl: RELEASES_URL }); });

/* ---- start-up window ----
   The main window is created hidden and shown only once the page has opened its board. If that takes more than a moment (a slow computer, a big board,
   a boards library on a cloud drive) a small window with the logo shows meanwhile and names the board being opened, which is remembered from last time. */
let mainWin = null, mainShown = false, splash = null, splashTimer = 0, failTimer = 0, lastBoardTitle = null;
const lastBoardFile = () => path.join(app.getPath('userData'), 'last-board.json');
const readLastBoard = () => { try { const t = JSON.parse(fs.readFileSync(lastBoardFile(), 'utf8')).title; return typeof t === 'string' ? t.slice(0, 80) : ''; } catch (_) { return ''; } };
ipcMain.on('app:board', (_e, title) => { try { title = String(title || '').slice(0, 80); if (title === lastBoardTitle) return; lastBoardTitle = title; fs.writeFileSync(lastBoardFile(), JSON.stringify({ title })); } catch (_) {} });
function showMain() {
  if (mainShown || !mainWin || mainWin.isDestroyed()) return;
  mainShown = true; clearTimeout(splashTimer); clearTimeout(failTimer);
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null; mainWin.show(); mainWin.focus();
}
ipcMain.on('app:ready', showMain);
function createWindow() {
  const w = new BrowserWindow({ width: 1320, height: 860, title: 'RejBoard', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#fff7fa', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !SMOKE } });
  updateWindow = w; mainWin = w; mainShown = false;
  if (!SMOKE || SPLASH_TEST) {
    splashTimer = setTimeout(() => {
      if (mainShown) return;
      try {
        splash = new BrowserWindow({ width: 360, height: 230, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, show: false, backgroundColor: '#fff7fa',
          icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        splash.setMenuBarVisibility(false);
        splash.loadFile('splash.html', { query: { board: readLastBoard() } });
        splash.once('ready-to-show', () => { if (!mainShown && splash && !splash.isDestroyed()) splash.show(); });
      } catch (_) { splash = null; }
    }, 400);
    failTimer = setTimeout(showMain, 12000); // never leave the user without a window, even if the page never reports in
    w.webContents.once('did-fail-load', showMain);
  }
  w.setMenuBarVisibility(false);
  lanShare.register(ipcMain, w);
  if (SPLASH_TEST) setTimeout(() => { try { w.loadFile('index.html'); } catch (_) {} }, 2500); else w.loadFile('index.html');
  if (SMOKE) require('./scripts/smoke-main.js')(w, app);
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
// Right-click menu for the in-app browser / video webview (Electron shows nothing by default).
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  const isWeb = u => /^https?:\/\//i.test(String(u || ''));
  const nav = contents.navigationHistory;
  const canBack = () => { try { return nav ? nav.canGoBack() : contents.canGoBack(); } catch (_) { return false; } };
  const canFwd = () => { try { return nav ? nav.canGoForward() : contents.canGoForward(); } catch (_) { return false; } };
  contents.on('context-menu', (_ev, p) => {
    try {
      const t = [], sep = () => { if (t.length && t[t.length - 1].type !== 'separator') t.push({ type: 'separator' }); };
      if (p.linkURL && isWeb(p.linkURL)) {
        t.push({ label: 'Open link here', click: () => contents.loadURL(p.linkURL) });
        t.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
        sep();
      }
      if (p.mediaType === 'image' && p.srcURL) {
        if (isWeb(p.srcURL)) {
          const host = contents.hostWebContents;
          t.push({ label: 'Add image to board', click: () => { try { host && host.send('browser:add-image', p.srcURL); } catch (_) {} } });
        }
        t.push({ label: 'Copy image', click: () => contents.copyImageAt(p.x, p.y) });
        if (isWeb(p.srcURL)) t.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) });
        t.push({ label: 'Save image as…', click: () => contents.downloadURL(p.srcURL) });
        sep();
      }
      if (p.isEditable) {
        t.push({ label: 'Cut', role: 'cut', enabled: p.editFlags.canCut });
        t.push({ label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy });
        t.push({ label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste });
        t.push({ label: 'Select all', role: 'selectAll' });
        sep();
      } else if (p.selectionText) {
        t.push({ label: 'Copy', role: 'copy' });
        const q = p.selectionText.trim().slice(0, 80);
        t.push({ label: 'Search Google for “' + (q.length > 30 ? q.slice(0, 30) + '…' : q) + '”', click: () => contents.loadURL('https://www.google.com/search?q=' + encodeURIComponent(q)) });
        sep();
      }
      t.push({ label: 'Back', enabled: canBack(), click: () => { nav ? nav.goBack() : contents.goBack(); } });
      t.push({ label: 'Forward', enabled: canFwd(), click: () => { nav ? nav.goForward() : contents.goForward(); } });
      t.push({ label: 'Reload', click: () => contents.reload() });
      if (!p.isEditable && !p.selectionText) t.push({ label: 'Select all', role: 'selectAll' });
      const host = contents.hostWebContents;
      Menu.buildFromTemplate(t).popup({ window: host ? BrowserWindow.fromWebContents(host) : undefined });
    } catch (_) {}
  });
});
app.whenReady().then(createWindow);
// The renderer uses a non-persistent partition for embedded browsing. Clear its in-memory
// cookies/cache/storage when the app exits; this cannot erase data a website has on its servers.
let finalCleanupStarted = false;
app.on('before-quit', (event) => {
  if (updateReady) { autoUpdater.autoInstallOnAppQuit = canInstallNow(updateActivity); if (!canInstallNow(updateActivity)) updateStatus({ status: 'ready', blocked: true }); }
  if (finalCleanupStarted) return;
  event.preventDefault(); finalCleanupStarted = true;
  (async () => { try { const ses = require('electron').session.fromPartition('rejboard-ephemeral'); await ses.clearStorageData(); await ses.clearCache(); } catch (_) {} finally { app.quit(); } })();
});
app.on('window-all-closed', () => app.quit());
