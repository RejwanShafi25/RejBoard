'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../board-core.js');

/* ---------------- searchText ---------------- */
test('searchText collects everything typed on a board', () => {
  const { q, pq } = C.searchText([
    { t: 't', text: 'Kinetic  energy\n' }, { t: 't', text: 'sticky reminder', sticky: 1 },
    { t: 'm', latex: '\\frac{1}{2}mv^2', srcText: 'half m v squared' }, { t: 'm', latex: 'E=mc^2' },
    { t: 'sp', shp: 'rect', label: 'Start node' },
    { t: 'tb', cells: [['Mass', 'Speed'], ['', '=A2*2']] },
    { t: 'gr', fns: [{ text: 'y=sin(x)' }, null] },
    { t: 'l', text: 'https://example.com' },
    { t: 'i', src: 'data:', pg: 1, txt: 'Chapter 4 page text' },
    { t: 's', pts: [[0, 0, 1]] }
  ]);
  for (const w of ['Kinetic energy', 'sticky reminder', 'half m v squared', 'E=mc^2', 'Start node', 'Mass', 'Speed', '=A2*2', 'y=sin(x)', 'https://example.com']) assert.ok(q.includes(w), w);
  assert.ok(!q.includes('Chapter 4'), 'PDF text is kept separately');
  assert.equal(pq, 'Chapter 4 page text');
});

test('searchText is bounded, even for enormous boards', () => {
  const items = Array.from({ length: 5000 }, (_, k) => ({ t: 't', text: 'word' + k + ' '.repeat(10) + 'x'.repeat(50) }));
  items.push({ t: 'i', pg: 1, txt: 'p'.repeat(1e6) });
  const t = Date.now(), { q, pq } = C.searchText(items);
  assert.ok(q.length <= 20000 && pq.length <= 40000);
  assert.ok(q.startsWith('word0 xxx'), 'the first notes are kept');
  assert.ok(Date.now() - t < 500, 'fast');
});

test('searchText ignores junk', () => {
  assert.deepEqual(C.searchText(null), { q: '', pq: '' });
  assert.deepEqual(C.searchText([null, 5, 'x', { cells: 'no' }, { cells: [null, [1, {}]] }, { fns: 'no' }, { txt: 7 }]), { q: '', pq: '' });
});

/* ---------------- textMatch ---------------- */
test('textMatch: every word, any order, any case', () => {
  assert.ok(C.textMatch('Physics: waves and optics', 'optics WAVES'));
  assert.ok(!C.textMatch('Physics: waves and optics', 'waves gravity'));
  assert.ok(C.textMatch('anything', ''));
  assert.ok(C.textMatch('anything', '   '));
});

test('textMatch ignores accents and width', () => {
  assert.ok(C.textMatch('Café crème', 'cafe creme'));
  assert.ok(C.textMatch('cafe', 'Café'));
  assert.ok(C.textMatch('ＣＡＦＥ', 'cafe'), 'full-width letters');
  assert.ok(C.textMatch('Ångström', 'angstrom'));
});

test('textMatch works for non-Latin scripts and treats regex characters literally', () => {
  assert.ok(C.textMatch('গণিত নোট', 'গণিত'));
  assert.ok(C.textMatch('微积分 笔记', '笔记'));
  assert.ok(C.textMatch('a+b=c (x)', '(x) a+b'));
  assert.ok(!C.textMatch('abc', '.*'));
  assert.ok(C.textMatch('', '') && !C.textMatch(null, 'x') && C.textMatch(undefined, null));
});

/* ---------------- inkLines ---------------- */
const box = (x, y, w = 20, h = 30) => [x, y, x + w, y + h];

test('inkLines groups strokes into lines, top to bottom, left to right', () => {
  const b = [box(100, 0), box(0, 2), box(50, 4), box(0, 100), box(60, 98)];
  assert.deepEqual(C.inkLines(b), [[1, 2, 0], [3, 4]]);
});

test('inkLines splits a line at a wide gap and when it gets too long', () => {
  const b = [box(0, 0), box(25, 0), box(400, 0), box(425, 0)];
  assert.deepEqual(C.inkLines(b), [[0, 1], [2, 3]]);
  const long = Array.from({ length: 100 }, (_, k) => box(k * 22, 0));
  const g = C.inkLines(long);
  assert.ok(g.length > 1 && g.every(x => long[x[x.length - 1]][2] - long[x[0]][0] <= 30 * 30 + 20), 'chunks of at most ~30 letter heights wide');
  assert.equal(g.flat().length, 100);
});

test('inkLines keeps descenders and accents with their line', () => {
  const b = [box(0, 0), box(25, 8, 20, 40), box(50, -6, 10, 10)]; // "g" hangs lower, an accent sits above
  assert.equal(C.inkLines(b).length, 1);
});

test('inkLines survives junk and is bounded', () => {
  assert.deepEqual(C.inkLines(null), []);
  assert.deepEqual(C.inkLines([null, [1, 2], [NaN, 0, 1, 1], [5, 5, 1, 1], 'x']), []);
  const many = Array.from({ length: 20000 }, (_, k) => box(0, k * 100));
  const t = Date.now(), g = C.inkLines(many);
  assert.ok(g.length <= 400, 'capped');
  assert.ok(Date.now() - t < 1000);
});
