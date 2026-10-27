/* RejBoard board core: the pure data logic behind drawing performance, Undo/Redo and board storage.
   No DOM and no canvas in here, so it runs in the app (as the global `BoardCore`) and under `node --test`.

   - History:  snapshots keep every stroke's points in one Float64Array; adding a stroke only records where it went.
   - Storage:  boards are saved with the same compact stroke data and unpacked lazily when read (see dbPack* / dbOut).
   - Cache:    boardSig() is the fingerprint that tells the screen cache whether the board changed behind its back.
   - Eraser:   strokeNear() is the cheap "is this stroke anywhere near the eraser" pre-filter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_W = 8; // widest point tuple we pack ([x, y, pressure, tilt, ...])

  /* ---------- point packing ---------- */
  /* Returns a Float64Array of the stroke's points and their width, or null when the stroke is not a clean array of equal-length numeric tuples. */
  function flatten(P) {
    if (!Array.isArray(P) || !P.length || !Array.isArray(P[0])) return null;
    const w = P[0].length;
    if (!(w > 0 && w <= MAX_W)) return null;
    const f = new Float64Array(P.length * w);
    let o = 0;
    for (let j = 0; j < P.length; j++) {
      const q = P[j];
      if (!q || q.length !== w) return null;
      for (let m = 0; m < w; m++) {
        const v = q[m];
        if (typeof v !== 'number') return null;
        f[o++] = v;
      }
    }
    return { f, w };
  }

  /* Inverse of flatten(). Returns null for data that cannot be a valid packed stroke. */
  function inflate(f, w) {
    if (!(w > 0 && w <= MAX_W) || !f || typeof f.length !== 'number' || f.length % w !== 0) return null;
    const n = f.length / w, P = new Array(n);
    let o = 0;
    for (let j = 0; j < n; j++) {
      const q = new Array(w);
      for (let m = 0; m < w; m++) q[m] = f[o++];
      P[j] = q;
    }
    return P;
  }

  /* ---------- history snapshots ---------- */
  /* Deep, independent copy of an items array. Strokes become {...item, pts: null, __fp: Float64Array, __w}; everything else is structuredClone'd.
     Copying a typed array is far cheaper than structuredClone of nested arrays (about 13x on a 200k-point board). */
  function packItems(a) {
    const out = new Array(a.length);
    let cost = 0;
    for (let k = 0; k < a.length; k++) {
      const i = a[k], P = i.pts;
      let c = null;
      if (Array.isArray(P) && P.length && Array.isArray(P[0])) {
        let simple = true;
        for (const key in i) {
          const v = i[key];
          if (key !== 'pts' && v !== null && typeof v === 'object') { simple = false; break; }
        }
        if (simple) {
          const fl = flatten(P);
          if (fl) { c = { ...i }; c.pts = null; c.__fp = fl.f; c.__w = fl.w; }
        }
      }
      if (!c) {
        const hold = typeof i.src === 'string' && i.src.length > 4096 ? i.src : null; // big embedded images are shared, not copied
        if (hold) i.src = '';
        try { c = structuredClone(i); } finally { if (hold) i.src = hold; }
        if (hold) c.src = hold;
      }
      out[k] = c;
      cost += i.pts ? i.pts.length * 112 : i.cw ? i.cw.length * i.rh.length * 400 : 200;
    }
    out.__c = cost;
    return out;
  }

  /* Turns a packed snapshot back into live items (consumes the snapshot). */
  function unpackItems(h) {
    const out = new Array(h.length);
    for (let k = 0; k < h.length; k++) {
      const c = h[k];
      if (c.__fp) {
        c.pts = inflate(c.__fp, c.__w) || [];
        delete c.__fp;
        delete c.__w;
      }
      out[k] = c;
    }
    return out;
  }

  function trimHist(hist, budget) {
    let t = 0;
    for (const h of hist) t += h.__c || 0;
    while (hist.length > 3 && (hist.length > 60 || t > budget)) t -= hist.shift().__c || 0;
  }

  /* A finished stroke is added at the end, so its history entry is only {where it went, how to recognise it}. Call BEFORE pushing the stroke. */
  function addEntry(items, s) {
    const P0 = s && s.t === 's' && s.pts && s.pts[0];
    return P0 ? { __add: 1, idx: items.length, n: s.pts.length, x: P0[0], y: P0[1], __c: 400 } : null;
  }

  /* Where an "added stroke" entry's stroke lives now (it may have moved if earlier history was replayed). -1 if it is gone. */
  function addIdx(items, h) {
    let k = Math.min(h.idx, items.length - 1);
    const ok = q => q && q.t === 's' && q.pts && q.pts.length === h.n && q.pts[0] && q.pts[0][0] === h.x && q.pts[0][1] === h.y;
    if (ok(items[k])) return k;
    for (k = items.length - 1; k >= 0; k--) if (ok(items[k])) return k;
    return -1;
  }

  /* push(): remember the whole board before a change. */
  function pushDeep(S, hist, fut, budget) {
    hist.push(packItems(S.items));
    trimHist(hist, budget);
    fut.length = 0;
  }
  /* pushAdd(): remember "a stroke is about to be added". Returns false when s is not a plain stroke (use pushDeep then). */
  function pushAdd(S, hist, fut, budget, s) {
    const e = addEntry(S.items, s);
    if (!e) return false;
    hist.push(e);
    trimHist(hist, budget);
    fut.length = 0;
    return true;
  }

  /* hooks (all optional): pgUi(), pgLk(records, undoing), layersChanged() */
  function undoStep(S, hist, fut, hooks) {
    hooks = hooks || {};
    while (hist.length) {
      const h = hist.pop();
      if (h.__add) {
        const k = addIdx(S.items, h);
        if (k < 0) continue; // its stroke no longer exists: skip this entry
        const it = S.items.splice(k, 1)[0];
        fut.push({ __add: 1, idx: k, n: h.n, x: h.x, y: h.y, item: it, __c: 400 });
        S.sel = [];
        return true;
      }
      const f = packItems(S.items);
      if (h.__pn != null) { f.__pn = S.pg.n; S.pg.n = h.__pn; if (hooks.pgUi) hooks.pgUi(); }
      if (h.__lk) { f.__lk = h.__lk; if (hooks.pgLk) hooks.pgLk(h.__lk, true); }
      if (h.__ly) { f.__ly = { l: S.layers.map(q => ({ ...q })), a: S.ly }; S.layers = h.__ly.l; S.ly = h.__ly.a; if (hooks.layersChanged) hooks.layersChanged(); }
      fut.push(f);
      S.items = unpackItems(h);
      S.sel = [];
      return true;
    }
    return false;
  }

  function redoStep(S, hist, fut, hooks, budget) {
    hooks = hooks || {};
    if (!fut.length) return false;
    const h = fut.pop();
    if (h.__add) {
      const k = Math.min(h.idx, S.items.length);
      S.items.splice(k, 0, h.item);
      hist.push({ __add: 1, idx: k, n: h.n, x: h.x, y: h.y, __c: 400 });
      trimHist(hist, budget);
      S.sel = [];
      return true;
    }
    const f = packItems(S.items);
    if (h.__pn != null) { f.__pn = S.pg.n; S.pg.n = h.__pn; if (hooks.pgUi) hooks.pgUi(); }
    if (h.__lk) { f.__lk = h.__lk; if (hooks.pgLk) hooks.pgLk(h.__lk, false); }
    if (h.__ly) { f.__ly = { l: S.layers.map(q => ({ ...q })), a: S.ly }; S.layers = h.__ly.l; S.ly = h.__ly.a; if (hooks.layersChanged) hooks.layersChanged(); }
    hist.push(f);
    trimHist(hist, budget);
    S.items = unpackItems(h);
    S.sel = [];
    return true;
  }

  /* ---------- stored boards ---------- */
  /* Items array for IndexedDB: strokes carry pts as a Float64Array plus __w. Never mutates its input; returns the same array when nothing was packable. */
  function dbPackItems(a) {
    let out = null;
    for (let k = 0; k < a.length; k++) {
      const i = a[k];
      const fl = i && flatten(i.pts);
      if (!fl) continue;
      if (!out) out = a.slice();
      out[k] = { ...i, pts: fl.f, __w: fl.w };
    }
    return out || a;
  }

  /* In place: packed strokes back to plain arrays. Corrupt packed data degrades to an empty stroke instead of throwing. */
  function dbUnpackItems(a) {
    for (let k = 0; k < a.length; k++) {
      const c = a[k];
      if (c && c.__w) {
        c.pts = inflate(c.pts, c.__w) || [];
        delete c.__w;
      }
    }
    return a;
  }

  const hasPacked = items => { for (let k = 0; k < items.length; k++) { const i = items[k]; if (i && i.__w) return true; } return false; };

  /* A board record as it should be written. enabled=false writes plain arrays (readable by older versions). */
  function dbPackRec(v, enabled) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.items) || !v.items.length) return v;
    if (enabled === false) return hasPacked(v.items) ? { ...v, items: dbUnpackItems(v.items.map(i => (i && i.__w ? { ...i } : i))) } : v;
    const it = dbPackItems(v.items);
    return it === v.items ? v : { ...v, items: it };
  }

  /* A record as stored -> a record whose `items` unpack themselves on first access (listing boards never pays for it). */
  function dbLazy(rec) {
    const raw = rec.items;
    if (!hasPacked(raw)) return rec;
    const set = v => Object.defineProperty(rec, 'items', { value: v, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(rec, 'items', { enumerable: true, configurable: true, get() { const a = dbUnpackItems(raw); set(a); return a; }, set });
    return rec;
  }

  function dbOut(r) {
    if (Array.isArray(r)) { for (const x of r) if (x && typeof x === 'object' && Array.isArray(x.items)) dbLazy(x); return r; }
    return r && typeof r === 'object' && Array.isArray(r.items) ? dbLazy(r) : r;
  }

  /* ---------- screen-cache fingerprint ---------- */
  /* Cheap 32-bit hash of everything that changes how the board LOOKS. Equal fingerprints mean the cached picture is still right. */
  function boardSig(items, layers) {
    let h = items.length | 0;
    const mix = n => { h = (h * 31 + n) | 0; };
    const num = v => ((+v || 0) * 1000) | 0;
    const str = s => { mix(s.length); mix(s.charCodeAt(s.length - 1) | 0); mix(s.charCodeAt(0) | 0); };
    for (let k = 0; k < items.length; k++) {
      const i = items[k], P = i.pts;
      mix(i.t === 's' ? 1 : 2);
      if (P && P.length) {
        const a = P[0], b = P[P.length - 1], m = P[P.length >> 1], q = P[P.length >> 2];
        mix(P.length);
        mix(num((a[0] || 0) * 7 + (a[1] || 0) * 13 + (b[0] || 0) * 17 + (b[1] || 0) * 19 + (m[0] || 0) * 23 + (m[1] || 0) * 29 + (q[0] || 0) * 31 + (q[1] || 0) * 37));
      } else {
        mix(num((i.x || 0) * 7 + (i.y || 0) * 13 + (i.w || 0) * 17 + (i.h || 0) * 19));
      }
      if (i.rot) mix((i.rot * 1e4) | 0);
      if (i.color) str(i.color);
      if (i.fill) str(i.fill);
      if (i.tool) str(i.tool);
      if (i.shp) str(i.shp);
      if (i.lineType) str(i.lineType);
      mix(num(i.size)); mix(num(i.opacity));
      if (i.ly != null) mix(i.ly | 0);
      if (typeof i.html === 'string') mix(i.html.length);
      if (typeof i.text === 'string') mix(i.text.length);
      if (typeof i.src === 'string') mix(i.src.length);
      if (Array.isArray(i.cells)) { mix(i.cells.length); for (const r of i.cells) if (Array.isArray(r)) { mix(r.length); for (const c of r) if (typeof c === 'string') mix(c.length); } }
      if (Array.isArray(i.fns)) { const js = JSON.stringify([i.fns, i.params, i.view, i.opt]); mix(js.length); for (let q = 0; q < js.length; q++) mix(js.charCodeAt(q)); }
      if (Array.isArray(i.cw)) mix(num(i.cw.reduce((x, y) => x + y, 0)));
      if (Array.isArray(i.rh)) mix(num(i.rh.reduce((x, y) => x + y, 0)));
    }
    for (const l of layers || []) { mix((l.id | 0) * 3 + (l.vis ? 1 : 0)); mix(l.lock ? 1 : 0); }
    return h;
  }

  const sameSet = (a, b) => {
    if (!a && !b) return true;
    if (!a || !b || a.size !== b.size) return false;
    for (const x of b) if (!a.has(x)) return false;
    return true;
  };

  /* ---------- eraser pre-filter ---------- */
  /* True when point p is close enough to stroke i that the eraser (radius r) could touch it. cache: optional WeakMap of stroke boxes
     (invalidate it whenever strokes are edited in place). Conservative: it never returns false for a stroke that is actually within reach. */
  function strokeNear(i, p, r, cache) {
    let b = cache && cache.get(i);
    if (!b) {
      const P = i.pts;
      let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
      for (let k = 0; k < P.length; k++) {
        const q = P[k], x = q[0], y = q[1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      b = [x0, y0, x1, y1];
      if (cache) cache.set(i, b);
    }
    const m = r + (i.size || 4) / 2 + 2;
    return p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m;
  }

  /* ---------- board index and start-up ---------- */
  /* The small record kept in the board index: everything about a board except its (possibly huge) items, plus the ids of the boards it links to. */
  function metaOf(v, lk) {
    const m = {};
    for (const k in v) if (k !== 'items' && k !== 'enc') m[k] = v[k]; // for-in never touches a lazy `items` getter; encrypted content stays out of the index
    if (lk) m.lk = lk;
    return m;
  }

  /* ---------- search ---------- */
  const Q_MAX = 20000, PQ_MAX = 40000; // characters kept per board in the (small) board index
  const squash = s => String(s).replace(/\s+/g, ' ').trim();
  /* The searchable text of a board: q = everything typed (text, sticky notes, LaTeX, shape labels, table cells, links, graph formulas),
     pq = text of imported PDF pages. Kept separate so a long PDF never pushes your own notes out of the index. */
  function searchText(items) {
    const q = [], pq = [];
    let nq = 0, np = 0;
    const add = (a, s, cap, n) => { if (s == null || n >= cap) return n; const t = squash(s); if (!t) return n; a.push(t); return n + t.length + 1; };
    for (const i of Array.isArray(items) ? items : []) {
      if (!i || typeof i !== 'object') continue;
      nq = add(q, i.srcText || i.text || i.latex, Q_MAX, nq);
      if (i.label) nq = add(q, i.label, Q_MAX, nq);
      if (Array.isArray(i.cells)) for (const r of i.cells) if (Array.isArray(r)) for (const c of r) if (typeof c === 'string' && c) nq = add(q, c, Q_MAX, nq);
      if (Array.isArray(i.fns)) for (const f of i.fns) if (f && f.text) nq = add(q, f.text, Q_MAX, nq);
      if (i.t === 'ck') { if (i.title) nq = add(q, i.title, Q_MAX, nq); if (Array.isArray(i.rows)) for (const r of i.rows) if (r && r.text) nq = add(q, r.text, Q_MAX, nq); } /* checklists */
      if (typeof i.txt === 'string') np = add(pq, i.txt, PQ_MAX, np);
    }
    return { q: q.join(' ').slice(0, Q_MAX), pq: pq.join(' ').slice(0, PQ_MAX) };
  }
  /* Lower case, accents removed and compatibility forms unified, so "Café", "cafe" and "ＣＡＦＥ" all match. */
  const fold = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  /* Every word of the query must appear somewhere in the text (any order). An empty query matches everything. */
  function textMatch(hay, query) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const h = fold(hay);
    return words.every(w => h.includes(w));
  }

  /* Handwriting -> lines of ink, so each line can be recognized at a readable size.
     boxes: [[x0, y0, x1, y1], ...] (one per stroke). Returns groups of indices: strokes whose vertical centres fall inside the same band
     form a line; a line is split where there is a wide horizontal gap or when it gets too long to recognize at once. */
  function inkLines(boxes, { gapK = 3, maxLenK = 30, maxGroups = 400 } = {}) {
    const ok = b => Array.isArray(b) && b.length >= 4 && b.every(Number.isFinite) && b[2] >= b[0] && b[3] >= b[1];
    const idx = [];
    (Array.isArray(boxes) ? boxes : []).forEach((b, k) => { if (ok(b)) idx.push(k); });
    if (!idx.length) return [];
    const B = k => boxes[k], h = k => Math.max(1, B(k)[3] - B(k)[1]), cy = k => (B(k)[1] + B(k)[3]) / 2;
    const hs = idx.map(h).sort((a, b) => a - b), med = hs[hs.length >> 1];
    /* lines are built from letter-sized strokes first; small marks (i-dots, accents, commas) then join the nearest line */
    const big = idx.filter(k => h(k) >= med * 0.5).sort((a, b) => cy(a) - cy(b)), small = idx.filter(k => h(k) < med * 0.5);
    const lines = [];
    for (const k of big) {
      const L = lines[lines.length - 1];
      if (L && cy(k) <= L.y1 + med * 0.25 && cy(k) >= L.y0 - med * 0.25) { L.m.push(k); L.y0 = Math.min(L.y0, B(k)[1]); L.y1 = Math.max(L.y1, B(k)[3]); }
      else lines.push({ y0: B(k)[1], y1: B(k)[3], m: [k] });
    }
    for (const k of small.sort((a, b) => cy(a) - cy(b))) {
      let best = null, bd = Infinity;
      for (const L of lines) { const d = cy(k) < L.y0 ? L.y0 - cy(k) : cy(k) > L.y1 ? cy(k) - L.y1 : 0; if (d < bd) { bd = d; best = L; } }
      if (best && bd <= med * 0.75) best.m.push(k);
      else lines.push({ y0: B(k)[1], y1: B(k)[3], m: [k] });
    }
    lines.sort((a, b) => a.y0 - b.y0);
    const out = [];
    for (const L of lines) {
      L.m.sort((a, b) => B(a)[0] - B(b)[0]);
      let cur = [], x0 = 0, xr = 0;
      for (const k of L.m) {
        const b = B(k);
        if (cur.length && (b[0] - xr > gapK * med || b[2] - x0 > maxLenK * med)) { out.push(cur); cur = []; }
        if (!cur.length) { x0 = b[0]; xr = b[2]; }
        cur.push(k); xr = Math.max(xr, b[2]);
      }
      if (cur.length) out.push(cur);
      if (out.length >= maxGroups) return out.slice(0, maxGroups);
    }
    return out;
  }

  /* Which board to open at start-up: the one that was open last if it is still there and usable, else the most recently changed usable one. */
  function pickStart(lastId, metas) {
    const usable = r => r && !r.folder && !r.del && !r.locked;
    if (lastId) { const r = metas.find(x => x.id === lastId); if (usable(r)) return r.id; }
    let best = null;
    for (const r of metas) if (usable(r) && (!best || (r.t || 0) > (best.t || 0))) best = r;
    return best ? best.id : null;
  }

  /* ---------- straight lines (hold Shift while drawing) ---------- */
  /* Point p snapped onto the line from a that is level, upright or at 45 degrees, when it is within tolDeg of one (otherwise p unchanged).
     p is projected onto that line, so the end stays right under the pointer along the line, and level / upright results are exact
     (no 1e-16 drift): ruled staves and guitar tabs come out truly parallel. */
  const AXES = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0, 1], [-Math.SQRT1_2, Math.SQRT1_2], [-1, 0], [-Math.SQRT1_2, -Math.SQRT1_2], [0, -1], [Math.SQRT1_2, -Math.SQRT1_2]];
  function shiftSnap(a, p, tolDeg) {
    const dx = p[0] - a[0], dy = p[1] - a[1];
    if (!(Math.hypot(dx, dy) > 1e-9)) return p;
    const step = Math.PI / 4, ang = Math.atan2(dy, dx), k = Math.round(ang / step);
    if (Math.abs(ang - k * step) > (tolDeg == null ? 7 : tolDeg) * Math.PI / 180) return p;
    const i = ((k % 8) + 8) % 8;
    if (i === 0 || i === 4) return [p[0], a[1]]; // level
    if (i === 2 || i === 6) return [a[0], p[1]]; // upright
    const d = AXES[i], t = dx * d[0] + dy * d[1];
    return [a[0] + t * d[0], a[1] + t * d[1]];
  }

  return {
    metaOf, pickStart, shiftSnap, flatten, inflate, searchText, textMatch, fold, inkLines, packItems, unpackItems, trimHist, addEntry, addIdx, pushDeep, pushAdd, undoStep, redoStep,
    dbPackItems, dbUnpackItems, dbPackRec, dbLazy, dbOut, boardSig, sameSet, strokeNear
  };
});
