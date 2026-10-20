'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../board-core.js');
const { rng, stroke, board, state, json } = require('./helpers');

const BUDGET = 1e9;

/* ---------------- point packing ---------------- */
test('flatten/inflate round-trips exactly, including awkward numbers', () => {
  const P = [[0, -0, 1e-300, 5e15], [Number.MAX_SAFE_INTEGER, 0.1 + 0.2, -1e9, 3], [1 / 3, Math.PI, -Math.E, 0]];
  const fl = C.flatten(P);
  assert.equal(fl.w, 4);
  assert.deepEqual(C.inflate(fl.f, fl.w), P);
  assert.ok(Object.is(C.inflate(fl.f, fl.w)[0][1], -0), 'negative zero survives');
});

test('flatten refuses anything that is not a clean numeric tuple list', () => {
  assert.equal(C.flatten(null), null);
  assert.equal(C.flatten([]), null);
  assert.equal(C.flatten([[1, 2], [1, 2, 3]]), null, 'ragged');
  assert.equal(C.flatten([[1, '2']]), null, 'non-number');
  assert.equal(C.flatten([[1, 2], null]), null);
  assert.equal(C.flatten([new Array(9).fill(1)]), null, 'too wide');
});

test('inflate rejects corrupt packed data instead of throwing', () => {
  assert.equal(C.inflate(null, 4), null);
  assert.equal(C.inflate(new Float64Array(7), 4), null, 'length not a multiple of the width');
  assert.equal(C.inflate(new Float64Array(8), 0), null);
  assert.equal(C.inflate(new Float64Array(8), 99), null);
});

/* ---------------- history snapshots ---------------- */
test('packItems makes an independent deep copy that unpacks to the same board', () => {
  const r = rng(1), items = board(r, 50);
  const before = json(items);
  const snap = C.packItems(items);
  assert.ok(snap.__c > 0);
  items[0].pts[0][0] += 100; items[0].color = '#fff'; items.pop(); // mutate the live board afterwards
  assert.equal(json(C.unpackItems(snap)), before, 'snapshot is unaffected by later edits');
});

test('packItems does not touch the live items (pts and src stay intact)', () => {
  const items = board(rng(2), 10);
  const src = items.at(-2).src, p0 = items[0].pts;
  C.packItems(items);
  assert.equal(items.at(-2).src, src);
  assert.equal(items[0].pts, p0);
  assert.ok(Array.isArray(items[0].pts));
  assert.equal(items[0].__fp, undefined);
});

test('big embedded images are shared by reference, not copied', () => {
  const items = board(rng(3), 2);
  const snap = C.packItems(items);
  assert.equal(snap.at(-2).src, items.at(-2).src);
});

test('strokes with unusual extra properties fall back to a plain deep clone', () => {
  const s = stroke(rng(4)); s.meta = { dash: [1, 2, 3] };
  const snap = C.packItems([s]);
  assert.equal(snap[0].__fp, undefined);
  assert.notEqual(snap[0].meta, s.meta);
  assert.deepEqual(C.unpackItems(snap)[0], s);
});

test('trimHist keeps at least 3 entries and respects the count and byte budget', () => {
  const h = Array.from({ length: 100 }, () => ({ __c: 10 }));
  C.trimHist(h, BUDGET);
  assert.equal(h.length, 60);
  const g = Array.from({ length: 20 }, () => ({ __c: 100 }));
  C.trimHist(g, 450);
  assert.ok(g.length <= 4 && g.length >= 3);
  const t = Array.from({ length: 5 }, () => ({ __c: 1e12 }));
  C.trimHist(t, 1);
  assert.equal(t.length, 3);
});

/* Drives the real undo/redo code with a random mix of operations and checks every state against a reference timeline. */
function addStroke(S, hist, fut, s) { if (!C.pushAdd(S, hist, fut, BUDGET, s)) C.pushDeep(S, hist, fut, BUDGET); S.items.push(s); }

