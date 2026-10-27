/* RejBoard document scanner maths: perspective correction, page detection and clean-up filters. Works on plain
   {data: Uint8ClampedArray (RGBA), width, height} images, so it runs in the app (as the global `ScannerCore`) and under `node --test`.
   Corner order everywhere: top-left, top-right, bottom-right, bottom-left, as [x, y] points. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScannerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* solves A x = b (n x n) by Gaussian elimination with partial pivoting; null when singular */
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  /* the 3x3 homography (row-major, h[8] = 1) taking the four src points to the four dst points */
  function homography(src, dst) {
    const A = [], b = [];
    for (let k = 0; k < 4; k++) {
      const [x, y] = src[k], [u, v] = dst[k];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h ? h.concat([1]) : null;
  }
  const apply = (h, x, y) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /* the size of the flattened page: the longer of each pair of opposite edges, scaled so the long side is at most maxSide */
  function outSize(q, maxSide) {
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, (maxSide || 2400) / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }
  /* flattens the quadrilateral q of img into a w x h image (bilinear sampling; outside the image is white) */
  function warp(img, q, w, h) {
    const H = homography([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], q);
    const out = new Uint8ClampedArray(w * h * 4), W = img.width, Hh = img.height, d = img.data;
    if (!H) { out.fill(255); return { data: out, width: w, height: h }; }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [sx, sy] = apply(H, x, y), o = (y * w + x) * 4;
        if (!(sx >= 0 && sy >= 0 && sx <= W - 1 && sy <= Hh - 1)) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue; }
        const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(Hh - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy;
      }
    }
    return { data: out, width: w, height: h };
  }

  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  /* Otsu's threshold of a list of grey values 0..255 */
  function otsu(hist, total) {
    let sum = 0; for (let k = 0; k < 256; k++) sum += k * hist[k];
    let sB = 0, wB = 0, best = 0, th = 128;
    for (let k = 0; k < 256; k++) {
      wB += hist[k]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += k * hist[k];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = k; }
    }
    return th;
  }
  /* finds a light page on a darker background: the bright region's extreme corners. null when nothing page-like stands out. */
  function detect(img) {
    const W = img.width, H = img.height, step = Math.max(1, Math.floor(Math.max(W, H) / 220)), hist = new Array(256).fill(0), g = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const v = lum(img.data, (y * W + x) * 4) | 0; hist[v]++; g.push([x, y, v]); }
    const th = otsu(hist, g.length), bright = g.filter(p => p[2] > th);
    if (bright.length < g.length * .08 || bright.length > g.length * .97) return null;
    let tl = null, tr = null, br = null, bl = null;
    for (const [x, y] of bright) {
      if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
      if (!br || x + y > br[0] + br[1]) br = [x, y];
      if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
      if (!bl || x - y < bl[0] - bl[1]) bl = [x, y];
    }
    const q = [tl, tr, br, bl], area = Math.abs(q.reduce((s, p, k) => { const n = q[(k + 1) % 4]; return s + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
    return area > W * H * .15 ? q : null;
  }
  /* corners a little inside the picture, for when detection finds nothing */
  const inset = (W, H, f) => { const a = W * (f || .06), b = H * (f || .06); return [[a, b], [W - a, b], [W - a, H - b], [a, H - b]]; };

  /* clean-up: 'doc' evens out the lighting and whitens the paper, 'bw' makes it black and white, 'color' stretches the levels */
  function enhance(img, mode) {
    const W = img.width, H = img.height, d = img.data, out = new Uint8ClampedArray(d.length);
    if (mode === 'color') {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { if (d[i + c] < lo[c]) lo[c] = d[i + c]; if (d[i + c] > hi[c]) hi[c] = d[i + c]; }
      for (let i = 0; i < d.length; i += 4) { for (let c = 0; c < 3; c++) out[i + c] = (d[i + c] - lo[c]) * 255 / Math.max(1, hi[c] - lo[c]); out[i + 3] = 255; }
      return { data: out, width: W, height: H };
    }
    /* the paper's brightness around each point: the brightest grey in coarse blocks, smoothed between block centres */
    const B = Math.max(8, Math.round(Math.max(W, H) / 24)), bw = Math.ceil(W / B), bh = Math.ceil(H / B), mx = new Float32Array(bw * bh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = lum(d, (y * W + x) * 4), k = ((y / B) | 0) * bw + ((x / B) | 0); if (v > mx[k]) mx[k] = v; }
    const at = (bx, by) => mx[Math.max(0, Math.min(bh - 1, by)) * bw + Math.max(0, Math.min(bw - 1, bx))];
    for (let y = 0; y < H; y++) {
      const fy = y / B - .5, by = Math.floor(fy), ty = fy - by;
      for (let x = 0; x < W; x++) {
        const fx = x / B - .5, bx = Math.floor(fx), tx = fx - bx, i = (y * W + x) * 4;
        const bg = (at(bx, by) * (1 - tx) + at(bx + 1, by) * tx) * (1 - ty) + (at(bx, by + 1) * (1 - tx) + at(bx + 1, by + 1) * tx) * ty;
        let v = Math.min(255, lum(d, i) / Math.max(40, bg) * 255);
        v = mode === 'bw' ? (v > 170 ? 255 : 0) : Math.max(0, Math.min(255, (v - 60) * 255 / 175)); /* push the paper to white, keep the ink dark */
        out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
      }
    }
    return { data: out, width: W, height: H };
  }

  return { homography, apply, warp, outSize, detect, inset, enhance, otsu };
});
