'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../diagram-core.js');

const E = [1, 0], W = [-1, 0], N = [0, -1], S = [0, 1];
const axisAligned = P => P.every((p, k) => !k || Math.abs(p[0] - P[k - 1][0]) < 1e-9 || Math.abs(p[1] - P[k - 1][1]) < 1e-9);
const z = v => v || 0; // -0 and 0 are the same direction
const dir = (p, q) => [z(Math.sign(Math.round(q[0] - p[0]))), z(Math.sign(Math.round(q[1] - p[1])))];

/* ---------------- orthoRoute ---------------- */
test('elbow routes are made only of horizontal and vertical pieces, from a to b', () => {
  const cases = [[[0, 0], E, [200, 100], W], [[0, 0], E, [-200, 100], W], [[0, 0], S, [150, 200], N], [[0, 0], S, [150, -200], N],
    [[0, 0], E, [200, 150], N], [[0, 0], E, [-200, -150], N], [[0, 0], N, [200, 150], W], [[0, 0], E, [200, 0], E], [[0, 0], S, [0, 300], S],
    [[0, 0], null, [300, 80], null], [[0, 0], null, [20, 300], null], [[10, 10], E, [10, 10], W]];
  for (const [a, na, b, nb] of cases) {
    const P = D.orthoRoute(a, na, b, nb, { gap: 20 });
    assert.deepEqual(P[0], a); assert.deepEqual(P[P.length - 1], b);
    assert.ok(axisAligned(P), JSON.stringify([a, na, b, nb, P]));
  }
});

test('the route leaves along the start side and arrives against the end side', () => {
  for (const [na, nb] of [[E, W], [S, N], [E, N], [N, E], [W, W], [S, S]]) {
    for (const b of [[300, 200], [-300, 200], [300, -200], [-300, -200]]) {
      const P = D.orthoRoute([0, 0], na, b, nb, { gap: 20 });
      assert.deepEqual(dir(P[0], P[1]), na, 'leaves along ' + na + ' to ' + b + ': ' + JSON.stringify(P));
      assert.deepEqual(dir(P[P.length - 2], P[P.length - 1]), [z(-nb[0]), z(-nb[1])], 'arrives against ' + nb + ' at ' + b + ': ' + JSON.stringify(P));
    }
  }
});

test('simple cases take the obvious few corners', () => {
  assert.equal(D.orthoRoute([0, 0], E, [200, 100], W).length, 6 - 2, 'Z-shape: a, two corners, b');
  assert.equal(D.orthoRoute([0, 0], E, [200, 0], W).length, 2, 'facing at the same height: one straight piece');
  assert.equal(D.orthoRoute([0, 0], E, [200, 150], N).length, 3, 'L-shape: one corner');
});

test('orthoRoute survives bad input', () => {
  assert.deepEqual(D.orthoRoute(null, E, [1, 1], W), []);
  assert.deepEqual(D.orthoRoute([NaN, 0], E, [1, 1], W), []);
  assert.ok(D.orthoRoute([0, 0], [0.2, 0.1], [50, 50], 'x').length >= 2, 'odd normals fall back to automatic sides');
});

/* ---------------- crossings / hops ---------------- */
test('crossings finds proper crossings only', () => {
  const h = [[0, 50], [100, 50]];
  assert.deepEqual(D.crossings(h, [[[50, 0], [50, 100]]]), [[0.5]]);
  assert.deepEqual(D.crossings(h, [[[50, 50], [50, 100]]]), [[]], 'touching at an end is not a crossing');
  assert.deepEqual(D.crossings(h, [[[0, 50], [100, 50]]]), [[]], 'overlapping parallel lines are not crossings');
  assert.deepEqual(D.crossings(h, [[[20, 0], [20, 100]], [[70, 0], [70, 100]]]), [[0.2, 0.7]], 'sorted along the segment');
});

test('hops puts a jump at each crossing, never at a corner, never overlapping', () => {
  const ops = D.hops([[0, 50], [100, 50], [100, 200]], [[[40, 0], [40, 100]], [[110, 120], [0, 120]], [[98, 0], [98, 100]], [[43, 0], [43, 100]]], 5);
  const J = ops.filter(o => o.J);
  assert.equal(J.length, 2, 'the crossing at x=98 is too close to the corner, x=43 too close to the jump at 40');
  assert.deepEqual(J.map(j => j.J.c), [[40, 50], [100, 120]]);
  assert.deepEqual(ops[0], { M: [0, 50] });
  assert.deepEqual(ops[ops.length - 1], { L: [100, 200] });
});

test('hops also jumps where a curve (drawn as many short pieces) crosses a line', () => {
  const curve = Array.from({ length: 33 }, (_, k) => [k * 10, 100 - Math.sin(k / 32 * Math.PI) * 80]); // short pieces, gentle bends
  const ops = D.hops(curve, [[[155, -50], [155, 200]], [[161, -50], [161, 200]]], 5);
  assert.equal(ops.filter(o => o.J).length, 1, 'the crossing near a joint is still drawn; the second one is too close to the first');
  assert.ok(Math.abs(ops.find(o => o.J).J.c[0] - 155) < 1);
});

test('crossings work is bounded', () => {
  const many = Array.from({ length: 2000 }, (_, k) => [[k, -10], [k + 0.5, 10]]);
  const t = Date.now(), X = D.crossings([[0, 0], [2000, 0]], many);
  assert.ok(X[0].length <= 200 && Date.now() - t < 1000);
});

