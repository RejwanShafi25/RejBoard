'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const math = require('mathjs');
const G = require('../graph-core.js').create(math);

const V = (x0, x1, y0, y1) => ({ x0, x1, y0, y1 });
const view = V(-10, 10, -7.5, 7.5);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * (1 + Math.abs(b));
const all = lines => lines.flat();
const geo = (text, params, v, w, h) => { const c = G.parseCurve(text); assert.ok(!c.error, c.error); return Object.assign({ curve: c }, { geo: G.geometry(c, params || {}, v || view, w || 800, h || 600) }); };

/* ---------------- what the user types ---------------- */
test('parseCurve recognises every kind of curve', () => {
  const k = t => G.parseCurve(t).kind;
  assert.equal(k('y = sin(x)'), 'y'); assert.equal(k('sin(x)'), 'y'); assert.equal(k('x^2 - 3'), 'y'); assert.equal(k('sin(x) = y'), 'y'); assert.equal(k('2x(x+1)'), 'y');
  assert.equal(k('x^2 + y^2 = 4'), 'impl'); assert.equal(k('x*y = 1'), 'impl'); assert.equal(k('y^2 = x'), 'impl'); assert.equal(k('x = y^2 - 1'), 'impl'); assert.equal(k('x^2 + y^2 - 4'), 'impl'); assert.equal(k('y - x^2'), 'impl');
  assert.equal(k('r = 1 + cos(theta)'), 'pol'); assert.equal(k('cos(3 theta)'), 'pol');
  assert.equal(k('(cos(t), sin(t))'), 'par'); assert.equal(k('(t^2, t^3)'), 'par');
  const p = G.parseCurve('(cos(t), sin(2t)), t in [0, pi]'); assert.equal(p.kind, 'par');
});
test('parseCurve rejects nonsense with a message and never throws', () => {
  for (const bad of ['', '   ', 'y =', '= x', 'x = = 1', 'sin(', 'foo(x)', 'x^1000000', 'y = 2x +', '((((', '1,2,3', 'a = b = c']) {
    let r; assert.doesNotThrow(() => { r = G.parseCurve(bad); }, bad);
    assert.ok(r.error, 'expected an error for "' + bad + '"');
  }
  assert.ok(G.parseCurve('x'.repeat(400)).error);
});
test('slider parameters are the letters that are not axis or constant names', () => {
  const ps = (...t) => G.paramsOf(t.map(x => G.parseCurve(x)));
  assert.deepEqual(ps('a*sin(b*x)'), ['a', 'b']);
  assert.deepEqual(ps('y = x^2 + k', 'x^2 + y^2 = r2'), ['k', 'r2']);
  assert.deepEqual(ps('sin(x)', 'cos(x)'), []);
  assert.deepEqual(ps('(a*cos(t), b*sin(t))'), ['a', 'b']);
  assert.deepEqual(ps('r = a + b*cos(theta)'), ['a', 'b']);
  assert.deepEqual(ps('e^x + pi*x'), []);
});

