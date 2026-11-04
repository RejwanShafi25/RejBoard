'use strict';
/* Ink golden fixtures, made by running the desktop app's OWN drawing and input code (pulled out of index.html) against a
   recording canvas: stroke() for every brush, bgAll()/bgfx() for every paper, addPt() for pen / finger / mouse input,
   erase()/eraseMove() for the pressure eraser, and szFromR/szToR for the 0.1-60 px size slider.
   The Kotlin ports in core/src/commonMain/.../ink must issue the same canvas calls and produce the same points. */
const fs = require('fs');
const path = require('path');

/* ---------- pulling code out of index.html ---------- */
function scanEnd(src, i, stopAtComma) {
  // from i, walk to the end of an expression / block, skipping strings, template literals and comments
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '/' && nx === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && !stopAtComma) return i + 1; // end of a function body
      if (depth < 0) return i;
    } else if (stopAtComma && depth === 0 && (ch === ',' || ch === ';' || ch === '\n')) return i;
  }
  throw new Error('unterminated code at ' + i);
}
function fn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('index.html has no function ' + name);
  const body = src.indexOf('{', src.indexOf(')', at));
  return src.slice(at, scanEnd(src, body, false));
}
function val(src, anchor, name) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error('index.html has no ' + anchor);
  const start = at + anchor.indexOf('=') + 1;
  return 'const ' + name + '=' + src.slice(start, scanEnd(src, start, true)) + ';';
}

function desktop(root) {
  const src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const BoardCore = require(path.join(root, 'board-core.js'));
  const code = [
    'let S={}, cfg={}, ST={pres:true}, penCurve=50, lastPenPr=0, cur=null, sp=null, lp=0, lt=0, drag=null, erPr=1;',
    val(src, 'const PAP=', 'PAP'), val(src, ',dk=k=>', 'dk'), val(src, 'const CLEF_PTS=', 'CLEF_PTS'),
    val(src, 'const PSZ=', 'PSZ'), val(src, ',PG_GAP=', 'PG_GAP'), val(src, 'const pdim=', 'pdim'),
    val(src, 'const wd=', 'wd'), val(src, 'const ds=', 'ds'), val(src, 'const penGamma=', 'penGamma'), val(src, 'const erPress=', 'erPress'),
    val(src, 'const szFromR=', 'szFromR'), val(src, 'szToR=(v,lo,hi)=>', 'szToR'),
    fn(src, 'smoothPts'), fn(src, 'stroke'), fn(src, 'staffClef'), fn(src, 'bgfx'), fn(src, 'bgAll'),
    fn(src, 'penPr'), fn(src, 'addPt'), fn(src, 'erase'), fn(src, 'eraseMove'),
    // the desktop's surroundings, stubbed: grain pattern, rulers, layers, shapes/tape (not erased in this phase)
    "function pencilGrain(c,col){return 'grain:'+col}",
    'function rulerPoint(p){return p} function paperPoint(p){return p} function holdArm(){} function updateBrushCursor(){}',
    'function act(){return true} function spHit(){return false} function tapeNear(){return false} function bnds(){return [0,0,0,0]} function erDirty(){}',
    'const eNear=(i,p,r)=>BoardCore.strokeNear(i,p,r);',
    'function coal(e){return e.coal} function pt(v){return v.p}',
    `return {
      stroke, bgAll, szFromR, szToR, erase, eraseMove,
      setS(v){S=v}, setCfg(v){cfg=v}, setCurve(v){penCurve=v; lastPenPr=0},
      penDown(e,tool,tl){const p=[e.x,e.y];cur={tool,tl,pts:[[p[0],p[1],e.pointerType=='pen'?penPr(e):.5]]};sp=p.slice();lt=e.timeStamp;lp=e.pointerType=='pen'?penPr(e):.5},
      penMove(e){addPt(e,[e.x,e.y])}, penPts(){return cur.pts},
      eraserDown(){drag={k:'er'}}, getS(){return S}
    };`
  ].join('\n');
  return new Function('BoardCore', code)(BoardCore);
}

