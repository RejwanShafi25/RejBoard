/* Electron-side half of the smoke test (loaded by main.js only when REJBOARD_SMOKE=1 in a development checkout).
   Waits for the real app page to load, runs scripts/smoke-page.js inside it, prints the result and exits with 0 (pass) or 1 (fail). */
const fs = require('fs');
const path = require('path');

module.exports = function runSmoke(win, app) {
  const done = (code, payload) => {
    try { console.log('SMOKE_RESULT ' + JSON.stringify(payload)); } catch (_) { console.log('SMOKE_RESULT {"fatal":"unserialisable result"}'); }
    app.exit(code);
  };
  const timer = setTimeout(() => done(2, { fatal: 'timed out after 180 s' }), 180000);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.log('[page error] ' + message); });
  try { win.show(); win.focus(); } catch (_) {}
  win.webContents.once('did-finish-load', async () => {
    try {
      const code = fs.readFileSync(path.join(__dirname, 'smoke-page.js'), 'utf8');
      const res = await win.webContents.executeJavaScript(code, true);
      clearTimeout(timer);
      done(res && res.checks && res.checks.every(c => c.ok) ? 0 : 1, res);
    } catch (e) {
      clearTimeout(timer);
      done(2, { fatal: String(e && e.stack || e) });
    }
  });
};
