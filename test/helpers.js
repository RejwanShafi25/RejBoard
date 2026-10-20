'use strict';
/* Shared helpers for the unit tests: a seeded random generator and board builders. */

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function stroke(r, { n = 40, tool = 'fount', x = r() * 1200, y = r() * 4000, w = 4 } = {}) {
  const pts = [];
  let px = x, py = y, a = r() * 6;
  for (let k = 0; k < n; k++) {
    a += (r() - 0.5) * 0.9;
    px += Math.cos(a) * 3; py += Math.sin(a) * 3;
    const q = [px, py, 0.3 + r() * 0.5];
    if (w === 4) q.push(r() < 0.5 ? 0 : r());
    pts.push(q);
  }
  return { t: 's', tool, color: '#222222', size: 3, sens: 0.6, ang: 135, opacity: 100, pts, tl: false, ly: 1 };
}

function board(r, n, opts) {
  const items = [];
  for (let k = 0; k < n; k++) items.push(stroke(r, { tool: ['fount', 'calli', 'soft', 'ball', 'pencil', 'hrd'][k % 6], ...opts }));
  // a few non-stroke items, the way real boards have them
  items.push({ t: 't', x: 40, y: 60, w: 200, h: 40, text: 'hello', html: '<b>hello</b>', color: '#111', size: 24, ly: 1 });
  items.push({ t: 'i', x: 300, y: 80, w: 120, h: 90, src: 'data:image/png;base64,' + 'A'.repeat(6000), ly: 1 });
  items.push({ t: 'tb', x: 500, y: 100, cw: [80, 80], rh: [30, 30], cells: [['a', 'b'], ['c', 'd']], st: [[{}, {}], [{}, {}]], ly: 1 });
  return items;
}

function state(items) {
  return { items, sel: [], pg: { size: 'inf', o: 'p', n: 1 }, layers: [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }], ly: 1 };
}

const json = x => JSON.stringify(x);

module.exports = { rng, stroke, board, state, json };
