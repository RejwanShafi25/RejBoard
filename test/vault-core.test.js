'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../vault-core.js');
const { rng, board } = require('./helpers');

const IT = 100000; // the minimum the format accepts; keeps the tests quick
const plain = () => ({ id: 'b1', title: 'Diary', tags: 'private', parent: 'f1', fav: true, t: 5, ct: 1, mt: 4, items: board(rng(7), 30), bg: '#fff', pat: 'grid', layers: [{ id: 1 }], pg: { size: 'inf' }, q: 'secret words', pq: 'pdf words', hq: 'handwritten words', th: 'data:image/png;base64,AAAA' });

test('seal hides every piece of content and keeps the listing fields readable', async () => {
  const { key, head } = await V.create('correct horse', IT);
  const s = await V.seal(plain(), key, head);
  const json = JSON.stringify(s);
  for (const leak of ['secret words', 'pdf words', 'handwritten words', 'hello', 'AAAA', '"grid"', '#fff']) assert.ok(!json.includes(leak), 'leaks ' + leak);
  assert.deepEqual(s.items, []);
  assert.equal(s.th, '');
  assert.equal(s.locked, 'enc');
  for (const k of ['id', 'title', 'tags', 'parent', 'fav', 't', 'ct', 'mt']) assert.deepEqual(s[k], plain()[k], k);
  assert.ok(!json.includes('correct horse'), 'the password is never stored');
});

test('the right password restores the board exactly', async () => {
  const { key, head } = await V.create('pa55 wörd', IT);
  const s = await V.seal(plain(), key, head);
  const k2 = await V.open('pa55 wörd', s.enc.head);
  const back = await V.unseal(s, k2);
  assert.equal(back.locked, 'enc', 'still marked as protected, so saving seals it again');
  delete back.locked;
  assert.deepEqual(back, plain());
  assert.ok(!('enc' in back), 'no ciphertext travels with the opened board');
});

test('a wrong password fails, it never yields garbage', async () => {
  const { key, head } = await V.create('right', IT);
  for (const w of ['wrong', 'Right', 'right ', '', null, undefined]) await assert.rejects(V.open(w, head), /wrong password/, String(w));
});

test('passwords are compared after Unicode normalization (é typed two ways)', async () => {
  const { head } = await V.create('café', IT);
  await V.open('café', head);
});

test('each board gets its own salt and key; the same content seals differently every time', async () => {
  const a = await V.create('same', IT), b = await V.create('same', IT);
  assert.notEqual(a.head.salt, b.head.salt);
  assert.notEqual(a.head.wk, b.head.wk);
  const s1 = await V.seal(plain(), a.key, a.head), s2 = await V.seal(plain(), a.key, a.head);
  assert.notEqual(s1.enc.box, s2.enc.box, 'random IV per seal');
  await assert.rejects(V.unseal(s1, b.key), /could not be decrypted/, 'another board\'s key cannot open it');
});

test('tampering with any byte of the sealed content is detected', async () => {
  const { key, head } = await V.create('pw', IT);
  const s = await V.seal(plain(), key, head);
  const u = V.unb64(s.enc.box);
  for (const at of [0, 11, 12, 40, u.length - 1]) {
    const t = u.slice(); t[at] ^= 1;
    await assert.rejects(V.unseal({ ...s, enc: { ...s.enc, box: V.b64(t) } }, key), /could not be decrypted/, 'byte ' + at);
  }
  await assert.rejects(V.unseal({ ...s, enc: { ...s.enc, box: 'not base64!!' } }, key));
  await assert.rejects(V.unseal({ ...s, enc: { ...s.enc, box: V.b64(u.subarray(0, 20)) } }, key), /damaged|decrypted/);
});

test('changing the password re-wraps the key: old password stops working, content still opens', async () => {
  const v = await V.create('old', IT);
  const s = await V.seal(plain(), v.key, v.head);
  const head2 = await V.rewrap('old', 'new', s.enc.head, IT);
  await assert.rejects(V.open('old', head2), /wrong password/);
  const back = await V.unseal(s, await V.open('new', head2));
  assert.equal(back.q, 'secret words');
  await assert.rejects(V.rewrap('nope', 'x', s.enc.head, IT), /wrong password/);
  await assert.rejects(V.rewrap('old', '', s.enc.head, IT), /required/);
});

test('hostile headers are refused before any expensive work', async () => {
  const { head } = await V.create('pw', IT);
  const bad = [null, {}, { ...head, v: 2 }, { ...head, kdf: 'MD5' }, { ...head, it: 1e12 }, { ...head, it: 10 }, { ...head, it: 1.5e5 + 0.5 },
    { ...head, salt: 'AAAA' }, { ...head, wk: V.b64(new Uint8Array(10)) }, { ...head, salt: 'x'.repeat(1e6) }, { ...head, wk: 5 }];
  for (const h of bad) {
    const t = Date.now();
    await assert.rejects(V.open('pw', h), /unsupported|damaged/, JSON.stringify(h).slice(0, 60));
    assert.ok(Date.now() - t < 200, 'refused quickly');
  }
});