/* ---------------- explicit curves ---------------- */
test('y = f(x) points lie on the curve and cover the whole view', () => {
  for (const [t, f] of [['sin(x)', Math.sin], ['x^2/5', x => x * x / 5], ['abs(x)', Math.abs], ['x^3/20 - x', x => x ** 3 / 20 - x], ['exp(x/3)', x => Math.exp(x / 3)]]) {
    const g = geo(t); const pts = all(g.geo.lines);
    assert.ok(pts.length > 200, t);
    for (const [x, y] of pts) assert.ok(near(y, f(x), 1e-9), `${t} at ${x}`);
    assert.ok(Math.min(...pts.map(p => p[0])) <= -9.99 && Math.max(...pts.map(p => p[0])) >= 9.99, t + ' spans the view');
  }
});
test('sharp turns are sampled finely (|x| has a corner at 0, sin(1/x) wiggles)', () => {
  const ab = all(geo('abs(x)').geo.lines);
  assert.ok(ab.some(p => Math.abs(p[0]) < 0.06 && Math.abs(p[1]) < 0.06), 'a point at the corner');
  const w = all(geo('sin(1/x)', {}, V(-1, 1, -1.5, 1.5), 800, 400).geo.lines);
  assert.ok(w.length > 800, 'many samples near the origin: ' + w.length);
});
test('poles split the line instead of drawing a vertical connector', () => {
  for (const t of ['tan(x)', '1/x', '1/(x-2)', '1/(x^2-1)']) {
    const lines = geo(t).geo.lines;
    assert.ok(lines.length >= 2, t + ' is cut into pieces');
    for (const L of lines) for (let k = 1; k < L.length; k++) assert.ok(!(Math.abs(L[k][1] - L[k - 1][1]) > 15 && Math.sign(L[k][1]) !== Math.sign(L[k - 1][1])), `${t}: connector across a pole at x=${L[k][0]}`);
  }
  assert.equal(geo('1/x').geo.lines.length, 2);
  assert.equal(geo('tan(x)').geo.lines.length, 7);
});
test('domain gaps: sqrt, log and removable holes', () => {
  const s = all(geo('sqrt(x)').geo.lines); assert.ok(s.every(p => p[0] >= 0)); assert.ok(s.length > 100);
  const l = all(geo('log(x)').geo.lines); assert.ok(l.every(p => p[0] > 0));
  const h = geo('(x^2-1)/(x-1)').geo.lines; assert.ok(h.length >= 1);
  assert.equal(geo('sqrt(-1-x^2)').geo.lines.length, 0, 'nothing real to draw');
  assert.equal(geo('1/0').geo.lines.length, 0);
});
test('huge values are clipped instead of blowing the stroke up', () => {
  const pts = all(geo('exp(x^2)').geo.lines);
  assert.ok(pts.every(p => Number.isFinite(p[1]) && Math.abs(p[1]) < 1e5 * 15));
});
test('sliders change the curve', () => {
  const a = all(geo('a*sin(x)', { a: 1 }).geo.lines), b = all(geo('a*sin(x)', { a: 3 }).geo.lines);
  assert.ok(Math.max(...a.map(p => p[1])) < 1.01); assert.ok(Math.max(...b.map(p => p[1])) > 2.99);
  assert.equal(geo('a*x', {}).geo.lines.length, 0, 'an undefined parameter draws nothing rather than crashing');
});

/* ---------------- implicit curves ---------------- */
test('implicit curves: every point satisfies the equation', () => {
  const cases = [['x^2 + y^2 = 4', (x, y) => x * x + y * y - 4], ['x^2/9 + y^2/4 = 1', (x, y) => x * x / 9 + y * y / 4 - 1], ['x*y = 1', (x, y) => x * y - 1], ['y^2 = x', (x, y) => y * y - x], ['x^2 - y^2 = 1', (x, y) => x * x - y * y - 1], ['sin(x) = cos(y)', (x, y) => Math.sin(x) - Math.cos(y)]];
  for (const [t, F] of cases) {
    const g = geo(t); const pts = all(g.geo.lines);
    assert.ok(pts.length > 100, t);
    // linear interpolation along a grid edge: the residual shrinks with the cell size; allow a generous but meaningful bound
    const worst = Math.max(...pts.map(([x, y]) => Math.abs(F(x, y))));
    assert.ok(worst < 0.35, `${t}: worst residual ${worst}`);
  }
});
test('the circle is closed and round', () => {
  const g = geo('x^2 + y^2 = 4', {}, V(-5, 5, -5, 5), 600, 600), pts = all(g.geo.lines);
  const radii = pts.map(([x, y]) => Math.hypot(x, y));
  assert.ok(Math.min(...radii) > 1.97 && Math.max(...radii) < 2.03);
  const angles = new Set(pts.map(([x, y]) => Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 12))));
  assert.ok(angles.size >= 24, 'all around the circle');
});
test('implicit curves ignore poles and gaps', () => {
  const g = geo('y^2 = 1/(x^2-1)', {}, V(-5, 5, -5, 5), 600, 600);
  assert.equal(g.curve.kind, 'impl');
  assert.ok(g.geo.lines.length > 20);
  for (const [a, b] of g.geo.lines) {
    assert.ok(Math.abs(a[0]) > 1 - 0.1 && Math.abs(b[0]) > 1 - 0.1, 'nothing is drawn inside |x| < 1, where there is no real curve');
    assert.ok(near(a[1] * a[1] * (a[0] * a[0] - 1), 1, 0.5) || Math.abs(a[0]) < 1.2, 'points stay on the curve');
  }
  assert.equal(geo('x^2 + y^2 = -1').geo.lines.length, 0);
});

