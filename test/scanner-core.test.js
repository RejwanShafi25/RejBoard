const test = require('node:test');
const assert = require('node:assert');
const SC = require('../scanner-core.js');

const img = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; } return { data, width: w, height: h }; };
/* point inside a convex quad */
const inQuad = (q, x, y) => q.every((a, k) => { const b = q[(k + 1) % 4]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });

test('homography maps the four corners exactly', () => {
  const src = [[0, 0], [99, 0], [99, 49], [0, 49]], dst = [[12, 8], [180, 20], [170, 140], [5, 120]];
  const H = SC.homography(src, dst);
  src.forEach((p, k) => { const q = SC.apply(H, p[0], p[1]); assert.ok(Math.abs(q[0] - dst[k][0]) < 1e-6 && Math.abs(q[1] - dst[k][1]) < 1e-6); });
  assert.strictEqual(SC.homography([[0, 0], [1, 1], [2, 2], [3, 3]], dst), null, 'collinear points have no homography');
});

test('a tilted page is flattened: the inside becomes all page, the edges stay sharp', () => {
  const q = [[40, 30], [260, 50], [250, 210], [30, 190]];
  /* white page (with a black square in its middle) on a dark table */
  const H = SC.homography([[0, 0], [100, 0], [100, 100], [0, 100]], q);
  const src = img(300, 240, (x, y) => { if (!inQuad(q, x, y)) return 30; const Hi = SC.homography(q, [[0, 0], [100, 0], [100, 100], [0, 100]]), [u, v] = SC.apply(Hi, x, y); return u > 40 && u < 60 && v > 40 && v < 60 ? 0 : 245; });
  const [w, h] = SC.outSize(q, 400);
  assert.ok(w > 200 && h > 150);
  const out = SC.warp(src, q, w, h), px = (x, y) => out.data[(y * w + x) * 4];
  assert.ok(px(5, 5) > 200 && px(w - 6, h - 6) > 200, 'corners are page, not table');
  assert.ok(px(Math.round(w / 2), Math.round(h / 2)) < 60, 'the square sits in the middle');
  assert.ok(H);
});

test('outSize keeps the aspect and caps the long side', () => {
  assert.deepStrictEqual(SC.outSize([[0, 0], [400, 0], [400, 300], [0, 300]], 200), [200, 150]);
  assert.deepStrictEqual(SC.outSize([[0, 0], [40, 0], [40, 30], [0, 30]], 2000), [40, 30]);
});

test('detect finds a bright page on a dark background, or gives up', () => {
  const q = [[50, 40], [330, 60], [320, 260], [40, 240]];
  const found = SC.detect(img(380, 300, (x, y) => (inQuad(q, x, y) ? 235 : 40)));
  assert.ok(found, 'found');
  found.forEach((p, k) => assert.ok(Math.hypot(p[0] - q[k][0], p[1] - q[k][1]) < 6, 'corner ' + k + ' ' + p + ' vs ' + q[k]));
  assert.strictEqual(SC.detect(img(200, 200, () => 128)), null, 'a flat picture has no page');
  assert.strictEqual(SC.detect(img(200, 200, (x, y) => (x < 20 && y < 20 ? 250 : 20))), null, 'a tiny bright spot is not a page');
  assert.deepStrictEqual(SC.inset(100, 50, .1), [[10, 5], [90, 5], [90, 45], [10, 45]]);
});

test('document clean-up evens out a shadow and keeps the ink', () => {
  /* paper getting darker towards the right, with dark ink strokes */
  const src = img(240, 160, (x, y) => ((y % 40) < 4 && x % 60 < 40 ? 20 : 230 - x * .5));
  const doc = SC.enhance(src, 'doc'), bw = SC.enhance(src, 'bw'), col = SC.enhance(src, 'color');
  const v = (o, x, y) => o.data[(y * o.width + x) * 4];
  assert.ok(v(doc, 10, 20) > 230 && v(doc, 225, 20) > 230, 'paper is white on both sides ' + v(doc, 10, 20) + ' ' + v(doc, 225, 20));
  assert.ok(v(doc, 10, 1) < 60, 'ink stays dark');
  assert.ok([0, 255].includes(v(bw, 100, 20)) && v(bw, 225, 20) === 255 && v(bw, 10, 1) === 0);
  assert.strictEqual(v(col, 10, 1), 0);
  assert.strictEqual(SC.otsu([...Array(256)].map((_, k) => (k === 50 || k === 200 ? 10 : 0)), 20) >= 50, true);
});