/* ---------------- labels / heads ---------------- */
test('polyMid finds the point halfway along the path', () => {
  assert.deepEqual(D.polyMid([[0, 0], [100, 0]]), [50, 0]);
  assert.deepEqual(D.polyMid([[0, 0], [100, 0], [100, 100]]), [100, 0]);
  assert.deepEqual(D.polyMid([[5, 5]]), [5, 5]);
  assert.deepEqual(D.polyMid([]), [0, 0]);
});

test('arrowheads point at the tip, solid ones are closed', () => {
  for (const k of D.HEADS) {
    const h = D.head(k, [100, 0], [0, 0], 20);
    if (k === 'none') { assert.equal(h, null); continue; }
    assert.ok(h.pl.length >= 2, k);
    assert.ok(h.pl.every(p => p[0] <= 100 + 1e-9 && p[0] >= 100 - 25), k + ' sits just behind the tip');
    if (h.fill) assert.deepEqual(h.pl[0].map(v => Math.round(v) || 0), h.pl[h.pl.length - 1].map(v => Math.round(v) || 0), k + ' is closed');
  }
  assert.equal(D.head('tri', [0, 0], [0, 0], 0), null);
  assert.equal(D.head('???', [1, 1], [0, 0], 10), null);
});

/* ---------------- guides / grid ---------------- */
test('guideSnap aligns edges and centres within the tolerance and reports the guide lines', () => {
  const r = D.guideSnap([103, 300, 203, 350], [[100, 0, 200, 50]], 6);
  assert.equal(r.dx, -3); assert.equal(r.dy, 0);
  assert.ok(r.gx.some(g => g.x === 100) && r.gx.some(g => g.x === 150) && r.gx.some(g => g.x === 200));
  const far = D.guideSnap([130, 300, 230, 350], [[100, 0, 200, 50]], 6);
  assert.deepEqual([far.dx, far.dy, far.gx.length, far.gy.length], [0, 0, 0, 0]);
  const mid = D.guideSnap([0, 22, 40, 32], [[100, 0, 200, 50]], 6);
  assert.equal(mid.dy, -2, 'vertical centres line up (27 -> 25)');
});

test('guideSnap ignores junk boxes', () => {
  assert.deepEqual(D.guideSnap([0, 0, 10, 10], [null, [NaN, 0, 1, 1], 'x'], 5), { dx: 0, dy: 0, gx: [], gy: [] });
});

test('gridSnap puts the top-left corner on the grid', () => {
  assert.deepEqual(D.gridSnap([13, 47, 50, 90], 20), { dx: 7, dy: -7 });
  assert.deepEqual(D.gridSnap([13, 47, 50, 90], 0), { dx: 0, dy: 0 });
});

/* ---------------- containers ---------------- */
test('inside picks what a container carries', () => {
  const boxes = [[0, 0, 400, 300], [20, 20, 80, 60], [380, 280, 480, 380], [-50, 100, 30, 120], [10, 10, 390, 290], [500, 500, 520, 520], [-10, -10, 410, 310]];
  assert.deepEqual(D.inside(boxes[0], boxes, new Set([0])), [1, 4], 'centre inside and not bigger than the container');
});

/* ---------------- layered layout ---------------- */
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
function check(nodes, edges, dir) {
  const P = D.layered(nodes, edges, { dir });
  const R = nodes.map(n => [P[n.id][0], P[n.id][1], n.w, n.h]);
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) assert.ok(!overlap(R[i], R[j]), 'nodes ' + i + ' and ' + j + ' overlap');
  return P;
}

test('layered layout: a flowchart goes top to bottom without overlaps', () => {
  const nodes = ['start', 'a', 'b', 'c', 'end'].map(id => ({ id, w: 120, h: 50 }));
  const edges = [['start', 'a'], ['start', 'b'], ['a', 'c'], ['b', 'c'], ['c', 'end']];
  const P = check(nodes, edges, 'TB');
  for (const [f, t] of edges) assert.ok(P[t][1] > P[f][1], f + ' above ' + t);
  assert.equal(P.a[1], P.b[1], 'siblings share a layer');
});

test('layered layout: left to right, cycles and isolated nodes', () => {
  const nodes = [1, 2, 3, 4, 5].map(id => ({ id, w: 80, h: 40 }));
  const P = check(nodes, [[1, 2], [2, 3], [3, 1], [3, 4]], 'LR');
  assert.ok(P[2][0] > P[1][0] && P[3][0] > P[2][0] && P[4][0] > P[3][0], 'the loop is broken, the rest flows right');
  assert.ok(P[5], 'an unconnected node still gets a place');
});

test('layered layout survives junk and scales', () => {
  assert.deepEqual(D.layered([], []), {});
  assert.deepEqual(Object.keys(D.layered([{ id: 'x', w: 1, h: 1 }, null], [['x', 'x'], ['x', 'nope'], null])), ['x']);
  const n = 400, nodes = Array.from({ length: n }, (_, k) => ({ id: k, w: 60, h: 30 })), edges = [];
  for (let k = 1; k < n; k++) edges.push([Math.floor((k - 1) / 3), k]);
  const t = Date.now(); check(nodes, edges, 'TB'); assert.ok(Date.now() - t < 2000, 'fast for a few hundred shapes');
});