/* ---------- a canvas that writes down every call ---------- */
function recorder() {
  const log = [];
  class Path2D {
    constructor() { this.log = []; }
    moveTo(x, y) { this.log.push(['moveTo', x, y]); }
    lineTo(x, y) { this.log.push(['lineTo', x, y]); }
    closePath() { this.log.push(['closePath']); }
  }
  global.Path2D = Path2D;
  const calls = {
    beginPath: () => log.push(['beginPath']), closePath: () => log.push(['closePath']),
    moveTo: (x, y) => log.push(['moveTo', x, y]), lineTo: (x, y) => log.push(['lineTo', x, y]),
    quadraticCurveTo: (a, b, x, y) => log.push(['quadTo', a, b, x, y]),
    bezierCurveTo: (a, b, c, d, x, y) => log.push(['bezierTo', a, b, c, d, x, y]),
    arc: (x, y, r, a0, a1) => log.push(['arc', x, y, r, a0, a1]), rect: (x, y, w, h) => log.push(['rect', x, y, w, h]),
    fill: p => { if (p) { log.push(['beginPath']); log.push(...p.log); } log.push(['fill']); },
    stroke: () => log.push(['stroke']), clip: () => log.push(['clip']),
    fillRect: (x, y, w, h) => log.push(['fillRect', x, y, w, h]),
    save: () => log.push(['save']), restore: () => log.push(['restore']),
    translate: (x, y) => log.push(['translate', x, y]), scale: (x, y) => log.push(['scale', x, y]),
    setLineDash: a => log.push(['setLineDash', ...a]), fillText: (t, x, y) => log.push(['fillText', t, x, y])
  };
  const quiet = new Set(['font', 'textAlign', 'textBaseline']); // text styling is checked by eye, not here
  const state = {}; // property values read back (bgfx reads c.lineWidth)
  const c = new Proxy(calls, { set(_, k, v) { state[k] = v; if (!quiet.has(k)) log.push([k, v]); return true; }, get(t, k) { return k in t ? t[k] : state[k]; } });
  return { c, log };
}

