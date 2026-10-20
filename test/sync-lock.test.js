'use strict';
/* The sync-folder lock must never be deleted by a PC that no longer owns it (another PC took over, then this one closed). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const a = src.indexOf("ipcMain.handle('sync:remove'");
const b = src.indexOf('\n', src.indexOf('return false; } });', a));
assert.ok(a > 0 && b > a, 'sync:remove handler not found in main.js');

function load(dir) {
  let handler;
  const syncName = n => typeof n === 'string' && (/\.rjwb$/i.test(n) || n === '.rejboard-lock.json');
  vm.runInNewContext(src.slice(a, b), { ipcMain: { handle: (_n, f) => { handler = f; } }, syncDir: () => dir, syncName, fs, path });
  return (name, owner) => handler({}, name, owner);
}

const LOCK = '.rejboard-lock.json';
function setup(lockObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rjsync-'));
  if (lockObj !== undefined) fs.writeFileSync(path.join(dir, LOCK), typeof lockObj === 'string' ? lockObj : JSON.stringify(lockObj));
  return { dir, remove: load(dir), has: () => fs.existsSync(path.join(dir, LOCK)) };
}

test('own lock is removed', () => {
  const s = setup({ id: 'A', host: 'pc-a', t: Date.now() });
  assert.equal(s.remove(LOCK, 'A'), true);
  assert.equal(s.has(), false);
});

test("another PC's lock (taken over) is kept", () => {
  const s = setup({ id: 'B', host: 'pc-b', t: Date.now() });
  assert.equal(s.remove(LOCK, 'A'), false);
  assert.equal(s.has(), true);
});

test('unreadable lock is kept when an owner is given', () => {
  const s = setup('not json');
  assert.equal(s.remove(LOCK, 'A'), false);
  assert.equal(s.has(), true);
});

test('board files are still removed without an owner (rename cleanup)', () => {
  const s = setup();
  const f = path.join(s.dir, 'Old [x1].rjwb'); fs.writeFileSync(f, 'RJWB1:');
  assert.equal(s.remove('Old [x1].rjwb'), true);
  assert.equal(fs.existsSync(f), false);
});

test('the page sends its machine id when it removes the lock on close', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /wb\.sync\.remove\(SF_LOCK,\s*sfMid\(\)\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'), /remove:\s*\(n,\s*ownerId\)/);
});