test('undo/redo reproduces every earlier board exactly (random operation mix)', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const r = rng(seed), S = state(board(r, 12)), hist = [], fut = [];
    const timeline = [json(S.items)];
    const ops = 40;
    for (let k = 0; k < ops; k++) {
      const roll = r();
      if (roll < 0.5) addStroke(S, hist, fut, stroke(r));
      else if (roll < 0.7 && S.items.length > 3) { C.pushDeep(S, hist, fut, BUDGET); S.items.splice((r() * S.items.length) | 0, 1); } // delete
      else if (roll < 0.9) { C.pushDeep(S, hist, fut, BUDGET); const i = S.items.find(x => x.t === 's'); i.pts.forEach(q => { q[0] += 7; q[1] -= 3; }); i.color = '#abc'; } // move + recolor
      else { // eraser-style: split a stroke in two
        C.pushDeep(S, hist, fut, BUDGET);
        const k2 = S.items.findIndex(x => x.t === 's' && x.pts.length > 6);
        if (k2 >= 0) { const o = S.items[k2]; S.items.splice(k2, 1, { ...o, pts: o.pts.slice(0, 3) }, { ...o, pts: o.pts.slice(4) }); }
      }
      timeline.push(json(S.items));
    }
    // walk all the way back, then all the way forward again
    for (let k = ops; k > 0; k--) { assert.equal(C.undoStep(S, hist, fut), true); assert.equal(json(S.items), timeline[k - 1], `seed ${seed} undo to step ${k - 1}`); }
    assert.equal(C.undoStep(S, hist, fut), false, 'nothing left to undo');
    for (let k = 1; k <= ops; k++) { assert.equal(C.redoStep(S, hist, fut, null, BUDGET), true); assert.equal(json(S.items), timeline[k], `seed ${seed} redo to step ${k}`); }
    assert.equal(C.redoStep(S, hist, fut, null, BUDGET), false, 'nothing left to redo');
  }
});

test('a new action after undo discards the redo stack', () => {
  const r = rng(21), S = state(board(r, 5)), hist = [], fut = [];
  addStroke(S, hist, fut, stroke(r)); addStroke(S, hist, fut, stroke(r));
  C.undoStep(S, hist, fut);
  assert.equal(fut.length, 1);
  addStroke(S, hist, fut, stroke(r));
  assert.equal(fut.length, 0);
});

test('an "added stroke" entry whose stroke is gone is skipped, not applied to the wrong item', () => {
  const r = rng(22), S = state(board(r, 5)), hist = [], fut = [];
  addStroke(S, hist, fut, stroke(r));            // entry A (will be orphaned)
  S.items = S.items.filter(i => i.t !== 's' || i.pts.length !== 40 || false); // remove all strokes of length 40, incl. the new one
  const left = json(S.items);
  const E = C.undoStep(S, hist, fut);
  assert.equal(E, false, 'orphaned entry is dropped, no item is removed');
  assert.equal(json(S.items), left);
});

test('undo restores layers, page counts and runs the hooks', () => {
  const r = rng(23), S = state(board(r, 3)), hist = [], fut = [], calls = [];
  const hooks = { pgUi: () => calls.push('pg'), pgLk: (_, u) => calls.push('lk' + u), layersChanged: () => calls.push('layers') };
  C.pushDeep(S, hist, fut, BUDGET);
  const e = hist.at(-1);
  e.__pn = 1; e.__ly = { l: S.layers.map(q => ({ ...q })), a: 1 };
  e.__lk = [{ b: 'x', before: 'a', after: 'b' }];
  S.pg.n = 4; S.layers = [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }, { id: 2, name: 'New', vis: 1, lock: 0 }]; S.ly = 2;
  C.undoStep(S, hist, fut, hooks);
  assert.equal(S.pg.n, 1); assert.equal(S.layers.length, 1); assert.equal(S.ly, 1);
  assert.deepEqual(calls.sort(), ['layers', 'lktrue', 'pg']);
  C.redoStep(S, hist, fut, hooks, BUDGET);
  assert.equal(S.pg.n, 4); assert.equal(S.layers.length, 2); assert.equal(S.ly, 2);
});

test('pushAdd only handles plain strokes', () => {
  const S = state([]), hist = [], fut = [];
  assert.equal(C.pushAdd(S, hist, fut, BUDGET, { t: 't', text: 'x' }), false);
  assert.equal(C.pushAdd(S, hist, fut, BUDGET, { t: 's', pts: [] }), false);
  assert.equal(hist.length, 0);
});

/* ---------------- stored boards ---------------- */
test('dbPackRec / dbOut round-trip a board record exactly', () => {
  const rec = { id: 'b1', title: 'T', th: 'data:x', items: board(rng(31), 30), layers: [{ id: 1 }] };
  const plain = json(rec);
  const stored = C.dbPackRec(rec, true);
  assert.ok(stored.items.some(i => i.__w), 'strokes are packed');
  assert.ok(stored.items.find(i => i.__w).pts instanceof Float64Array);
  assert.equal(json(rec), plain, 'input record is untouched');
  const structured = structuredClone(stored); // what IndexedDB does
  const back = C.dbOut(structured);
  assert.equal(json(back), plain);
});