module.exports = function inkFixtures(out, { root, rng, stroke }) {
  const D = desktop(root);
  const clone = x => JSON.parse(JSON.stringify(x));

  /* ---- sizes ---- */
  const rs = [0, 1, 37, 100, 250, 333.3, 500, 612, 777, 900, 999, 1000, -5, 1200];
  const vs = [0.1, 0.15, 0.3, 0.5, 1, 2.5, 6, 9.96, 10, 33, 60, 80, 0, -1];
  out.inkSizes = {
    fromSlider: rs.flatMap(r => [[r, .1, 60, D.szFromR(r, .1, 60)], [r, .5, 80, D.szFromR(r, .5, 80)]]),
    toSlider: vs.flatMap(v => [[v, .1, 60, D.szToR(v, .1, 60)], [v, .5, 80, D.szToR(v, .5, 80)]])
  };

  /* ---- strokes: every brush and its options ---- */
  const r = rng(91);
  const pts = n => { const p = stroke(r, { n, x: 50 + r() * 100, y: 50 + r() * 100 }).pts; p[0] = p[0].slice(0, 3); return p; };
  const DEF = { fount: 6, calli: 8, soft: 14, ball: 3, pencil: 3, hsq: 18, hch: 18, hrd: 18, xyz: 5 };
  const mk = (tool, extra = {}, n = 14) => ({ t: 's', tool, color: '#2a6f9e', size: DEF[tool], sens: .6, ang: tool == 'hch' ? 45 : 135, opacity: tool[0] == 'h' ? 35 : 100, tl: false, pts: pts(n), ly: 1, ...extra });
  const strokes = [];
  for (const t of ['fount', 'calli', 'soft', 'ball', 'pencil', 'hsq', 'hch', 'hrd']) strokes.push(mk(t), mk(t, {}, 1), mk(t, {}, 2), mk(t, { size: .1 }), mk(t, { size: 60 }, 5));
  strokes.push(
    mk('fount', { lineType: 'dashed', pl: 1 }), mk('calli', { lineType: 'dotted', pl: 1, ang: 30 }), mk('ball', { lineType: 'dashdot', pl: 1, fill: '#ffeeaa' }),
    mk('pencil', { tl: true, lineType: 'longdash', pl: 1 }), mk('soft', { tl: true }), mk('pencil', { tl: true }), mk('fount', { sharp: 1 }),
    mk('ball', { cornerType: 'sharp' }), mk('hch', { ang: 100 }), mk('fount', { sens: 0 }), mk('fount', { lineType: 'shortdash' }),
    mk('xyz'), mk('ball', { lineType: 'dashed' })
  );
  const noOpacity = mk('hrd'); delete noOpacity.opacity; strokes.push(noOpacity);
  const softNoOp = mk('soft'); delete softNoOp.opacity; strokes.push(softNoOp);
  const noSens = mk('fount'); delete noSens.sens; strokes.push(noSens);
  out.inkStrokes = strokes.map(s => { const { c, log } = recorder(); D.stroke(c, clone(s)); return { item: s, log }; });

  /* ---- paper and pages ---- */
  const pats = ['plain', 'grid', 'dots', 'cols', 'margin', 'iso', 'lines', 'music', 'tab', 'hand', 'eng', 'mm', 'hex', 'slant', 'cornell'];
  const papers = [];
  for (const pat of pats) for (const bg of ['white', 'navy']) papers.push({ S: { bg, pat, gs: 28, gd: 1.5, pg: { size: 'inf', o: 'p', n: 1 } }, view: [420, 320, -33.7, 21.3, 1.25] });
  papers.push(
    { S: { bg: 'cream', pat: 'lines', gs: 32, gd: 2, pg: { size: 'a4', o: 'p', n: 3 } }, view: [500, 900, 40, -200, .5] },
    { S: { bg: 'slate', pat: 'grid', gs: 24, gd: 1, pg: { size: 'letter', o: 'l', n: 2 } }, view: [600, 400, 10, 10, .4] },
    { S: { bg: 'white', pat: 'dots', gs: 28, gd: 1.5, pg: { size: 'pdf', o: 'p', n: 2, w: 612, h: 792 } }, view: [400, 400, -20, -700, .6] },
    { S: { bg: 'white', pat: 'grid', gs: 28, gd: 1.5, pg: { size: 'inf', o: 'p', n: 1 } }, view: [300, 200, 0, 0, .1] },
    { S: { bg: 'white', pat: 'music', gs: 28, gd: 1.5, pg: { size: 'inf', o: 'p', n: 1 } }, view: [300, 200, 5, 7, .5] },
    { S: { bg: 'mint', pat: 'hex', gs: 10, gd: 1.5, pg: { size: 'inf', o: 'p', n: 1 } }, view: [300, 200, 5, 7, 1] }
  );
  out.inkPaper = papers.map(p => { const { c, log } = recorder(); D.setS(clone(p.S)); D.bgAll(c, ...p.view); return { ...p, log }; });

  /* ---- pen, finger and mouse input (addPt) ---- */
  const ri = rng(92), inputs = [];
  for (const [kind, tool, tl, stab, curve, zoom] of [
    ['pen', 'fount', false, 30, 50, 1], ['pen', 'pencil', true, 0, 20, 2], ['pen', 'hrd', false, 80, 85, .5],
    ['touch', 'calli', false, 30, 50, 1], ['touch', 'ball', false, 50, 50, 3], ['mouse', 'soft', false, 30, 50, 1], ['mouse', 'fount', false, 100, 50, .25]
  ]) {
    const evs = [];
    let x = 100 + ri() * 50, y = 80 + ri() * 50, t = 1000;
    for (let k = 0; k < 40; k++) {
      x += (ri() - .3) * 9; y += (ri() - .5) * 7; t += k % 7 == 3 ? 0 : 3 + ri() * 14;
      const pressure = kind == 'mouse' ? (k % 2 ? .5 : 0) : kind == 'touch' ? (k % 5 ? 0 : ri()) : (k == 4 ? 0 : .05 + ri() * .9);
      evs.push({ x, y, pointerType: kind, pressure, tiltX: (ri() - .5) * 120, tiltY: (ri() - .5) * 90, timeStamp: t, shiftKey: false });
    }
    D.setS({ straight: false, z: zoom }); D.setCfg({ [tool]: { stab } }); D.setCurve(curve);
    D.penDown(evs[0], tool, tl && kind == 'pen');
    for (const e of evs.slice(1)) D.penMove(e);
    inputs.push({ kind, tool, tl, stab, curve, zoom, events: evs, pts: clone(D.penPts()) });
  }
  out.inkInput = inputs;

  /* ---- the eraser (erase / eraseMove) ---- */
  const re = rng(93);
  const board = () => {
    const b = [];
    for (let k = 0; k < 9; k++) {
      const s = stroke(re, { n: 30, x: 40 + re() * 120, y: 40 + re() * 120, tool: k == 3 ? 'hrd' : 'fount' });
      s.size = k == 3 ? 18 : 2 + re() * 4;
      b.push(s);
    }
    b.push({ t: 's', tool: 'ball', color: '#000', size: 3, sens: .6, ang: 135, opacity: 100, pts: [[100, 100, .5]], tl: false, ly: 1 });
    b.push({ t: 'sp', shp: 'rect', x: 90, y: 90, w: 40, h: 40, size: 2, color: '#000', ly: 1 });
    return b;
  };
  const base = board();
  const gestures = [];
  for (const [mode, size, kind] of [['part', 16, 'pen'], ['part', 4, 'mouse'], ['whole', 10, 'pen'], ['hl', 24, 'pen'], ['part', 40, 'touch']]) {
    const moves = [];
    let x = 30 + re() * 30, y = 30 + re() * 40;
    if (mode == 'hl') { x = base[3].pts[5][0] - 25; y = base[3].pts[5][1] - 8; } // run across the highlighter stroke
    for (let k = 0; k < 12; k++) {
      const n = 1 + ((re() * 4) | 0), coal = [];
      for (let j = 0; j < n; j++) { x += re() * 14; y += (re() - .3) * 12; coal.push({ p: [x, y], pointerType: kind, pressure: kind == 'pen' ? re() : 0 }); }
      moves.push({ pointerType: kind, pressure: coal[n - 1].pressure, coal });
    }
    D.setCfg({ erase: { size } });
    D.setS({ items: clone(base), sel: [], eraseOnly: mode == 'hl' ? 'hl' : '', eraseWhole: mode == 'whole' });
    D.eraserDown();
    for (const m of moves) D.eraseMove(m, m.coal[0].p);
    gestures.push({ mode, size, kind, moves, items: clone(D.getS().items) });
  }
  out.inkEraser = { board: base, gestures };
};
