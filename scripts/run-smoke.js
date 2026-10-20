#!/usr/bin/env node
/* `npm run test:smoke`: launches the real desktop app against a throw-away profile (your boards are never touched), runs the end-to-end
   checks in scripts/smoke-page.js inside it, and prints a report. Exit code 0 = everything passed. On a headless Linux box use xvfb-run. */
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron'); // path of the electron binary
const root = path.join(__dirname, '..');
const args = ['.'];
if (process.platform === 'linux' && (process.env.CI || process.getuid && process.getuid() === 0)) args.push('--no-sandbox');

const child = spawn(electron, args, { cwd: root, env: { ...process.env, REJBOARD_SMOKE: '1', ELECTRON_ENABLE_LOGGING: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { const s = String(d); if (/error|fail/i.test(s) && !/GPU|dbus|gcm|VSyncProvider|Autofill/i.test(s)) process.stderr.write(s); });
child.on('exit', code => {
  const line = out.split(/\r?\n/).reverse().find(l => l.startsWith('SMOKE_RESULT '));
  if (!line) { console.error('The app produced no smoke result (exit code ' + code + ').\n' + out.slice(-2000)); process.exit(2); }
  const res = JSON.parse(line.slice('SMOKE_RESULT '.length));
  if (res.fatal) { console.error('Smoke test crashed: ' + res.fatal); process.exit(2); }
  let bad = 0;
  for (const c of res.checks) { console.log((c.ok ? '  ok   ' : '  FAIL ') + c.name + (c.detail && (!c.ok || /ms|%|\{/.test(c.detail)) ? '  (' + c.detail + ')' : '')); if (!c.ok) bad++; }
  console.log('\nperf: ' + JSON.stringify(res.perf));
  console.log(bad ? '\n' + bad + ' check(s) FAILED' : '\nall ' + res.checks.length + ' checks passed');
  process.exit(bad ? 1 : 0);
});
