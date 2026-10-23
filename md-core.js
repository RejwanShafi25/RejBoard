/* RejBoard Markdown export core: boards -> Markdown files (+ their images) -> one .zip. Open formats only, readable without RejBoard.
   No DOM in here, so it runs in the app (as the global `MdCore`) and under `node --test`.

   - boardToMd(): a board's typed content in reading order (text, sticky notes, LaTeX, tables, links, shape labels, graphs, images).
     Ink cannot be Markdown; the caller adds a picture of the whole board for that.
   - Every string that came from a board is escaped, every file name is sanitized, and no path can leave the archive (no "..", no absolute paths).
   - zip(): a minimal STORE-only ZIP writer (UTF-8 names, CRC-32), returning Blob-ready parts. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MdCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- escaping ---------- */
  /* Plain text -> Markdown text that renders as exactly that text (no accidental bold, links, headings, HTML or lists). */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\\`*_[\]<>|~]/g, m => '\\' + m)
      .replace(/&(?=#?[a-z0-9]+;)/gi, '\\&') // "&lt;" typed on the board must not turn into "<"
      .replace(/^(\s*)([#>+-])/gm, '$1\\$2')
      .replace(/^(\s*\d+)([.)])/gm, '$1\\$2');
  }
  const cellEsc = s => esc(s).replace(/\r?\n/g, '<br>');
  /* LaTeX is kept as written, but it cannot close its own $$ fence or smuggle in HTML. */
  const texEsc = s => String(s == null ? '' : s).replace(/\$/g, '\\$').replace(/</g, '\\lt ').replace(/>/g, '\\gt ');
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const unent = s => String(s).replace(/&(#x[0-9a-f]{1,8}|#\d{1,10}|[a-z]+\d*);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ''; }
    return ENT[k] != null ? ENT[k] : m;
  });
  const attr = (tag, name) => { const m = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag); return m ? unent(m[2] != null ? m[2] : m[3]) : null; };

  /* The editor's rich text (bold/italic, line breaks, inline math, @board links) -> Markdown. Unknown tags are dropped, never passed through. */
  function htmlToMd(html) {
    const src = String(html == null ? '' : html).slice(0, 2e6);
    let out = '', b = 0, i = 0, skip = 0;
    const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)|(<)/gi;
    let m;
    while ((m = re.exec(src))) {
      if (m[4] != null || m[5] != null) { if (!skip) out += esc(unent(m[4] != null ? m[4] : '<')); continue; }
      const close = !!m[1], tag = m[2].toLowerCase(), full = m[0];
      if (tag === 'script' || tag === 'style') { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
      if (skip) continue;
      if (tag === 'br') { out += '  \n'; continue; }
      if (tag === 'div' || tag === 'p') { if (!close && out && !out.endsWith('\n')) out += '\n'; else if (close) out += '\n'; continue; }
      if (tag === 'b' || tag === 'strong') { out += '**'; b += close ? -1 : 1; continue; }
      if (tag === 'i' || tag === 'em') { out += '*'; i += close ? -1 : 1; continue; }
      if (tag === 'span' && !close) {
        const dm = attr(full, 'data-math'), bid = attr(full, 'data-board');
        if (dm != null) { out += '$' + texEsc(dm) + '$'; skipSpan(); continue; }
        if (bid != null) { out += '@' + esc(attr(full, 'data-title') || ''); skipSpan(); continue; }
      }
    }
    /* a math / board-link span carries its own text; skip its inner content up to the matching </span> */
    function skipSpan() {
      let depth = 1, n;
      const r2 = /<(\/?)span\b[^>]*>/gi; r2.lastIndex = re.lastIndex;
      while (depth && (n = r2.exec(src))) depth += n[1] ? -1 : 1;
      re.lastIndex = n ? r2.lastIndex : src.length;
    }
    if (b > 0) out += '**'.repeat(b); if (i > 0) out += '*'.repeat(i); // close anything the editor left open
    return out.replace(/\*\*\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- file names ---------- */
  const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
  /* One safe path segment: no separators, no control or Windows-forbidden characters, no ".." and no reserved device names. */
  function safeName(s, fallback = 'Untitled') {
    let t = String(s == null ? '' : s).normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!t || /^_+$/.test(t)) t = fallback;
    if (RESERVED.test(t)) t = '_' + t;
    if (t.length > 80) t = t.slice(0, 80).trim();
    return t || fallback;
  }
  /* Makes names unique within one folder ("Notes", "Notes (2)", ...), case-insensitively like Windows and macOS. */
  function uniquer() {
    const used = new Set();
    return (dir, name, ext) => {
      for (let k = 1; ; k++) {
        const n = k === 1 ? name : name + ' (' + k + ')', key = (dir + '/' + n + ext).toLowerCase();
        if (!used.has(key)) { used.add(key); return n + ext; }
      }
    };
  }
  const joinPath = (...parts) => parts.filter(Boolean).join('/');
  /* A zip entry path is safe when every segment is a sanitized name. */
  const safePath = p => typeof p === 'string' && p.length > 0 && p.length < 1024 && !p.startsWith('/') && p.split('/').every(seg => seg && seg !== '.' && seg !== '..' && safeName(seg) === seg);

  /* ---------- images ---------- */
  const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  /* data:image/...;base64 -> {ext, bytes}. SVG and anything else is refused (an SVG file can carry script). */
  function dataUrlImage(u, maxBytes = 50 * 1048576) {
    const m = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(typeof u === 'string' ? u.slice(0, maxBytes * 1.4 + 64) : '');
    if (!m) return null;
    const ext = IMG_EXT[m[1].toLowerCase()];
    if (!ext) return null;
    const b64 = m[2].replace(/\s+/g, '');
    if (b64.length * 0.75 > maxBytes) return null;
    let bin;
    try { bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); } catch (_) { return null; }
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return { ext, bytes };
  }
  const httpsUrl = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (_) { return null; } };
  const mdUrl = u => u.replace(/[()<>\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

  /* ---------- reading order ---------- */
  function bbox(i) {
    const n = v => (Number.isFinite(+v) ? +v : 0);
    if (Array.isArray(i.pts) && i.pts.length) { let x0 = 1e18, y0 = 1e18; for (const p of i.pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; } return [n(x0), n(y0)]; }
    return [n(i.x), n(i.y)];
  }
  /* top-to-bottom; items whose tops are within `band` of each other count as one row, read left to right */
  function readingOrder(items, band = 24) {
    const a = (Array.isArray(items) ? items : []).filter(i => i && typeof i === 'object').map(i => ({ i, p: bbox(i) })).sort((u, v) => u.p[1] - v.p[1] || u.p[0] - v.p[0]);
    const rows = [];
    for (const e of a) { const r = rows[rows.length - 1]; if (r && e.p[1] - r.y <= band) r.e.push(e); else rows.push({ y: e.p[1], e: [e] }); }
    return rows.flatMap(r => r.e.sort((u, v) => u.p[0] - v.p[0]).map(e => e.i));
  }

  /* ---------- one board ---------- */
  function table(i) {
    const rows = (Array.isArray(i.cells) ? i.cells : []).filter(Array.isArray).slice(0, 2000);
    if (!rows.length) return '';
    const w = Math.min(200, Math.max(...rows.map(r => r.length)));
    const line = r => '| ' + Array.from({ length: w }, (_, k) => cellEsc(r[k] == null ? '' : typeof r[k] === 'object' ? (r[k].v != null ? r[k].v : '') : r[k])).join(' | ') + ' |';
    return [line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
  }
  const yamlStr = s => JSON.stringify(String(s == null ? '' : s)); // JSON strings are valid YAML scalars
  const iso = t => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);

  /* rec: a stored board. opts.picture: path of a whole-board image to show first (or null); opts.assetDir: folder for its images.
     Returns {md, files:[{path, bytes}]} where file paths are relative to the .md file. */
  function boardToMd(rec, opts) {
    const o = Object.assign({ picture: null, assetDir: 'assets', hq: '' }, opts || {});
    const files = [], out = [], tags = String(rec && rec.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const fm = ['---', 'title: ' + yamlStr(rec && rec.title || 'Untitled')];
    if (tags.length) fm.push('tags: [' + tags.map(yamlStr).join(', ') + ']');
    const c = iso(rec && rec.ct), mo = iso(rec && (rec.mt || rec.t));
    if (c) fm.push('created: ' + c); if (mo) fm.push('modified: ' + mo);
    fm.push('---', '');
    out.push(fm.join('\n'), '# ' + esc(rec && rec.title || 'Untitled'), '');
    if (o.picture) out.push('![Board](' + mdUrl(o.picture) + ')', '');
    let img = 0;
    for (const i of readingOrder(rec && rec.items)) {
      let s = '';
      if (i.t === 't') {
        const body = typeof i.html === 'string' && i.html ? htmlToMd(i.html) : esc(i.text || '');
        s = i.sticky ? body.split('\n').map(l => '> ' + l).join('\n') : body;
      } else if (i.t === 'm' && i.latex) s = '$$\n' + texEsc(i.latex) + '\n$$';
      else if (i.t === 'tb') s = table(i);
      else if (i.t === 'l') { const u = httpsUrl(i.text); s = u ? '[' + esc(i.text) + '](' + mdUrl(u) + ')' : esc(i.text || ''); }
      else if (i.t === 'sp' && i.label) s = esc(i.label);
      else if (i.t === 'gr' && Array.isArray(i.fns)) { const f = i.fns.map(f => f && String(f.text || '').trim()).filter(Boolean); if (f.length) s = 'Graph: ' + f.map(x => '$' + texEsc(x) + '$').join(', '); }
      else if (i.t === 'i' && i.src) {
        const d = dataUrlImage(i.src);
        if (d) { const p = joinPath(o.assetDir, 'image-' + (++img) + '.' + d.ext); files.push({ path: p, bytes: d.bytes }); s = '![](' + mdUrl(p) + ')'; }
        else { const u = httpsUrl(i.src); if (u) s = '![](' + mdUrl(u) + ')'; }
      }
      if (s && s.trim()) out.push(s, '');
    }
    if (o.hq && String(o.hq).trim()) out.push('## Handwriting (recognized)', '', esc(String(o.hq).trim()), '');
    return { md: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', files };
  }

  /* ---------- zip (STORE) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let k = 0; k < b.length; k++) c = CRC[(c ^ b[k]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s);
  function dosTime(d) { return { t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

  /* entries: [{path, bytes|text}] -> array of Uint8Array parts (pass to new Blob(parts)). Refuses unsafe or duplicate paths and >4 GB archives. */
  function zip(entries, when) {
    const dt = dosTime(when instanceof Date ? when : new Date()), parts = [], central = [], seen = new Set();
    let off = 0;
    for (const e of entries) {
      if (!safePath(e.path)) throw new Error('unsafe path in archive: ' + JSON.stringify(e.path));
      const key = e.path.toLowerCase();
      if (seen.has(key)) throw new Error('duplicate path in archive: ' + e.path);
      seen.add(key);
      const name = utf8(e.path), data = e.bytes instanceof Uint8Array ? e.bytes : utf8(String(e.text == null ? '' : e.text)), crc = crc32(data);
      if (off + data.length > 0xfffffff0) throw new Error('archive too large');
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt.t, true); h.setUint16(12, dt.d, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt.t, true); c.setUint16(14, dt.d, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, seen.size, true); end.setUint16(10, seen.size, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    if (seen.size > 0xffff) throw new Error('too many files for one archive');
    return [...parts, ...central, new Uint8Array(end.buffer)];
  }

  return { esc, htmlToMd, safeName, uniquer, safePath, joinPath, dataUrlImage, readingOrder, boardToMd, crc32, zip };
});
