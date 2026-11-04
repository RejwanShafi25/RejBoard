#!/usr/bin/env node
'use strict';
/* Golden fixtures for the Kotlin core, produced by the desktop app's own JS (board-core.js) and the
   board builders the Node tests use (test/helpers.js). The Kotlin tests in core/src/commonTest read these
   files and must reproduce them exactly.

     node mobile/core/golden/generate.js          rewrite the fixtures
     node mobile/core/golden/generate.js --check  fail if the fixtures are out of date (used in CI)

   Every fixture is plain JSON written by JSON.stringify, so the Kotlin side can compare its own output
   byte for byte with what the desktop app would write. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const C = require(path.join(ROOT, 'board-core.js'));
const { rng, stroke, board, state, json } = require(path.join(ROOT, 'test', 'helpers.js'));

const BUDGET = 1e9;
const clone = x => JSON.parse(JSON.stringify(x));
const out = {};
/* FNV-1a 64 over UTF-16 code units, as 16 hex digits: lets a fixture pin down a long JSON text without storing it */
const fnv = s => { let h = 0xcbf29ce484222325n; for (let k = 0; k < s.length; k++) { h ^= BigInt(s.charCodeAt(k)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; } return h.toString(16).padStart(16, '0'); };
/* the boards from helpers.board() with a short image, so the fixtures stay small (only src.length matters to the code under test) */
const smallBoard = (r, n) => { const b = board(r, n); for (const i of b) if (i.t === 'i') i.src = 'data:image/png;base64,iVBORw0KGgo='; return b; };

/* ---------- undo/redo: the random operation mix from board-core.test.js, recorded as explicit operations ---------- */
function historyCase(seed) {
  const r = rng(seed), S = state(smallBoard(r, 12)), hist = [], fut = [];
  const initial = clone(S.items), ops = [], timeline = [json(S.items)];
  const add = s => { if (!C.pushAdd(S, hist, fut, BUDGET, s)) C.pushDeep(S, hist, fut, BUDGET); S.items.push(s); };
  for (let k = 0; k < 40; k++) {
    const roll = r();
    if (roll < 0.5) { const s = stroke(r); ops.push({ op: 'add', item: clone(s) }); add(s); }
    else if (roll < 0.7 && S.items.length > 3) {
      C.pushDeep(S, hist, fut, BUDGET);
      const at = (r() * S.items.length) | 0;
      ops.push({ op: 'delete', index: at });
      S.items.splice(at, 1);
    } else if (roll < 0.9) {
      C.pushDeep(S, hist, fut, BUDGET);
      const at = S.items.findIndex(x => x.t === 's'), i = S.items[at];
      i.pts.forEach(q => { q[0] += 7; q[1] -= 3; }); i.color = '#abc';
      ops.push({ op: 'replace', index: at, item: clone(i) });
    } else {
      C.pushDeep(S, hist, fut, BUDGET);
      const k2 = S.items.findIndex(x => x.t === 's' && x.pts.length > 6);
      if (k2 >= 0) {
        const o = S.items[k2], a = { ...o, pts: o.pts.slice(0, 3) }, b = { ...o, pts: o.pts.slice(4) };
        S.items.splice(k2, 1, a, b);
        ops.push({ op: 'split', index: k2, a: clone(a), b: clone(b) });
      } else ops.push({ op: 'none' });
    }
    timeline.push(json(S.items));
  }
  const histLen = hist.length;
  for (let k = 40; k > 0; k--) if (!C.undoStep(S, hist, fut) || json(S.items) !== timeline[k - 1]) throw new Error('JS undo disagrees with itself, seed ' + seed);
  return { seed, budget: BUDGET, initial, ops, histLen, last: JSON.parse(timeline[40]), timeline: timeline.map(fnv) };
}
out.history = { cases: [11, 12, 13, 14, 15, 16].map(historyCase) };

/* the orphaned "added stroke" entry: its stroke was removed outside history, so undo skips the entry */
{
  const r = rng(22), S = state(smallBoard(r, 5)), hist = [], fut = [];
  const initial = clone(S.items), s = stroke(r);
  C.pushAdd(S, hist, fut, BUDGET, s); S.items.push(s);
  const added = clone(s);
  S.items = S.items.filter(i => i.t !== 's' || i.pts.length !== 40);
  const after = clone(S.items);
  const undone = C.undoStep(S, hist, fut);
  out.history.orphan = { initial, added, removePtsLength: 40, after, undone, final: clone(S.items) };
}

/* layers, page count and page links travel with a snapshot entry */
{
  const r = rng(23), S = state(smallBoard(r, 3)), hist = [], fut = [];
  const initial = clone(S.items);
  C.pushDeep(S, hist, fut, BUDGET);
  const e = hist.at(-1);
  e.__pn = 1; e.__ly = { l: S.layers.map(q => ({ ...q })), a: 1 }; e.__lk = [{ b: 'x', before: 'a', after: 'b' }];
  const entry = { pn: 1, layers: clone(e.__ly.l), activeLayer: 1, lk: clone(e.__lk) };
  S.pg.n = 4; S.layers = [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }, { id: 2, name: 'New', vis: 1, lock: 0 }]; S.ly = 2;
  const before = { pn: S.pg.n, layers: clone(S.layers), activeLayer: S.ly };
  C.undoStep(S, hist, fut, {});
  const afterUndo = { pn: S.pg.n, layers: clone(S.layers), activeLayer: S.ly };
  C.redoStep(S, hist, fut, {}, BUDGET);
  const afterRedo = { pn: S.pg.n, layers: clone(S.layers), activeLayer: S.ly };
  out.history.extras = { initial, entry, before, afterUndo, afterRedo };
}

