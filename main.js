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
function createWindow() {
  const w = new BrowserWindow({ width: 1320, height: 860, title: 'RejBoard', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#fff7fa',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  w.setMenuBarVisibility(false);
  lanShare.register(ipcMain, w);
  w.loadFile('index.html');
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
