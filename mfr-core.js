/* RejBoard handwriting -> LaTeX core: the pure logic behind "✍→∑" (math formula recognition).
   No DOM, no network and no model runtime in here, so it runs in the recognition worker (as the global `MfrCore`) and under `node --test`.

   - Model:    the pinned pix2text-mfr files (MIT licence) with their exact sizes and SHA-256 hashes. Nothing else is ever downloaded.
   - Pixels:   a 384x384 RGBA image -> the normalized float tensor the encoder expects.
   - Decode:   greedy token-by-token decoding with hard limits, plus a guard against the model looping on the same tokens.
   - Tokens:   byte-level BPE ids -> text, and tidying the result into readable LaTeX. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MfrCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- the model (pinned: a changed or swapped file fails the hash check) ---------- */
  const MODEL = {
    repo: 'breezedeus/pix2text-mfr',
    rev: 'bea257edb2653f2ae413b084f2ac0e8299d08df0',
    licence: 'MIT',
    files: [
      { key: 'tok', name: 'tokenizer.json', size: 39161, sha256: '3e2ab757277d22639bec28c9d7972e352d3d1dba223051fa674002dc5ab64df3' },
      { key: 'dec', name: 'decoder_model.onnx', size: 30114937, sha256: 'fd0f92d7a012f3dae41e1ac79421aea0ea888b5a66cb3f9a004e424f82f3daed' },
      { key: 'enc', name: 'encoder_model.onnx', size: 87496990, sha256: 'bd8d5c322792e9ec45793af5569e9748f82a3d728a9e00213dbfc56c1486f37d' },
      /* the ONNX Runtime WebAssembly engine is downloaded with the model so the installer does not grow; its small loader ships in vendor/ort/ */
      { key: 'wasm', name: 'ort-wasm-simd-threaded.wasm', size: 14239897, sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
        url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm' }
    ]
  };
  const fileUrl = f => f.url || 'https://huggingface.co/' + MODEL.repo + '/resolve/' + MODEL.rev + '/' + f.name;
  const totalSize = () => MODEL.files.reduce((a, f) => a + f.size, 0);

  const SIDE = 384;            // encoder input is SIDE x SIDE
  const BOS = 2, EOS = 2;      // decoder_start_token_id / eos_token_id from generation_config.json
  const SPECIAL_MAX = 4;       // ids 0..4 are <pad> <s> </s> <unk> <mask>
  const MAX_TOKENS = 256;      // generation hard stop
  const MAX_VOCAB = 8192;
  const MAX_LATEX = 2000;

  /* ---------- pixels ---------- */
  /* RGBA bytes of a SIDE x SIDE image -> Float32Array in NCHW order, rescaled to 0..1 and normalized with mean 0.5 / std 0.5 (DeiTImageProcessor). */
  function pixels(rgba) {
    if (!rgba || typeof rgba.length !== 'number' || rgba.length !== SIDE * SIDE * 4) throw new Error('image must be ' + SIDE + 'x' + SIDE + ' RGBA');
    const n = SIDE * SIDE, out = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = rgba[j] / 127.5 - 1;
      out[n + i] = rgba[j + 1] / 127.5 - 1;
      out[2 * n + i] = rgba[j + 2] / 127.5 - 1;
    }
    return out;
  }

  /* ---------- tokenizer ---------- */
  /* GPT-2 style byte <-> printable character table used by byte-level BPE. */
  const BYTE_OF = (() => {
    const bs = [];
    for (let b = 33; b <= 126; b++) bs.push(b);
    for (let b = 161; b <= 172; b++) bs.push(b);
    for (let b = 174; b <= 255; b++) bs.push(b);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
    const m = new Map();
    for (let k = 0; k < bs.length; k++) m.set(String.fromCharCode(cs[k]), bs[k]);
    return m;
  })();

  /* tokenizer.json (already parsed) -> array of token strings by id. Throws on anything that is not a small byte-level BPE vocabulary. */
  function vocabOf(tok) {
    const v = tok && tok.model && tok.model.type === 'BPE' ? tok.model.vocab : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('tokenizer: not a BPE vocabulary');
    const keys = Object.keys(v);
    if (!keys.length || keys.length > MAX_VOCAB) throw new Error('tokenizer: bad vocabulary size');
    const out = new Array(keys.length);
    for (const k of keys) {
      const id = v[k];
      if (!Number.isInteger(id) || id < 0 || id >= keys.length || out[id] !== undefined || k.length > 64) throw new Error('tokenizer: bad entry');
      out[id] = k;
    }
    return out;
  }

  /* Token ids -> text. Special tokens and unknown ids are skipped; bytes that are not valid UTF-8 become U+FFFD instead of throwing. */
  function decodeIds(ids, vocab) {
    const bytes = [];
    for (const id of ids) {
      if (!Number.isInteger(id) || id <= SPECIAL_MAX || id >= vocab.length) continue;
      for (const ch of vocab[id]) { const b = BYTE_OF.get(ch); if (b !== undefined) bytes.push(b); }
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }

  /* ---------- LaTeX tidying ---------- */
  /* The model writes "\frac { 1 } { x }". Remove the spaces that carry no meaning, but keep the one that ends a command before a letter ("\alpha x"). */
  function tidy(s) {
    let t = String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (t.length > MAX_LATEX) t = t.slice(0, MAX_LATEX);
    let out = '', i = 0;
    while (i < t.length) {
      const c = t[i];
      if (c !== ' ') { out += c; i++; continue; }
      const prev = out[out.length - 1] || '', next = t[i + 1] || '';
      const cmdEnd = /[a-zA-Z]/.test(prev) && /\\[a-zA-Z]*$/.test(out) && /[a-zA-Z0-9]/.test(next); // "\alpha x", "\cdot 2"
      const words = /[a-zA-Z]/.test(prev) && /[a-zA-Z]/.test(next) && !/[{}^_]/.test(prev); // "\text { a b }" style words, "d x"
      if (cmdEnd || words) out += ' ';
      i++;
    }
    return out;
  }

  /* Problems that make the result untrustworthy. An empty list means the LaTeX is structurally sound. */
  function problems(s) {
    const p = [];
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; } // skip the escaped character (\{ and \} are literal braces)
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth < 0) break;
    }
    if (depth !== 0) p.push('unbalanced braces');
    const L = (s.match(/\\left(?![a-zA-Z])/g) || []).length, R = (s.match(/\\right(?![a-zA-Z])/g) || []).length;
    if (L !== R) p.push('unmatched \\left / \\right');
    if (/\\begin\{/.test(s) && (s.match(/\\begin\{/g) || []).length !== (s.match(/\\end\{/g) || []).length) p.push('unmatched \\begin / \\end');
    return p;
  }

  /* ---------- greedy decoding ---------- */
  function argmax(a) {
    let best = 0, bv = -Infinity;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (v > bv) { bv = v; best = i; } } // NaN never wins
    return best;
  }

  /* Length of the shortest repeating unit at the end of ids that repeats at least `times` times in a row, or 0. */
  function loopTail(ids, times = 6, maxUnit = 8) {
    for (let u = 1; u <= maxUnit; u++) {
      if (ids.length < u * times) break;
      let ok = true;
      for (let k = ids.length - u * times; k < ids.length - u && ok; k++) if (ids[k] !== ids[k + u]) ok = false;
      if (ok) return u;
    }
    return 0;
  }

  /* step(ids) -> logits of the NEXT token (array-like, vocabulary length). Returns { ids, stopped: 'eos' | 'limit' | 'loop' | 'cancel' }.
     isCancelled() is checked between steps so a closed dialog stops the work. */
  async function greedy(step, { maxTokens = MAX_TOKENS, isCancelled } = {}) {
    const ids = [BOS];
    const cap = Math.max(1, Math.min(MAX_TOKENS, maxTokens | 0));
    for (let n = 0; n < cap; n++) {
      if (isCancelled && isCancelled()) return { ids: ids.slice(1), stopped: 'cancel' };
      const logits = await step(ids);
      if (!logits || typeof logits.length !== 'number' || !logits.length) throw new Error('decoder returned no logits');
      const t = argmax(logits);
      if (t === EOS) return { ids: ids.slice(1), stopped: 'eos' };
      ids.push(t);
      const u = loopTail(ids);
      if (u) { ids.length -= u * 5; return { ids: ids.slice(1), stopped: 'loop' }; } // keep one copy of the repeated unit
    }
    return { ids: ids.slice(1), stopped: 'limit' };
  }

  /* Commands MathJax would turn into live links, element ids/classes/styles, or use to load extra code. Typed LaTeX is the user's own;
     recognized LaTeX comes from a model reading ink that may have come from someone else's board, so it never gets these. */
  const UNSAFE = /\\(href|url|class|cssId|style|data|require|html|unicode|mmlToken)(?![a-zA-Z])/;
  const unsafe = s => UNSAFE.test(String(s || ''));

  /* ---------- download checks ---------- */
  /* Reads a stream reader ({read, cancel}) into a buffer of at most `size` bytes. More bytes than that is refused at once (no unbounded
     allocation, whatever the server sends); fewer is returned as-is and then fails verify(). */
  async function readCapped(rd, size, { isCancelled, onBytes } = {}) {
    const buf = new Uint8Array(size);
    let n = 0;
    for (;;) {
      if (isCancelled && isCancelled()) { try { await rd.cancel(); } catch (_) {} throw new Error('cancelled'); }
      const { done, value } = await rd.read();
      if (done) break;
      if (!value || typeof value.byteLength !== 'number') { try { await rd.cancel(); } catch (_) {} throw new Error('bad download data'); }
      if (n + value.byteLength > size) { try { await rd.cancel(); } catch (_) {} throw new Error('larger than expected, refused'); }
      buf.set(value, n); n += value.byteLength;
      if (onBytes) onBytes(value.byteLength);
    }
    return n === size ? buf.buffer : buf.slice(0, n).buffer;
  }
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  /* Throws unless the bytes are exactly the pinned file. digest(bytes) -> Promise<ArrayBuffer> is injected (crypto.subtle in the app). */
  async function verify(f, bytes, digest) {
    if (!bytes || bytes.byteLength !== f.size) throw new Error(f.name + ': wrong size (' + (bytes ? bytes.byteLength : 0) + ' bytes, expected ' + f.size + ')');
    const h = hex(await digest(bytes));
    if (h !== f.sha256) throw new Error(f.name + ': checksum mismatch');
    return true;
  }

  return { MODEL, SIDE, BOS, EOS, MAX_TOKENS, fileUrl, totalSize, pixels, vocabOf, decodeIds, tidy, problems, unsafe, argmax, loopTail, greedy, readCapped, hex, verify };
});