/* trimHist on entries of known cost */
out.trim = [
  { costs: Array(100).fill(10), budget: BUDGET },
  { costs: Array(20).fill(100), budget: 450 },
  { costs: Array(5).fill(1e12), budget: 1 },
  { costs: [5, 400, 7, 9000, 12, 3, 400, 400], budget: 1000 }
].map(c => { const h = c.costs.map(x => ({ __c: x })); C.trimHist(h, c.budget); return { ...c, kept: h.map(x => x.__c) }; });

/* snapshot cost (packItems().__c) drives trimming, so it has to agree too */
out.cost = [smallBoard(rng(1), 6), [{ t: 'tb', cw: [1, 2, 3], rh: [4, 5] }, { t: 't', text: 'x' }], []].map(items => ({ items, cost: C.packItems(items).__c }));

/* ---------- point packing ---------- */
out.flatten = [
  [[0, 1e-300, 5e15], [Number.MAX_SAFE_INTEGER, 0.1 + 0.2, -1e9], [1 / 3, Math.PI, -Math.E]],
  [[1, 2]], null, [], [[1, 2], [1, 2, 3]], [[1, '2']], [[1, 2], null], [new Array(9).fill(1)], [new Array(8).fill(2)], [1, 2]
].map(input => { const f = C.flatten(input); return { input, out: f ? { w: f.w, f: Array.from(f.f) } : null }; });
out.inflate = [
  { f: [1, 2, 3, 4, 5, 6], w: 3 }, { f: [1, 2, 3, 4, 5, 6, 7], w: 4 }, { f: [0, 0, 0, 0, 0, 0, 0, 0], w: 0 }, { f: [1, 2], w: 99 }, { f: [], w: 2 }
].map(c => ({ ...c, out: C.inflate(new Float64Array(c.f), c.w) }));