test('the default work factor is the current recommendation', () => {
  assert.ok(V.ITER >= 600000);
});

test('voice recordings are sealed too, and tampering is caught', async () => {
  const { key } = await V.create('pw', IT);
  const audio = new Uint8Array(5000).map((_, k) => k & 255);
  const s = await V.sealBytes(key, audio);
  assert.notDeepEqual(s.subarray(12, 40), audio.subarray(0, 28));
  assert.deepEqual(await V.unsealBytes(key, s), audio);
  s[100] ^= 1;
  await assert.rejects(V.unsealBytes(key, s));
});

test('legacy (hash-only) locks are recognised so they can be upgraded', () => {
  assert.equal(V.isLegacy({ locked: 'a'.repeat(64) }), true);
  assert.equal(V.isLegacy({ locked: 'enc', enc: {} }), false);
  assert.equal(V.isLegacy({}), false);
  assert.equal(V.isProtected({ enc: { box: '' } }), true);
});

test('ink points are stored as exact binary numbers (no JSON rounding, -0 kept)', () => {
  const items = [{ t: 's', pts: [[0.1 + 0.2, -0, 1e-300, 5], [Math.PI, 2, 3, 4]] }, { t: 't', text: 'x' }, { t: 's', pts: [[1, 2]] }, { t: 's', pts: [[1, 2], [3]] }];
  const back = V.decodeBody(V.encodeBody({ items, bg: '#fff' }));
  assert.deepEqual(back.items[0].pts, items[0].pts);
  assert.ok(Object.is(back.items[0].pts[0][1], -0));
  assert.deepEqual(back.items[1], { t: 't', text: 'x' });
  assert.deepEqual(back.items[2].pts, [[1, 2]]);
  assert.deepEqual(back.items[3].pts, [[1, 2], [3]], 'a ragged stroke stays in the JSON part, unchanged');
  assert.ok(!('__w' in back.items[0]));
  assert.equal(back.bg, '#fff');
});

test('boards sealed in the first (plain JSON) format still open', async () => {
  const { key, head } = await V.create('pw', IT);
  const s = await V.seal(plain(), key, head);
  const u = await V.unsealBytes(key, V.unb64(s.enc.box)); // the current format...
  const legacyBox = await V.sealBytes(key, new TextEncoder().encode(JSON.stringify({ items: [{ t: 't', text: 'old format' }], bg: '#000' })));
  const back = await V.unseal({ ...s, enc: { ...s.enc, box: V.b64(legacyBox) } }, key);
  assert.equal(back.items[0].text, 'old format');
  assert.equal(back.bg, '#000');
  assert.equal(String.fromCharCode(...u.subarray(0, 4)), 'RBV2', '...starts with the binary marker');
});

test('corrupt point references degrade to an empty stroke, never a crash or an out-of-bounds read', () => {
  const buf = V.encodeBody({ items: [{ t: 's', pts: [[1, 2], [3, 4]] }] });
  const len = new DataView(buf.buffer).getUint32(4, true);
  const mk = ref => { const j = new TextEncoder().encode(JSON.stringify({ items: [{ t: 's', pts: ref, __w: 2 }] })), at = (8 + j.length + 7) & ~7, out = new Uint8Array(at + 32); out.set(buf.subarray(0, 4)); new DataView(out.buffer).setUint32(4, j.length, true); out.set(j, 8); return out; };
  for (const ref of [{ __o: 3, __n: 4 }, { __o: -1, __n: 2 }, { __o: 0, __n: 3 }, { __o: 0, __n: 1e9 }, { __o: 'a', __n: 2 }, { __o: 0.5, __n: 2 }])
    assert.deepEqual(V.decodeBody(mk(ref)).items[0].pts, [], JSON.stringify(ref));
  assert.ok(len > 0);
  const bad = buf.slice(); new DataView(bad.buffer).setUint32(4, 1e9, true);
  assert.throws(() => V.decodeBody(bad), /damaged/);
});

test('sealing a large board is fast enough for autosave', async () => {
  const items = board(rng(1), 3000).map(i => i.pts ? { ...i, pts: Array.from({ length: 70 }, (_, k) => [k * 1.1, k * 2.2, 0.5, 0]) } : i); // ~210,000 points
  const { key, head } = await V.create('pw', IT);
  await V.seal({ id: 'w', items: items.slice(0, 50) }, key, head); // warm up
  const t = performance.now(), s = await V.seal({ id: 'x', items }, key, head), ms = performance.now() - t;
  assert.ok(ms < 120, 'seal took ' + Math.round(ms) + ' ms (was ~250 ms with JSON points)');
  const back = await V.unseal(s, key);
  assert.deepEqual(back.items[5].pts, items[5].pts);
});

test('large boards round-trip (base64 is chunked)', async () => {
  const { key, head } = await V.create('pw', IT);
  const r = { id: 'x', items: [{ t: 'i', src: 'data:image/png;base64,' + 'Q'.repeat(3e6) }] };
  const back = await V.unseal(await V.seal(r, key, head), key);
  assert.equal(back.items[0].src.length, r.items[0].src.length);
});
