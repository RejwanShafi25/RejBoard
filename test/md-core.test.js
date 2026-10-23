'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const M = require('../md-core.js');

const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/* ---------------- escaping ---------------- */
test('esc makes board text render literally', () => {
  assert.equal(M.esc('a*b*_c_ [x](y) <b>'), 'a\\*b\\*\\_c\\_ \\[x\\](y) \\<b\\>');
  assert.equal(M.esc('# not a heading'), '\\# not a heading');
  assert.equal(M.esc('- not a list\n1. nor this'), '\\- not a list\n1\\. nor this');
  assert.equal(M.esc('> no quote'), '\\> no quote');
  assert.equal(M.esc('back\\slash `code` a|b ~~s~~'), 'back\\\\slash \\`code\\` a\\|b \\~\\~s\\~\\~');
  assert.equal(M.esc(null), '');
});

test('htmlToMd converts the editor formatting', () => {
  assert.equal(M.htmlToMd('<b>bold</b> and <i>it</i>'), '**bold** and *it*');
  assert.equal(M.htmlToMd('line1<br>line2'), 'line1  \nline2');
  assert.equal(M.htmlToMd('<div>a</div><div>b</div>'), 'a\nb');
  assert.equal(M.htmlToMd('x &amp; y &lt;3 &#955; &#x3bb;'), 'x & y \\<3 λ λ');
  assert.equal(M.htmlToMd('see <span data-board="b1" data-title="Physics">@Physics</span>'), 'see @Physics');
  assert.equal(M.htmlToMd('area <span data-math="\\pi r^2"><svg>junk</svg></span> m'), 'area $\\pi r^2$ m');
});

test('htmlToMd drops scripts, styles and unknown markup instead of passing HTML through', () => {
  const md = M.htmlToMd('<script>alert(1)</script><style>*{}</style><img src=x onerror=alert(1)><a href="javascript:x">click</a><iframe></iframe>ok');
  assert.ok(!/<|script|onerror|javascript|alert/i.test(md), md);
  assert.ok(md.endsWith('ok'));
  assert.equal(M.htmlToMd('<b>never closed'), '**never closed**');
  assert.equal(M.htmlToMd('a < b'), 'a \\< b');
  assert.equal(M.htmlToMd('&#0;&#xD800;&#99999999;x'), 'x', 'invalid code points vanish');
  assert.equal(M.htmlToMd(null), '');
});

test('htmlToMd copes with hostile nesting and size', () => {
  const deep = '<span>'.repeat(5000) + 'x' + '</span>'.repeat(5000);
  assert.equal(M.htmlToMd(deep), 'x');
  const t = Date.now(); M.htmlToMd('<b>a</b>'.repeat(200000)); assert.ok(Date.now() - t < 3000, 'linear time');
  M.htmlToMd('<span data-math="x">' + '<span>'.repeat(1000)); // unterminated: no hang, no throw
});

test('LaTeX cannot break out of its $$ block', () => {
  const { md } = M.boardToMd({ title: 'T', items: [{ t: 'm', latex: 'x$$\n<script>alert(1)</script>', x: 0, y: 0 }] });
  const block = md.slice(md.indexOf('$$\n'));
  assert.equal((block.match(/(^|[^\\])\$\$/g) || []).length, 2, 'exactly the opening and closing fences');
  assert.ok(!/<script/.test(md));
});

