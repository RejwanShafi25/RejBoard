'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const LV = require('../liveview.js');
const Q = require('../qr-core.js');

const get = (port, path, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method }, res => { const b = []; res.on('data', d => b.push(d)); res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'] || '', csp: res.headers['content-security-policy'] || '', body: Buffer.concat(b) })); });
  req.on('error', reject); req.end();
});
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('the phone view serves the board only under its random key, read-only, and stops cleanly', async () => {
  const r = await LV.start();
  try {
    assert.ok(r.on && /^http:\/\/[\d.]+:\d+\/v\/[0-9a-f]{32}\/$/.test(r.url), r.url);
    const key = r.url.match(/\/v\/([0-9a-f]{32})\//)[1], port = r.port;
    assert.equal(LV.update({ title: 'Cell <b>biology</b>', pages: [png, png, Buffer.from('not a png')] }), true);
    const home = await get(port, `/v/${key}/`);
    assert.equal(home.code, 200); assert.match(home.type, /text\/html/); assert.match(home.csp, /default-src 'none'/);
    assert.ok(home.body.toString().includes('Cell &lt;b&gt;biology&lt;/b&gt;'), 'the title is escaped');
    const st = JSON.parse((await get(port, `/v/${key}/state.json`)).body);
    assert.equal(st.pages, 2, 'only real PNGs are kept'); assert.equal(st.ver, 1);
    const p1 = await get(port, `/v/${key}/p1.png`);
    assert.equal(p1.code, 200); assert.equal(p1.type, 'image/png'); assert.deepEqual(p1.body, png);
    assert.equal((await get(port, `/v/${key}/p3.png`)).code, 404);
    assert.equal((await get(port, `/v/${'0'.repeat(32)}/`)).code, 404, 'a wrong key sees nothing');
    assert.equal((await get(port, '/')).code, 404);
    assert.equal((await get(port, `/v/${key}/`, 'POST')).code, 405, 'read-only');
    assert.equal((await get(port, `/v/${key}`)).code, 301);
  } finally { LV.stop(); }
  assert.equal(LV.info().on, false);
  await assert.rejects(get(r.port, '/'), 'nothing listens after stop');
});

test('a share link fits in a QR code that phones can read', () => {
  const q = Q.encode('http://192.168.1.23:41236/v/9f2c4e81b7a04d3fa1c2e5f6a7b8c9d0/', { ecc: 'M' });
  assert.equal(q.version, 4); assert.equal(q.size, 33);
  /* finder pattern corners and the always-dark module */
  assert.ok(q.get(0, 0) && q.get(6, 6) && !q.get(1, 1) && q.get(q.size - 1, 0) && q.get(0, q.size - 1) && q.get(8, q.size - 8));
  assert.match(Q.svg(q), /^<svg [^>]*viewBox="0 0 41 41"/);
  assert.throws(() => Q.encode('x'.repeat(3000), { ecc: 'H' }), /too long/);
});
