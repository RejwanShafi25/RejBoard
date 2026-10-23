'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../mfr-core.js');

const digest = b => Promise.resolve(crypto.createHash('sha256').update(Buffer.from(b)).digest().buffer);
const sha = b => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

/* A tiny byte-level BPE vocabulary in the same shape as the real tokenizer.json (Ġ = space, Î± = the two UTF-8 bytes of α). */
const TOK = { model: { type: 'BPE', vocab: { '<pad>': 0, '<s>': 1, '</s>': 2, '<unk>': 3, '<mask>': 4, '\\frac': 5, '{': 6, '}': 7, '1': 8, 'x': 9, 'Ġ': 10, 'Î±': 11, '\\alpha': 12, '^': 13, '2': 14 } } };
const V = C.vocabOf(TOK);

/* A fake reader that serves the given chunks, like ReadableStreamDefaultReader. */
function reader(chunks) {
  let k = 0, cancelled = false;
  return { cancelled: () => cancelled, read: async () => (k < chunks.length ? { done: false, value: chunks[k++] } : { done: true }), cancel: async () => { cancelled = true; } };
}

/* ---------------- the pinned model ---------------- */
test('every model file is pinned: https, exact size, SHA-256, and a fixed revision (never "main")', () => {
  assert.match(C.MODEL.rev, /^[0-9a-f]{40}$/);
  assert.ok(C.MODEL.files.length >= 4);
  for (const f of C.MODEL.files) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/, f.name);
    assert.ok(Number.isInteger(f.size) && f.size > 0, f.name);
    const u = new URL(C.fileUrl(f));
    assert.equal(u.protocol, 'https:', f.name);
    assert.ok(!/\/(main|master|latest)\//.test(u.pathname), f.name + ' must not point at a moving branch');
    assert.ok(u.pathname.includes(C.MODEL.rev) || /@\d+\.\d+\.\d+\//.test(u.pathname), f.name + ' must be pinned to a revision or exact version');
  }
  assert.equal(new Set(C.MODEL.files.map(f => f.key)).size, C.MODEL.files.length, 'keys are unique');
  assert.equal(C.totalSize(), C.MODEL.files.reduce((a, f) => a + f.size, 0));
});

test('the model licence is MIT, compatible with the app', () => {
  assert.equal(C.MODEL.licence, 'MIT');
});

/* ---------------- pixels ---------------- */
test('pixels: white is +1, black is -1, channels land in separate planes (NCHW)', () => {
  const n = C.SIDE * C.SIDE, rgba = new Uint8ClampedArray(n * 4).fill(255);
  rgba[0] = 0; rgba[1] = 255; rgba[2] = 127.5; // first pixel: R black, G white, B grey (127.5 is stored as 128)
  const x = C.pixels(rgba);
  assert.equal(x.length, 3 * n);
  assert.equal(x[0], -1);
  assert.equal(x[n], 1);
  assert.ok(Math.abs(x[2 * n] - (128 / 127.5 - 1)) < 1e-6);
  assert.equal(x[1], 1, 'the next pixel is white');
  assert.ok(x.every(v => v >= -1 && v <= 1));
});

test('pixels refuses anything that is not exactly a 384x384 RGBA image', () => {
  for (const bad of [null, undefined, 42, 'abc', {}, [], new Uint8Array(10), new Uint8Array(C.SIDE * C.SIDE * 3), new Uint8Array(C.SIDE * C.SIDE * 4 + 4)]) {
    assert.throws(() => C.pixels(bad), /384x384/);
  }
});

/* ---------------- tokenizer ---------------- */
test('vocabOf maps ids to tokens', () => {
  assert.equal(V[5], '\\frac');
  assert.equal(V.length, 15);
});

test('vocabOf rejects malformed or hostile tokenizer files', () => {
  const bad = [
    null, {}, { model: {} }, { model: { type: 'WordPiece', vocab: { a: 0 } } },
    { model: { type: 'BPE', vocab: ['a', 'b'] } },                 // array, not a map
    { model: { type: 'BPE', vocab: {} } },                         // empty
    { model: { type: 'BPE', vocab: { a: 0, b: 0 } } },             // duplicate id
    { model: { type: 'BPE', vocab: { a: 0, b: 5 } } },             // id out of range
    { model: { type: 'BPE', vocab: { a: 0, b: 1.5 } } },           // not an integer
    { model: { type: 'BPE', vocab: { a: 0, b: -1 } } },
    { model: { type: 'BPE', vocab: { a: '0' } } },
    { model: { type: 'BPE', vocab: { ['x'.repeat(65)]: 0 } } }      // absurdly long token
  ];
  for (const t of bad) assert.throws(() => C.vocabOf(t), /tokenizer/, JSON.stringify(t));
  const huge = {}; for (let i = 0; i < 9000; i++) huge['t' + i] = i;
  assert.throws(() => C.vocabOf({ model: { type: 'BPE', vocab: huge } }), /size/);
});