/* ---------- screen-cache fingerprint ---------- */
{
  const mk = () => smallBoard(rng(41), 8);
  const layers = [{ id: 1, vis: 1, lock: 0 }];
  const graph = { t: 'gr', x: 10, y: 20, w: 480, h: 360, fns: [{ text: 'y = sin(x)', color: '#2563eb', on: true }], params: { a: { v: 1, min: -10, max: 10 } }, view: { x0: -10, x1: 10, y0: -7.5, y1: 7.5 }, opt: { grid: true }, ly: 1 };
  const variants = [
    ['base', it => it], ['removed', it => { it.pop(); }], ['color', it => { it[0].color = '#ff0000'; }], ['size', it => { it[0].size = 9.25; }],
    ['opacity', it => { it[0].opacity = 35; }], ['rot', it => { it[0].rot = -0.3; }], ['moved', it => { it[0].pts.forEach(q => { q[0] += 5.5; q[1] -= 1e7; }); }],
    ['layer', it => { it[0].ly = 2; }], ['text', it => { it.find(i => i.t === 't').html = '<b>héllo 👋</b>'; }], ['emptyText', it => { it.find(i => i.t === 't').text = ''; }],
    ['table', it => { it.find(i => i.t === 'tb').cw[0] += 20.125; }], ['graph', it => { it.push(clone(graph)); }],
    ['shape', it => { it.push({ t: 'sp', shp: 'ellipse', x: -40.5, y: 3e9, w: 10, h: 20, fill: '#ffeeaa', lineType: 'dash', size: 2, ly: 1 }); }],
    ['huge', it => { it.push({ t: 'sp', x: 1e300, y: -1e300, w: NaN, h: Infinity, size: 1e21 }); }]
  ];
  out.boardSig = variants.map(([name, f]) => { const it = mk(); f(it); return { name, items: JSON.parse(JSON.stringify(it)), layers, sig: C.boardSig(JSON.parse(JSON.stringify(it)), layers) }; });
  out.boardSig.push({ name: 'layers', items: [], layers: [{ id: 1, vis: 0, lock: 1 }, { id: 7, vis: 1 }], sig: C.boardSig([], [{ id: 1, vis: 0, lock: 1 }, { id: 7, vis: 1 }]) });
}

/* ---------- search text ---------- */
{
  const items = [
    { t: 't', text: '  Hello\n\tworld  ', html: '<b>x</b>' }, { t: 'm', latex: 'x^2', srcText: 'x squared' }, { t: 'm', latex: 'e^{i\\pi}' },
    { t: 'sp', shp: 'rect', label: 'Box label' }, { t: 'tb', cells: [['a', ''], [null, 'Café  ü']] }, { t: 'gr', fns: [{ text: 'y=x' }, {}, null] },
    { t: 'ck', title: 'Todo', rows: [{ text: 'milk' }, { text: '' }, null] }, { t: 'i', txt: 'PDF page text' }, null, 7, { t: 's', pts: [[1, 2]] }
  ];
  out.searchText = [{ items, out: C.searchText(items) }, { items: [{ t: 't', text: 'x'.repeat(25000) }, { t: 't', text: 'tail' }], out: C.searchText([{ t: 't', text: 'x'.repeat(25000) }, { t: 't', text: 'tail' }]) }];
}

/* ---------- start-up and board index ---------- */
{
  const metas = [{ id: 'a', t: 10 }, { id: 'b', t: 30 }, { id: 'c', t: 20, locked: true }, { id: 'd', t: 50, del: 1 }, { id: 'f', t: 99, folder: 1 }, { id: 'e', t: 25 }];
  out.pickStart = [['a', metas], ['c', metas], ['d', metas], ['f', metas], ['gone', metas], [null, metas], [null, []], ['x', [{ id: 'x', locked: 1 }]]]
    .map(([last, m]) => ({ last, metas: m, out: C.pickStart(last, m) }));
  const rec = { id: 'b', title: 'T', items: [{ t: 's' }], enc: { v: 1 }, th: 'data:x', t: 5, tags: 'a,b', fav: true, zz: { keep: [1, 2] } };
  out.metaOf = [{ rec, lk: ['x', 'y'], out: C.metaOf(rec, ['x', 'y']) }, { rec: { id: 1 }, lk: null, out: C.metaOf({ id: 1 }) }];
}

