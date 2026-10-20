#!/usr/bin/env node
/* `npm run test:smoke`: launches the real desktop app against a throw-away profile (your boards are never touched) and checks it end to end:
     1. scripts/smoke-page.js runs INSIDE the app: crowded board, drawing, scrolling, zooming, lasso, eraser, Undo/Redo, storage, board index.
     2. the start-up window: it appears while the page is still loading, names the last board, and gives way to the main window.
   Prints a report. Exit code 0 = everything passed. On a headless Linux box run it under xvfb-run. */
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron'); // path of the electron binary
const root = path.join(__dirname, '..');
const args = ['.'];
if (process.platform === 'linux' && (process.env.CI || (process.getuid && process.getuid() === 0))) args.push('--no-sandbox');

function run(label, extraEnv) {
  return new Promise(resolve => {
    console.log('== ' + label + ' ==');
    const child = spawn(electron, args, { cwd: root, env: { ...process.env, REJBOARD_SMOKE: '1', ELECTRON_ENABLE_LOGGING: '0', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s) && !/GPU|dbus|gcm|VSyncProvider|Autofill/i.test(s)) process.stderr.write(s); });
    child.on('exit', code => {
      const line = out.split(/\r?\n/).reverse().find(l => l.startsWith('SMOKE_RESULT '));
      if (!line) { console.error('The app produced no smoke result (exit code ' + code + ').\n' + out.slice(-2000)); return resolve(2); }
      const res = JSON.parse(line.slice('SMOKE_RESULT '.length));
      if (res.fatal) { console.error('Smoke test crashed: ' + res.fatal); return resolve(2); }
      let bad = 0;
      for (const c of res.checks) {
        console.log((c.ok ? '  ok   ' : '  FAIL ') + c.name + (c.detail && (!c.ok || /ms|%|\{/.test(c.detail)) ? '  (' + c.detail + ')' : ''));
        if (!c.ok) bad++;
      }
      if (res.perf && Object.keys(res.perf).length) console.log('\nperf: ' + JSON.stringify(res.perf));
      console.log(bad ? '\n' + bad + ' check(s) FAILED\n' : '\nall ' + res.checks.length + ' checks passed\n');
      resolve(bad ? 1 : 0);
    });
  });
}

(async () => {
  const a = await run('app end-to-end', {});
  const b = await run('start-up window', { REJBOARD_SMOKE_SPLASH: '1' });
  process.exit(a || b);
})();
