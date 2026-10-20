/* RejBoard graph core: the maths behind the function plotter. No DOM and no canvas, so it runs in the app and under `node --test`.
   Turns typed curves into geometry (polylines) for a view rectangle:
     explicit   y = f(x)             adaptive sampling, broken at poles and gaps
     implicit   F(x, y) = G(x, y)    marching squares
     parametric (fx(t), fy(t))       sampled over t0..t1
     polar      r = f(theta)         sampled over th0..th1
   plus nice axis ticks, slider parameters, intersections (polyline crossings refined with Newton / bisection) and view zoom / pan. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.GraphCore = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(math) {
  'use strict';
  const RESERVED = new Set(['x', 'y', 't', 'theta', 'r', 'pi', 'e', 'i', 'tau', 'phi', 'Infinity', 'NaN']);
  const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be185d', '#4b5563'];

  /* ---------- text -> expression ---------- */
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-')
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, 'pi').replace(/θ/g, 'theta')
      .replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([A-Za-z0-9.]+)/g, 'sqrt($1)')
      .replace(/\*\*/g, '^').replace(/\bln\s*\(/g, 'log(').replace(/\barc(sin|cos|tan)\b/g, 'a$1')
      .replace(/(^|[^a-zA-Z])([a-zA-Z])\s*\(/g, '$1$2*(').replace(/\s+/g, ' ').trim();
  }
  const cache = new Map();
  /* compile "expr" into f(scope) -> number (NaN where undefined / complex) */
  function compile(expr) {
    const key = String(expr);
    let fn = cache.get(key);
    if (fn) return fn;
    let code;
    try { code = math.parse(clean(expr)).compile(); } catch (e) { throw new Error('Cannot read "' + expr + '"'); }
    fn = scope => {
      try {
        const r = code.evaluate(scope);
        if (typeof r === 'number') return r;
        if (r && typeof r.re === 'number') return Math.abs(r.im) < 1e-12 * (1 + Math.abs(r.re)) ? r.re : NaN;
        return NaN;
      } catch (e) { return NaN; }
    };
    if (cache.size > 400) cache.clear();
    cache.set(key, fn);
    return fn;
  }
  function symbolsOf(expr) {
    const out = [];
    let node;
    try { node = math.parse(clean(expr)); } catch (e) { return out; }
    node.traverse((n, path, parent) => { if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn') && !out.includes(n.name)) out.push(n.name); });
    return out;
  }
  const KNOWN_FN = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'sqrt', 'abs', 'cbrt', 'log10', 'log2', 'floor', 'ceil', 'round', 'sign', 'erf', 'gamma', 'atan2', 'min', 'max', 'pow', 'mod']);
  function unknownFunction(expr) {
    let bad = null;
    try { math.parse(clean(expr)).traverse(n => { if (n.isFunctionNode && n.fn && n.fn.name && !KNOWN_FN.has(n.fn.name) && !bad) bad = n.fn.name; }); } catch (e) { return null; }
    return bad;
  }

  /* ---------- parsing what the user typed ---------- */
  /* "y = sin(x)", "x^2", "x^2 + y^2 = 4", "r = 1 + cos(theta)", "(cos(3t), sin(2t))" -> { kind, ... } or { error } */
  function parseCurve(text, opts) {
    opts = opts || {};
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return { error: 'Type a function first, for example y = sin(x).' };
    if (raw.length > 300) return { error: 'That is too long.' };
    if (/\^\s*\(?\s*-?\d{3,}/.test(raw)) return { error: 'That exponent is too large.' };
    const bad = unknownFunction(raw.replace(/^\s*\(/, '(').split(/[=,]/).join(' + '));
    if (bad) return { error: 'I do not know the function "' + bad + '". Try sin, cos, tan, exp, log, sqrt, abs.' };
    // parametric: (fx, fy)
    const par = /^\(\s*(.+?)\s*,\s*(.+?)\s*\)(?:\s*,?\s*t\s*(?:in|=|:)?\s*\[?\s*([-+\d.*/a-z()\s]+?)\s*[,;]\s*([-+\d.*/a-z()\s]+?)\s*\]?)?$/i.exec(raw);
    if (par && !/=/.test(par[1] + par[2])) {
      const t0 = par[3] != null ? par[3] : String(opts.t0 != null ? opts.t0 : 0), t1 = par[4] != null ? par[4] : String(opts.t1 != null ? opts.t1 : '2*pi');
      try { compile(par[1]); compile(par[2]); compile(t0); compile(t1); } catch (e) { return { error: e.message }; }
      return { kind: 'par', fx: par[1], fy: par[2], t0, t1 };
    }
    const eq = raw.split('=');
    if (eq.length > 2) return { error: 'Use at most one "=".' };
    if (eq.length === 2) {
      const l = eq[0].trim(), r = eq[1].trim();
      if (!l || !r) return { error: 'Both sides of "=" need something.' };
      try { compile(l); compile(r); } catch (e) { return { error: e.message }; }
      if (l === 'y' && !symbolsOf(r).includes('y')) return { kind: 'y', expr: r };
      if (r === 'y' && !symbolsOf(l).includes('y')) return { kind: 'y', expr: l };
      if (l === 'r' && !symbolsOf(r).includes('r')) return { kind: 'pol', expr: r, th0: String(opts.th0 != null ? opts.th0 : 0), th1: String(opts.th1 != null ? opts.th1 : '2*pi') };
      if (l === 'x' && !symbolsOf(r).includes('x') && symbolsOf(r).includes('y')) return { kind: 'impl', expr: '(' + l + ')-(' + r + ')', text: raw };
      return { kind: 'impl', expr: '(' + l + ')-(' + r + ')', text: raw };
    }
    try { compile(raw); } catch (e) { return { error: e.message }; }
    const syms = symbolsOf(raw);
    if (syms.includes('theta') && !syms.includes('x')) return { kind: 'pol', expr: raw, th0: '0', th1: '2*pi' };
    if (syms.includes('y')) return { kind: 'impl', expr: raw, text: raw + ' = 0' };
    return { kind: 'y', expr: raw };
  }
  /* slider parameters: every letter that is not an axis / constant name */
  function paramsOf(curves) {
    const out = [];
    for (const c of curves) {
      if (!c || c.error) continue;
      const exprs = c.kind === 'par' ? [c.fx, c.fy, c.t0, c.t1] : c.kind === 'pol' ? [c.expr, c.th0, c.th1] : [c.expr];
      for (const e of exprs) for (const s of symbolsOf(e)) if (!RESERVED.has(s) && !out.includes(s)) out.push(s);
    }
    return out.sort();
  }

  /* ---------- view rectangle ---------- */
  const DEFAULT_VIEW = () => ({ x0: -10, x1: 10, y0: -7.5, y1: 7.5 });
  function sane(v) { return v && [v.x0, v.x1, v.y0, v.y1].every(Number.isFinite) && v.x1 > v.x0 && v.y1 > v.y0; }
  function zoomView(v, fx, fy, factor) { // fx, fy: 0..1 position inside the view that stays put (y from the top)
    const wx = v.x1 - v.x0, wy = v.y1 - v.y0, nx = Math.min(1e9, Math.max(1e-9, wx * factor)), ny = Math.min(1e9, Math.max(1e-9, wy * factor));
    const cx = v.x0 + wx * fx, cy = v.y1 - wy * fy;
    return { x0: cx - nx * fx, x1: cx + nx * (1 - fx), y1: cy + ny * fy, y0: cy - ny * (1 - fy) };
  }
  function panView(v, dxFrac, dyFrac) { const wx = v.x1 - v.x0, wy = v.y1 - v.y0; return { x0: v.x0 - wx * dxFrac, x1: v.x1 - wx * dxFrac, y0: v.y0 + wy * dyFrac, y1: v.y1 + wy * dyFrac }; }
  /* make one unit the same length on both axes (keeps circles round) for a w x h plot area */
  function equalAspect(v, w, h) {
    const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, ppu = Math.min(w / (v.x1 - v.x0), h / (v.y1 - v.y0));
    const hx = w / ppu / 2, hy = h / ppu / 2;
    return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
  }

  /* ---------- axis ticks ---------- */
  function niceStep(span, count) {
    const raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  }
  function ticks(min, max, count) {
    if (!(max > min)) return [];
    const step = niceStep(max - min, count), out = [];
    for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) out.push(Math.abs(k * step) < step * 1e-9 ? 0 : +(k * step).toPrecision(12));
    out.step = step;
    return out;
  }
  function formatNum(v, step) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) return v.toExponential(2).replace('e+', 'e');
    const dec = step ? Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 4;
    return String(+v.toFixed(dec));
  }

  /* ---------- geometry ---------- */
  const finite = Number.isFinite;
  /* y = f(x): returns polylines [[x, y], ...]; the line is cut at gaps, poles and out-of-range jumps */
  function plotExplicit(f, v, widthPx) {
    const span = v.x1 - v.x0, yr = v.y1 - v.y0, n = Math.max(160, Math.min(2400, Math.round(widthPx * 1.25)));
    const lines = [];
    let cur = [];
    const flush = () => { if (cur.length > 1) lines.push(cur); cur = []; };
    const ylim = 1e3 * yr;
    const push = (x, y) => { cur.push([x, y]); };
    let px = v.x0, py = f(px);
    let budget = 14000;
    const seg = (xa, ya, xb, yb, depth) => {
      // [xa,xb] both finite: refine where the curve moves a lot between samples
      const xm = (xa + xb) / 2, ym = f(xm);
      const dy = Math.abs(yb - ya);
      if (!finite(ym)) { if (depth < 14 && budget > 0) { budget--; seg(xa, ya, xm, ym === ym ? ym : NaN, depth + 1); } return; }
      const lin = (ya + yb) / 2, dev = Math.abs(ym - lin);
      if (depth < 9 && budget > 0 && (dev > 0.004 * yr || (dy > 0.25 * yr && depth < 6))) { budget -= 2; seg(xa, ya, xm, ym, depth + 1); push(xm, ym); seg(xm, ym, xb, yb, depth + 1); }
    };
    for (let k = 1; k <= n; k++) {
      const x = v.x0 + span * k / n, y = f(x);
      const ok0 = finite(py) && Math.abs(py) < ylim, ok1 = finite(y) && Math.abs(y) < ylim;
      if (ok0 && ok1) {
        if (!cur.length) push(px, py);
        // a big jump of opposite sign across a pole (tan, 1/x) must not be joined; a steep but continuous climb is
        const jump = Math.abs(y - py);
        if (jump > 2 * yr && Math.sign(y) !== Math.sign(py) && pole(f, px, x, yr)) { flush(); push(x, y); }
        else { seg(px, py, x, y, 0); push(x, y); }
      } else if (ok1 && !ok0) { flush(); push(x, y); }
      else if (ok0 && !ok1) { /* line ends here (leaves the domain) */ flush(); }
      else flush();
      px = x; py = y;
    }
    flush();
    return lines;
  }
  /* is there a pole (|f| blowing up) between a and b? */
  function pole(f, a, b, yr) {
    let lo = a, hi = b, best = 0;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2, fl = f(lo), fm = f(m);
      if (!finite(fm)) return true;
      if (Math.abs(fm - fl) > Math.abs(f(hi) - fm)) hi = m; else lo = m;
      best = Math.max(best, Math.abs(fm));
    }
    return best > 4 * yr || !finite(f((lo + hi) / 2));
  }
  function plotParam(fx, fy, t0, t1, widthPx, view) {
    const n = Math.max(300, Math.min(4000, Math.round(widthPx * 2))), lines = [];
    let cur = [];
    const big = 1e4 * Math.max(view.x1 - view.x0, view.y1 - view.y0);
    for (let k = 0; k <= n; k++) {
      const t = t0 + (t1 - t0) * k / n, x = fx(t), y = fy(t);
      if (finite(x) && finite(y) && Math.abs(x) < big && Math.abs(y) < big) cur.push([x, y]);
      else { if (cur.length > 1) lines.push(cur); cur = []; }
    }
    if (cur.length > 1) lines.push(cur);
    return lines;
  }
  function plotPolar(fr, th0, th1, widthPx, view) {
    const n = Math.max(360, Math.min(4800, Math.round(widthPx * 3))), lines = [];
    let cur = [];
    const big = 1e4 * Math.max(view.x1 - view.x0, view.y1 - view.y0);
    for (let k = 0; k <= n; k++) {
      const th = th0 + (th1 - th0) * k / n, r = fr(th);
      const x = r * Math.cos(th), y = r * Math.sin(th);
      if (finite(x) && finite(y) && Math.abs(x) < big && Math.abs(y) < big) cur.push([x, y]);
      else { if (cur.length > 1) lines.push(cur); cur = []; }
    }
    if (cur.length > 1) lines.push(cur);
    return lines;
  }
  /* F(x, y) = 0 by marching squares; returns segments as 2-point polylines */
  function plotImplicit(F, v, widthPx, heightPx) {
    const gx = Math.max(24, Math.min(260, Math.round(widthPx / 3))), gy = Math.max(18, Math.min(260, Math.round(heightPx / 3)));
    const dx = (v.x1 - v.x0) / gx, dy = (v.y1 - v.y0) / gy;
    const val = new Float64Array((gx + 1) * (gy + 1));
    for (let j = 0; j <= gy; j++) for (let i = 0; i <= gx; i++) val[j * (gx + 1) + i] = F(v.x0 + i * dx, v.y0 + j * dy);
    const lines = [];
    const at = (i, j) => val[j * (gx + 1) + i];
    const lerp = (xa, ya, fa, xb, yb, fb) => { const t = fa / (fa - fb); return [xa + (xb - xa) * t, ya + (yb - ya) * t]; };
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const f00 = at(i, j), f10 = at(i + 1, j), f11 = at(i + 1, j + 1), f01 = at(i, j + 1);
      if (!(finite(f00) && finite(f10) && finite(f11) && finite(f01))) continue;
      const x = v.x0 + i * dx, y = v.y0 + j * dy;
      let code = (f00 > 0 ? 1 : 0) | (f10 > 0 ? 2 : 0) | (f11 > 0 ? 4 : 0) | (f01 > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // reject cells that straddle a pole (huge values of opposite sign): not a real crossing
      const mx = Math.max(Math.abs(f00), Math.abs(f10), Math.abs(f11), Math.abs(f01));
      const e = { b: () => lerp(x, y, f00, x + dx, y, f10), r: () => lerp(x + dx, y, f10, x + dx, y + dy, f11), t: () => lerp(x, y + dy, f01, x + dx, y + dy, f11), l: () => lerp(x, y, f00, x, y + dy, f01) };
      const s = [];
      switch (code) {
        case 1: case 14: s.push([e.l(), e.b()]); break;
        case 2: case 13: s.push([e.b(), e.r()]); break;
        case 3: case 12: s.push([e.l(), e.r()]); break;
        case 4: case 11: s.push([e.r(), e.t()]); break;
        case 6: case 9: s.push([e.b(), e.t()]); break;
        case 7: case 8: s.push([e.l(), e.t()]); break;
        case 5: case 10: { // saddle: decide by the centre value
          const c = (f00 + f10 + f11 + f01) / 4;
          if ((c > 0) === (code === 5)) s.push([e.l(), e.t()], [e.b(), e.r()]); else s.push([e.l(), e.b()], [e.r(), e.t()]);
          break;
        }
      }
      for (const [a, b] of s) if (finite(a[0]) && finite(a[1]) && finite(b[0]) && finite(b[1]) && mx < 1e12) lines.push([a, b]);
    }
    return lines;
  }

  /* ---------- evaluate one curve over a view ---------- */
  /* curve: result of parseCurve; params: {name: value}.  Returns { lines, F?, f? } */
  function geometry(curve, params, view, wPx, hPx) {
    const sc = Object.assign({}, params);
    const evalX = fn => x => { sc.x = x; return fn(sc); };
    if (curve.kind === 'y') { const f = evalX(compile(curve.expr)); return { lines: plotExplicit(f, view, wPx), f }; }
    if (curve.kind === 'impl') { const fn = compile(curve.expr), F = (x, y) => { sc.x = x; sc.y = y; return fn(sc); }; return { lines: plotImplicit(F, view, wPx, hPx), F }; }
    if (curve.kind === 'par') {
      const fx = compile(curve.fx), fy = compile(curve.fy), ft0 = compile(curve.t0)(sc), ft1 = compile(curve.t1)(sc);
      if (!finite(ft0) || !finite(ft1)) return { lines: [] };
      return { lines: plotParam(t => { sc.t = t; return fx(sc); }, t => { sc.t = t; return fy(sc); }, ft0, ft1, wPx, view) };
    }
    if (curve.kind === 'pol') {
      const fr = compile(curve.expr), a = compile(curve.th0)(sc), b = compile(curve.th1)(sc);
      if (!finite(a) || !finite(b)) return { lines: [] };
      return { lines: plotPolar(th => { sc.theta = th; sc.t = th; return fr(sc); }, a, b, wPx, view) };
    }
    return { lines: [] };
  }

  /* ---------- intersections ---------- */
  function segCross(p, q, r, s) {
    const d1x = q[0] - p[0], d1y = q[1] - p[1], d2x = s[0] - r[0], d2y = s[1] - r[1], den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-300) return null;
    const t = ((r[0] - p[0]) * d2y - (r[1] - p[1]) * d2x) / den, u = ((r[0] - p[0]) * d1y - (r[1] - p[1]) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + t * d1x, p[1] + t * d1y] : null;
  }
  function polylineCrossings(A, B, view) {
    const cell = Math.max((view.x1 - view.x0), (view.y1 - view.y0)) / 48, grid = new Map(), key = (i, j) => i + ',' + j;
    const cellsOf = (p, q, fn) => { const i0 = Math.floor(Math.min(p[0], q[0]) / cell), i1 = Math.floor(Math.max(p[0], q[0]) / cell), j0 = Math.floor(Math.min(p[1], q[1]) / cell), j1 = Math.floor(Math.max(p[1], q[1]) / cell); if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(key(i, j)); };
    for (const L of B) for (let k = 1; k < L.length; k++) { const seg = [L[k - 1], L[k]]; cellsOf(seg[0], seg[1], c => { let a = grid.get(c); if (!a) grid.set(c, a = []); a.push(seg); }); }
    const out = [], seen = new Set();
    for (const L of A) for (let k = 1; k < L.length; k++) {
      const p = L[k - 1], q = L[k];
      cellsOf(p, q, c => {
        const a = grid.get(c); if (!a) return;
        for (const seg of a) { if (seen.has(seg) && false) continue; const x = segCross(p, q, seg[0], seg[1]); if (x && x[0] >= view.x0 && x[0] <= view.x1 && x[1] >= view.y0 && x[1] <= view.y1) out.push(x); }
      });
    }
    return out;
  }
  function dedupe(points, view) {
    const tol = Math.max(view.x1 - view.x0, view.y1 - view.y0) * 2e-3, out = [];
    for (const p of points) if (!out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol)) out.push(p);
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  /* Newton on G(x,y) = (A(x,y), B(x,y)) from p; null when it does not converge close to p */
  function newton2(A, B, p, view) {
    let x = p[0], y = p[1];
    const h = 1e-7 * Math.max(1, Math.abs(x), Math.abs(y)), lim = Math.max(view.x1 - view.x0, view.y1 - view.y0) * 0.02;
    for (let it = 0; it < 30; it++) {
      const a = A(x, y), b = B(x, y);
      if (!finite(a) || !finite(b)) return null;
      if (Math.abs(a) + Math.abs(b) < 1e-13) break;
      const ax = (A(x + h, y) - A(x - h, y)) / (2 * h), ay = (A(x, y + h) - A(x, y - h)) / (2 * h), bx = (B(x + h, y) - B(x - h, y)) / (2 * h), by = (B(x, y + h) - B(x, y - h)) / (2 * h);
      const det = ax * by - ay * bx;
      if (!finite(det) || Math.abs(det) < 1e-14) return null;
      const dx = (a * by - b * ay) / det, dy = (ax * b - bx * a) / det;
      x -= dx; y -= dy;
      if (Math.hypot(x - p[0], y - p[1]) > lim) return null;
    }
    const a = A(x, y), b = B(x, y);
    return finite(a) && finite(b) && Math.abs(a) + Math.abs(b) < 1e-8 * (1 + Math.abs(x) + Math.abs(y)) ? [x, y] : null;
  }
  /* curves: [{ curve, geo, params }]; returns [{ x, y, a, b }] */
  function intersections(items, params, view) {
    const res = [];
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b];
      if (!A.geo.lines.length || !B.geo.lines.length) continue;
      const raw = dedupe(polylineCrossings(A.geo.lines, B.geo.lines, view), view);
      const FA = A.geo.F || (A.geo.f ? (x, y) => y - A.geo.f(x) : null), FB = B.geo.F || (B.geo.f ? (x, y) => y - B.geo.f(x) : null);
      for (const p of raw) {
        let q = p;
        if (FA && FB) { const r = newton2(FA, FB, p, view); if (r) q = r; }
        res.push({ x: q[0], y: q[1], a, b });
      }
    }
    // the same crossing found by two different pairs, or twice by neighbouring cells
    const out = [], tol = Math.max(view.x1 - view.x0, view.y1 - view.y0) * 1e-3;
    for (const p of res) if (!out.some(q => q.a === p.a && q.b === p.b && Math.hypot(q.x - p.x, q.y - p.y) < tol)) out.push(p);
    return out.slice(0, 60);
  }

  return { clean, compile, symbolsOf, parseCurve, paramsOf, DEFAULT_VIEW, sane, zoomView, panView, equalAspect, niceStep, ticks, formatNum,
    plotExplicit, plotParam, plotPolar, plotImplicit, geometry, intersections, polylineCrossings, newton2, COLORS };
});
