/* RejBoard handwriting -> LaTeX worker. Runs the pix2text-mfr model with ONNX Runtime (WebAssembly) off the main thread, so inking never stalls.

   The model is NOT bundled: the first use downloads the pinned files listed in mfr-core.js (about 132 MB), checks every byte against its
   SHA-256 hash and keeps them in this app's IndexedDB. After that, recognition is fully offline and nothing about the ink leaves the device.

   Messages in:  {id, op:'status'} | {id, op:'install'} | {id, op:'cancel'} | {id, op:'remove'} | {id, op:'recognize', rgba: Uint8ClampedArray 384x384}
   Messages out: {id, ok:true, ...result} | {id, ok:false, error} | {id, progress:{done, total}} while installing */
'use strict';
importScripts('mfr-core.js');
const C = self.MfrCore;

/* ---------- storage: one IndexedDB store, keyed by "<model revision>/<file name>" ---------- */
const DBN = 'rejmodels', OS = 'f';
const keyOf = f => C.MODEL.rev + '/' + f.name;
let dbp = null;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const q = indexedDB.open(DBN, 1);
    q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains(OS)) q.result.createObjectStore(OS); };
    q.onsuccess = () => { q.result.onversionchange = () => { q.result.close(); dbp = null; }; res(q.result); };
    q.onerror = () => { dbp = null; rej(new Error('local storage is unavailable')); };
  }));
}
async function op(mode, f) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(OS, mode), q = f(t.objectStore(OS));
    let out; if (q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error && t.error.name === 'QuotaExceededError' ? new Error('not enough free disk space') : new Error('could not use local storage'));
  });
}
const getFile = f => op('readonly', s => s.get(keyOf(f)));
const putFile = (f, buf) => op('readwrite', s => s.put(buf, keyOf(f)));
const keys = () => op('readonly', s => s.getAllKeys());

async function status() {
  const k = new Set(await keys());
  const have = C.MODEL.files.filter(f => k.has(keyOf(f)));
  return { installed: have.length === C.MODEL.files.length, bytes: have.reduce((a, f) => a + f.size, 0), total: C.totalSize() };
}

/* ---------- download: streamed into a buffer of exactly the pinned size, then hash-checked before it is stored ---------- */
let cancelled = false;
const digest = b => crypto.subtle.digest('SHA-256', b);
async function download(f, onBytes) {
  const r = await fetch(C.fileUrl(f), { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!r.ok || !r.body) throw new Error('download failed (' + f.name + ': HTTP ' + r.status + ')');
  const out = await C.readCapped(r.body.getReader(), f.size, { isCancelled: () => cancelled, onBytes });
  await C.verify(f, out, digest);
  return out;
}
async function install(post) {
  if (!(self.crypto && crypto.subtle)) throw new Error('downloads cannot be verified here (needs a secure https:// or app context)');
  cancelled = false;
  const have = new Set(await keys()), total = C.totalSize();
  let done = C.MODEL.files.filter(f => have.has(keyOf(f))).reduce((a, f) => a + f.size, 0), last = 0;
  post({ done, total });
  for (const f of C.MODEL.files) {
    if (have.has(keyOf(f))) continue;
    const buf = await download(f, b => { done += b; const t = Date.now(); if (t - last > 150) { last = t; post({ done, total }); } });
    await putFile(f, buf);
  }
  post({ done: total, total });
  return status();
}
async function remove() {
  unload();
  await op('readwrite', s => s.clear());
  return status();
}

/* ---------- inference ---------- */
let rt = null, enc = null, dec = null, vocab = null;
const tickCh = new MessageChannel(), tickQ = [];
tickCh.port1.onmessage = () => { const f = tickQ.shift(); if (f) f(); };
const tick = () => new Promise(r => { tickQ.push(r); tickCh.port2.postMessage(0); }); // a macrotask turn, without setTimeout's 4 ms clamp
function unload() { for (const s of [enc, dec]) { try { s && s.release(); } catch (_) {} } enc = dec = vocab = null; }
async function load() {
  if (enc && dec && vocab) return;
  const F = {};
  for (const f of C.MODEL.files) {
    const b = await getFile(f);
    if (!b) throw new Error('the math recognition model is not installed');
    await C.verify(f, b, digest); // catches a damaged or tampered local copy, not just a bad download
    F[f.key] = b;
  }
  if (!rt) {
    importScripts('vendor/ort/ort.wasm.min.js');
    rt = self.ort;
    rt.env.wasm.wasmPaths = { mjs: new URL('vendor/ort/ort-wasm-simd-threaded.mjs', self.location).href };
    rt.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
    rt.env.wasm.proxy = false;
  }
  rt.env.wasm.wasmBinary = F.wasm;
  vocab = C.vocabOf(JSON.parse(new TextDecoder().decode(F.tok)));
  const o = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  enc = await rt.InferenceSession.create(new Uint8Array(F.enc), o);
  dec = await rt.InferenceSession.create(new Uint8Array(F.dec), o);
}
async function recognize(rgba) {
  const x = C.pixels(rgba); // validates the size before anything runs
  cancelled = false;
  const t0 = Date.now();
  await load();
  const h = (await enc.run({ pixel_values: new rt.Tensor('float32', x, [1, 3, C.SIDE, C.SIDE]) })).last_hidden_state;
  const r = await C.greedy(async ids => {
    await tick(); // the engine runs synchronously: give a pending "cancel" message its turn between tokens
    const lg = (await dec.run({ input_ids: new rt.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]), encoder_hidden_states: h })).logits;
    const V = lg.dims[2];
    return lg.data.subarray((ids.length - 1) * V, ids.length * V);
  }, { isCancelled: () => cancelled });
  if (r.stopped === 'cancel') throw new Error('cancelled');
  const latex = C.tidy(C.decodeIds(r.ids, vocab));
  if (C.unsafe(latex)) throw new Error('the result contained a command that is not allowed here');
  return { latex, stopped: r.stopped, problems: C.problems(latex), ms: Date.now() - t0 };
}

/* ---------- messages: one job at a time; cancel is handled immediately ---------- */
let busy = false;
self.onmessage = async e => {
  const m = e.data || {}, id = m.id;
  if (m.op === 'cancel') { cancelled = true; return self.postMessage({ id, ok: true }); }
  if (busy) return self.postMessage({ id, ok: false, error: 'still busy with the previous request' });
  busy = true;
  try {
    let r;
    if (m.op === 'status') r = await status();
    else if (m.op === 'install') r = await install(p => self.postMessage({ id, progress: p }));
    else if (m.op === 'remove') r = await remove();
    else if (m.op === 'recognize') r = await recognize(m.rgba);
    else throw new Error('unknown request');
    self.postMessage(Object.assign({ id, ok: true }, r));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err).slice(0, 300) });
  } finally { busy = false; }
};
