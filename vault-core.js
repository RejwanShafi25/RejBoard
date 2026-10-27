/* RejBoard per-board encryption ("Lock with password"). WebCrypto only: runs in the app (as the global `VaultCore`) and under `node --test`.

   - Every protected board has its own random 256-bit content key. The password never encrypts content directly: PBKDF2-SHA-256
     (600,000 iterations, random 16-byte salt) turns it into a key that wraps the content key. Changing the password re-wraps only that.
   - Content (ink, text, images, PDF pages, layers, paper, thumbnail, search text) is sealed with AES-256-GCM: a wrong password, a changed
     byte or a swapped field fails loudly instead of decrypting to garbage.
   - Title, tags, folder, dates and favourite stay readable, so the board can be listed and sorted without the password.
   - Headers read from a file are untrusted: sizes and iteration counts are checked before any work (no 10^12-iteration denial of service). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VaultCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1, ITER = 600000, ITER_MIN = 100000, ITER_MAX = 5000000;
  const AAD = new TextEncoder().encode('rejboard-vault-1');
  /* the fields that are encrypted; everything else on the record stays as it is */
  const CONTENT = ['items', 'bg', 'pat', 'gs', 'gd', 'layers', 'bms', 'pg', 'q', 'pq', 'hq', 'hs', 'hsAt', 'th'];
  const MAX_CT = 1.5 * 1024 * 1048576; // refuse absurd ciphertexts before allocating

  const C = () => { const c = globalThis.crypto; if (!c || !c.subtle) throw new Error('encryption is not available here (needs a secure context)'); return c; };
  const rnd = n => C().getRandomValues(new Uint8Array(n));

  /* ---------- base64 for large buffers ----------
     Native Uint8Array.toBase64/fromBase64 (Chromium 140+, recent Firefox and Safari) is ~15x faster than building strings; Node's
     Buffer next; the chunked string version is the fallback for older browsers. All three produce the same text. */
  const NATIVE = typeof Uint8Array.prototype.toBase64 === 'function' && typeof Uint8Array.fromBase64 === 'function';
  const NODEBUF = !NATIVE && typeof Buffer === 'function' && typeof Buffer.from === 'function';
  function b64(u8) {
    if (NATIVE) return u8.toBase64();
    if (NODEBUF) return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = '';
    for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
    return btoa(s);
  }
  function unb64(s, max = MAX_CT) {
    if (typeof s !== 'string' || s.length > max * 1.4 + 16 || s.length % 4 !== 0) throw new Error('damaged protected data');
    /* native decoding rejects bad characters itself; anything that slips through fails AES-GCM authentication anyway */
    if (NATIVE) { try { return Uint8Array.fromBase64(s); } catch (e) { throw new Error('damaged protected data'); } }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('damaged protected data');
    if (NODEBUF) return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    return u;
  }

  /* ---------- keys ---------- */
  async function passKey(password, salt, it) {
    const base = await C().subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return C().subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const contentKey = raw => C().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  async function gcm(key, data) { const iv = rnd(12), ct = new Uint8Array(await C().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, data)); const o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); return o; }
  async function ungcm(key, box) { if (!(box instanceof Uint8Array) || box.length < 28) throw new Error('damaged protected data'); return new Uint8Array(await C().subtle.decrypt({ name: 'AES-GCM', iv: box.subarray(0, 12), additionalData: AAD }, key, box.subarray(12))); }

  /* untrusted header -> checked header, or throws */
  function checkHead(h) {
    if (!h || typeof h !== 'object' || h.v !== VERSION || h.kdf !== 'PBKDF2-SHA256') throw new Error('unsupported protection format');
    if (!Number.isInteger(h.it) || h.it < ITER_MIN || h.it > ITER_MAX) throw new Error('unsupported protection settings');
    const salt = unb64(h.salt, 64), wk = unb64(h.wk, 128);
    if (salt.length !== 16 || wk.length !== 12 + 32 + 16) throw new Error('damaged protected data');
    return { salt, wk, it: h.it };
  }

  /* A new vault for a board: {key (CryptoKey), head (store this)} */
  async function create(password, it = ITER) {
    if (typeof password !== 'string' || !password) throw new Error('a password is required');
    const raw = rnd(32), salt = rnd(16);
    try {
      const wk = await gcm(await passKey(password, salt, it), raw);
      return { key: await contentKey(raw), head: { v: VERSION, kdf: 'PBKDF2-SHA256', it, salt: b64(salt), wk: b64(wk) } };
    } finally { raw.fill(0); }
  }
  /* password + head -> content key. A wrong password throws 'wrong password' (the authentication tag does not match). */
  async function open(password, head) {
    const h = checkHead(head);
    let raw;
    try { raw = await ungcm(await passKey(String(password == null ? '' : password), h.salt, h.it), h.wk); }
    catch (e) { throw new Error('wrong password'); }
    try { return await contentKey(raw); } finally { raw.fill(0); }
  }
  /* new password for the same content key: content does not need to be re-encrypted */
  async function rewrap(oldPassword, newPassword, head, it = ITER) {
    const h = checkHead(head);
    if (typeof newPassword !== 'string' || !newPassword) throw new Error('a password is required');
    let raw;
    try { raw = await ungcm(await passKey(String(oldPassword), h.salt, h.it), h.wk); } catch (e) { throw new Error('wrong password'); }
    try { const salt = rnd(16), wk = await gcm(await passKey(newPassword, salt, it), raw); return { v: VERSION, kdf: 'PBKDF2-SHA256', it, salt: b64(salt), wk: b64(wk) }; }
    finally { raw.fill(0); }
  }

  /* ---------- payload: JSON for everything, with ink points as raw float64 numbers after it ----------
     Writing hundreds of thousands of points as JSON text costs ~10x more than copying them, and every autosave of a protected
     board pays it. Layout: "RBV2" | u32 json length | json | zero padding to 8 bytes | float64 data. A stroke's pts become {__o, __n}
     (offset and count in the float64 data) plus __w (numbers per point). Payloads from the first format (plain JSON) still open. */
  const MAGIC = [0x52, 0x42, 0x56, 0x32]; // "RBV2"
  function flat(P) {
    if (!Array.isArray(P) || !P.length || !Array.isArray(P[0])) return null;
    const w = P[0].length;
    if (!(w > 0 && w <= 8)) return null;
    const f = new Float64Array(P.length * w);
    let o = 0;
    for (const q of P) { if (!Array.isArray(q) || q.length !== w) return null; for (let m = 0; m < w; m++) { const v = q[m]; if (typeof v !== 'number') return null; f[o++] = v; } }
    return { f, w };
  }
  function encodeBody(body) {
    const parts = [];
    let floats = 0;
    const items = (Array.isArray(body.items) ? body.items : []).map(i => {
      const fl = i && typeof i === 'object' ? flat(i.pts) : null;
      if (!fl) return i;
      parts.push(fl.f); const o = floats; floats += fl.f.length;
      return { ...i, pts: { __o: o, __n: fl.f.length }, __w: fl.w };
    });
    const json = new TextEncoder().encode(JSON.stringify({ ...body, items }));
    const at = (8 + json.length + 7) & ~7, buf = new Uint8Array(at + floats * 8), dv = new DataView(buf.buffer);
    buf.set(MAGIC); dv.setUint32(4, json.length, true); buf.set(json, 8);
    const f64 = new Float64Array(buf.buffer, at, floats);
    let o = 0; for (const p of parts) { f64.set(p, o); o += p.length; }
    return buf;
  }
  function decodeBody(u) {
    if (!(u.length >= 8 && MAGIC.every((b, k) => u[k] === b))) return JSON.parse(new TextDecoder().decode(u)); // first format
    const len = new DataView(u.buffer, u.byteOffset, u.byteLength).getUint32(4, true);
    if (8 + len > u.length) throw new Error('damaged protected data');
    const body = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + len)));
    const at = (8 + len + 7) & ~7, n = Math.floor((u.length - at) / 8);
    const f64 = n > 0 ? new Float64Array(u.slice(at, at + n * 8).buffer) : new Float64Array(0);
    if (body && Array.isArray(body.items)) for (const i of body.items) {
      if (!i || typeof i !== 'object' || !i.pts || typeof i.pts !== 'object' || Array.isArray(i.pts) || !('__o' in i.pts)) continue;
      const o = i.pts.__o, c = i.pts.__n, w = i.__w;
      delete i.__w;
      if (!(Number.isInteger(o) && Number.isInteger(c) && Number.isInteger(w) && w > 0 && w <= 8 && o >= 0 && c >= 0 && c % w === 0 && o + c <= n)) { i.pts = []; continue; }
      const P = new Array(c / w);
      for (let j = 0, p = o; j < P.length; j++) { const q = new Array(w); for (let m = 0; m < w; m++) q[m] = f64[p++]; P[j] = q; }
      i.pts = P;
    }
    return body;
  }

  /* ---------- records ---------- */
  /* plain board record -> stored protected record (content sealed, readable metadata kept). */
  async function seal(rec, key, head) {
    const body = {}, out = {};
    for (const k in rec) { if (k === 'enc') continue; if (CONTENT.includes(k)) body[k] = rec[k]; else out[k] = rec[k]; }
    if (!('items' in body)) body.items = [];
    const box = await gcm(key, encodeBody(body));
    out.items = []; out.th = ''; out.locked = 'enc';
    out.enc = { head, box: b64(box) };
    return out;
  }
  /* stored protected record -> plain record (for the editor; never written back as is) */
  async function unseal(rec, key) {
    if (!rec || !rec.enc || typeof rec.enc.box !== 'string') throw new Error('not a protected board');
    let body;
    let raw;
    try { raw = await ungcm(key, unb64(rec.enc.box)); } catch (e) { throw new Error('this board could not be decrypted (wrong password, or the data was changed)'); }
    try { body = decodeBody(raw); } catch (e) { throw new Error('damaged protected data'); }
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) throw new Error('damaged protected data');
    const out = {};
    for (const k in rec) if (k !== 'enc' && !CONTENT.includes(k)) out[k] = rec[k];
    for (const k of CONTENT) if (k in body) out[k] = body[k];
    return out;
  }
  /* bytes (a voice recording) <-> sealed bytes */
  const sealBytes = (key, bytes) => gcm(key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const unsealBytes = (key, bytes) => ungcm(key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  const isProtected = r => !!(r && r.enc && typeof r.enc === 'object');
  /* the pre-encryption "lock": a SHA-256 (or FNV) hash of the password in `locked`, content in plain text */
  const isLegacy = r => !!(r && typeof r.locked === 'string' && r.locked !== 'enc' && !r.enc);

  return { VERSION, ITER, CONTENT, encodeBody, decodeBody, create, open, rewrap, seal, unseal, sealBytes, unsealBytes, isProtected, isLegacy, checkHead, b64, unb64 };
});