/* ---------------- file names and paths ---------------- */
test('safeName produces a usable file name on every OS', () => {
  assert.equal(M.safeName('Physics: waves / optics?'), 'Physics_ waves _ optics_');
  assert.equal(M.safeName('..'), 'Untitled');
  assert.equal(M.safeName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(M.safeName('CON'), '_CON');
  assert.equal(M.safeName('nul.txt'), '_nul.txt');
  assert.equal(M.safeName('  trailing dots... '), 'trailing dots');
  assert.equal(M.safeName('a\u0000b\nc'), 'a_b_c');
  assert.equal(M.safeName(''), 'Untitled');
  assert.equal(M.safeName('x'.repeat(500)).length, 80);
  assert.equal(M.safeName('গণিত নোট'), 'গণিত নোট', 'non-Latin titles are kept');
});

test('uniquer avoids collisions case-insensitively, per folder', () => {
  const u = M.uniquer();
  assert.equal(u('', 'Notes', '.md'), 'Notes.md');
  assert.equal(u('', 'notes', '.md'), 'notes (2).md');
  assert.equal(u('', 'Notes', '.md'), 'Notes (3).md');
  assert.equal(u('Math', 'Notes', '.md'), 'Notes.md');
});

test('safePath rejects anything that could escape the archive', () => {
  for (const p of ['../x.md', 'a/../../x', '/etc/passwd', 'C:\\x', 'a//b', '', 'a/./b', 'a\\b', 'x\u0000.md', 5, null]) assert.equal(M.safePath(p), false, String(p));
  assert.equal(M.safePath('Folder/Sub/Notes (2).md'), true);
});

/* ---------------- images ---------------- */
test('dataUrlImage decodes raster images and refuses SVG, junk and oversize data', () => {
  const d = M.dataUrlImage(PNG1);
  assert.equal(d.ext, 'png');
  assert.deepEqual([...d.bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(M.dataUrlImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), null);
  assert.equal(M.dataUrlImage('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(M.dataUrlImage('https://example.com/a.png'), null);
  assert.equal(M.dataUrlImage('data:image/png;base64,!!!'), null);
  assert.equal(M.dataUrlImage(PNG1, 10), null, 'over the size cap');
  assert.equal(M.dataUrlImage(null), null);
});

/* ---------------- boards ---------------- */
test('boardToMd writes front matter, a title and the content in reading order', () => {
  const rec = { title: 'Week 3', tags: 'math, exam', ct: Date.UTC(2026, 0, 2), mt: Date.UTC(2026, 0, 3), items: [
    { t: 't', text: 'second line', x: 10, y: 200 },
    { t: 't', text: 'right', x: 400, y: 50 },
    { t: 't', text: 'left', x: 10, y: 55 },
    { t: 'm', latex: '\\frac{a}{b}', x: 10, y: 300 },
    { t: 't', text: 'note to self', sticky: 1, x: 10, y: 400 },
    { t: 'tb', cells: [['Name', 'Score'], ['Ann', '9|10']], x: 10, y: 500 },
    { t: 'l', text: 'https://example.com/a b', x: 10, y: 600 },
    { t: 'sp', shp: 'rect', label: 'Box *label*', x: 10, y: 700 },
    { t: 'gr', fns: [{ text: 'y=x^2' }, { text: ' ' }], x: 10, y: 800 },
    { t: 's', pts: [[0, 0, .5]], x: 0, y: 0 }
  ] };
  const { md, files } = M.boardToMd(rec, { picture: 'Week 3 files/board.png', assetDir: 'Week 3 files' });
  assert.match(md, /^---\ntitle: "Week 3"\ntags: \["math", "exam"\]\ncreated: 2026-01-02T00:00:00.000Z\nmodified: 2026-01-03T00:00:00.000Z\n---\n/);
  assert.ok(md.includes('# Week 3'));
  assert.ok(md.includes('![Board](Week%203%20files/board.png)'));
  const order = ['left', 'right', 'second line', '\\frac{a}{b}', '> note to self', '| Name | Score |', 'Box \\*label\\*', 'Graph: $y=x^2$'];
  let at = -1; for (const s of order) { const k = md.indexOf(s); assert.ok(k > at, 'order: ' + s); at = k; }
  assert.ok(md.includes('| Ann | 9\\|10 |'), 'pipes in cells are escaped');
  assert.ok(md.includes('[https://example.com/a b](https://example.com/a%20b)'));
  assert.equal(files.length, 0);
});

test('boardToMd exports embedded images as files and never javascript: links', () => {
  const { md, files } = M.boardToMd({ title: 'I', items: [
    { t: 'i', src: PNG1, x: 0, y: 0 }, { t: 'i', src: 'https://example.com/x.jpg', x: 0, y: 50 },
    { t: 'i', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', x: 0, y: 90 },
    { t: 'l', text: 'javascript:alert(1)', x: 0, y: 100 }, { t: 'l', text: 'file:///etc/passwd', x: 0, y: 110 }
  ] }, { assetDir: 'I files' });
  assert.deepEqual(files.map(f => f.path), ['I files/image-1.png']);
  assert.ok(md.includes('![](I%20files/image-1.png)'));
  assert.ok(md.includes('![](https://example.com/x.jpg)'));
  assert.ok(!/\]\(javascript:|\]\(file:/.test(md), 'dangerous URLs are text, not links');
});

test('boardToMd survives empty and malformed boards', () => {
  for (const r of [{}, { items: null }, { items: [null, 5, 'x', { t: 'tb', cells: 'no' }, { t: 'gr', fns: 'no' }] }, null])
    assert.equal(typeof M.boardToMd(r).md, 'string');
  assert.ok(M.boardToMd({ title: 'He said "hi"\n---' }).md.startsWith('---\ntitle: "He said \\"hi\\"\\n---"\n'), 'front matter cannot be broken out of');
});

test('boardToMd adds recognized handwriting when given', () => {
  const { md } = M.boardToMd({ title: 'H', items: [] }, { hq: 'buy *milk*' });
  assert.ok(md.includes('## Handwriting (recognized)\n\nbuy \\*milk\\*'));
});

/* ---------------- zip ---------------- */
test('crc32 matches the standard check value', () => {
  assert.equal(M.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip produces an archive a real unzip tool reads back exactly', () => {
  const entries = [{ path: 'Notes.md', text: '# Hi\n' }, { path: 'Math/গণিত.md', text: 'λ' }, { path: 'Math/gণ files/board.png', bytes: M.dataUrlImage(PNG1).bytes }];
  const buf = Buffer.concat(M.zip(entries, new Date(2026, 9, 22, 12, 30)).map(p => Buffer.from(p)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbzip-')), f = path.join(dir, 'a.zip');
  fs.writeFileSync(f, buf);
  try {
    const py = "import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename:[i.file_size,z.read(i).hex()] for i in z.infolist()}))";
    const out = JSON.parse(execFileSync('python', ['-I', '-c', py, f], { encoding: 'utf8' }));
    assert.deepEqual(Object.keys(out), entries.map(e => e.path));
    assert.equal(Buffer.from(out['Math/গণিত.md'][1], 'hex').toString('utf8'), 'λ');
    assert.equal(out['Math/gণ files/board.png'][0], entries[2].bytes.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('zip refuses unsafe and duplicate paths', () => {
  assert.throws(() => M.zip([{ path: '../evil.md', text: 'x' }]), /unsafe/);
  assert.throws(() => M.zip([{ path: '/abs.md', text: 'x' }]), /unsafe/);
  assert.throws(() => M.zip([{ path: 'a.md', text: 'x' }, { path: 'A.md', text: 'y' }]), /duplicate/);
});

test('zip of nothing is a valid empty archive', () => {
  const parts = M.zip([]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].length, 22);
});

test('typed entity-like text stays literal', () => {
  assert.equal(M.esc('a &lt; b &#60; c & d'), 'a \\&lt; b \\&#60; c & d');
});