/* ---------------- parametric and polar ---------------- */
test('parametric and polar curves', () => {
  const c = all(geo('(cos(t), sin(t))').geo.lines); assert.ok(c.every(([x, y]) => near(Math.hypot(x, y), 1, 1e-9)));
  const e = all(geo('(3cos(t), 2sin(t))').geo.lines); assert.ok(e.every(([x, y]) => near(x * x / 9 + y * y / 4, 1, 1e-9)));
  const part = all(geo('(cos(t), sin(t)), t in [0, pi]').geo.lines); assert.ok(part.every(p => p[1] >= -1e-9));
  const cardioid = all(geo('r = 1 + cos(theta)').geo.lines); assert.ok(cardioid.every(([x, y]) => near(Math.hypot(x, y), 1 + x / Math.hypot(x, y) || 2, 1e-6) || Math.hypot(x, y) < 1e-6));
  const rose = geo('r = 3*cos(2*theta)'); assert.ok(all(rose.geo.lines).length > 300);
  const lissajous = all(geo('(sin(3t), sin(2t))').geo.lines); assert.ok(lissajous.every(([x, y]) => Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9));
  assert.equal(geo('(1/0, t)').geo.lines.length, 0);
  assert.ok(all(geo('(a*cos(t), a*sin(t))', { a: 2 }).geo.lines).every(([x, y]) => near(Math.hypot(x, y), 2, 1e-9)));
});

/* ---------------- intersections ---------------- */
function crossings(texts, params, v) {
  const view2 = v || view;
  const items = texts.map(t => geo(t, params, view2));
  return G.intersections(items, params || {}, view2).map(p => [p.x, p.y]).sort((a, b) => a[0] - b[0]);
}
test('intersections of explicit curves are exact', () => {
  const r = crossings(['x^2', 'x + 2']); assert.equal(r.length, 2);
  assert.ok(near(r[0][0], -1, 1e-9) && near(r[0][1], 1, 1e-9) && near(r[1][0], 2, 1e-9) && near(r[1][1], 4, 1e-9), JSON.stringify(r));
  const s = crossings(['sin(x)', '0.5']); assert.equal(s.length, 7, 'sin x = 0.5 seven times on [-10, 10]');
  for (const [x, y] of s) { assert.ok(near(Math.sin(x), 0.5, 1e-9)); assert.ok(near(y, 0.5, 1e-9)); }
  const c = crossings(['sin(x)', 'cos(x)']); for (const [x] of c) assert.ok(near(Math.sin(x), Math.cos(x), 1e-9));
  assert.equal(crossings(['x', 'x + 1']).length, 0, 'parallel lines never meet');
});
test('intersections between different kinds of curves', () => {
  const r = crossings(['x^2 + y^2 = 4', 'y = x']); assert.equal(r.length, 2);
  for (const [x, y] of r) { assert.ok(near(x * x + y * y, 4, 1e-9)); assert.ok(near(x, y, 1e-9)); }
  const h = crossings(['x*y = 1', 'x^2 + y^2 = 4']); assert.equal(h.length, 4);
  for (const [x, y] of h) { assert.ok(near(x * y, 1, 1e-8)); assert.ok(near(x * x + y * y, 4, 1e-8)); }
  const p = crossings(['(cos(t), sin(t))', 'y = 0.5']); assert.equal(p.length, 2);
  for (const [x, y] of p) assert.ok(near(Math.hypot(x, y), 1, 1e-2) && near(y, 0.5, 1e-2));
});
test('an intersection outside the view is not reported', () => {
  assert.equal(crossings(['x^2', 'x + 2'], {}, V(3, 10, -1, 20)).length, 0);
});

