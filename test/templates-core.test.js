const test = require('node:test');
const assert = require('node:assert');
const T = require('../templates-core.js');

const PATS = ['plain', 'grid', 'dots', 'lines', 'margin', 'cornell', 'cols', 'iso', 'eng', 'mm', 'hex', 'music', 'tab', 'hand', 'slant'];

test('every category has templates, ids are unique', () => {
  assert.ok(T.TEMPLATES.length >= 50);
  for (const c of T.CATS) assert.ok(T.TEMPLATES.filter(t => t.cat === c).length >= 5, c);
  assert.strictEqual(new Set(T.TEMPLATES.map(t => t.id)).size, T.TEMPLATES.length);
});

test('paper settings are ones the app knows', () => {
  for (const t of T.TEMPLATES) {
    assert.ok(PATS.includes(t.pat), t.id + ' pattern ' + t.pat);
    assert.ok(t.size === 'inf' || T.PSZ[t.size], t.id + ' size');
    assert.ok(t.o === 'p' || t.o === 'l');
    assert.ok(t.gs >= 10 && t.gs <= 80 && t.gd >= 1 && t.gd <= 5, t.id + ' spacing');
  }
});

test('templates build valid items on light and dark paper', () => {
  for (const t of T.TEMPLATES) for (const dark of [false, true]) {
    const items = T.build(t, dark);
    const ids = new Set();
    for (const i of items) {
      assert.ok(['t', 'tb', 'sp'].includes(i.t), t.id + ' kind ' + i.t);
      assert.ok(Number.isFinite(i.x) && Number.isFinite(i.y), t.id + ' position');
      if (i.t === 'sp') { assert.ok(i.w >= 0 && i.h >= 0); assert.ok(i.id); ids.add(i.id); }
      if (i.t === 'tb') { assert.strictEqual(i.cells.length, i.rh.length); i.cells.forEach(r => assert.strictEqual(r.length, i.cw.length)); }
    }
    /* connectors only point at shapes of the same template */
    for (const i of items) for (const k of ['lk0', 'lk1']) if (i[k]) assert.ok(ids.has(i[k].id), t.id + ' dangling ' + k);
  }
});

test('page templates stay on their page', () => {
  for (const t of T.TEMPLATES.filter(t => t.size !== 'inf')) {
    const [W, H] = T.pageSize(t.size, t.o);
    for (const i of T.build(t, false)) {
      const r = i.x + (i.w || 0), b = i.y + (i.h || 0);
      assert.ok(i.x >= 0 && i.y >= 0 && r <= W + 1 && b <= H + 1, `${t.id}: item at ${i.x},${i.y} ${i.w}x${i.h} leaves the ${W}x${H} page`);
    }
  }
});

test('ink follows the paper and labels go through the translator', () => {
  const t = T.byId('meeting');
  const light = T.build(t, false), dark = T.build(t, true);
  assert.notStrictEqual(light[0].color, dark[0].color);
  const tr = s => (s === 'Agenda' ? 'Tagesordnung' : s);
  assert.ok(T.build(t, false, null, tr).some(i => i.text === 'Tagesordnung'));
  assert.strictEqual(T.byId('nope'), null);
});

test('a broken template builds to nothing instead of throwing', () => {
  assert.deepStrictEqual(T.build({ size: 'a4', o: 'p', build: () => { throw new Error('x'); } }, false), []);
});
