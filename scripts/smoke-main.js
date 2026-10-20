/* Electron-side half of the smoke test (loaded by main.js only when REJBOARD_SMOKE=1 in a development checkout).
   Waits for the real app page to load, runs scripts/smoke-page.js inside it, prints the result and exits with 0 (pass) or 1 (fail). */
const fs = require('fs');
const path = require('path');

/* Start-up window check: the page is loaded 2.5 s late, so a small window with the logo and the remembered board name must appear first,
   then give way to the main window once the page has opened its board. */
function runSplashSmoke(win, app) {
  const { BrowserWindow } = require('electron');
  const checks = [];
  const ok = (name, cond, detail) => checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  const done = code => { console.log('SMOKE_RESULT ' + JSON.stringify({ checks, perf: {} })); app.exit(code); };
  fs.writeFileSync(path.join(app.getPath('userData'), 'last-board.json'), JSON.stringify({ title: 'Physics notes' }));
  const timer = setTimeout(() => { ok('main window opened in time', false); done(1); }, 60000);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  (async () => {
    await sleep(1500);
    const wins = BrowserWindow.getAllWindows();
    const sp = wins.find(w => w !== win && /splash\.html/.test(w.webContents.getURL()));
    ok('a start-up window appears while the page is still loading', !!sp && sp.isVisible());
    ok('the main window stays hidden meanwhile', !win.isVisible());
    if (sp) {
      const msg = await sp.webContents.executeJavaScript('document.getElementById("msg").textContent');
      ok('it names the board that was open last time', /Physics notes/.test(msg), msg);
      const [w, h] = sp.getSize(); ok('it is small and frameless', w <= 420 && h <= 300);
    }
    for (let i = 0; i < 400 && !win.isVisible(); i++) await sleep(100);
    ok('the main window then opens', win.isVisible());
    await sleep(300);
    ok('the start-up window is gone', BrowserWindow.getAllWindows().filter(w => /splash\.html/.test(w.webContents.getURL())).length === 0);
    clearTimeout(timer);
    done(checks.every(c => c.ok) ? 0 : 1);
  })().catch(e => { ok('no crash', false, e && e.stack || e); done(2); });
}

module.exports = function runSmoke(win, app) {
  if (process.env.REJBOARD_SMOKE_SPLASH === '1') return runSplashSmoke(win, app);
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