test('listing boards does not unpack them (lazy items)', () => {
  const stored = structuredClone(C.dbPackRec({ id: 'b', items: board(rng(32), 20) }, true));
  const out = C.dbOut(stored);
  const raw = Object.getOwnPropertyDescriptor(out, 'items');
  assert.equal(typeof raw.get, 'function', 'items is a lazy getter until first read');
  const a = out.items;
  assert.ok(Array.isArray(a[0].pts) && !a[0].__w);
  assert.equal(out.items, a, 'second read returns the same unpacked array');
  const { items, ...rest } = out; // spread / destructuring must work too
  assert.equal(items, a); assert.equal(rest.id, 'b');
});

test('legacy (plain) records pass through untouched', () => {
  const rec = { id: 'old', items: board(rng(33), 10) };
  const copy = structuredClone(rec);
  const out = C.dbOut(structuredClone(rec));
  assert.equal(json(out), json(copy));
  assert.equal(Object.getOwnPropertyDescriptor(out, 'items').value !== undefined, true, 'no lazy getter needed');
});

test('mixed packed and plain items in one record are fine', () => {
  const items = board(rng(34), 6);
  const mixed = items.map((i, k) => (k % 2 && C.flatten(i.pts) ? { ...i, pts: C.flatten(i.pts).f, __w: C.flatten(i.pts).w } : i));
  assert.equal(json(C.dbOut(structuredClone({ id: 'm', items: mixed })).items), json(items));
});

test('corrupt packed strokes degrade to empty strokes and never throw', () => {
  const rec = structuredClone(C.dbPackRec({ id: 'c', items: board(rng(35), 4) }, true));
  const k = rec.items.findIndex(i => i.__w);
  rec.items[k].pts = new Float64Array(7); // length no longer matches the width
  const it = C.dbOut(rec).items[k];
  assert.deepEqual(it.pts, []);
  assert.equal(it.__w, undefined);
});

test('turning compact storage off writes plain records an older version can read', () => {
  const rec = { id: 'x', items: board(rng(36), 10) };
  const packed = C.dbPackRec(rec, true);
  const plain = C.dbPackRec(packed, false);
  assert.ok(plain.items.every(i => !i.__w && (!i.pts || Array.isArray(i.pts))));
  assert.equal(json(plain), json(rec));
  assert.ok(packed.items.some(i => i.__w), 'the packed record itself is not modified');
  assert.equal(C.dbPackRec(rec, false), rec, 'already plain: same object, nothing to write');
});

test('records without strokes are not rewritten', () => {
  const rec = { id: 'e', items: [{ t: 't', text: 'x' }] };
  assert.equal(C.dbPackRec(rec, true), rec);
  const folder = { id: 'f', folder: 1, name: 'F' };
  assert.equal(C.dbPackRec(folder, true), folder);
  assert.equal(C.dbPackRec(null, true), null);
});

/* ---------------- screen-cache fingerprint ---------------- */
test('boardSig is stable and notices every kind of visible change', () => {
  const mk = () => board(rng(41), 20);
  const layers = [{ id: 1, vis: 1, lock: 0 }];
  const sig = (items, l = layers) => C.boardSig(items, l);
  const base = sig(mk());
  assert.equal(sig(mk()), base, 'same board, same fingerprint');
  const changed = (f, why) => { const it = mk(); f(it); assert.notEqual(sig(it), base, why); };
  changed(it => it.pop(), 'item removed');
  changed(it => it.push(stroke(rng(9))), 'item added');
  changed(it => { const t = it[0]; it[0] = it[1]; it[1] = t; }, 'z-order swapped');
  changed(it => { it[0].color = '#ff0000'; }, 'color');
  changed(it => { it[0].size = 9; }, 'size');
  changed(it => { it[0].opacity = 35; }, 'opacity');
  changed(it => { it[0].tool = 'pencil'; }, 'tool');
  changed(it => { it[0].rot = 0.3; }, 'rotation');
  changed(it => { it[0].pts.forEach(q => { q[0] += 5; q[1] += 5; }); }, 'moved');
  changed(it => { it[0].pts.forEach(q => { q[0] *= 1.1; q[1] *= 1.1; }); }, 'scaled');
  changed(it => { it[0].pts.splice(10, 5); }, 'part erased (fewer points)');
  changed(it => { it[0].pts = it[0].pts.slice(0, 20); }, 'stroke cut');
  changed(it => { it[0].ly = 2; }, 'moved to another layer');
  changed(it => { const t = it.find(i => i.t === 't'); t.html = '<b>hello!!</b>'; }, 'text edited');
  changed(it => { const t = it.find(i => i.t === 't'); t.x += 3; }, 'text moved');
  changed(it => { const i = it.find(x => x.t === 'i'); i.w += 10; }, 'image resized');
  changed(it => { const tb = it.find(i => i.t === 'tb'); tb.cells[1][1] = 'dddd'; }, 'table cell edited');
  changed(it => { const tb = it.find(i => i.t === 'tb'); tb.cw[0] += 20; }, 'table column resized');
  assert.notEqual(sig(mk(), [{ id: 1, vis: 0, lock: 0 }]), base, 'layer hidden');
  assert.notEqual(sig(mk(), [{ id: 1, vis: 1, lock: 0 }, { id: 2, vis: 1, lock: 0 }]), base, 'layer added');
});

