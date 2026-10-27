/* RejBoard database schemas: SQL (CREATE TABLE / ALTER TABLE) and DBML (dbdiagram.io) in and out. No DOM in here, so it runs
   in the app (as the global `SchemaCore`) and under `node --test`.

   The model: {tables: [{name, columns: [{name, type, pk, nn, uq, fk, def}]}], refs: [{from: {table, column}, to: {table, column}, kind}], errors}
   A ref points from the referencing column (the "many" side for kind 'n1') to the referenced one. kind: 'n1' | '11' | 'nn'.
   Board side: a table is an ER "table" shape whose label is the table name followed by one line per column, e.g.
   "orders\nid INT PK\ncustomer_id INT FK NN". */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SchemaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIM = { text: 200000, tables: 300, cols: 300 };
  const FLAGS = ['PK', 'FK', 'NN', 'UQ'];

  /* ---------- small text helpers ---------- */
  /* removes -- and // line comments and block comments, keeping quoted text intact */
  function stripComments(t, slashes) {
    let out = '', q = null;
    for (let k = 0; k < t.length; k++) {
      const c = t[k], n = t[k + 1];
      if (q) { out += c; if (c === q) { if (n === q) { out += n; k++; } else q = null; } continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
      if ((c === '-' && n === '-') || (slashes && c === '/' && n === '/')) { while (k < t.length && t[k] !== '\n') k++; out += '\n'; continue; }
      if (c === '/' && n === '*') { const e = t.indexOf('*/', k + 2); k = e < 0 ? t.length : e + 1; out += ' '; continue; }
      out += c;
    }
    return out;
  }
  /* splits on sep at bracket depth 0, outside quotes */
  function splitTop(s, sep) {
    const out = []; let d = 0, q = null, cur = '';
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if ((c === ')' || c === ']' || c === '}') && d > 0) d--;
      if (c === sep && d === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim()).filter(Boolean);
  }
  /* the text inside the bracket that opens at s[i] (i points at the opening bracket) */
  function inside(s, i) {
    const open = s[i], close = { '(': ')', '{': '}', '[': ']' }[open];
    let d = 0, q = null;
    for (let k = i; k < s.length; k++) {
      const c = s[k];
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === open) d++;
      else if (c === close && --d === 0) return { body: s.slice(i + 1, k), end: k + 1 };
    }
    return { body: s.slice(i + 1), end: s.length };
  }
  /* reads one identifier (possibly quoted, possibly schema.name) from the start of s */
  function ident(s) {
    s = s.replace(/^\s+/, '');
    const parts = []; let rest = s;
    for (;;) {
      let m;
      if ((m = /^"((?:[^"]|"")*)"/.exec(rest)) || (m = /^`([^`]*)`/.exec(rest)) || (m = /^\[([^\]]*)\]/.exec(rest))) parts.push(m[1].replace(/""/g, '"'));
      else if ((m = /^[\p{L}\p{N}_$#@]+/u.exec(rest))) parts.push(m[0]);
      else break;
      rest = rest.slice(m[0].length);
      if (rest[0] === '.' ) { rest = rest.slice(1); continue; }
      break;
    }
    return { name: parts.join('.'), rest };
  }
  const identList = s => splitTop(s, ',').map(x => ident(x).name).filter(Boolean);
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
  const base = n => String(n).split('.').pop();

  /* ---------- the model ---------- */
  function model() {
    const tables = [], byName = new Map(), refs = [], errors = [];
    const table = name => {
      const key = String(name).toLowerCase();
      let t = byName.get(key) || byName.get(base(key));
      if (!t) {
        if (tables.length >= LIM.tables) return null;
        t = { name: clip(name, 120), columns: [] }; tables.push(t); byName.set(key, t);
      }
      return t;
    };
    const find = name => byName.get(String(name).toLowerCase()) || byName.get(base(String(name).toLowerCase())) ||
      tables.find(t => base(t.name).toLowerCase() === base(String(name)).toLowerCase()) || null;
    const col = (t, name) => t && t.columns.find(c => c.name.toLowerCase() === String(name).toLowerCase());
    return { tables, refs, errors, table, find, col };
  }
  /* ref targets without a column point at the primary key; flags follow the refs */
  function finish(M) {
    const out = [];
    for (const r of M.refs) {
      const ft = M.find(r.from.table), tt = M.find(r.to.table);
      if (!ft || !tt) { M.errors.push('Reference to an unknown table: ' + (ft ? r.to.table : r.from.table)); continue; }
      let tc = r.to.column;
      if (!tc) { const pk = tt.columns.find(c => c.pk); tc = pk ? pk.name : 'id'; }
      const fc = M.col(ft, r.from.column);
      if (!fc) { M.errors.push('Reference from an unknown column: ' + ft.name + '.' + r.from.column); continue; }
      fc.fk = true;
      if (!out.some(q => q.from.table === ft.name && q.from.column === fc.name && q.to.table === tt.name && q.to.column === tc))
        out.push({ from: { table: ft.name, column: fc.name }, to: { table: tt.name, column: tc }, kind: r.kind || (fc.uq || (fc.pk && ft.columns.filter(c => c.pk).length === 1) ? '11' : 'n1') }); /* a key of its own makes it one-to-one */
    }
    return { tables: M.tables, refs: out, errors: M.errors };
  }

  /* ---------- SQL in ---------- */
  const COLSTOP = /^(not|null|primary|references|default|unique|check|constraint|auto_increment|autoincrement|generated|collate|comment|identity|on|key|as)\b/i;
  function parseSQL(text) {
    const M = model();
    const src = stripComments(String(text || '').slice(0, LIM.text));
    for (const st0 of splitTop(src, ';')) {
      const st = st0.replace(/\s+/g, ' ').trim();
      let m;
      if ((m = /^create (?:or replace )?(?:(?:global |local )?(?:temporary|temp) |unlogged |virtual )?table\b ?(?:if not exists )?/i.exec(st))) {
        const id = ident(st.slice(m[0].length)), t = id.name && M.table(id.name);
        if (!t) { M.errors.push('Skipped a CREATE TABLE without a name'); continue; }
        const open = id.rest.indexOf('(');
        if (open < 0) { M.errors.push('Skipped ' + t.name + ': no column list'); continue; }
        for (const item of splitTop(inside(id.rest, open).body, ',')) sqlItem(M, t, item);
      } else if ((m = /^alter table (?:only )?(?:if exists )?/i.exec(st))) {
        const id = ident(st.slice(m[0].length)), t = M.find(id.name);
        for (const part of splitTop(id.rest, ',')) {
          const a = /^add (?:constraint \S+ )?(foreign key|primary key|unique)\s*\(([^)]*)\)(.*)$/i.exec(part.trim());
          if (!a || !t) continue;
          const cols = identList(a[2]);
          if (/^primary/i.test(a[1])) cols.forEach(c => { const q = M.col(t, c); if (q) { q.pk = true; q.nn = true; } });
          else if (/^unique/i.test(a[1])) { if (cols.length === 1) { const q = M.col(t, cols[0]); if (q) q.uq = true; } }
          else fkClause(M, t, cols, a[3]);
        }
      }
    }
    return finish(M);
  }
  function fkClause(M, t, cols, rest) {
    const r = /references\s+/i.exec(rest);
    if (!r) return;
    const id = ident(rest.slice(r.index + r[0].length)), o = id.rest.trim();
    const to = o[0] === '(' ? identList(inside(o, 0).body) : [];
    cols.forEach((c, k) => M.refs.push({ from: { table: t.name, column: c }, to: { table: id.name, column: to[k] || '' } }));
  }
  function sqlItem(M, t, item) {
    let m;
    const body = item.replace(/^constraint\s+("[^"]*"|`[^`]*`|\[[^\]]*\]|\S+)\s+/i, '');
    if ((m = /^primary key\s*\(([^)]*)\)/i.exec(body))) { identList(m[1]).forEach(c => { const q = M.col(t, c); if (q) { q.pk = true; q.nn = true; } }); return; }
    if ((m = /^foreign key\s*\(([^)]*)\)(.*)$/i.exec(body))) { fkClause(M, t, identList(m[1]), m[2]); return; }
    if ((m = /^unique(?: key| index)?(?:\s+[\p{L}\p{N}_`"]+)?\s*\(([^)]*)\)/iu.exec(body))) { const c = identList(m[1]); if (c.length === 1) { const q = M.col(t, c[0]); if (q) q.uq = true; } return; }
    if (/^(check|index|key|fulltext|spatial|exclude|period)\b/i.test(body)) return;
    if (t.columns.length >= LIM.cols) return;
    const id = ident(body);
    if (!id.name) return;
    /* the type runs until the first constraint keyword (it may contain spaces and brackets) */
    let rest = id.rest.trim(), type = '';
    while (rest && !COLSTOP.test(rest)) {
      if (rest[0] === '(') { const q = inside(rest, 0); type += '(' + q.body.replace(/\s+/g, '') + ')'; rest = rest.slice(q.end).trim(); continue; }
      const w = /^[^\s(]+/.exec(rest)[0]; type += (type && !/^\[/.test(w) ? ' ' : '') + w; rest = rest.slice(w.length).trim();
    }
    const c = { name: clip(id.name, 80), type: clip(type, 60), pk: /primary key/i.test(rest), nn: /not null/i.test(rest), uq: /\bunique\b/i.test(rest), fk: false };
    const d = /\bdefault\s+('(?:[^']|'')*'|\([^)]*\)|[^\s,]+)/i.exec(rest);
    if (d) c.def = clip(d[1], 60);
    if (c.pk) c.nn = true;
    t.columns.push(c);
    if (/\breferences\s/i.test(rest)) fkClause(M, t, [c.name], rest);
  }

  /* ---------- SQL out ---------- */
  const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const RESERVED = new Set(['user', 'order', 'group', 'table', 'select', 'from', 'where', 'key', 'index', 'check', 'default', 'primary', 'references', 'to', 'by', 'desc', 'asc', 'limit', 'column', 'constraint', 'unique', 'values']);
  const qid = n => String(n).split('.').map(p => (SAFE.test(p) && !RESERVED.has(p.toLowerCase())) ? p : '"' + p.replace(/"/g, '""') + '"').join('.');
  function toSQL(m) {
    const out = [];
    for (const t of m.tables || []) {
      const pks = t.columns.filter(c => c.pk), lines = t.columns.map(c => '  ' + qid(c.name) + ' ' + (c.type || 'TEXT') +
        (c.pk && pks.length === 1 ? ' PRIMARY KEY' : '') + (c.nn && !c.pk ? ' NOT NULL' : '') + (c.uq && !c.pk ? ' UNIQUE' : '') + (c.def != null && c.def !== '' ? ' DEFAULT ' + c.def : ''));
      if (pks.length > 1) lines.push('  PRIMARY KEY (' + pks.map(c => qid(c.name)).join(', ') + ')');
      out.push('CREATE TABLE ' + qid(t.name) + ' (\n' + lines.join(',\n') + '\n);');
    }
    /* foreign keys last, so tables can be created in any order */
    for (const r of m.refs || []) out.push('ALTER TABLE ' + qid(r.from.table) + ' ADD FOREIGN KEY (' + qid(r.from.column) + ') REFERENCES ' + qid(r.to.table) + ' (' + qid(r.to.column) + ');');
    return out.join('\n\n') + '\n';
  }

  /* ---------- DBML in (dbdiagram.io) ---------- */
  function parseDBML(text) {
    const M = model();
    const src = stripComments(String(text || '').slice(0, LIM.text), true);
    let k = 0;
    while (k < src.length) {
      const rest = src.slice(k), m = /^\s*(table|ref|enum|project|tablegroup|note|tablepartial|records)\b/i.exec(rest);
      if (!m) { const nl = rest.indexOf('\n'); k += nl < 0 ? rest.length : nl + 1; continue; }
      const kw = m[1].toLowerCase(), after = rest.slice(m[0].length), brace = after.indexOf('{'), nl = after.indexOf('\n');
      if (kw === 'ref' && (brace < 0 || (nl >= 0 && nl < brace) || /^\s*[\w"]*\s*:/.test(after) && after.indexOf(':') < brace)) {
        /* Ref name: a.b > c.d [settings] on one line */
        const line = after.slice(0, nl < 0 ? after.length : nl), c = line.indexOf(':');
        dbmlRef(M, c >= 0 ? line.slice(c + 1) : line);
        k += m[0].length + (nl < 0 ? after.length : nl + 1);
        continue;
      }
      if (brace < 0) { k = src.length; break; }
      const blk = inside(after, brace), head = after.slice(0, brace);
      if (kw === 'table') dbmlTable(M, head, blk.body);
      else if (kw === 'ref') blk.body.split('\n').forEach(l => { if (l.trim()) dbmlRef(M, l); });
      k += m[0].length + blk.end;
    }
    return finish(M);
  }
  function settings(s) { /* "[pk, not null, ref: > a.b]" -> list of settings */
    s = s.trim();
    if (s[0] !== '[') return [];
    return splitTop(inside(s, 0).body, ',');
  }
  function dbmlTable(M, head, body) {
    const id = ident(head), t = id.name && M.table(id.name);
    if (!t) return;
    const lines = [], idx = []; let k = 0;
    /* an "indexes { ... }" block may span lines */
    while (k < body.length) {
      const nl = body.indexOf('\n', k), line = body.slice(k, nl < 0 ? body.length : nl);
      const im = /^\s*indexes\s*\{/i.exec(line);
      if (im) { const blk = inside(body, k + line.indexOf('{')); idx.push(...blk.body.split('\n')); k = blk.end; continue; }
      lines.push(line); k = nl < 0 ? body.length : nl + 1;
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^note\s*:/i.test(line) || /^note\s*\{/i.test(line) || line === '}' || /^~/.test(line)) continue;
      if (t.columns.length >= LIM.cols) break;
      const cid = ident(line);
      if (!cid.name) continue;
      let rest = cid.rest.trim(), type = '';
      const tq = /^"([^"]*)"/.exec(rest);
      if (tq) { type = tq[1]; rest = rest.slice(tq[0].length).trim(); }
      else { const tm = /^[^\s[]+(?:\([^)]*\))?/.exec(rest); if (tm) { type = tm[0]; rest = rest.slice(tm[0].length).trim(); } }
      const c = { name: clip(cid.name, 80), type: clip(type, 60), pk: false, nn: false, uq: false, fk: false };
      for (const st of settings(rest)) {
        const low = st.toLowerCase();
        if (low === 'pk' || low === 'primary key') { c.pk = true; c.nn = true; }
        else if (low === 'not null') c.nn = true;
        else if (low === 'unique') c.uq = true;
        else if (/^default\s*:/.test(low)) c.def = clip(st.replace(/^default\s*:\s*/i, '').replace(/^`|`$/g, ''), 60);
        else if (/^ref\s*:/.test(low)) dbmlRef(M, st.replace(/^ref\s*:\s*/i, ''), t.name + '.' + c.name);
      }
      t.columns.push(c);
    }
    idx.forEach(l => dbmlIndex(M, t, l)); /* indexes refer to the columns, so they come last */
  }
  function dbmlIndex(M, t, l) {
    const line = l.trim();
    if (!line) return;
    let cols, rest;
    if (line[0] === '(') { const q = inside(line, 0); cols = identList(q.body); rest = line.slice(q.end); }
    else { const id = ident(line); cols = id.name ? [id.name] : []; rest = id.rest; }
    const st = settings(rest.trim()).map(x => x.toLowerCase());
    if (st.includes('pk')) cols.forEach(n => { const c = M.col(t, n); if (c) { c.pk = true; c.nn = true; } });
    else if (st.includes('unique') && cols.length === 1) { const c = M.col(t, cols[0]); if (c) c.uq = true; }
  }
  /* "a.b > c.d" (many-to-one), "<" (one-to-many), "-" (one-to-one), "<>" (many-to-many); inline refs give the left side */
  function dbmlRef(M, s, left) {
    const m = /^\s*(?:([^<>\-\s]+(?:\([^)]*\))?)\s*)?(<>|<|>|-)\s*([^\s[]+)/.exec(left ? ' ' + s.trim() : s.trim());
    if (!m) return;
    const end = x => { const k = x.lastIndexOf('.'), tn = x.slice(0, k), cn = x.slice(k + 1); const cs = /^\(/.test(cn) ? identList(cn.replace(/^\(|\)$/g, '')) : [ident(cn).name]; return { table: ident(tn).name, cols: cs }; };
    const a = end(left || m[1] || ''), b = end(m[3]), op = m[2];
    if (!a.table || !b.table) return;
    a.cols.forEach((ac, k) => {
      const bc = b.cols[k] || b.cols[0];
      if (op === '<') M.refs.push({ from: { table: b.table, column: bc }, to: { table: a.table, column: ac }, kind: 'n1' });
      else M.refs.push({ from: { table: a.table, column: ac }, to: { table: b.table, column: bc }, kind: op === '-' ? '11' : op === '<>' ? 'nn' : 'n1' });
    });
  }

  /* ---------- DBML out ---------- */
  const did = n => String(n).split('.').map(p => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : '"' + p + '"').join('.');
  function toDBML(m) {
    const out = [];
    for (const t of m.tables || []) {
      const pks = t.columns.filter(c => c.pk);
      const lines = t.columns.map(c => {
        const st = [];
        if (c.pk && pks.length === 1) st.push('pk');
        if (c.nn && !c.pk) st.push('not null');
        if (c.uq && !c.pk) st.push('unique');
        if (c.def != null && c.def !== '') st.push('default: ' + (/^'.*'$|^-?[\d.]+$|^(true|false|null)$/i.test(c.def) ? c.def : '`' + c.def + '`'));
        const ty = c.type || 'text';
        return '  ' + did(c.name) + ' ' + (/[\s,]/.test(ty) ? '"' + ty + '"' : ty) + (st.length ? ' [' + st.join(', ') + ']' : '');
      });
      if (pks.length > 1) lines.push('', '  indexes {', '    (' + pks.map(c => did(c.name)).join(', ') + ') [pk]', '  }');
      out.push('Table ' + did(t.name) + ' {\n' + lines.join('\n') + '\n}');
    }
    for (const r of m.refs || []) out.push('Ref: ' + did(r.from.table) + '.' + did(r.from.column) + ' ' + (r.kind === '11' ? '-' : r.kind === 'nn' ? '<>' : '>') + ' ' + did(r.to.table) + '.' + did(r.to.column));
    return out.join('\n\n') + '\n';
  }

  /* which format a text is: 'dbml' or 'sql' */
  const detect = t => /^\s*(table\s+[^\s(]+\s*(\bas\b\s+\S+\s*)?(\[[^\]]*\]\s*)?\{|ref\s*\w*\s*:|enum\s+\S+\s*\{|project\s)/im.test(stripComments(String(t || ''), true)) && !/\bcreate\s+table\b/i.test(t) ? 'dbml' : 'sql';
  const parse = (t, fmt) => ((fmt || detect(t)) === 'dbml' ? parseDBML(t) : parseSQL(t));

  /* ---------- board labels ---------- */
  function tableLabel(t) {
    return [t.name].concat(t.columns.map(c => [c.name, c.type, c.pk && 'PK', c.fk && 'FK', c.nn && !c.pk && 'NN', c.uq && !c.pk && 'UQ'].filter(Boolean).join(' '))).join('\n');
  }
  /* "name TYPE WORDS PK FK NN UQ" per line -> table */
  function parseTableLabel(label) {
    const L = String(label || '').split('\n').map(x => x.trim());
    const t = { name: L[0] || 'table', columns: [] };
    for (const line of L.slice(1)) {
      if (!line || line === '--') continue;
      const w = line.split(/\s+/);
      const c = { name: w.shift(), type: '', pk: false, nn: false, uq: false, fk: false };
      while (w.length && FLAGS.includes(w[w.length - 1].toUpperCase())) { const f = w.pop().toUpperCase(); c[{ PK: 'pk', FK: 'fk', NN: 'nn', UQ: 'uq' }[f]] = true; }
      if (/^not null$/i.test(w.slice(-2).join(' '))) { w.splice(-2); c.nn = true; }
      c.type = w.join(' ');
      if (c.pk) c.nn = true;
      t.columns.push(c);
    }
    return t;
  }
  /* crow's-foot ends for a ref: [from end, to end] */
  function ends(r, fromCol) {
    if (r.kind === '11') return ['zone', 'only'];
    if (r.kind === 'nn') return ['zmany', 'zmany'];
    return ['zmany', fromCol && fromCol.nn ? 'only' : 'zone'];
  }
  /* refs for connectors drawn by hand between two tables: the "many" end (or the end with a FK column naming the other table) refers to the other */
  const sing = n => n.replace(/ies$/i, 'y').replace(/(ss)es$/i, '$1').replace(/([^s])s$/i, '$1');
  function guessRef(a, b, many) {
    const pick = (child, parent) => {
      const pn = base(parent.name).toLowerCase(), names = [pn + '_id', sing(pn) + '_id', pn + 'id', sing(pn) + 'id'];
      const fc = child.columns.find(c => names.includes(c.name.toLowerCase())) || child.columns.find(c => c.fk && !c.pk) || null;
      if (!fc) return null;
      const pk = parent.columns.find(c => c.pk) || parent.columns.find(c => c.name.toLowerCase() === 'id');
      return { from: { table: child.name, column: fc.name }, to: { table: parent.name, column: pk ? pk.name : 'id' }, kind: 'n1' };
    };
    if (many === 'a') return pick(a, b);
    if (many === 'b') return pick(b, a);
    return pick(a, b) || pick(b, a);
  }

  return { parseSQL, toSQL, parseDBML, toDBML, parse, detect, tableLabel, parseTableLabel, ends, guessRef, stripComments, splitTop, LIM };
});
