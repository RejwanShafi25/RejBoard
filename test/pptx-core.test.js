'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pptx-core.js');
const M = require('../md-core.js');

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('a deck has every part PowerPoint needs, one slide and one picture per page', () => {
  const E = P.build({ title: 'Cells & <tissues>', slides: [{ png, w: 794, h: 1123 }, { png, w: 794, h: 1123 }], when: new Date('2026-11-05T10:00:00Z') });
  const paths = E.map(e => e.path);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
    'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml',
    'ppt/slides/_rels/slide2.xml.rels', 'ppt/media/image1.png', 'ppt/media/image2.png', 'docProps/core.xml']) assert.ok(paths.includes(p), 'missing ' + p);
  const ct = E.find(e => e.path === '[Content_Types].xml').text;
  assert.match(ct, /PartName="\/ppt\/slides\/slide2\.xml"/);
  const pres = E.find(e => e.path === 'ppt/presentation.xml').text;
  assert.equal((pres.match(/<p:sldId /g) || []).length, 2);
  assert.match(E.find(e => e.path === 'docProps/core.xml').text, /<dc:title>Cells &amp; &lt;tissues&gt;<\/dc:title>/);
  assert.equal(E.find(e => e.path === 'ppt/media/image2.png').bytes, png);
  /* it packs into a zip with no duplicate or unsafe paths */
  const parts = M.zip(E, new Date(), { fixed: true });
  assert.throws(() => M.zip([{ path: '../evil', text: 'x' }], new Date(), { fixed: true }), /unsafe path/);
  assert.throws(() => M.zip([{ path: 'a\\b', text: 'x' }], new Date(), { fixed: true }), /unsafe path/);
  assert.throws(() => M.zip([{ path: 'C:/x', text: 'x' }], new Date(), { fixed: true }), /unsafe path/);
  assert.ok(parts.reduce((a, p) => a + p.length, 0) > 1000);
});

test('the slide takes the page shape, long side 13.33 in, inside PowerPoint limits', () => {
  const a4 = P.slideSize(794, 1123);
  assert.equal(a4.cy, 12192000); assert.ok(Math.abs(a4.cx / a4.cy - 794 / 1123) < 1e-3);
  const wide = P.slideSize(1600, 900);
  assert.equal(wide.cx, 12192000); assert.equal(wide.cy, 6858000);
  const strip = P.slideSize(5000, 10);
  assert.ok(strip.cy >= 914400 && strip.cx <= 51206400);
  const f = P.fit(1000, 500, { cx: 1000, cy: 1000 });
  assert.deepEqual(f, { x: 0, y: 250, cx: 1000, cy: 500 });
});

test('an empty deck is refused', () => {
  assert.throws(() => P.build({ title: 'x', slides: [] }), /nothing to export/);
});