/* ---------- .rjwb files ---------- */
/* exactly what index.html's "Save a copy" writes: 'RJWB1:' + base64(UTF-8 of JSON.stringify(board)) */
const rjwb = o => { const j = JSON.stringify(o); return { json: j, rjwb: 'RJWB1:' + Buffer.from(j, 'utf8').toString('base64') }; };
{
  const r = rng(77);
  const everyType = [
    stroke(r, { n: 12 }),
    { ...stroke(r, { n: 5, tool: 'hrd' }), opacity: 35, lineType: 'dash', pl: 1, rot: 0.25 },
    { t: 't', x: 40, y: 60, w: 200, h: 40, text: 'héllo wörld 👋 日本語', html: '<b>héllo</b>', color: '#111', size: 24, ff: 'sans', b: 1, i: 0, u: 0, dir: 'ltr', ly: 1 },
    { t: 'l', x: 10, y: 20, text: 'https://example.com/?q=a&b=c', size: 16, ly: 1 },
    { t: 'i', x: 300, y: 80, w: 120, h: 90, src: 'data:image/png;base64,iVBORw0KGgo=', ly: 1, rot: 0 },
    { t: 'm', latex: '\\frac{a}{b}', srcText: 'a/b', x: 5, y: 6, size: 26.4, color: '#000', ly: 1 },
    { t: 'k', x: 1, y: 2, w: 300, h: 24, color: '#ff0', st: 'grid', open: false, ly: 1 },
    { t: 'sp', shp: 'rect', x: 0, y: 0, w: 50.5, h: 20, fx: 0, fy: 1, rot: 0, size: 2, color: '#123456', fill: '#fff', lineType: 'solid', cornerType: 'round', label: 'Start', ly: 1 },
    { t: 'tb', x: 500, y: 100, cw: [120, 120], rh: [40, 40], cells: [['a', '=A1*2'], ['', 'd']], mg: [], st: [[null, { b: 1 }], [null, null]], fs: 18, color: '#111', w: 240, h: 80, ly: 1 },
    { t: 'gr', x: 10, y: 20, w: 480, h: 360, fns: [{ text: 'y = sin(x)', color: '#2563eb', on: true }], params: { a: { v: 1, min: -10, max: 10 } }, view: { x0: -10, x1: 10, y0: -7.5, y1: 7.5 }, opt: { grid: true }, ly: 2 },
    { t: 'ck', x: 3, y: 4, w: 300, h: 0, title: 'Groceries', rows: [{ text: 'milk', done: true }, { text: 'eggs', done: false }], ly: 2 },
    { t: 'zz', future: { nested: [1, 'two', null, true, { deep: -0.5 }] }, x: 1, y: 2 }
  ];
  const full = {
    title: 'Every item type ✓', items: everyType, bg: 'white', pat: 'lines', gs: 28, gd: 1.5,
    layers: [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }, { id: 2, name: 'Notes', vis: 0, lock: 1 }], tags: 'math,physics',
    pg: { size: 'a4', o: 'p', n: 3 }, recs: [], src: 'b_123', futureTopLevel: { a: [1.5e-7, 2e+21, 12345678901234567890] }
  };
  const minimal = { title: 'Untitled', items: [] };
  const big = { title: 'Big', items: board(rng(5), 4), bg: '#1e1e1e', pat: 'grid', gs: 32, gd: 2, layers: [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }], tags: '', pg: { size: 'inf', o: 'p', n: 1 }, recs: [], src: 'b_big' };
  const locked = { title: 'Secret', items: [], enc: { v: 2, iv: 'AAAA', ct: 'BBBB', salt: 'CCCC' }, recs: [], src: 'b_lock', app: 'RejBoard' };
  const linked = { ...minimal, title: 'Has links', src: 'b_l', linked: [{ id: 'b_x', title: 'Other', items: [stroke(rng(8), { n: 3 })] }] };
  out.rjwb = [['full', full], ['minimal', minimal], ['big', big], ['locked', locked], ['linked', linked]].map(([name, o]) => ({ name, ...rjwb(o) }));
}

/* ink: brushes, paper, input, eraser and sizes, from the desktop's own drawing code (see ink-fixtures.js) */
require('./ink-fixtures.js')(out, { root: ROOT, rng, stroke });

/* the hash itself, so the Kotlin port of fnv() can be checked on its own */
out.fnv = ['', 'a', 'héllo 👋', '{"t":"s"}'].map(s => ({ s, h: fnv(s) }));

/* ---------- write / check ---------- */
const check = process.argv.includes('--check');
let stale = 0;
for (const [name, data] of Object.entries(out)) {
  const file = path.join(__dirname, name + '.json'), text = JSON.stringify(data) + '\n';
  if (check) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur !== text) { console.error('stale golden fixture: ' + path.relative(ROOT, file)); stale++; }
  } else fs.writeFileSync(file, text);
}
if (stale) { console.error('Run: node mobile/core/golden/generate.js'); process.exit(1); }
console.log(check ? 'golden fixtures are up to date' : 'wrote ' + Object.keys(out).length + ' golden fixtures');