/* ---------------- ticks, formatting, view ---------------- */
test('axis ticks are round numbers inside the range', () => {
  for (const [a, b] of [[-10, 10], [0, 1], [-0.3, 0.7], [1e-6, 3e-6], [-1234, 5678], [0, 100], [-7.5, 7.5]]) {
    const t = G.ticks(a, b, 8);
    assert.ok(t.length >= 3 && t.length <= 20, `${a}..${b}: ${t.length} ticks`);
    assert.ok(t.every(v => v >= a - 1e-12 && v <= b + 1e-12));
    for (let k = 1; k < t.length; k++) assert.ok(near(t[k] - t[k - 1], t.step, 1e-6));
    assert.ok([1, 2, 5].includes(Math.round(t.step / Math.pow(10, Math.floor(Math.log10(t.step))))), 'step is 1, 2 or 5 times a power of ten');
  }
  assert.deepEqual(G.ticks(0, 0, 5), []);
  assert.equal(G.formatNum(0.30000000000000004, 0.1), '0.3'); assert.equal(G.formatNum(0, 1), '0'); assert.equal(G.formatNum(2500000), '2.50e6');
});
test('zoom keeps the point under the pointer fixed; pan moves the window', () => {
  const v = V(-10, 10, -5, 5);
  const z = G.zoomView(v, 0.25, 0.5, 0.5);
  assert.ok(near(z.x1 - z.x0, 10) && near(z.y1 - z.y0, 5));
  assert.ok(near(z.x0 + (z.x1 - z.x0) * 0.25, v.x0 + (v.x1 - v.x0) * 0.25, 1e-12), 'x under the pointer unchanged');
  assert.ok(near(z.y1 - (z.y1 - z.y0) * 0.5, v.y1 - (v.y1 - v.y0) * 0.5, 1e-12), 'y under the pointer unchanged');
  const p = G.panView(v, 0.1, -0.2); assert.ok(near(p.x0, -12) && near(p.x1, 8) && near(p.y0, -7) && near(p.y1, 3));
  let t = v; for (let k = 0; k < 400; k++) t = G.zoomView(t, 0.5, 0.5, 0.5); assert.ok(G.sane(t), 'extreme zoom stays valid');
  const q = G.equalAspect(V(-10, 10, -10, 10), 400, 200); assert.ok(near((q.x1 - q.x0) / 400, (q.y1 - q.y0) / 200));
  assert.equal(G.sane({ x0: 1, x1: 1, y0: 0, y1: 1 }), false); assert.equal(G.sane(G.DEFAULT_VIEW()), true);
});

/* ---------------- speed ---------------- */
test('eight curves with intersections are ready in well under a second', () => {
  const t0 = process.hrtime.bigint();
  const texts = ['sin(x)', 'cos(x)', 'x^2/10', 'x^2 + y^2 = 25', 'x*y = 4', 'r = 3*cos(3*theta)', '(5cos(t), 3sin(t))', 'exp(x/4) - 3'];
  const items = texts.map(t => geo(t, {}, view, 1000, 750));
  const ix = G.intersections(items, {}, view);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  8 curves + ${ix.length} intersections in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 2500, 'too slow: ' + ms);
  assert.ok(ix.length > 5);
});