test('sameSet compares membership, not identity', () => {
  const a = {}, b = {}, c = {};
  assert.equal(C.sameSet(null, null), true);
  assert.equal(C.sameSet(new Set([a, b]), new Set([b, a])), true);
  assert.equal(C.sameSet(new Set([a]), new Set([b])), false);
  assert.equal(C.sameSet(new Set([a]), null), false);
  assert.equal(C.sameSet(new Set([a, b]), new Set([a, b, c])), false);
});

/* ---------------- eraser pre-filter ---------------- */
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

test('strokeNear never rules out a stroke the eraser could actually touch', () => {
  const r = rng(51);
  for (let n = 0; n < 300; n++) {
    const s = stroke(r, { n: 2 + ((r() * 60) | 0), x: r() * 300, y: r() * 300 });
    s.size = 1 + r() * 20;
    const cache = new WeakMap();
    for (let k = 0; k < 40; k++) {
      const p = [r() * 400 - 50, r() * 400 - 50], rad = 2 + r() * 40, reach = rad + s.size / 2;
      let hit = false;
      for (let j = 0; j < s.pts.length && !hit; j++) hit = Math.hypot(s.pts[j][0] - p[0], s.pts[j][1] - p[1]) < reach || (j > 0 && segDist(p, s.pts[j - 1], s.pts[j]) < reach);
      if (hit) assert.equal(C.strokeNear(s, p, rad, cache), true, 'a stroke that is within reach must pass the pre-filter');
    }
  }
});

test('strokeNear is a real filter: far-away strokes are skipped', () => {
  const s = stroke(rng(52), { x: 0, y: 0 });
  assert.equal(C.strokeNear(s, [5000, 5000], 10), false);
  assert.equal(C.strokeNear(s, s.pts[5], 10), true);
});

/* ---------------- performance budget (generous: catches accidental O(n^2) or a lost fast path, not machine noise) ---------------- */
test('performance budget on a 3,000-stroke / 210,000-point board', () => {
  const r = rng(61), items = [];
  for (let k = 0; k < 3000; k++) items.push(stroke(r, { n: 70 }));
  const T = f => { const t = process.hrtime.bigint(); const v = f(); return [Number(process.hrtime.bigint() - t) / 1e6, v]; };
  T(() => C.packItems(items)); // warm up
  const [tp, snap] = T(() => C.packItems(items));
  const [tc] = T(() => structuredClone(items));
  const [tu] = T(() => C.unpackItems(snap));
  const [ts] = T(() => C.boardSig(items, [{ id: 1, vis: 1 }]));
  const [td] = T(() => C.dbPackItems(items));
  console.log(`  pack ${tp.toFixed(0)} ms (structuredClone ${tc.toFixed(0)} ms), unpack ${tu.toFixed(0)} ms, sig ${ts.toFixed(1)} ms, dbPack ${td.toFixed(0)} ms`);
  assert.ok(tp < 1500, 'pack ' + tp);
  assert.ok(tu < 1500, 'unpack ' + tu);
  assert.ok(ts < 300, 'sig ' + ts);
  assert.ok(td < 1500, 'dbPack ' + td);
  assert.ok(tp < tc, 'packing must stay faster than a structuredClone of the board');
});

/* ---------------- Shift = straight line ---------------- */
test('shiftSnap puts near-level, near-upright and near-diagonal lines exactly on the axis', () => {
  const a = [100, 200];
  assert.deepEqual(C.shiftSnap(a, [400, 205]), [400, 200], 'near level (right)');
  assert.deepEqual(C.shiftSnap(a, [-300, 195]), [-300, 200], 'near level (left)');
  assert.deepEqual(C.shiftSnap(a, [104, 500]), [100, 500], 'near upright (down)');
  assert.deepEqual(C.shiftSnap(a, [97, -100]), [100, -100], 'near upright (up)');
  const d = C.shiftSnap(a, [300, 390]);
  assert.ok(Math.abs((d[0] - a[0]) - (d[1] - a[1])) < 1e-9, 'near 45 degrees');
  const e = C.shiftSnap(a, [300, 15]);
  assert.ok(Math.abs((e[0] - a[0]) + (e[1] - a[1])) < 1e-9, 'near the other diagonal');
  assert.ok(e[0] > a[0] && e[1] < a[1], 'and in the right direction');
});

