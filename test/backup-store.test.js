'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../backup-store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rjbk-'));
const at = (y, mo, d, h = 12, mi = 0) => B.nameFor(new Date(y, mo - 1, d, h, mi));

test('backup names round-trip and nothing else is recognised', () => {
  const n = at(2026, 10, 22, 14, 5);
  assert.equal(n, 'RejBoard backup 2026-10-22 1405.json');
  assert.equal(B.timeOf(n), new Date(2026, 9, 22, 14, 5).getTime());
  for (const x of ['RejBoard backup 2026-13-01 1200.json', 'RejBoard backup 2026-02-30 1200.json', '../RejBoard backup 2026-10-22 1405.json', 'notes.json', '.partial-ab.json', null, 5])
    assert.equal(B.timeOf(x), null, String(x));
});

test('rotate keeps 7 daily, 4 weekly and 6 monthly backups and the newest', () => {
  const names = [];
  for (let d = 0; d < 400; d++) { const t = new Date(2026, 9, 22, 9); t.setDate(t.getDate() - d); names.push(B.nameFor(t)); }
  const del = new Set(B.rotate(names)), kept = names.filter(n => !del.has(n));
  assert.ok(kept.includes(names[0]), 'newest');
  for (let d = 0; d < 7; d++) assert.ok(kept.includes(names[d]), 'day ' + d);
  assert.ok(kept.length <= 7 + 4 + 6, 'bounded: ' + kept.length);
  assert.ok(kept.length >= 12);
  assert.ok(!kept.includes(names[399]), 'a year+ old daily backup goes');
});

test('rotate ignores foreign files and never deletes them', () => {
  const del = B.rotate(['my notes.json', 'RejBoard backup 2026-10-22 1405.json', 'desktop.ini']);
  assert.deepEqual(del, []);
});

test('a backup is written atomically, named by the store, and listed', () => {
  const dir = tmp(), s = B.create(dir);
  try {
    const b = s.begin(); assert.ok(b.ok && /^[0-9a-f]{32}$/.test(b.token));
    assert.ok(s.chunk(b.token, '[{"id":"a","title":"λ"}').ok);
    assert.ok(s.chunk(b.token, ']').ok);
    assert.equal(s.list().length, 0, 'not visible until finished');
    const e = s.end(b.token); assert.ok(e.ok);
    assert.match(e.name, /^RejBoard backup \d{4}-\d{2}-\d{2} \d{4}\.json$/);
    assert.deepEqual(JSON.parse(s.read(e.name)), [{ id: 'a', title: 'λ' }]);
    assert.equal(fs.readdirSync(dir).filter(n => n.startsWith('.partial')).length, 0);
    const e2 = s.begin(); s.chunk(e2.token, '[]'); const n2 = s.end(e2.token).name;
    assert.notEqual(n2, e.name, 'two backups in the same minute do not overwrite each other');
    assert.deepEqual(s.list().map(x => x.name), [n2], 'one per day is kept: the newer one');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('read only returns backups this store made: no paths, no other files', () => {
  const dir = tmp(), s = B.create(dir);
  try {
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
    fs.writeFileSync(path.join(path.dirname(dir), 'outside-' + path.basename(dir) + '.json'), 'x');
    for (const n of ['secret.txt', '../outside-' + path.basename(dir) + '.json', '..\\x', '/etc/passwd', 'C:\\Windows\\win.ini', null, {}, 'RejBoard backup 2026-10-22 1405.json'])
      assert.equal(s.read(n), null, String(n));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(path.dirname(dir), 'outside-' + path.basename(dir) + '.json'), { force: true }); }
});

test('wrong tokens, bad data and oversize backups are refused and cleaned up', () => {
  const dir = tmp(), s = B.create(dir);
  try {
    assert.equal(s.chunk('x'.repeat(32), 'a').ok, false);
    assert.equal(s.end(undefined).ok, false);
    const b = s.begin();
    assert.equal(s.begin().ok, false, 'one backup at a time');
    assert.equal(s.chunk(b.token, { not: 'text' }).ok, false);
    assert.equal(fs.readdirSync(dir).length, 0, 'the half-written file is gone');
    const c = s.begin();
    assert.equal(s.chunk(c.token, 'x'.repeat(B.MAX_CHUNK + 1)).ok, false, 'chunk cap');
    assert.equal(fs.readdirSync(dir).length, 0);
    const d = s.begin(); s.abort(d.token);
    assert.equal(fs.readdirSync(dir).length, 0, 'abort deletes the temp file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rotation runs after each backup and leaves foreign files alone', () => {
  const dir = tmp(), s = B.create(dir);
  try {
    for (let d = 1; d <= 30; d++) fs.writeFileSync(path.join(dir, at(2025, 1, d)), '[]');
    fs.writeFileSync(path.join(dir, 'keep me.json'), '{}');
    const b = s.begin(); s.chunk(b.token, '[]'); assert.ok(s.end(b.token).deleted > 0);
    assert.ok(fs.existsSync(path.join(dir, 'keep me.json')));
    assert.ok(s.list().length <= 17);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup removes temp files left by a crash, only those', () => {
  const dir = tmp(), s = B.create(dir);
  try {
    fs.writeFileSync(path.join(dir, '.partial-' + 'a'.repeat(32) + '.json'), '[');
    fs.writeFileSync(path.join(dir, '.partial-notmine.json'), '[');
    s.cleanup();
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.partial-notmine.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main.js wires the store up and preload exposes it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.ok(/backupStore\.register\(ipcMain, app, shell\)/.test(main));
  for (const ch of ['begin', 'chunk', 'end', 'abort', 'list', 'read', 'open']) assert.ok(pre.includes("'backup:" + ch + "'"), ch);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('backup-store.js'), 'packaged into the installer');
});
