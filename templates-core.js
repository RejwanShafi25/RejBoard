/* RejBoard templates: paper setups plus starting content for new boards. No DOM in here, so it runs in the app (as the global
   `TemplatesCore`) and under `node --test`.

   Each template: {id, cat, name, size ('inf' | 'a4' | 'a5' | 'a3' | 'letter'), o ('p' | 'l'), pat, gs, gd, build(K) -> items}.
   build() receives a kit K: the page size (K.W, K.H), colours that suit the chosen paper (K.ink, K.soft, K.pastel[...]) and
   constructors for text, sticky notes, tables, shapes and connectors. Everything it returns is a plain board item. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TemplatesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PSZ = { a4: [794, 1123], a5: [559, 794], a3: [1123, 1587], letter: [816, 1056] };
  const CATS = ['Notes', 'Study', 'Planners', 'Creative', 'Business', 'Diagrams'];
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  /* page size of a template (an infinite board gets a comfortable working area) */
  function pageSize(size, o) {
    if (size === 'inf' || !PSZ[size]) return [1400, 900];
    const d = PSZ[size];
    return o === 'l' ? [d[1], d[0]] : d.slice();
  }

  /* the building kit */
  function kit(size, o, dark, newId, tr) {
    const [W, H] = pageSize(size, o);
    const ink = dark ? '#e9e9f0' : '#2b2b33', soft = dark ? '#a9a9b8' : '#6b6b78';
    const pastel = dark ? ['#4a3a14', '#173a2a', '#16314f', '#3d1f3f', '#4a2a1a', '#2a2a4a'] : ['#fff3a3', '#c8f5d4', '#cfe5ff', '#f6d1f0', '#ffe0c7', '#dcdcff'];
    const id = () => newId();
    const tx = v => (tr ? tr(String(v)) : String(v));
    /* a translated label with {placeholders}, e.g. tf('Day {n}', {n: 3}) */
    const tf = (k, v) => { let o = tx(k); for (const n in v) o = o.split('{' + n + '}').join(String(v[n])); return o; };
    const T = (x, y, text, size = 18, opt = {}) => ({ t: 't', x, y, text: tx(text), size, color: opt.color || ink, ff: opt.ff || 'sans', b: opt.b ? 1 : 0, i: opt.i ? 1 : 0, u: 0, dir: 'ltr' });
    const H1 = (x, y, text, size = 30) => T(x, y, text, size, { b: 1 });
    const Sticky = (x, y, w, h, text, bg) => ({ t: 't', sticky: true, stickySize: 'm', szOk: 1, x, y, w, h, bg: bg || pastel[0], text: text ? tx(text) : '', size: 18, color: dark ? '#f2f2f2' : '#222222' });
    const Tb = (x, y, cw, rh, cells, fs = 15) => ({ t: 'tb', x, y, cw: cw.slice(), rh: rh.slice(), cells: cells.map(r => r.map(c => String(c == null ? '' : c))), mg: [], st: cells.map(r => r.map(() => null)), fs, color: ink, w: cw.reduce((a, b) => a + b, 0), h: rh.reduce((a, b) => a + b, 0) });
    /* a table of `rows` rows filling `width`, with given headers and column proportions */
    const Grid = (x, y, width, heads, props, rows, rowH = 30, fill) => {
      const tot = props.reduce((a, b) => a + b, 0), cw = props.map(p => Math.round(width * p / tot));
      const cells = [heads.map(tx)].concat(Array.from({ length: rows }, (_, r) => heads.map((_, c) => (fill ? tx(fill(r, c)) : ''))));
      return Tb(x, y, cw, cells.map(() => rowH), cells);
    };
    const Sh = (shp, x, y, w, h, label, opt = {}) => ({ t: 'sp', shp, x, y, w, h, fx: 0, fy: 0, rot: 0, size: opt.size || 2, color: opt.color || ink, fill: opt.fill, lineType: opt.lineType || 'solid', cornerType: 'rounded', label: label ? tx(label) : undefined, id: id() });
    const Line = (x1, y1, x2, y2, opt = {}) => ({ t: 'sp', shp: opt.arrow ? 'arr' : 'line', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), fx: x2 < x1 ? 1 : 0, fy: y2 < y1 ? 1 : 0, rot: 0, size: opt.size || 2, color: opt.color || ink, lineType: opt.lineType || 'solid', cornerType: 'rounded', id: id() });
    /* a connector from shape a to shape b (it attaches to their outlines when the board is drawn) */
    const Conn = (a, b, opt = {}) => {
      const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
      return Object.assign({ t: 'sp', shp: opt.line ? 'line' : 'arr', x: Math.min(ca[0], cb[0]), y: Math.min(ca[1], cb[1]), w: Math.abs(cb[0] - ca[0]), h: Math.abs(cb[1] - ca[1]), fx: cb[0] < ca[0] ? 1 : 0, fy: cb[1] < ca[1] ? 1 : 0, rot: 0, size: 2, color: ink, lineType: 'solid', cornerType: 'rounded', lk0: { id: a.id, s: opt.s0 || 'auto' }, lk1: { id: b.id, s: opt.s1 || 'auto' }, id: id() },
        opt.label ? { label: tx(opt.label) } : {}, opt.rt ? { rt: opt.rt } : {}, opt.ah0 ? { ah0: opt.ah0 } : {}, opt.ah1 ? { ah1: opt.ah1 } : {});
    };
    return { W, H, ink, soft, pastel, dark, T, H1, Sticky, Tb, Grid, Sh, Line, Conn, DAYS, tf };
  }

  const M = 48; // page margin
  const lines = (K, x, y, w, n, gap) => Array.from({ length: n }, (_, k) => K.Line(x, y + k * gap, x + w, y + k * gap, { color: K.soft, size: 1 }));
  const header = (K, title, sub) => [K.H1(M, M, title)].concat(sub ? [K.T(M, M + 44, sub, 15, { color: K.soft })] : []);

  const L = [];
  const add = (cat, id, name, size, o, pat, gs, gd, build) => L.push({ cat, id, name, size, o, pat, gs, gd, build: build || (() => []) });

  /* ---------- Notes ---------- */
  add('Notes', 'blank', 'Blank', 'inf', 'p', 'plain', 28, 1.5);
  add('Notes', 'lined', 'Lined notes', 'a4', 'p', 'lines', 30, 1.2);
  add('Notes', 'grid', 'Grid notes', 'a4', 'p', 'grid', 24, 1);
  add('Notes', 'dotted', 'Dotted notes', 'a4', 'p', 'dots', 24, 1.2);
  add('Notes', 'cornell', 'Cornell notes', 'a4', 'p', 'cornell', 30, 1.2, K => [K.T(14, 30, 'Topic:', 16, { b: 1 }), K.T(14, 100, 'Cues & questions', 14, { color: K.soft }), K.T(274, 100, 'Notes', 14, { color: K.soft }), K.T(14, 1062, 'Summary', 14, { color: K.soft })]);
  add('Notes', 'twocol', 'Two-column notes', 'a4', 'p', 'lines', 30, 1.2, K => [...header(K, 'Notes'), K.Line(K.W / 2, 110, K.W / 2, K.H - M, { color: K.soft, size: 1 }), K.T(M, 110, 'Ideas', 16, { b: 1 }), K.T(K.W / 2 + 16, 110, 'Details', 16, { b: 1 })]);
  add('Notes', 'lecture', 'Lecture notes', 'a4', 'p', 'margin', 30, 1.2, K => [K.Grid(M, M, K.W - 2 * M, ['Course', 'Lecture', 'Date'], [3, 2, 2], 1, 30), K.T(M, 130, 'Key points', 18, { b: 1 }), K.T(M, K.H - 220, 'Summary', 18, { b: 1 }), K.Sh('rect', M, K.H - 190, K.W - 2 * M, 140, '', { color: K.soft })]);
  add('Notes', 'meeting', 'Meeting notes', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Meeting notes', 'Date · Time · Place'), K.T(M, 120, 'Attendees', 17, { b: 1 }), ...lines(K, M, 170, K.W - 2 * M, 2, 30),
    K.T(M, 250, 'Agenda', 17, { b: 1 }), K.Grid(M, 280, K.W - 2 * M, ['#', 'Topic', 'Owner', 'Time'], [1, 7, 3, 2], 5, 32, (r, c) => (c === 0 ? r + 1 : '')),
    K.T(M, 500, 'Notes', 17, { b: 1 }), ...lines(K, M, 550, K.W - 2 * M, 8, 32), K.T(M, 830, 'Action items', 17, { b: 1 }), K.Grid(M, 860, K.W - 2 * M, ['☐', 'Action', 'Owner', 'Due'], [1, 8, 3, 2], 5, 32, (r, c) => (c === 0 ? '☐' : ''))]);
  add('Notes', 'journal', 'Journal', 'a5', 'p', 'lines', 28, 1.1, K => [K.T(M - 10, M - 10, 'Date:', 15, { b: 1 }), K.T(K.W - 190, M - 10, 'Mood:  ☺  😐  ☹', 15)]);
  add('Notes', 'reading', 'Reading notes', 'a4', 'p', 'lines', 30, 1.2, K => [K.Grid(M, M, K.W - 2 * M, ['Title', 'Author', 'Pages'], [5, 3, 1], 1, 30), K.T(M, 140, 'Big ideas', 17, { b: 1 }), K.T(M, 470, 'Quotes', 17, { b: 1 }), K.T(M, 800, 'My thoughts', 17, { b: 1 })]);

  /* ---------- Study ---------- */
  add('Study', 'math', 'Math paper', 'a4', 'p', 'grid', 20, 1, K => [K.Grid(M, M, K.W - 2 * M, ['Subject', 'Topic', 'Date'], [3, 4, 2], 1, 28)]);
  add('Study', 'eng', 'Engineering paper', 'a4', 'p', 'eng', 50, 1);
  add('Study', 'mm', 'Millimetre paper', 'a4', 'p', 'mm', 50, 1);
  add('Study', 'iso', 'Isometric paper', 'a4', 'p', 'iso', 24, 1.2);
  add('Study', 'graph', 'Large graph paper', 'a4', 'p', 'grid', 40, 1.2);
  add('Study', 'hand', 'Handwriting practice', 'a4', 'p', 'hand', 60, 1.2);
  add('Study', 'calli', 'Calligraphy (slanted guides)', 'a4', 'p', 'slant', 40, 1);
  add('Study', 'flash', 'Flashcards', 'a4', 'p', 'plain', 28, 1, K => { const w = (K.W - 3 * M) / 2, h = (K.H - 2 * M - 3 * 24) / 4, out = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) out.push(K.Sh('rect', M + c * (w + M), M + r * (h + 24), w, h, c === 0 ? 'Question' : 'Answer', { color: K.soft })); return out; });
  add('Study', 'vocab', 'Vocabulary list', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Vocabulary'), K.Grid(M, 110, K.W - 2 * M, ['Word', 'Meaning', 'Example'], [2, 3, 4], 26, 36)]);
  add('Study', 'revision', 'Exam revision checklist', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Revision checklist', 'Exam · Date'), K.Grid(M, 110, K.W - 2 * M, ['Topic', 'Notes', 'Practised', 'Confident'], [5, 3, 2, 2], 24, 36, (r, c) => (c >= 2 ? '☐' : ''))]);
  add('Study', 'lab', 'Lab report', 'a4', 'p', 'lines', 30, 1.1, K => ['Aim', 'Hypothesis', 'Method', 'Results', 'Conclusion'].map((t, k) => K.T(M, M + k * 210, t, 18, { b: 1 })));
  add('Study', 'timetable', 'Class timetable', 'a4', 'l', 'plain', 28, 1, K => [...header(K, 'Timetable'), K.Grid(M, 110, K.W - 2 * M, ['Time'].concat(K.DAYS.slice(0, 5)), [1.2, 2, 2, 2, 2, 2], 9, 58, (r, c) => (c === 0 ? (8 + r) + ':00' : ''))]);

  /* ---------- Planners ---------- */
  add('Planners', 'daily', 'Daily planner', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Today', 'Date'), K.T(M, 120, 'Top priorities', 17, { b: 1 }), K.Grid(M, 150, (K.W - 3 * M) / 2, ['☐', 'Priority'], [1, 7], 3, 32, (r, c) => (c ? '' : '☐')),
    K.Grid(M, 300, (K.W - 3 * M) / 2, ['Time', 'Plan'], [1.3, 5], 17, 40, (r, c) => (c ? '' : (6 + r) + ':00')), K.T(K.W / 2 + M / 2, 120, 'Notes', 17, { b: 1 }), K.Sh('rect', K.W / 2 + M / 2, 150, (K.W - 3 * M) / 2, 450, '', { color: K.soft }),
    K.T(K.W / 2 + M / 2, 630, 'Water  ○○○○○○○○', 15), K.T(K.W / 2 + M / 2, 670, 'Gratitude', 17, { b: 1 })]);
  add('Planners', 'weekly', 'Weekly planner', 'a4', 'l', 'plain', 28, 1, K => { const w = (K.W - 2 * M - 3 * 16) / 4, h = (K.H - 130 - M - 16) / 2, out = header(K, 'This week', 'Week of'); K.DAYS.concat(['Notes']).forEach((d, k) => { const x = M + (k % 4) * (w + 16), y = 110 + Math.floor(k / 4) * (h + 16); out.push(K.Sh('rect', x, y, w, h, '', { color: K.soft }), K.T(x + 10, y + 8, d, 15, { b: 1 })); }); return out; });
  add('Planners', 'monthly', 'Monthly calendar', 'a4', 'l', 'plain', 28, 1, K => [...header(K, 'Month', 'Year'), K.Grid(M, 110, K.W - 2 * M, K.DAYS.map(d => d.slice(0, 3)), [1, 1, 1, 1, 1, 1, 1], 6, 90)]);
  add('Planners', 'todo', 'To-do list', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'To do'), K.Grid(M, 110, K.W - 2 * M, ['☐', 'Task', 'Priority', 'Due'], [1, 9, 2, 2], 26, 36, (r, c) => (c ? '' : '☐'))]);
  add('Planners', 'habits', 'Habit tracker', 'a4', 'l', 'plain', 28, 1, K => [...header(K, 'Habit tracker', 'Month'), K.Grid(M, 110, K.W - 2 * M, ['Habit'].concat(Array.from({ length: 31 }, (_, k) => k + 1)), [6].concat(Array(31).fill(1)), 12, 40)]);
  add('Planners', 'goals', 'Goal planner', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Goal'), K.Sh('rect', M, 110, K.W - 2 * M, 90, 'My goal', { color: K.soft }), K.T(M, 230, 'Why it matters', 17, { b: 1 }), ...lines(K, M, 280, K.W - 2 * M, 3, 32),
    K.T(M, 400, 'Steps', 17, { b: 1 }), K.Grid(M, 430, K.W - 2 * M, ['☐', 'Step', 'By when'], [1, 9, 3], 8, 36, (r, c) => (c ? '' : '☐')), K.T(M, 780, 'Reward', 17, { b: 1 })]);
  add('Planners', 'budget', 'Monthly budget', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Budget', 'Month'), K.T(M, 110, 'Income', 17, { b: 1 }), K.Grid(M, 140, K.W - 2 * M, ['Source', 'Planned', 'Actual'], [5, 2, 2], 4, 32),
    K.T(M, 330, 'Expenses', 17, { b: 1 }), K.Grid(M, 360, K.W - 2 * M, ['Category', 'Planned', 'Actual'], [5, 2, 2], 12, 32, (r, c) => (c ? '' : ['Rent', 'Food', 'Transport', 'Bills', 'Savings', 'Fun', '', '', '', '', '', ''][r])),
    K.T(M, 800, 'Totals: type =SUM(B2:B13) in a cell', 13, { color: K.soft })]);
  add('Planners', 'meals', 'Meal planner', 'a4', 'l', 'plain', 28, 1, K => [...header(K, 'Meal plan', 'Week of'), K.Grid(M, 110, K.W - 2 * M, ['Meal'].concat(K.DAYS.map(d => d.slice(0, 3))), [1.4, 1, 1, 1, 1, 1, 1, 1], 4, 90, (r, c) => (c ? '' : ['Breakfast', 'Lunch', 'Dinner', 'Snacks'][r]))]);
  add('Planners', 'workout', 'Workout log', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Workout', 'Date'), K.Grid(M, 110, K.W - 2 * M, ['Exercise', 'Sets', 'Reps', 'Weight', 'Notes'], [4, 1, 1, 1.5, 3], 20, 36)]);
  add('Planners', 'travel', 'Travel itinerary', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Trip', 'Destination · Dates'), K.Grid(M, 110, K.W - 2 * M, ['Day', 'Plan', 'Booking'], [1, 6, 3], 10, 56, (r, c) => (c ? '' : K.tf('Day {n}', { n: r + 1 }))), K.T(M, 720, 'Packing list', 17, { b: 1 }), K.Grid(M, 750, K.W - 2 * M, ['☐', 'Item', '☐', 'Item'], [1, 5, 1, 5], 8, 32, (r, c) => (c % 2 ? '' : '☐'))]);

  /* ---------- Creative ---------- */
  add('Creative', 'music', 'Music staff', 'a4', 'p', 'music', 64, 1);
  add('Creative', 'tab', 'Guitar tab', 'a4', 'p', 'tab', 80, 1);
  add('Creative', 'story', 'Storyboard', 'a4', 'l', 'plain', 28, 1, K => { const w = (K.W - 2 * M - 2 * 24) / 3, h = (K.H - 110 - M - 70) / 2 - 40, out = header(K, 'Storyboard', 'Scene'); for (let k = 0; k < 6; k++) { const x = M + (k % 3) * (w + 24), y = 110 + Math.floor(k / 3) * (h + 110); out.push(K.Sh('rect', x, y, w, h, '', { size: 2 }), K.T(x, y + h + 8, K.tf('Shot {n}:', { n: k + 1 }), 13, { color: K.soft }), K.Line(x, y + h + 52, x + w, y + h + 52, { color: K.soft, size: 1 })); } return out; });
  add('Creative', 'comic', 'Comic page', 'a4', 'p', 'plain', 28, 1, K => { const g = 14, w = K.W - 2 * M, h = K.H - 2 * M, r1 = h * .32, r2 = h * .36; return [K.Sh('rect', M, M, w * .6 - g / 2, r1, '', { size: 3 }), K.Sh('rect', M + w * .6 + g / 2, M, w * .4 - g / 2, r1, '', { size: 3 }), K.Sh('rect', M, M + r1 + g, w, r2 - g, '', { size: 3 }), K.Sh('rect', M, M + r1 + r2 + g, w / 3 - g / 2, h - r1 - r2 - g, '', { size: 3 }), K.Sh('rect', M + w / 3 + g / 2, M + r1 + r2 + g, w * 2 / 3 - g / 2, h - r1 - r2 - g, '', { size: 3 })]; });
  add('Creative', 'sketch', 'Sketchbook', 'a4', 'p', 'plain', 28, 1);
  add('Creative', 'mood', 'Mood board', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.H1(40, 20, 'Mood board')]; const sz = [[280, 200], [200, 280], [280, 280], [200, 200], [280, 200], [200, 280]]; let x = 40; sz.forEach(([w, h], k) => { out.push(K.Sh('rect', x, 90 + (k % 2) * 30, w, h, 'Image', { color: K.soft, lineType: 'dashed' })); x += w + 24; }); out.push(K.Sticky(40, 430, 220, 160, 'Colours'), K.Sticky(290, 430, 220, 160, 'Words', K.pastel[2]), K.Sticky(540, 430, 220, 160, 'Textures', K.pastel[3])); return out; });
  add('Creative', 'ideas', 'Ideas & sketches', 'a4', 'p', 'dots', 24, 1.2, K => [...header(K, 'Ideas'), K.Sticky(K.W - M - 200, M, 200, 140, 'Big idea')]);

  /* ---------- Business ---------- */
  add('Business', 'agenda', 'Meeting agenda', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Agenda', 'Meeting · Date · Facilitator'), K.Grid(M, 110, K.W - 2 * M, ['Time', 'Item', 'Lead', 'Outcome'], [1.4, 5, 2, 3], 10, 44)]);
  add('Business', 'kanban', 'Kanban board', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.H1(40, 10, 'Kanban')]; ['To do', 'Doing', 'Review', 'Done'].forEach((t, k) => { const x = 40 + k * 320; out.push(K.Sh('frame', x, 70, 300, 640, t, { color: K.soft })); for (let n = 0; n < (k < 2 ? 2 : 1); n++) out.push(K.Sticky(x + 20, 130 + n * 150, 260, 120, k === 0 ? 'Task' : '', K.pastel[k])); }); return out; });
  add('Business', 'swot', 'SWOT analysis', 'a4', 'l', 'plain', 28, 1, K => { const w = (K.W - 2 * M - 16) / 2, h = (K.H - 110 - M - 16) / 2, out = header(K, 'SWOT analysis'); [['Strengths', 0], ['Weaknesses', 1], ['Opportunities', 2], ['Threats', 3]].forEach(([t, k]) => { const x = M + (k % 2) * (w + 16), y = 110 + Math.floor(k / 2) * (h + 16); out.push(K.Sh('rect', x, y, w, h, '', { fill: K.pastel[k], color: K.soft }), K.T(x + 14, y + 10, t, 20, { b: 1 })); }); return out; });
  add('Business', 'mindmap', 'Mind map', 'inf', 'p', 'plain', 28, 1, K => { const c = K.Sh('ell', 560, 360, 260, 120, 'Main idea', { size: 3, fill: K.pastel[0] }), out = [c]; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 - Math.PI / 2, x = 690 + Math.cos(a) * 420 - 90, y = 420 + Math.sin(a) * 260 - 32, b = K.Sh('btask', x, y, 180, 64, K.tf('Branch {n}', { n: k + 1 }), { fill: K.pastel[(k + 1) % 6] }); out.push(b, K.Conn(c, b, { line: true })); } return out; });
  add('Business', 'fishbone', 'Fishbone (cause and effect)', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.Line(80, 420, 1120, 420, { size: 4 }), K.Sh('rect', 1130, 380, 200, 80, 'Problem', { size: 3 })]; ['People', 'Process', 'Equipment', 'Materials', 'Environment', 'Management'].forEach((t, k) => { const x = 220 + (k % 3) * 300, up = k < 3; out.push(K.Line(x, up ? 160 : 680, x + 140, 420, { size: 2 }), K.T(x - 50, up ? 120 : 690, t, 18, { b: 1 })); }); return out; });
  add('Business', 'brainstorm', 'Brainstorm', 'inf', 'p', 'dots', 28, 1.2, K => { const c = K.Sh('cloud', 520, 300, 320, 200, 'Question?', { size: 3 }); return [c].concat(Array.from({ length: 8 }, (_, k) => { const a = k / 8 * Math.PI * 2; return K.Sticky(680 + Math.cos(a) * 470 - 90, 400 + Math.sin(a) * 300 - 70, 180, 140, '', K.pastel[k % 6]); })); });
  add('Business', 'retro', 'Retrospective', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.H1(40, 10, 'Retrospective')]; [['Went well', 1], ['To improve', 4], ['Actions', 2]].forEach(([t, p], k) => { out.push(K.Sh('frame', 40 + k * 380, 70, 360, 600, t, { color: K.soft }), K.Sticky(60 + k * 380, 130, 320, 120, '', K.pastel[p])); }); return out; });
  add('Business', 'okr', 'OKRs', 'a4', 'p', 'plain', 28, 1, K => [...header(K, 'Objectives & key results', 'Quarter'), ...[0, 1, 2].flatMap(k => [K.Sh('rect', M, 110 + k * 320, K.W - 2 * M, 60, K.tf('Objective {n}', { n: k + 1 }), { fill: K.pastel[k], color: K.soft }), K.Grid(M, 180 + k * 320, K.W - 2 * M, ['Key result', 'Target', 'Now', '%'], [6, 2, 2, 1], 3, 34)])]);
  add('Business', 'gantt', 'Project plan (Gantt)', 'a4', 'l', 'plain', 28, 1, K => [...header(K, 'Project plan', 'Project · Start date'), K.Grid(M, 110, K.W - 2 * M, ['Task', 'Owner'].concat(Array.from({ length: 12 }, (_, k) => 'W' + (k + 1))), [5, 2].concat(Array(12).fill(1)), 14, 36)]);
  add('Business', 'bmc', 'Business model canvas', 'a4', 'l', 'plain', 28, 1, K => { const x0 = M, y0 = 100, w = (K.W - 2 * M) / 5, h1 = (K.H - y0 - M) * .68, h2 = (K.H - y0 - M) - h1, out = header(K, 'Business model canvas'); const box = (x, y, ww, hh, t) => out.push(K.Sh('rect', x, y, ww, hh, '', { color: K.soft }), K.T(x + 8, y + 6, t, 13, { b: 1 }));
    box(x0, y0, w, h1, 'Key partners'); box(x0 + w, y0, w, h1 / 2, 'Key activities'); box(x0 + w, y0 + h1 / 2, w, h1 / 2, 'Key resources'); box(x0 + 2 * w, y0, w, h1, 'Value propositions'); box(x0 + 3 * w, y0, w, h1 / 2, 'Customer relationships'); box(x0 + 3 * w, y0 + h1 / 2, w, h1 / 2, 'Channels'); box(x0 + 4 * w, y0, w, h1, 'Customer segments'); box(x0, y0 + h1, 2.5 * w, h2, 'Cost structure'); box(x0 + 2.5 * w, y0 + h1, 2.5 * w, h2, 'Revenue streams'); return out; });
  add('Business', 'journey', 'User journey map', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.H1(40, 10, 'User journey')]; const stages = ['Discover', 'Try', 'Buy', 'Use', 'Recommend'], rows = ['Doing', 'Thinking', 'Feeling', 'Opportunities']; stages.forEach((s, k) => out.push(K.Sh('btask', 200 + k * 240, 70, 220, 56, s, { fill: K.pastel[k % 6] }))); rows.forEach((r, j) => { out.push(K.T(40, 160 + j * 150, r, 18, { b: 1 })); stages.forEach((s, k) => out.push(K.Sh('rect', 200 + k * 240, 150 + j * 150, 220, 130, '', { color: K.soft, lineType: 'dashed' }))); }); return out; });

  /* ---------- Diagrams ---------- */
  add('Diagrams', 'flow', 'Flowchart starter', 'inf', 'p', 'dots', 28, 1, K => { const a = K.Sh('term', 600, 40, 180, 60, 'Start'), b = K.Sh('rect', 600, 160, 180, 70, 'Step'), c = K.Sh('dia', 590, 290, 200, 110, 'Decision?'), d = K.Sh('rect', 900, 310, 180, 70, 'Other step'), e = K.Sh('term', 600, 470, 180, 60, 'End'); return [a, b, c, d, e, K.Conn(a, b), K.Conn(b, c), K.Conn(c, e, { label: 'yes' }), K.Conn(c, d, { label: 'no', rt: 'orth' })]; });
  add('Diagrams', 'swim', 'Swimlane process', 'inf', 'p', 'plain', 28, 1, K => { const out = [], lanes = ['Customer', 'Sales', 'Warehouse']; lanes.forEach((t, k) => out.push(K.Sh('lane', 40, 40 + k * 180, 1200, 180, t, { color: K.soft }))); const a = K.Sh('term', 140, 95, 160, 60, 'Order'), b = K.Sh('rect', 400, 270, 180, 70, 'Check stock'), c = K.Sh('rect', 700, 450, 180, 70, 'Ship'), d = K.Sh('term', 1000, 95, 160, 60, 'Received'); return out.concat([a, b, c, d, K.Conn(a, b, { rt: 'orth' }), K.Conn(b, c, { rt: 'orth' }), K.Conn(c, d, { rt: 'orth' })]); });
  add('Diagrams', 'org', 'Org chart', 'inf', 'p', 'plain', 28, 1, K => { const top = K.Sh('btask', 560, 40, 220, 70, 'CEO', { fill: K.pastel[2] }), mids = ['Product', 'Development', 'Sales'].map((t, k) => K.Sh('btask', 200 + k * 360, 220, 220, 70, t, { fill: K.pastel[0] })), out = [top, ...mids]; mids.forEach(m => { out.push(K.Conn(top, m, { line: true, rt: 'orth' })); for (let n = 0; n < 2; n++) { const s = K.Sh('rect', m.x - 60 + n * 200, 400, 180, 60, K.tf('Team {n}', { n: n + 1 })); out.push(s, K.Conn(m, s, { line: true, rt: 'orth' })); } }); return out; });
  add('Diagrams', 'uml', 'UML class diagram', 'inf', 'p', 'grid', 28, 1, K => { const a = K.Sh('uclass', 200, 120, 240, 170, 'Customer\n- name: String\n- email: String\n--\n+ placeOrder()'), b = K.Sh('uclass', 700, 120, 240, 170, 'Order\n- id: int\n- total: Money\n--\n+ addItem()\n+ checkout()'); return [a, b, K.Conn(a, b, { line: true, label: 'places  1..*' })]; });
  add('Diagrams', 'er', 'ER diagram', 'inf', 'p', 'grid', 28, 1, K => { const a = K.Sh('ertable', 200, 120, 240, 150, 'customers\nid INT PK\nname TEXT\nemail TEXT'), b = K.Sh('ertable', 700, 120, 240, 170, 'orders\nid INT PK\ncustomer_id INT FK\ntotal DECIMAL\ncreated DATE'); return [a, b, K.Conn(a, b, { line: true, ah0: 'only', ah1: 'zmany' })]; });
  add('Diagrams', 'usecase', 'Use case diagram', 'inf', 'p', 'plain', 28, 1, K => { const sys = K.Sh('frame', 360, 40, 520, 520, 'System', { color: K.soft }), u = K.Sh('uactor', 140, 220, 60, 120, 'User'), c1 = K.Sh('ell', 480, 130, 280, 80, 'Sign in'), c2 = K.Sh('ell', 480, 260, 280, 80, 'Create board'), c3 = K.Sh('ell', 480, 390, 280, 80, 'Share board'); return [sys, u, c1, c2, c3, K.Conn(u, c1, { line: true }), K.Conn(u, c2, { line: true }), K.Conn(u, c3, { line: true })]; });
  add('Diagrams', 'timeline', 'Timeline', 'inf', 'p', 'plain', 28, 1, K => { const out = [K.H1(40, 10, 'Timeline'), K.Line(60, 300, 1340, 300, { size: 4, arrow: true })]; for (let k = 0; k < 6; k++) { const x = 120 + k * 220; out.push(K.Sh('uinit', x - 9, 291, 18, 18, ''), K.Sh('btask', x - 90, k % 2 ? 340 : 170, 180, 90, K.tf('Milestone {n}', { n: k + 1 }), { fill: K.pastel[k % 6] })); } return out; });
  add('Diagrams', 'schema', 'Database schema', 'inf', 'p', 'dots', 28, 1, K => {
    const c = K.Sh('ertable', 60, 120, 260, 150, 'customers\nid SERIAL PK\nemail VARCHAR(255) NN UQ\nname TEXT'), o = K.Sh('ertable', 460, 60, 280, 170, 'orders\nid SERIAL PK\ncustomer_id INT FK NN\ntotal NUMERIC(10,2)\ncreated_at TIMESTAMP'),
      p = K.Sh('ertable', 460, 320, 280, 150, 'products\nid SERIAL PK\nsku VARCHAR(40) UQ\nprice NUMERIC(10,2)'), i = K.Sh('ertable', 880, 180, 260, 150, 'order_items\norder_id INT PK FK\nproduct_id INT PK FK\nqty INT NN');
    return [K.H1(60, 10, 'Database schema'), c, o, p, i, K.Conn(o, c, { line: true, rt: 'orth', ah0: 'zmany', ah1: 'only' }), K.Conn(i, o, { line: true, rt: 'orth', ah0: 'zmany', ah1: 'only' }), K.Conn(i, p, { line: true, rt: 'orth', ah0: 'zmany', ah1: 'only' })];
  });
  add('Diagrams', 'cloud', 'Cloud architecture', 'inf', 'p', 'dots', 28, 1, K => {
    const I = (k, x, y, t) => K.Sh(k, x, y, 72, 72, t), u = I('iuser', 40, 220, 'Users'), cdn = I('iglobe', 220, 220, 'CDN'), reg = K.Sh('frame', 380, 80, 700, 420, 'Region', { color: K.soft, lineType: 'dashed' }),
      lb = I('ilb', 430, 220, 'Load balancer'), s1 = I('iserver', 640, 140, 'App server'), s2 = I('iserver', 640, 320, 'App server'), db = K.Sh('cyl', 880, 140, 90, 100, 'Database'), ca = I('icache', 890, 330, 'Cache'),
      q = I('iqueue', 640, 560, 'Message queue'), f = I('ifunc', 890, 560, 'Worker function'), mon = I('imon', 220, 520, 'Monitoring');
    return [K.H1(40, 10, 'Cloud architecture'), reg, u, cdn, lb, s1, s2, db, ca, q, f, mon, K.Conn(u, cdn), K.Conn(cdn, lb), K.Conn(lb, s1, { rt: 'orth' }), K.Conn(lb, s2, { rt: 'orth' }), K.Conn(s1, db), K.Conn(s2, ca), K.Conn(s2, q, { rt: 'orth' }), K.Conn(q, f)];
  });
  add('Diagrams', 'network', 'Office network', 'inf', 'p', 'plain', 28, 1, K => {
    const I = (k, x, y, t) => K.Sh(k, x, y, 72, 72, t), net = I('iglobe', 60, 260, 'Internet'), r = I('irouter', 240, 260, 'Router'), fw = I('ifw', 420, 260, 'Firewall'), sw = I('iswitch', 600, 260, 'Switch'),
      srv = I('iserver', 800, 60, 'File server'), ap = I('iap', 800, 200, 'Wi-Fi'), pc = I('ipc', 800, 340, 'Desktop'), pr = I('iprinter', 800, 480, 'Printer'), lp = I('ilaptop', 1000, 200, 'Laptop'), ph = I('imobile', 1000, 330, 'Phone');
    return [K.H1(60, 10, 'Office network'), net, r, fw, sw, srv, ap, pc, pr, lp, ph, K.Conn(net, r, { line: true }), K.Conn(r, fw, { line: true }), K.Conn(fw, sw, { line: true }), ...[srv, ap, pc, pr].map(d => K.Conn(sw, d, { line: true, rt: 'orth', s0: 'e', s1: 'w' })), Object.assign(K.Conn(ap, lp, { line: true }), { lineType: 'dashed' }), Object.assign(K.Conn(ap, ph, { line: true }), { lineType: 'dashed' })];
  });
  add('Diagrams', 'c4', 'C4 context diagram', 'inf', 'p', 'plain', 28, 1, K => {
    const p = K.Sh('c4person', 520, 40, 200, 160, 'Customer', { fill: K.pastel[2] }), s = K.Sh('c4sys', 470, 300, 300, 140, 'Online shop', { fill: K.pastel[2], size: 3 }),
      pay = K.Sh('c4ext', 100, 320, 260, 120, 'Payment provider'), mail = K.Sh('c4ext', 880, 320, 260, 120, 'Email service');
    return [K.H1(40, 10, 'System context'), p, s, pay, mail, K.Conn(p, s, { label: 'Places orders' }), K.Conn(s, pay, { label: 'Takes payments' }), K.Conn(s, mail, { label: 'Sends emails' })];
  });

  /* builds a template's items for the given paper. newId() makes unique ids (the app passes its own); tr() translates labels. */
  function build(tpl, dark, newId, tr) {
    let n = 0;
    const K = kit(tpl.size, tpl.o, !!dark, newId || (() => 'tpl' + (++n)), tr);
    let items;
    try { items = tpl.build(K) || []; } catch (e) { items = []; }
    return items.filter(i => i && typeof i === 'object');
  }
  const byId = id => L.find(t => t.id === id) || null;

  return { TEMPLATES: L, CATS, PSZ, pageSize, build, byId };
});