test('shiftSnap leaves clearly slanted lines alone', () => {
  const a = [0, 0], p = [300, 100]; // about 18 degrees
  assert.equal(C.shiftSnap(a, p), p);
  assert.equal(C.shiftSnap(a, a), a, 'zero-length line is returned as is');
  assert.deepEqual(C.shiftSnap(a, [1000, 1]), [1000, 0]);
});

test('shiftSnap tolerance is adjustable', () => {
  const a = [0, 0], p = [300, 30]; // about 5.7 degrees
  assert.deepEqual(C.shiftSnap(a, p), [300, 0]);
  assert.equal(C.shiftSnap(a, p, 3), p);
});

test('shiftSnap results are exactly level / upright, so ruled lines stay parallel', () => {
  const ys = new Set(), xs = new Set();
  for (let k = 0; k < 50; k++) {
    ys.add(C.shiftSnap([10, 77], [500 + k, 77 + (k % 5)])[1]);
    xs.add(C.shiftSnap([42, 10], [42 + (k % 4), 900 + k])[0]);
  }
  assert.equal(ys.size, 1); assert.equal(xs.size, 1);
});

/* ---------------- board index and start-up ---------------- */
test('metaOf keeps everything except the items, and never reads a lazy items getter', () => {
  let touched = false;
  const rec = { id: 'b', title: 'T', th: 'data:x', t: 5, tags: 'a,b', fav: true };
  Object.defineProperty(rec, 'items', { enumerable: true, get() { touched = true; return []; } });
  const m = C.metaOf(rec, ['x', 'y']);
  assert.equal(touched, false);
  assert.deepEqual(m, { id: 'b', title: 'T', th: 'data:x', t: 5, tags: 'a,b', fav: true, lk: ['x', 'y'] });
  assert.equal('items' in C.metaOf({ id: 1, items: [1, 2, 3] }), false);
  assert.equal('lk' in C.metaOf({ id: 1 }), false);
});

test('pickStart opens the last board when it is usable, else the newest usable one', () => {
  const metas = [
    { id: 'a', t: 10 }, { id: 'b', t: 30 }, { id: 'c', t: 20, locked: true }, { id: 'd', t: 50, del: 1 }, { id: 'f', t: 99, folder: 1 }, { id: 'e', t: 25 }
  ];
  assert.equal(C.pickStart('a', metas), 'a', 'last board wins even if older');
  assert.equal(C.pickStart('c', metas), 'b', 'locked last board is skipped');
  assert.equal(C.pickStart('d', metas), 'b', 'trashed last board is skipped');
  assert.equal(C.pickStart('f', metas), 'b', 'a folder is not a board');
  assert.equal(C.pickStart('gone', metas), 'b', 'missing last board');
  assert.equal(C.pickStart(null, metas), 'b', 'no last board: newest usable');
  assert.equal(C.pickStart(null, []), null);
  assert.equal(C.pickStart('x', [{ id: 'x', locked: 1 }]), null, 'nothing usable at all');
});

test('boardSig notices edits to a graph object', () => {
  const g = () => ({ t: 'gr', x: 10, y: 20, w: 480, h: 360, fns: [{ text: 'y = sin(x)', color: '#2563eb', on: true }], params: { a: { v: 1, min: -10, max: 10 } }, view: { x0: -10, x1: 10, y0: -7.5, y1: 7.5 }, opt: { grid: true }, ly: 1 });
  const base = C.boardSig([g()], []);
  assert.equal(C.boardSig([g()], []), base);
  const edit = f => { const o = g(); f(o); return C.boardSig([o], []); };
  assert.notEqual(edit(o => { o.fns[0].text = 'y = cos(x)'; }), base, 'function text');
  assert.notEqual(edit(o => { o.fns[0].color = '#dc2626'; }), base, 'colour');
  assert.notEqual(edit(o => { o.fns[0].on = false; }), base, 'hidden');
  assert.notEqual(edit(o => { o.params.a.v = 2; }), base, 'slider value');
  assert.notEqual(edit(o => { o.view.x1 = 12; }), base, 'view');
  assert.notEqual(edit(o => { o.opt.grid = false; }), base, 'option');
  assert.notEqual(edit(o => { o.fns.push({ text: 'x', color: '#000', on: true }); }), base, 'added function');
  assert.notEqual(edit(o => { o.w = 600; }), base, 'size');
});
