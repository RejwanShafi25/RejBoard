/* RejBoard diagram interchange: PlantUML text and draw.io (diagrams.net) files, in and out. No DOM in here, so it runs in the
   app (as the global `InteropCore`) and under `node --test`.

   Both readers return plain data that the app turns into board items:
   PlantUML -> {kind: 'graph' | 'sequence', dir, nodes: [{id, label, type}], edges: [{from, to, label, ah0, ah1, dashed, m0, m1}],
                participants: [{id, label, type}], messages: [{from, to, label, dashed}], errors}
   draw.io  -> {pages: [{name, nodes: [{id, kind, x, y, w, h, label, fill, stroke, font, sw, dashed, text}],
                edges: [{id, source, target, sp, tp, points, label, ah0, ah1, orth, curved, dashed, stroke, sw}]}], errors} */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InteropCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIM = { text: 2000000, nodes: 2000, edges: 4000, label: 400 };
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n || LIM.label);

  /* ======================= PlantUML ======================= */
  const ELEM = { class: 'class', 'abstract class': 'class', abstract: 'class', interface: 'interface', enum: 'enum', annotation: 'class', entity: 'entity', object: 'class', struct: 'class',
    actor: 'actor', usecase: 'usecase', component: 'component', node: 'node', database: 'database', cloud: 'cloud', rectangle: 'rect', package: 'package', folder: 'package',
    frame: 'package', artifact: 'doc', file: 'doc', card: 'rect', queue: 'queue', storage: 'database', boundary: 'rect', control: 'ell', collections: 'rect',
    agent: 'rect', person: 'actor', state: 'state', participant: 'rect', label: 'text', hexagon: 'hexagon', stack: 'rect', process: 'rect', action: 'rect' };
  const SEQ_DECL = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+/i;
  /* an arrow: optional left head, a run of - or . (with an optional [style] and direction word inside), optional right head */
  const ARROW = /(<\|?|\*|o|#|x|\+|\}|\{|\^)?((?:-+|\.+)(?:\[[^\]]*\])?(?:up|down|left|right|le|ri|do|u|d|l|r)?(?:\[[^\]]*\])?(?:-+|\.+)?)(\|?>|\*|o|#|x|\+|\{|\})?/;
  const HEADMAP = { '<|': 'htri', '|>': 'htri', '*': 'diamond', o: 'hdiamond', '<': 'arrow', '>': 'arrow', '#': 'bar', x: 'bar', '+': 'circle', '}': 'many', '{': 'many', '^': 'htri' };

  function plantLines(text) {
    let t = String(text || '').slice(0, LIM.text).replace(/\r/g, '');
    t = t.replace(/\/'[\s\S]*?'\//g, ''); /* block comments */
    const out = [];
    for (let l of t.split('\n')) {
      l = l.trim();
      if (!l || /^'/.test(l) || /^@(start|end)\w*/i.test(l) || /^!/.test(l) || /^(skinparam|title|caption|header|footer|legend|hide|show|scale|autonumber|activate|deactivate|destroy|return|newpage|box|end box|== .* ==|\.\.\.|\|\|\|)/i.test(l)) continue;
      out.push(l);
    }
    return out;
  }
  const unq = s => String(s || '').trim().replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n');
  /* "Name", Name, "Long name" as N, (Use case), [Component], :Actor: -> {id, label, type?} */
  function plantRef(s) {
    s = String(s || '').trim();
    let m;
    if ((m = /^\((.+?)\)(?:\s+as\s+(\S+))?$/.exec(s))) return { id: m[2] || m[1], label: unq(m[1]), type: 'usecase' };
    if ((m = /^\[(.+?)\](?:\s+as\s+(\S+))?$/.exec(s))) return { id: m[2] || m[1], label: unq(m[1]), type: 'component' };
    if ((m = /^:(.+?):(?:\s+as\s+(\S+))?$/.exec(s))) return { id: m[2] || m[1], label: unq(m[1]), type: 'actor' };
    if ((m = /^("[^"]+"|\S+)\s+as\s+("[^"]+"|\S+)$/.exec(s))) {
      const a = unq(m[1]), b = unq(m[2]);
      return /^"/.test(m[1]) ? { id: b, label: a } : { id: a, label: b };
    }
    if ((m = /^"([^"]+)"$/.exec(s))) return { id: m[1], label: m[1] };
    return { id: s.replace(/<<.*>>/, '').trim(), label: s.replace(/<<.*>>/, '').trim() };
  }

  function parsePlantUML(text) {
    const L = plantLines(text), errors = [];
    /* a sequence diagram: "participant" lines, or only plain "A -> B : message" arrows and no class / use case / component vocabulary */
    const graphish = l => /^(class|interface|enum|abstract|usecase|component|node|package|rectangle|cloud|object|state|artifact|folder|frame|left to right)\b/i.test(l) ||
      /^\s*[([:]/.test(l) || /<\||\|>|\*--|--\*|o--|--o|\.\.>|<\.\./.test(l);
    const seq = L.some(l => /^participant\b/i.test(l)) || (!L.some(graphish) && L.some(l => /^("[^"]+"|[^\s<>:-]+)\s*-{1,2}>{1,2}\s*("[^"]+"|[^\s:]+)\s*:/.test(l)));
    return seq ? plantSeq(L, errors) : plantGraph(L, errors);
  }
  function plantGraph(L, errors) {
    const nodes = [], byId = new Map(), edges = [];
    let dir = 'TB';
    const node = (r, type) => {
      if (!r || !r.id) return null;
      let n = byId.get(r.id);
      if (!n) { if (nodes.length >= LIM.nodes) return null; n = { id: clip(r.id, 120), label: clip(r.label || r.id), type: type || r.type || 'class', members: [] }; nodes.push(n); byId.set(r.id, n); }
      else { if (type && n.type === 'class' && type !== 'class') n.type = type; if (r.label && r.label !== r.id && n.label === n.id) n.label = clip(r.label); }
      return n;
    };
    let open = null; /* the class whose { ... } body we are in */
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (open) { if (l === '}' || /^}/.test(l)) { open = null; continue; } if (!/^(--|==|\.\.|__)/.test(l)) open.members.push(clip(l, 120)); continue; }
      if (/^left to right direction$/i.test(l)) { dir = 'LR'; continue; }
      if (/^top to bottom direction$/i.test(l)) { dir = 'TB'; continue; }
      if (/^note\b/i.test(l)) { if (!/:/.test(l)) while (k < L.length && !/^end ?note$/i.test(L[k])) k++; continue; }
      if (l === '}' || /^end\b/i.test(l)) continue;
      let m;
      /* element declarations: kind name [as alias] [<<stereotype>>] [#colour] [{] */
      if ((m = /^(abstract class|abstract|class|interface|enum|annotation|entity|object|struct|actor|usecase|component|node|database|cloud|rectangle|package|folder|frame|artifact|file|card|queue|storage|boundary|control|collections|agent|person|state|hexagon|stack|process|action)\s+(.+?)\s*(\{)?\s*$/i.exec(l))) {
        const kind = m[1].toLowerCase(), body = m[2].replace(/<<[^>]*>>/g, '').replace(/#\S+/g, '').trim();
        if (/^(package|folder|frame|rectangle|node|cloud)$/.test(kind) && m[3]) continue; /* groups: their contents are read, the group itself is not drawn */
        const n = node(plantRef(body.replace(/\s*\{$/, '')), ELEM[kind]);
        if (m[3] && n) open = n;
        continue;
      }
      /* relations: A "1" --> "*" B : label */
      const a = ARROW.exec(l);
      if (a) {
        const left = l.slice(0, a.index).trim(), rest = l.slice(a.index + a[0].length), colon = rest.indexOf(':');
        const rightRaw = (colon >= 0 ? rest.slice(0, colon) : rest).trim(), label = colon >= 0 ? unq(rest.slice(colon + 1).replace(/^\s*[<>]\s*|\s*[<>]\s*$/g, '')) : '';
        const mq = /^(.*?)\s*"([^"]*)"$/.exec(left), rq = /^"([^"]*)"\s*(.*)$/.exec(rightRaw);
        const lref = mq ? mq[1] : left, rref = rq ? rq[2] : rightRaw;
        if (!lref || !rref || /^[-.]/.test(rref)) { errors.push('Skipped: ' + clip(l, 60)); continue; }
        const A = node(plantRef(lref)), B = node(plantRef(rref));
        if (!A || !B || edges.length >= LIM.edges) continue;
        edges.push({ from: A.id, to: B.id, label: clip(label), ah0: HEADMAP[a[1]] || 'none', ah1: HEADMAP[a[3]] || 'none', dashed: /\./.test(a[2]), m0: mq ? mq[2] : '', m1: rq ? rq[1] : '' });
        continue;
      }
      /* Class : member */
      if ((m = /^([\w.$]+)\s*:\s*(.+)$/.exec(l)) && byId.has(m[1])) { byId.get(m[1]).members.push(clip(m[2], 120)); continue; }
      if (/^[\w"]/.test(l)) errors.push('Skipped: ' + clip(l, 60));
    }
    for (const n of nodes) if (!n.members.length) delete n.members;
    return { kind: 'graph', dir, nodes, edges, errors };
  }
  function plantSeq(L, errors) {
    const participants = [], byId = new Map(), messages = [];
    const part = (r, type) => {
      if (!r || !r.id) return null;
      let p = byId.get(r.id);
      if (!p) { if (participants.length >= 60) return null; p = { id: clip(r.id, 120), label: clip(r.label || r.id), type: type || 'participant' }; participants.push(p); byId.set(r.id, p); }
      return p;
    };
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      let m;
      if (/^note\b/i.test(l)) { if (!/:/.test(l)) while (k < L.length && !/^end ?note$/i.test(L[k])) k++; continue; }
      if (/^(alt|else|opt|loop|par|break|critical|group|end|ref)\b/i.test(l)) continue;
      if ((m = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+?)(?:\s+order\s+\d+)?(?:\s+#\S+)?$/i.exec(l))) { part(plantRef(m[2].replace(/<<[^>]*>>/g, '').trim()), m[1].toLowerCase()); continue; }
      if ((m = /^([^\s<>\-]+|"[^"]+")\s*(<?)(-{1,2}|\.{1,2})(?:\[[^\]]*\])?(>{1,2}|\\\\?|\/\/?|x|o)?(?:o)?\s*([^\s:]+|"[^"]+")\s*(?::\s*(.*))?$/.exec(l))) {
        let A = part(plantRef(m[1])), B = part(plantRef(m[5]));
        if (!A || !B) continue;
        if (m[2] === '<' && !m[4]) [A, B] = [B, A];
        if (messages.length < LIM.edges) messages.push({ from: A.id, to: B.id, label: clip(unq(m[6] || '')), dashed: m[3].length > 1 || /\./.test(m[3]) });
        continue;
      }
      if (/\S/.test(l)) errors.push('Skipped: ' + clip(l, 60));
    }
    return { kind: 'sequence', participants, messages, errors };
  }

  /* ---- PlantUML out ---- */
  const pid = (s, k) => /^[A-Za-z_][\w]*$/.test(s) ? s : 'E' + (k + 1);
  const pq = s => '"' + String(s).replace(/"/g, "'").replace(/\n/g, '\\n') + '"';
  const HEAD_OUT_L = { htri: '<|', diamond: '*', hdiamond: 'o', arrow: '<', bar: '#', circle: '+', many: '}' }, HEAD_OUT_R = { htri: '|>', diamond: '*', hdiamond: 'o', arrow: '>', bar: '#', circle: '+', many: '{' };
  /* nodes: [{id, label, type, members?}], edges: [{from, to, label, ah0, ah1, dashed, m0, m1}] */
  function toPlantUML(m) {
    const out = ['@startuml'];
    if (m.kind === 'sequence') {
      const ids = new Map();
      (m.participants || []).forEach((p, k) => { const id = pid(p.label.replace(/\s+/g, '_'), k); ids.set(p.id, id); out.push((p.type === 'actor' ? 'actor ' : 'participant ') + (id === p.label ? id : pq(p.label) + ' as ' + id)); });
      for (const g of m.messages || []) if (ids.has(g.from) && ids.has(g.to)) out.push(ids.get(g.from) + (g.dashed ? ' --> ' : ' -> ') + ids.get(g.to) + (g.label ? ' : ' + g.label.replace(/\n/g, ' ') : ''));
      out.push('@enduml');
      return out.join('\n') + '\n';
    }
    if (m.dir === 'LR') out.push('left to right direction');
    const ids = new Map();
    (m.nodes || []).forEach((n, k) => {
      const id = pid(String(n.label).split('\n')[0].replace(/\s+/g, '_'), k);
      const uniq = [...ids.values()].includes(id) ? id + '_' + (k + 1) : id;
      ids.set(n.id, uniq);
      const kw = { class: 'class', interface: 'interface', enum: 'enum', actor: 'actor', usecase: 'usecase', component: 'component', node: 'node', database: 'database', cloud: 'cloud', package: 'package', doc: 'artifact', queue: 'queue', state: 'state', hexagon: 'hexagon', ell: 'usecase', entity: 'entity' }[n.type] || 'rectangle';
      const name = String(n.label).split('\n')[0];
      const head = kw + ' ' + (name === uniq ? uniq : pq(name) + ' as ' + uniq);
      out.push(n.members && n.members.length ? head + ' {\n' + n.members.map(x => '  ' + x).join('\n') + '\n}' : head);
    });
    for (const e of m.edges || []) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      const line = e.dashed ? '..' : '--';
      out.push(ids.get(e.from) + (e.m0 ? ' ' + pq(e.m0) : '') + ' ' + (HEAD_OUT_L[e.ah0] || '') + line + (HEAD_OUT_R[e.ah1] || '') + ' ' + (e.m1 ? pq(e.m1) + ' ' : '') + ids.get(e.to) + (e.label ? ' : ' + e.label.replace(/\n/g, ' ') : ''));
    }
    out.push('@enduml');
    return out.join('\n') + '\n';
  }

  /* ======================= draw.io ======================= */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const unent = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] != null ? ENT[e] : m));
  const ent = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xa;');
  const attrs = s => { const o = {}; s.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (m, k, v) => { o[k] = unent(v); }); return o; };
  const style = s => { const o = {}; String(s || '').split(';').forEach((p, k) => { if (!p) return; const e = p.indexOf('='); if (e < 0) o[k === 0 ? '_' + p : p] = '1'; else o[p.slice(0, e)] = p.slice(e + 1); if (k === 0 && e < 0) o._base = p; }); return o; };
  /* html labels to plain text: line breaks kept, tags dropped */
  const plain = s => unent(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(div|p|li|tr)\b[^>]*>/gi, '\n').replace(/<hr[^>]*>/gi, '\n--\n').replace(/<[^>]+>/g, '')).replace(/ /g, ' ').split('\n').map(x => x.trim()).filter(Boolean).join('\n');

  /* the pages of a .drawio / .xml file: each with its model XML, or the compressed text that still needs inflating */
  function drawioPages(xml) {
    const s = String(xml || '').slice(0, LIM.text * 5);
    if (/^\s*<mxGraphModel/.test(s)) return [{ name: 'Page-1', model: s }];
    const pages = [], re = /<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g;
    let m;
    while ((m = re.exec(s))) {
      const a = attrs(m[1]), body = m[2].trim();
      pages.push(/<mxGraphModel/.test(body) ? { name: a.name || 'Page', model: body } : { name: a.name || 'Page', compressed: body });
    }
    if (!pages.length && /<mxGraphModel/.test(s)) pages.push({ name: 'Page-1', model: s.slice(s.indexOf('<mxGraphModel')) });
    return pages;
  }
  /* compressed pages: base64 -> raw deflate -> URI-encoded XML. inflateRaw(bytes) -> bytes is supplied by the caller. */
  function b64bytes(b) { const t = typeof atob === 'function' ? atob(b.replace(/\s+/g, '')) : Buffer.from(b, 'base64').toString('binary'); const u = new Uint8Array(t.length); for (let k = 0; k < t.length; k++) u[k] = t.charCodeAt(k); return u; }
  function decodePage(compressed, inflateRaw) {
    const bytes = inflateRaw(b64bytes(compressed));
    let s = ''; for (let k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
    try { return decodeURIComponent(s); } catch (e) { return s; }
  }

  /* draw.io shape style -> board shape kind */
  function kindOf(st) {
    const sh = st.shape || '', b = st._base || '';
    const has = k => b === k || st['_' + k] || sh === k;
    if (st.swimlane || b === 'swimlane' || sh === 'swimlane') return st.childLayout === 'stackLayout' ? 'class' : 'frame';
    if (/^table$/.test(sh)) return 'class';
    if (has('text') || b === 'text' || st.text) return 'text';
    if (/umlActor/.test(sh)) return 'uactor';
    if (/umlLifeline/.test(sh)) return 'ulife';
    if (/cylinder|datastore|database/i.test(sh)) return 'cyl';
    if (/cloud/i.test(sh) || has('cloud')) return 'cloud';
    if (/terminator/.test(sh)) return 'term';
    if (/decision/.test(sh) || has('rhombus')) return 'dia';
    if (/^(ellipse|mxgraph\.flowchart\.(start_1|start_2|on-page_reference))$/.test(sh) || has('ellipse') || has('doubleEllipse')) return 'ell';
    if (/predefined|process$/.test(sh) && /process/.test(sh)) return 'subp';
    if (/document/.test(sh)) return 'doc';
    if (/multi.?document/i.test(sh)) return 'mdoc';
    if (/parallelogram|data$/.test(sh)) return 'para';
    if (/trapezoid/.test(sh)) return 'trap';
    if (/hexagon|preparation/.test(sh)) return 'hex';
    if (has('triangle') || /triangle/.test(sh)) return 'tri';
    if (/note/.test(sh)) return 'unote';
    if (/card/.test(sh)) return 'card';
    if (/delay/.test(sh)) return 'delay';
    if (/manual_input|manualInput/.test(sh)) return 'manin';
    if (/display/.test(sh)) return 'disp';
    if (/off.?page/.test(sh)) return 'offp';
    if (/umlFrame/.test(sh)) return 'uframe';
    if (/folder|umlPackage/.test(sh)) return 'upkg';
    if (/component/.test(sh)) return 'ucomp';
    if (has('image') || st.image) return 'image';
    if (st.rounded === '1') return 'btask';
    return 'rect';
  }
  const AH_IN = { none: 'none', classic: 'tri', classicThin: 'tri', block: 'tri', blockThin: 'tri', open: 'arrow', openThin: 'arrow', openAsync: 'arrow', async: 'arrow', oval: 'circle', diamond: 'diamond', diamondThin: 'diamond', dash: 'bar', cross: 'bar',
    ERone: 'one', ERmandOne: 'only', ERmany: 'many', ERzeroToOne: 'zone', ERoneToMany: 'omany', ERzeroToMany: 'zmany', box: 'bar', halfCircle: 'circle' };
  function head(kind, fill) { const k = AH_IN[kind]; if (!k) return kind ? 'arrow' : null; if (fill === '0' && k === 'tri') return 'htri'; if (fill === '0' && k === 'diamond') return 'hdiamond'; return k; }
  const colour = v => (v && v !== 'none' && /^#[0-9a-f]{3,8}$/i.test(v)) ? v : (v === 'none' ? 'none' : null);

  function parseModel(model) {
    const cells = [], src = String(model);
    /* <mxCell .../> or <mxCell ...>...</mxCell>, possibly wrapped in <UserObject>/<object> that carries the label and id */
    const re = /<(UserObject|object)\b([^>]*)>\s*<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)\s*<\/\1>|<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
    let m;
    while ((m = re.exec(src))) {
      let a, inner;
      if (m[1]) { const w = attrs(m[2]); a = attrs(m[3]); inner = m[4] || ''; a.id = w.id || a.id; if (w.label != null) a.value = w.label; else if (w.value != null) a.value = w.value; }
      else { a = attrs(m[5]); inner = m[6] || ''; }
      const g = /<mxGeometry\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxGeometry>)/.exec(inner), ga = g ? attrs(g[1]) : {}, gi = g ? (g[2] || '') : '';
      const pt = as => { const q = new RegExp('<mxPoint\\b([^>]*as="' + as + '"[^>]*)\\/?>').exec(gi); if (!q) return null; const p = attrs(q[1]); return [+p.x || 0, +p.y || 0]; };
      const arr = /<Array\b[^>]*as="points"[^>]*>([\s\S]*?)<\/Array>/.exec(gi), pts = [];
      if (arr) arr[1].replace(/<mxPoint\b([^>]*)\/?>/g, (x, q) => { const p = attrs(q); pts.push([+p.x || 0, +p.y || 0]); });
      cells.push({ a, geo: { x: +ga.x || 0, y: +ga.y || 0, w: +ga.width || 0, h: +ga.height || 0, rel: ga.relative === '1' }, sp: pt('sourcePoint'), tp: pt('targetPoint'), pts });
      if (cells.length > LIM.nodes + LIM.edges + 100) break;
    }
    const byId = new Map(cells.map(c => [c.a.id, c]));
    /* absolute position: children of shapes are placed relative to them (layers 0/1 are not shapes) */
    const abs = c => { let x = c.geo.x, y = c.geo.y, p = byId.get(c.a.parent), guard = 0; while (p && p.a.vertex === '1' && guard++ < 50) { x += p.geo.x; y += p.geo.y; p = byId.get(p.a.parent); } return [x, y]; };
    const nodes = [], edges = [], used = new Set();
    /* class / table: a stack-layout swimlane whose child rows are the members */
    for (const c of cells) {
      if (c.a.vertex !== '1' || used.has(c.a.id) || (byId.get(c.a.parent) && byId.get(c.a.parent).a.edge === '1')) continue; /* edge labels are read with their edge */
      const st = style(c.a.style), kind = kindOf(st);
      const [x, y] = abs(c);
      let label = plain(c.a.value);
      if (kind === 'class') {
        const rows = cells.filter(q => q.a.parent === c.a.id && q.a.vertex === '1').sort((p, q) => p.geo.y - q.geo.y);
        rows.forEach(q => used.add(q.a.id));
        const lines = [];
        for (const q of rows) { const qs = style(q.a.style); if (/line/.test(qs.shape || '') || qs._line || (qs._base === 'line')) { lines.push('--'); continue; } const t = plain(q.a.value); if (t) lines.push(...t.split('\n')); }
        label = [label].concat(lines).join('\n').replace(/^\n+/, '');
      }
      if (nodes.length >= LIM.nodes) break;
      const img = kind === 'image' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(st.image || '') ? st.image.replace(/^(data:image\/[\w+]+),(?!base64)/, '$1;base64,') : null;
      nodes.push({ id: c.a.id, kind: kind === 'image' && !img ? 'rect' : kind, x, y, w: c.geo.w, h: c.geo.h, label: clip(label, 2000), fill: colour(st.fillColor), stroke: colour(st.strokeColor), font: colour(st.fontColor),
        sw: +st.strokeWidth || null, fs: +st.fontSize || null, dashed: st.dashed === '1', rounded: st.rounded === '1', img, rot: +st.rotation || 0, parent: byId.get(c.a.parent) && byId.get(c.a.parent).a.vertex === '1' ? c.a.parent : null });
    }
    for (const c of cells) {
      if (c.a.edge !== '1' || edges.length >= LIM.edges) continue;
      const st = style(c.a.style);
      const labels = [plain(c.a.value)].concat(cells.filter(q => q.a.parent === c.a.id && q.a.vertex === '1').map(q => plain(q.a.value))).filter(Boolean);
      const off = p => { if (!p) return null; const par = byId.get(c.a.parent); if (par && par.a.vertex === '1') { const [px, py] = abs(par); return [p[0] + px, p[1] + py]; } return p; };
      edges.push({ id: c.a.id, source: byId.has(c.a.source) ? c.a.source : null, target: byId.has(c.a.target) ? c.a.target : null, sp: off(c.sp), tp: off(c.tp), points: c.pts.map(off),
        label: clip(labels.join('\n')), ah0: head(st.startArrow || 'none', st.startFill), ah1: head(st.endArrow == null ? 'classic' : st.endArrow, st.endFill),
        orth: /orthogonal|elbow|entityRelation/i.test(st.edgeStyle || ''), curved: st.curved === '1', dashed: st.dashed === '1', stroke: colour(st.strokeColor), sw: +st.strokeWidth || null });
    }
    /* labels inside edges were consumed; drop their cells from the shapes */
    const edgeIds = new Set(edges.map(e => e.id));
    return { nodes: nodes.filter(n => !edgeIds.has(n.parent) && !(n.kind === 'text' && !n.label)), edges };
  }
  /* reads a .drawio file. inflateRaw is needed only for compressed pages. */
  function parseDrawio(xml, inflateRaw) {
    const errors = [], pages = [];
    for (const p of drawioPages(xml)) {
      let model = p.model;
      if (!model) {
        if (!inflateRaw) { errors.push('Compressed page skipped: ' + p.name); continue; }
        try { model = decodePage(p.compressed, inflateRaw); } catch (e) { errors.push('Could not read page ' + p.name); continue; }
      }
      const r = parseModel(model);
      pages.push(Object.assign({ name: clip(p.name, 120) }, r));
    }
    if (!pages.length && !errors.length) errors.push('No draw.io diagram found');
    return { pages, errors };
  }

  /* ---- draw.io out (uncompressed, so the file is readable and diffable) ---- */
  const STYLE_OUT = {
    rect: 'rounded=0;whiteSpace=wrap;html=1;', btask: 'rounded=1;whiteSpace=wrap;html=1;', ell: 'ellipse;whiteSpace=wrap;html=1;', dia: 'rhombus;whiteSpace=wrap;html=1;',
    tri: 'triangle;whiteSpace=wrap;html=1;direction=north;', cyl: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=12;', cloud: 'ellipse;shape=cloud;whiteSpace=wrap;html=1;',
    term: 'strokeWidth=2;html=1;shape=mxgraph.flowchart.terminator;whiteSpace=wrap;', doc: 'shape=document;whiteSpace=wrap;html=1;boundedLbl=1;', mdoc: 'shape=mxgraph.flowchart.multi-document;whiteSpace=wrap;html=1;',
    subp: 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;', para: 'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;',
    trap: 'shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;fixedSize=1;', hex: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;',
    prep: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;', unote: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;', card: 'shape=card;whiteSpace=wrap;html=1;',
    delay: 'shape=delay;whiteSpace=wrap;html=1;', manin: 'shape=manualInput;whiteSpace=wrap;html=1;', disp: 'shape=display;whiteSpace=wrap;html=1;', offp: 'shape=offPageConnector;whiteSpace=wrap;html=1;',
    uactor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;', ulife: 'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=0;collapsible=0;size=40;',
    uframe: 'shape=umlFrame;whiteSpace=wrap;html=1;', upkg: 'shape=folder;fontStyle=1;spacingTop=10;tabWidth=40;tabHeight=14;tabPosition=left;html=1;', ucomp: 'shape=component;align=left;spacingLeft=36;html=1;',
    frame: 'swimlane;whiteSpace=wrap;html=1;', lane: 'swimlane;horizontal=0;whiteSpace=wrap;html=1;', text: 'text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;', sticky: 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;fillColor=#fff2cc;',
    comp: 'verticalAlign=top;align=left;overflow=fill;html=1;whiteSpace=wrap;', icon: 'rounded=1;whiteSpace=wrap;html=1;verticalLabelPosition=bottom;verticalAlign=top;'
  };
  const AH_OUT = { none: ['none', 1], arrow: ['open', 1], tri: ['block', 1], htri: ['block', 0], circle: ['oval', 1], diamond: ['diamond', 1], hdiamond: ['diamond', 0], bar: ['dash', 1],
    one: ['ERone', 0], only: ['ERmandOne', 0], many: ['ERmany', 0], zone: ['ERzeroToOne', 0], omany: ['ERoneToMany', 0], zmany: ['ERzeroToMany', 0] };
  /* nodes: [{id, kind, x, y, w, h, label, fill, stroke, font, sw, dashed, comp, img}], edges: [{id, source, target, sp, tp, label, ah0, ah1, orth, dashed, stroke, sw}] */
  function toDrawio(m, name) {
    const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
    const r = v => Math.round(v * 100) / 100, id = s => 'rb-' + String(s).replace(/[^\w-]/g, '_');
    for (const n of m.nodes || []) {
      let st = n.img ? 'shape=image;html=1;imageAspect=0;aspect=fixed;image=' + n.img.replace(/;base64/, '') + ';' : (STYLE_OUT[n.comp ? 'comp' : n.kind] || STYLE_OUT.rect);
      if (n.fill && n.fill !== 'none') st += 'fillColor=' + n.fill + ';'; else if (n.kind !== 'text' && n.kind !== 'sticky') st += 'fillColor=none;';
      if (n.stroke) st += 'strokeColor=' + n.stroke + ';';
      if (n.font) st += 'fontColor=' + n.font + ';';
      if (n.sw) st += 'strokeWidth=' + r(n.sw) + ';';
      if (n.dashed) st += 'dashed=1;';
      if (n.size) st += 'fontSize=' + Math.round(n.size) + ';';
      const val = n.comp ? compHtml(n.label) : htmlVal(n.label);
      cells.push(`<mxCell id="${id(n.id)}" value="${val}" style="${st}" vertex="1" parent="1"><mxGeometry x="${r(n.x)}" y="${r(n.y)}" width="${r(n.w)}" height="${r(n.h)}" as="geometry"/></mxCell>`);
    }
    for (const e of m.edges || []) {
      const [a0, f0] = AH_OUT[e.ah0] || AH_OUT.none, [a1, f1] = AH_OUT[e.ah1] || AH_OUT.none;
      let st = (e.orth ? 'edgeStyle=orthogonalEdgeStyle;rounded=0;' : e.curved ? 'curved=1;' : '') + `html=1;startArrow=${a0};startFill=${f0};endArrow=${a1};endFill=${f1};`;
      if (e.dashed) st += 'dashed=1;';
      if (e.stroke) st += 'strokeColor=' + e.stroke + ';';
      if (e.sw) st += 'strokeWidth=' + r(e.sw) + ';';
      const ends = (e.source ? '' : e.sp ? `<mxPoint x="${r(e.sp[0])}" y="${r(e.sp[1])}" as="sourcePoint"/>` : '') + (e.target ? '' : e.tp ? `<mxPoint x="${r(e.tp[0])}" y="${r(e.tp[1])}" as="targetPoint"/>` : '');
      cells.push(`<mxCell id="${id(e.id)}" value="${htmlVal(e.label)}" style="${st}" edge="1" parent="1"${e.source ? ` source="${id(e.source)}"` : ''}${e.target ? ` target="${id(e.target)}"` : ''}><mxGeometry relative="1" as="geometry">${ends}</mxGeometry></mxCell>`);
    }
    return `<mxfile host="RejBoard" agent="RejBoard"><diagram name="${ent(name || 'Page-1')}" id="rejboard"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>\n`;
  }
  /* labels are html in draw.io (html=1): text is escaped as html, then as an attribute */
  const htmlVal = t => ent(String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'));
  /* a class / table label as draw.io html: bold name, a rule, then the rows (a "--" line is another rule) */
  function compHtml(label) {
    const L = String(label || '').split('\n'), esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = '<p style="margin:0px;margin-top:4px;text-align:center;"><b>' + esc(L[0] || '') + '</b></p><hr size="1"/>' +
      L.slice(1).map(t => t === '--' ? '<hr size="1"/>' : '<p style="margin:0px;margin-left:4px;">' + esc(t) + '</p>').join('');
    return ent(html);
  }

  return { parsePlantUML, toPlantUML, parseDrawio, toDrawio, drawioPages, decodePage, kindOf, style, plain, LIM };
});
