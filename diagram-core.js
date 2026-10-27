/* RejBoard diagram core: the geometry behind connectors, guides and layout. No DOM in here, so it runs in the app (as the global
   `DiagramCore`) and under `node --test`.

   - orthoRoute(): a right-angle (elbow) path between two connector ends that leaves and enters along the shapes' sides.
   - crossings() / hops(): where a connector crosses the ones below it, and the path split around small jump arcs.
   - head(): arrowhead geometry (open arrow, filled triangle, dot, diamond, bar).
   - guideSnap() / gridSnap(): smart alignment guides and grid snapping while moving things.
   - inside(): what a container or swimlane carries with it.
   - layered(): automatic layout of a connected diagram in layers (top to bottom or left to right). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiagramCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;
  const fin = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  const unit = n => (Array.isArray(n) && (Math.abs(n[0]) > 0.5 ? [Math.sign(n[0]), 0] : Math.abs(n[1]) > 0.5 ? [0, Math.sign(n[1])] : null));

  /* removes repeated points and middle points of straight runs */
  function simplify(P) {
    const a = [];
    for (const p of P) if (!a.length || !same(a[a.length - 1], p)) a.push(p);
    for (let k = a.length - 2; k > 0; k--) {
      const p = a[k - 1], q = a[k], r = a[k + 1];
      if ((Math.abs(p[0] - q[0]) < EPS && Math.abs(q[0] - r[0]) < EPS) || (Math.abs(p[1] - q[1]) < EPS && Math.abs(q[1] - r[1]) < EPS)) a.splice(k, 1);
    }
    return a;
  }

  /* ---------- right-angle routing ----------
     a, b: end points. na, nb: outward normals of the sides they sit on ([1,0] = east ...), or null for a free end.
     The path leaves a along na and arrives at b coming in against nb, with `gap` of straight line at both ends. */
  function orthoRoute(a, na, b, nb, opts) {
    if (!fin(a) || !fin(b)) return [];
    const gap = Math.max(0, (opts && opts.gap) != null ? +opts.gap : 20);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let A = unit(na), B = unit(nb);
    if (!A) A = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
    if (!B) B = A[0] ? [-(Math.sign(dx) || A[0]), 0] : [0, -(Math.sign(dy) || A[1])];
    const p1 = [a[0] + A[0] * gap, a[1] + A[1] * gap], p2 = [b[0] + B[0] * gap, b[1] + B[1] * gap];
    const hA = !!A[0], hB = !!B[0];
    let mid;
    if (hA && hB) {
      /* both leave sideways: one vertical run between them, unless they face away from each other */
      const facing = A[0] * (p2[0] - p1[0]) >= 0 && B[0] * (p1[0] - p2[0]) >= 0;
      if (facing || A[0] === B[0]) { const mx = A[0] === B[0] ? (A[0] > 0 ? Math.max(p1[0], p2[0]) : Math.min(p1[0], p2[0])) : (p1[0] + p2[0]) / 2; mid = [[mx, p1[1]], [mx, p2[1]]]; }
      else { const my = (p1[1] + p2[1]) / 2; mid = [[p1[0], my], [p2[0], my]]; }
    } else if (!hA && !hB) {
      const facing = A[1] * (p2[1] - p1[1]) >= 0 && B[1] * (p1[1] - p2[1]) >= 0;
      if (facing || A[1] === B[1]) { const my = A[1] === B[1] ? (A[1] > 0 ? Math.max(p1[1], p2[1]) : Math.min(p1[1], p2[1])) : (p1[1] + p2[1]) / 2; mid = [[p1[0], my], [p2[0], my]]; }
      else { const mx = (p1[0] + p2[0]) / 2; mid = [[mx, p1[1]], [mx, p2[1]]]; }
    } else if (hA) {
      /* sideways out of a, vertically into b: one corner when it does not double back */
      mid = A[0] * (p2[0] - p1[0]) >= 0 && B[1] * (p1[1] - p2[1]) >= 0 ? [[p2[0], p1[1]]] : [[p1[0], p2[1]]];
    } else {
      mid = A[1] * (p2[1] - p1[1]) >= 0 && B[0] * (p1[0] - p2[0]) >= 0 ? [[p1[0], p2[1]]] : [[p2[0], p1[1]]];
    }
    return simplify([a, p1, ...mid, p2, b]);
  }

  /* ---------- crossings and jumps ---------- */
  function segX(p, q, r, s) {
    const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [s[0] - r[0], s[1] - r[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return null; // parallel or collinear: no single crossing point
    const t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den, u = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? t : null;
  }
  /* For each segment of `poly`, the sorted positions (0..1) where it crosses any polyline in `others`. Capped for safety. */
  function crossings(poly, others, max = 200) {
    const out = [];
    let n = 0;
    for (let k = 1; k < (poly || []).length; k++) {
      const ts = [];
      for (const o of others || []) for (let j = 1; j < (o || []).length; j++) {
        const t = segX(poly[k - 1], poly[k], o[j - 1], o[j]);
        if (t != null && ++n <= max) ts.push(t);
      }
      out.push(ts.sort((x, y) => x - y));
    }
    return out;
  }
  /* The path split into straight pieces and jumps: [{L:[x,y]}, {J:{c:[x,y], r, ang}}, ...] after an initial {M:[x,y]}.
     Jumps closer than r to a corner or to each other are skipped so they never overlap. */
  function hops(poly, others, r) {
    if (!poly || poly.length < 2) return [];
    const X = crossings(poly, others), ops = [{ M: poly[0] }], n = poly.length;
    /* a "corner" is a real bend (or the path's ends) — not the joints of a curve drawn as many short pieces */
    const ang = k => Math.atan2(poly[k][1] - poly[k - 1][1], poly[k][0] - poly[k - 1][0]);
    const bend = k => { if (k <= 0 || k >= n - 1) return true; let d = Math.abs(ang(k + 1) - ang(k)); if (d > Math.PI) d = 2 * Math.PI - d; return d > 0.5; };
    const cum = [0]; for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]));
    const corners = cum.filter((_, k) => bend(k));
    let last = -Infinity;
    for (let k = 1; k < n; k++) {
      const p = poly[k - 1], q = poly[k], L = cum[k] - cum[k - 1], a = ang(k);
      for (const t of X[k - 1]) {
        const d = t * L, at = cum[k - 1] + d;
        if (corners.some(c => Math.abs(c - at) < r * 1.5) || at - last < r * 2.2) continue;
        last = at;
        const u = [Math.cos(a), Math.sin(a)], c = [p[0] + u[0] * d, p[1] + u[1] * d];
        ops.push({ L: [c[0] - u[0] * r, c[1] - u[1] * r] }, { J: { c, r, ang: a } });
      }
      ops.push({ L: q });
    }
    return ops;
  }

  /* point halfway along a polyline (where a line's label goes) */
  function polyMid(P) {
    if (!P || !P.length) return [0, 0];
    let L = 0;
    for (let k = 1; k < P.length; k++) L += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
    let h = L / 2;
    for (let k = 1; k < P.length; k++) {
      const s = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
      if (h <= s && s > 0) return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * h / s, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * h / s];
      h -= s;
    }
    return P[P.length - 1].slice();
  }

  /* ---------- arrowheads ----------
     kind: 'none' | 'arrow' | 'tri' | 'circle' | 'diamond' | 'bar'. tip: end point, from: a point the line arrives from, L: size.
     Returns {pl: polyline, fill: true for solid heads} or null. */
  /* the last six are crow's-foot (ER) ends: exactly one, one, many, zero-or-one, one-or-many, zero-or-many */
  const HEADS = ['none', 'arrow', 'tri', 'circle', 'diamond', 'bar', 'one', 'only', 'many', 'zone', 'omany', 'zmany', 'htri', 'hdiamond'];
  function head(kind, tip, from, L) {
    if (!kind || kind === 'none' || !fin(tip) || !fin(from) || !(L > 0)) return null;
    const t = Math.atan2(tip[1] - from[1], tip[0] - from[0]), u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
    const at = (a, b) => [tip[0] + u[0] * a + v[0] * b, tip[1] + u[1] * a + v[1] * b];
    /* crow's foot: built from small pieces (bars, a ring, the three-pronged foot) placed back from the tip */
    if (['one', 'only', 'many', 'zone', 'omany', 'zmany'].includes(kind)) {
      const s = L * .55, bar = d => ({ pl: [at(-d, -s * .6), at(-d, s * .6)], fill: false }), foot = { pl: [at(0, -s * .6), at(-s, 0), at(0, s * .6)], fill: false },
        ring = d => { const r = s * .32, c = at(-d - r, 0), pl = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2; pl.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return { pl, fill: false, paper: true }; };
      const parts = kind === 'one' ? [bar(s * .5)] : kind === 'only' ? [bar(s * .35), bar(s * .7)] : kind === 'many' ? [foot] :
        kind === 'zone' ? [bar(s * .35), ring(s * .6)] : kind === 'omany' ? [foot, bar(s * 1.2)] : [foot, ring(s * 1.05)];
      return Object.assign(parts[0], { more: parts.slice(1) });
    }
    if (kind === 'arrow') return { pl: [at(-L * Math.cos(.45), -L * Math.sin(.45)), tip.slice(), at(-L * Math.cos(.45), L * Math.sin(.45))], fill: false };
    if (kind === 'tri') return { pl: [tip.slice(), at(-L, -L * .45), at(-L, L * .45), tip.slice()], fill: true };
    if (kind === 'diamond') return { pl: [tip.slice(), at(-L * .6, -L * .35), at(-L * 1.2, 0), at(-L * .6, L * .35), tip.slice()], fill: true };
    /* hollow (UML inheritance / aggregation): paper-filled so the line does not show through */
    if (kind === 'htri') return { pl: [tip.slice(), at(-L * 1.1, -L * .55), at(-L * 1.1, L * .55), tip.slice()], fill: false, paper: true };
    if (kind === 'hdiamond') return { pl: [tip.slice(), at(-L * .6, -L * .38), at(-L * 1.2, 0), at(-L * .6, L * .38), tip.slice()], fill: false, paper: true };
    if (kind === 'bar') return { pl: [at(-L * .15, -L * .5), at(-L * .15, L * .5)], fill: false };
    if (kind === 'circle') { const r = L * .32, c = at(-r, 0), pl = []; for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2; pl.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return { pl, fill: true }; }
    return null;
  }

  /* ---------- guides and grid ----------
     box: [x0,y0,x1,y1] of what is moving (already moved by the pointer). others: boxes of the things around it.
     Snaps the box's left/centre/right and top/middle/bottom onto any other box's edges or centres within tol.
     Returns {dx, dy, gx:[{x,y0,y1}], gy:[{y,x0,x1}]} — the correction and the guide lines to draw. */
  function guideSnap(box, others, tol) {
    const xs = b => [b[0], (b[0] + b[2]) / 2, b[2]], ys = b => [b[1], (b[1] + b[3]) / 2, b[3]];
    let bx = null, by = null;
    for (const o of others || []) {
      if (!Array.isArray(o) || !o.every(Number.isFinite)) continue;
      for (const a of xs(box)) for (const c of xs(o)) { const d = c - a; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d) - EPS)) bx = { d }; }
      for (const a of ys(box)) for (const c of ys(o)) { const d = c - a; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d) - EPS)) by = { d }; }
    }
    const dx = bx ? bx.d : 0, dy = by ? by.d : 0, m = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy], gx = [], gy = [];
    if (bx || by) for (const o of others || []) {
      if (!Array.isArray(o) || !o.every(Number.isFinite)) continue;
      if (bx) for (const a of xs(m)) for (const c of xs(o)) if (Math.abs(c - a) < 1e-3) gx.push({ x: c, y0: Math.min(m[1], o[1]), y1: Math.max(m[3], o[3]) });
      if (by) for (const a of ys(m)) for (const c of ys(o)) if (Math.abs(c - a) < 1e-3) gy.push({ y: c, x0: Math.min(m[0], o[0]), x1: Math.max(m[2], o[2]) });
    }
    return { dx, dy, gx, gy };
  }
  /* correction that puts the box's top-left corner on the grid */
  function gridSnap(box, g) {
    if (!(g > 0)) return { dx: 0, dy: 0 };
    return { dx: Math.round(box[0] / g) * g - box[0], dy: Math.round(box[1] / g) * g - box[1] };
  }

  /* ---------- containers ----------
     Indices of the boxes that a container carries: their centre is inside it. The container itself and other excluded indices are skipped. */
  function inside(cbox, boxes, skip) {
    const out = [];
    (boxes || []).forEach((b, k) => {
      if (skip && skip.has(k) || !Array.isArray(b)) return;
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      if (cx > cbox[0] && cx < cbox[2] && cy > cbox[1] && cy < cbox[3] && (b[2] - b[0]) <= (cbox[2] - cbox[0]) && (b[3] - b[1]) <= (cbox[3] - cbox[1])) out.push(k);
    });
    return out;
  }

  /* ---------- automatic layered layout ----------
     nodes: [{id, w, h}], edges: [[fromId, toId]]. Cycles are broken by ignoring edges that close a loop.
     Returns {id: [x, y]} top-left positions, starting at (0, 0). dir 'TB' (top to bottom) or 'LR' (left to right). */
  function layered(nodes, edges, opts) {
    const o = Object.assign({ dir: 'TB', gap: 60, sep: 40, sweeps: 4 }, opts || {});
    const N = (nodes || []).filter(n => n && n.id != null), ids = new Map(N.map((n, k) => [n.id, k])), n = N.length;
    if (!n) return {};
    const out = Array.from({ length: n }, () => []), inn = Array.from({ length: n }, () => []);
    const seen = new Set();
    for (const e of edges || []) {
      const a = ids.get(e && e[0]), b = ids.get(e && e[1]);
      if (a == null || b == null || a === b || seen.has(a + ',' + b)) continue;
      seen.add(a + ',' + b); out[a].push(b); inn[b].push(a);
    }
    /* break cycles: depth-first, dropping edges back to a node still on the stack */
    const state = new Uint8Array(n), keep = Array.from({ length: n }, () => []);
    const order = [...Array(n).keys()].sort((x, y) => inn[x].length - inn[y].length || x - y);
    for (const s of order) {
      if (state[s]) continue;
      const st = [[s, 0]]; state[s] = 1;
      while (st.length) {
        const top = st[st.length - 1], v = top[0];
        if (top[1] < out[v].length) {
          const w = out[v][top[1]++];
          if (state[w] === 1) continue;                  // back edge: ignored
          keep[v].push(w);
          if (!state[w]) { state[w] = 1; st.push([w, 0]); }
        } else { state[v] = 2; st.pop(); }
      }
    }
    /* layers: longest path from the sources */
    const indeg = new Array(n).fill(0); keep.forEach(l => l.forEach(w => indeg[w]++));
    const layer = new Array(n).fill(0), q = [];
    for (let k = 0; k < n; k++) if (!indeg[k]) q.push(k);
    while (q.length) { const v = q.shift(); for (const w of keep[v]) { layer[w] = Math.max(layer[w], layer[v] + 1); if (!--indeg[w]) q.push(w); } }
    const L = [];
    for (let k = 0; k < n; k++) (L[layer[k]] = L[layer[k]] || []).push(k);
    /* order inside each layer: a few barycentre sweeps reduce crossings */
    const pos = new Array(n).fill(0);
    L.forEach(l => l.forEach((v, k) => { pos[v] = k; }));
    const up = Array.from({ length: n }, () => []); keep.forEach((l, v) => l.forEach(w => up[w].push(v)));
    const bary = (v, nb) => nb[v].length ? nb[v].reduce((s, u) => s + pos[u], 0) / nb[v].length : pos[v];
    for (let s = 0; s < o.sweeps; s++) {
      const down = s % 2 === 0;
      const seq = down ? L.slice(1) : L.slice(0, -1).reverse();
      for (const l of seq) { l.sort((x, y) => bary(x, down ? up : keep) - bary(y, down ? up : keep) || x - y); l.forEach((v, k) => { pos[v] = k; }); }
    }
    /* coordinates: layers along the main axis, nodes centred across it */
    const TB = o.dir !== 'LR', along = k => (TB ? N[k].h : N[k].w), across = k => (TB ? N[k].w : N[k].h);
    const thick = L.map(l => Math.max(...l.map(along))), span = L.map(l => l.reduce((s, v) => s + across(v), 0) + o.sep * (l.length - 1));
    const widest = Math.max(...span), res = {};
    let main = 0;
    L.forEach((l, li) => {
      let c = (widest - span[li]) / 2;
      for (const v of l) {
        const m = main + (thick[li] - along(v)) / 2;
        res[N[v].id] = TB ? [c, m] : [m, c];
        c += across(v) + o.sep;
      }
      main += thick[li] + o.gap;
    });
    return res;
  }

  /* ---------- Mermaid flowcharts ----------
     parseMermaid(text) -> {dir, nodes:[{id, label, shape}], edges:[{from, to, label, style, arrow, back}], errors:[...]}
     Shapes follow Mermaid's brackets: [rect] (round) ([stadium]) [[subroutine]] [(database)] ((circle)) {decision} {{hexagon}}
     [/parallelogram/] [\alt\] [/trapezoid\] [\trapezoid alt/] >flag]. Unknown lines (styles, classes, clicks) are skipped, never fatal.
     Input is untrusted: size, node and edge counts and label lengths are capped. */
  const MM_SHAPES = [['([', '])', 'stadium'], ['[[', ']]', 'subroutine'], ['[(', ')]', 'database'], ['((', '))', 'circle'], ['{{', '}}', 'hexagon'],
    ['[/', '/]', 'parallelogram'], ['[\\', '\\]', 'parallelogram'], ['[/', '\\]', 'trapezoid'], ['[\\', '/]', 'trapezoid'], ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'decision'], ['>', ']', 'flag']];
  const EDGE = /^(<)?(-{2,}>|-{3,}|={2,}>|={3,}|-\.+->|-\.+-|--o|--x|~~~)(?:\|([^|]*)\|)?/;
  const EDGE_TXT = /^(<)?(--|==|-\.)\s+(.+?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)/;
  const unq = s => { s = String(s).trim(); if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1); return s.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n').slice(0, 200); };
  function parseMermaid(text, lim) {
    const L = Object.assign({ chars: 50000, nodes: 500, edges: 2000 }, lim || {});
    const out = { dir: 'TB', nodes: [], edges: [], errors: [] }, byId = new Map();
    const src = String(text == null ? '' : text).slice(0, L.chars).replace(/%%.*$/gm, '');
    /* statements end at a newline, or at ';' outside quotes and brackets (labels may contain ';', e.g. "#quot;") */
    const stmts = [];
    { let cur = '', q = false, d = 0;
      for (const ch of src) {
        if (ch === '"') q = !q; else if (!q && '[({'.includes(ch)) d++; else if (!q && '])}'.includes(ch)) d = Math.max(0, d - 1);
        if (ch === '\n' || (ch === ';' && !q && !d)) { stmts.push(cur); cur = ''; q = false; d = 0; } else cur += ch;
      }
      stmts.push(cur); }
    for (let k = stmts.length - 1; k >= 0; k--) { stmts[k] = stmts[k].trim(); if (!stmts[k]) stmts.splice(k, 1); }
    if (!stmts.length) return out;
    const h = /^(flowchart|graph)\b\s*(TD|TB|BT|LR|RL)?/i.exec(stmts[0]);
    if (h) { out.dir = (h[2] || 'TB').toUpperCase() === 'TD' ? 'TB' : (h[2] || 'TB').toUpperCase(); stmts.shift(); }
    const node = (id, label, shape) => {
      let n = byId.get(id);
      if (!n) { if (out.nodes.length >= L.nodes) return null; n = { id, label: id, shape: 'rect' }; byId.set(id, n); out.nodes.push(n); }
      if (label != null) { n.label = label; n.shape = shape; }
      return n;
    };
    /* one node reference at s[i]: id plus optional bracket shape. Returns {n, i} or null */
    const readNode = (s, i) => {
      const m = /^[\p{L}\p{N}_]+/u.exec(s.slice(i)); // no '-' or '.': "A-->B" must read as A, edge, B
      if (!m) return null;
      const id = m[0].slice(0, 60); let j = i + m[0].length;
      for (const [o, c, shape] of MM_SHAPES) {
        if (!s.startsWith(o, j)) continue;
        const k = s.indexOf(c, j + o.length);
        if (k < 0) continue;
        return { n: node(id, unq(s.slice(j + o.length, k)), shape), i: k + c.length };
      }
      return { n: node(id), i: j };
    };
    const readGroup = (s, i) => { const g = []; for (;;) { while (s[i] === ' ') i++; const r = readNode(s, i); if (!r) break; if (r.n) g.push(r.n); i = r.i; while (s[i] === ' ') i++; if (s[i] === '&') { i++; continue; } break; } return { g, i }; };
    for (const st of stmts) {
      if (/^(classDef|class|style|linkStyle|click|subgraph|end|direction|accTitle|accDescr|title)\b/i.test(st)) continue;
      let r = readGroup(st, 0);
      if (!r.g.length) { out.errors.push(st.slice(0, 80)); continue; }
      let i = r.i, left = r.g;
      while (i < st.length) {
        const rest = st.slice(i).replace(/^\s+/, ''), skip = st.length - i - rest.length;
        let m = EDGE_TXT.exec(rest), label = '', op = '', back = false;
        if (m) { back = !!m[1]; label = m[3]; op = m[2] + m[4]; }
        else if ((m = EDGE.exec(rest))) { back = !!m[1]; op = m[2]; label = m[3] || ''; }
        else { out.errors.push(st.slice(0, 80)); break; }
        i += skip + m[0].length;
        const rr = readGroup(st, i);
        if (!rr.g.length) { out.errors.push(st.slice(0, 80)); break; }
        const style = /=/.test(op) ? 'thick' : /\./.test(op) ? 'dotted' : op === '~~~' ? 'invisible' : 'solid';
        const arrow = />$|o$|x$/.test(op);
        for (const a of left) for (const b of rr.g) if (out.edges.length < L.edges) out.edges.push({ from: a.id, to: b.id, label: unq(label), style, arrow, back });
        left = rr.g; i = rr.i;
      }
    }
    return out;
  }
  /* the reverse: shapes and connectors -> Mermaid flowchart text (ids are made safe; labels are quoted) */
  const MM_OUT = { rect: ['[', ']'], round: ['(', ')'], stadium: ['([', '])'], subroutine: ['[[', ']]'], database: ['[(', ')]'], circle: ['((', '))'], decision: ['{', '}'], hexagon: ['{{', '}}'], parallelogram: ['[/', '/]'], trapezoid: ['[/', '\\]'], flag: ['>', ']'] };
  function toMermaid(dir, nodes, edges) {
    const ids = new Map(), q = s => '"' + String(s == null ? '' : s).replace(/"/g, '#quot;').replace(/\n/g, '<br>') + '"';
    const lines = ['flowchart ' + (['TB', 'BT', 'LR', 'RL'].includes(dir) ? dir : 'TB')];
    (nodes || []).forEach((n, k) => { const id = 'n' + (k + 1); ids.set(n.id, id); const b = MM_OUT[n.shape] || MM_OUT.rect; lines.push('  ' + id + b[0] + q(n.label) + b[1]); });
    for (const e of edges || []) {
      const a = ids.get(e.from), b = ids.get(e.to);
      if (!a || !b) continue;
      const op = e.style === 'dotted' ? (e.arrow ? '-.->' : '-.-') : e.style === 'thick' ? (e.arrow ? '==>' : '===') : (e.arrow ? '-->' : '---');
      lines.push('  ' + a + ' ' + op + (e.label ? '|' + q(e.label) + '|' : '') + ' ' + b);
    }
    return lines.join('\n') + '\n';
  }

  return { HEADS, orthoRoute, simplify, crossings, hops, polyMid, head, guideSnap, gridSnap, inside, layered, parseMermaid, toMermaid };
});