test('a "__proto__" token cannot pollute Object.prototype', () => {
  const t = JSON.parse('{"model":{"type":"BPE","vocab":{"__proto__":0,"a":1}}}');
  const v = C.vocabOf(t);
  assert.equal(v[0], '__proto__');
  assert.equal({}.a, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('decodeIds joins byte-level tokens, decodes UTF-8 and skips special ids', () => {
  assert.equal(C.decodeIds([5, 6, 8, 7, 6, 9, 7], V), '\\frac{1}{x}');
  assert.equal(C.decodeIds([1, 9, 10, 9, 2, 0, 3, 4], V), 'x x', 'Ġ is a space; <s> </s> <pad> <unk> <mask> vanish');
  assert.equal(C.decodeIds([11], V), 'α', 'two bytes -> one character');
});

test('decodeIds ignores ids it does not know instead of throwing', () => {
  assert.equal(C.decodeIds([9, -1, 99999, 1.5, NaN, null, '9', 9], V), 'xx');
  assert.equal(C.decodeIds([], V), '');
});

test('decodeIds turns broken UTF-8 into U+FFFD, never an exception', () => {
  const v = C.vocabOf({ model: { type: 'BPE', vocab: { '<pad>': 0, '<s>': 1, '</s>': 2, '<unk>': 3, '<mask>': 4, 'Î': 5 } } }); // a lone lead byte
  assert.equal(C.decodeIds([5], v), '\uFFFD');
});

/* ---------------- tidy / problems / unsafe ---------------- */
test('tidy removes the spaces the model puts between tokens (real model outputs)', () => {
  assert.equal(C.tidy('\\frac { 1 } { x }'), '\\frac{1}{x}');
  assert.equal(C.tidy('x ^ { 2 } + y ^ { 2 } = 1'), 'x^{2}+y^{2}=1');
  assert.equal(C.tidy('\\sin ( x ) + 3'), '\\sin(x)+3');
  assert.equal(C.tidy('a + b = c'), 'a+b=c');
  assert.equal(C.tidy('\\frac { 1 } { \\mathrm { X } }'), '\\frac{1}{\\mathrm{X}}');
});

test('tidy keeps a space where removing it would change the meaning', () => {
  assert.equal(C.tidy('\\alpha x'), '\\alpha x', '\\alphax would be an unknown command');
  assert.equal(C.tidy('\\cdot 2'), '\\cdot 2');
  assert.equal(C.tidy('\\int _ { 0 } ^ { 1 } x d x'), '\\int_{0}^{1}x d x');
  assert.equal(C.tidy('\\pi r ^ { 2 }'), '\\pi r^{2}');
});

test('tidy strips control characters, caps the length and survives junk input', () => {
  assert.equal(C.tidy('a\u0000+\u0007b\u001b'), 'a+b');
  assert.equal(C.tidy('  \n\t x \r\n '), 'x');
  assert.ok(C.tidy('x '.repeat(5000)).length <= 2000);
  for (const j of [null, undefined, 0, {}, []]) assert.equal(typeof C.tidy(j), 'string');
});

test('problems spots structurally broken LaTeX', () => {
  assert.deepEqual(C.problems('\\frac{1}{x}'), []);
  assert.deepEqual(C.problems('\\{ x \\}'), [], 'escaped braces are literal');
  assert.deepEqual(C.problems('\\left( x \\right)'), []);
  assert.deepEqual(C.problems('\\begin{matrix}a\\end{matrix}'), []);
  assert.ok(C.problems('\\frac{1}{x').includes('unbalanced braces'));
  assert.ok(C.problems('x}{').includes('unbalanced braces'));
  assert.ok(C.problems('\\left( x').some(p => /left/.test(p)));
  assert.ok(C.problems('\\leftarrow x').every(p => !/left/.test(p)), '\\leftarrow is not \\left');
  assert.ok(C.problems('\\begin{matrix}a').some(p => /begin/.test(p)));
});

test('unsafe flags MathJax commands that create links, styles or load code', () => {
  for (const s of ['\\href{javascript:alert(1)}{x}', '\\url{http://a}', '\\class{a}{x}', '\\cssId{a}{x}', '\\style{color:red}{x}', '\\require{html}', '\\data{a=1}{x}', 'x+\\href {u}{v}'])
    assert.ok(C.unsafe(s), s);
  for (const s of ['\\frac{1}{x}', '\\hrefx', '\\stylish', '\\mathrm{href}', 'href', '\\alpha', '', null]) assert.ok(!C.unsafe(s), String(s));
});

/* ---------------- decoding ---------------- */
const logitsFor = t => { const a = new Float32Array(V.length); a[t] = 1; return a; };

test('argmax picks the first highest score and is never fooled by NaN', () => {
  assert.equal(C.argmax([0, 3, 3, 1]), 1);
  assert.equal(C.argmax([NaN, -5, NaN, -1]), 3);
  assert.equal(C.argmax([-Infinity, -Infinity]), 0);
});

test('greedy starts from the decoder start token and stops at the end token', async () => {
  const seen = [];
  const plan = [5, 6, 8, 7, C.EOS];
  const r = await C.greedy(async ids => { seen.push(ids.slice()); return logitsFor(plan[ids.length - 1]); });
  assert.deepEqual(r, { ids: [5, 6, 8, 7], stopped: 'eos' });
  assert.deepEqual(seen[0], [C.BOS]);
  assert.equal(seen.length, 5);
});

test('greedy never runs past its hard token limit, however large maxTokens is', async () => {
  let k = 0;
  const r = await C.greedy(async () => logitsFor(5 + (k++ % 9)), { maxTokens: 1e9 }); // a never-ending, non-repeating-enough stream
  assert.ok(r.ids.length <= C.MAX_TOKENS);
  assert.ok(['limit', 'loop'].includes(r.stopped));
  const s = await C.greedy(async () => logitsFor(8), { maxTokens: 3 });
  assert.ok(s.ids.length <= 3);
});

test('greedy cuts a repetition loop and keeps one copy of the repeated part', async () => {
  const seq = [9, 13, 6, 14, 7]; // x^{2} ... then the model gets stuck repeating "+x"
  const r = await C.greedy(async ids => { const n = ids.length - 1; return logitsFor(n < seq.length ? seq[n] : (n - seq.length) % 2 ? 9 : 10); });
  assert.equal(r.stopped, 'loop');
  assert.ok(r.ids.length < 30);
  assert.deepEqual(r.ids.slice(0, 5), seq, 'the real formula survives');
});

test('loopTail only fires on a genuine repetition', () => {
  assert.equal(C.loopTail([1, 2, 3, 4, 5, 6, 7, 8]), 0);
  assert.equal(C.loopTail([7, 7, 7, 7, 7, 7]), 1);
  assert.equal(C.loopTail([1, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8]), 2);
  assert.equal(C.loopTail([9, 9, 9, 9, 9]), 0, 'five is not enough');
});

test('greedy stops when cancelled and when the decoder misbehaves', async () => {
  let n = 0;
  const r = await C.greedy(async () => logitsFor(5 + (n % 7)), { isCancelled: () => ++n > 3 });
  assert.equal(r.stopped, 'cancel');
  await assert.rejects(C.greedy(async () => null), /no logits/);
  await assert.rejects(C.greedy(async () => new Float32Array(0)), /no logits/);
  await assert.rejects(C.greedy(async () => { throw new Error('boom'); }), /boom/);
});

/* ---------------- download safety ---------------- */
test('readCapped returns exactly what the server sent, with progress', async () => {
  let got = 0;
  const out = await C.readCapped(reader([new Uint8Array([1, 2]), new Uint8Array([3])]), 3, { onBytes: b => { got += b; } });
  assert.deepEqual([...new Uint8Array(out)], [1, 2, 3]);
  assert.equal(got, 3);
});

test('readCapped refuses a server that sends more than the pinned size (no unbounded memory)', async () => {
  const rd = reader([new Uint8Array(4), new Uint8Array(1)]);
  await assert.rejects(C.readCapped(rd, 4), /larger than expected/);
  assert.ok(rd.cancelled(), 'the download is aborted');
  await assert.rejects(C.readCapped(reader([new Uint8Array(1e6)]), 10), /larger than expected/);
});

test('readCapped returns a short download as-is, so verify() rejects it', async () => {
  const f = { name: 'm.onnx', size: 4, sha256: sha(new Uint8Array([1, 2, 3, 4])) };
  const out = await C.readCapped(reader([new Uint8Array([1, 2])]), 4);
  assert.equal(out.byteLength, 2);
  await assert.rejects(C.verify(f, out, digest), /wrong size/);
});

test('readCapped stops on cancel and on garbage chunks', async () => {
  const rd = reader([new Uint8Array(1), new Uint8Array(1)]);
  await assert.rejects(C.readCapped(rd, 10, { isCancelled: () => true }), /cancelled/);
  assert.ok(rd.cancelled());
  await assert.rejects(C.readCapped(reader(['abc']), 10), /bad download data/);
  await assert.rejects(C.readCapped(reader([null]), 10), /bad download data/);
});

test('verify accepts only the exact pinned bytes', async () => {
  const good = new Uint8Array([10, 20, 30]), f = { name: 'enc.onnx', size: 3, sha256: sha(good) };
  assert.equal(await C.verify(f, good.buffer, digest), true);
  await assert.rejects(C.verify(f, new Uint8Array([10, 20, 31]).buffer, digest), /checksum mismatch/, 'one changed byte');
  await assert.rejects(C.verify(f, new Uint8Array([10, 20]).buffer, digest), /wrong size/);
  await assert.rejects(C.verify(f, null, digest), /wrong size/);
});

test('verify checks the size before hashing (a huge wrong file is not hashed)', async () => {
  let hashed = false;
  const f = { name: 'x', size: 3, sha256: '0'.repeat(64) };
  await assert.rejects(C.verify(f, new ArrayBuffer(10), async b => { hashed = true; return digest(b); }), /wrong size/);
  assert.equal(hashed, false);
});

test('hex encodes bytes as lowercase, zero-padded pairs', () => {
  assert.equal(C.hex(new Uint8Array([0, 15, 16, 255]).buffer), '000f10ff');
});
