/* RejBoard for Android: the page-side half of the native bridge.
 *
 * The Electron app exposes `window.wb` from preload.js and answers it in the main process (main.js, lan.js, liveview.js, ocr.js,
 * backup-store.js). This file exposes the SAME `window.wb` API, with the same argument and result shapes, and forwards every call to
 * the Android app (Kotlin) over a WebMessage channel that only this app's own origin can use. index.html is not changed at all:
 * it simply finds `window.wb` and behaves exactly like the desktop app.
 *
 * It also fills the few gaps between Electron's Chromium and Android's WebView:
 *   <webview>        -> a native Android WebView placed over the element (in-app browser / video)
 *   <a download>     -> the system "Save as" picker
 *   new Notification -> Android notifications (checklist reminders)
 *   service worker   -> off (the UI ships inside the APK; updates come with the app)
 *   on-device OCR    -> the same bundled Tesseract.js engine, run in a web worker
 *
 * Wire format (strings, both directions):
 *   page -> app  C|id|channel|argsJson   call            S|id|channel|key   call whose args were staged with P|key|piece
 *                P|key|piece             staged text      B|key|base64      staged binary
 *   app -> page  D|id|ok|json  reply      L|id|ok|key  big reply (fetched from /__rb/pull/key)
 *                E|channel|json event     M|channel|key big event
 * Binary values travel as {"__b64": "..."} and come back as Uint8Array (Electron IPC also turns Buffers into Uint8Array).
 */
(() => {
  'use strict';
  if (window.top !== window || window.wb) return;
  const N = window.RBNative;
  if (!N || typeof N.postMessage !== 'function') return;
  const BOOT = /*__RB_BOOT__*/ {};
  const PART = 1 << 21; // 2 M characters per message
  const ORIGIN = location.origin;
  let seq = 0;
  const pending = new Map(), listeners = new Map();

  /* ---------- encoding ---------- */
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const r = atob(s), u = new Uint8Array(r.length);
    for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i);
    return u;
  }
  const pack = v => JSON.stringify(v === undefined ? null : v, (_k, x) => {
    if (x instanceof ArrayBuffer) return { __b64: b64(new Uint8Array(x)) };
    if (ArrayBuffer.isView(x)) return { __b64: b64(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)) };
    return x;
  });
  const unpack = t => (t == null || t === '') ? undefined : JSON.parse(t, (_k, x) =>
    (x && typeof x === 'object' && typeof x.__b64 === 'string' && Object.keys(x).length === 1) ? unb64(x.__b64) : x);
  const pull = key => fetch(ORIGIN + '/__rb/pull/' + encodeURIComponent(key), { cache: 'no-store' }).then(r => r.text());

  /* ---------- transport ---------- */
  function post(s) { N.postMessage(s); }
  function stage(key, s) { for (let o = 0; o < s.length; o += PART) post('P|' + key + '|' + s.slice(o, o + PART)); }
  function call(ch, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      let s;
      try { s = pack(args || []); } catch (e) { reject(e); return; }
      pending.set(id, { resolve, reject });
      try {
        if (s.length <= PART) post('C|' + id + '|' + ch + '|' + s);
        else { const key = 'a' + id; stage(key, s); post('S|' + id + '|' + ch + '|' + key); }
      } catch (e) { pending.delete(id); reject(e); }
    });
  }
  const send = (ch, args) => { call(ch, args).catch(() => {}); };
  /* binary payloads that are too big for one JSON message (downloads): base64 pieces of a multiple of 3 bytes */
  function stageBytes(u8) {
    const key = 'b' + (++seq), step = 3 * (1 << 19);
    for (let o = 0; o < u8.length; o += step) post('B|' + key + '|' + b64(u8.subarray(o, Math.min(u8.length, o + step))));
    return key;
  }
  function fire(ch, v) {
    const set = listeners.get(ch);
    if (set) for (const fn of [...set]) { try { fn(v); } catch (e) { console.error(e); } }
  }
  function on(ch, fn) {
    let set = listeners.get(ch);
    if (!set) listeners.set(ch, set = new Set());
    set.add(fn);
    return () => set.delete(fn);
  }
  async function recv(s) {
    if (typeof s !== 'string' || s.length < 3) return;
    const t = s[0];
    if (t === 'D' || t === 'L') {
      const a = s.indexOf('|', 2), b = s.indexOf('|', a + 1);
      const id = +s.slice(2, a), ok = s.slice(a + 1, b) === '1';
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      try {
        let body = s.slice(b + 1);
        if (t === 'L') body = await pull(body);
        const v = unpack(body);
        if (ok) p.resolve(v); else p.reject(new Error(typeof v === 'string' ? v : 'Request failed'));
      } catch (e) { p.reject(e); }
    } else if (t === 'E' || t === 'M') {
      const a = s.indexOf('|', 2), ch = s.slice(2, a);
      let body = s.slice(a + 1);
      try { if (t === 'M') body = await pull(body); fire(ch, unpack(body)); } catch (e) { console.error(e); }
    }
  }
  if (typeof N.addEventListener === 'function') N.addEventListener('message', e => recv(e.data));
  Object.defineProperty(window, '__rbRecv', { value: recv }); // fallback channel (evaluateJavascript)

  /* ---------- on-device OCR: the bundled Tesseract.js, same rules as the desktop app's ocr.js ---------- */
  const OCR = (() => {
    const BASE = ORIGIN + '/android/ocr/';
    const MAX_IMAGE_BYTES = 6 * 1024 * 1024, MAX_TEXT = 4000, IDLE_KILL_MS = 30000;
    const LANGS = { en: 'eng', es: 'spa', fr: 'fra', de: 'deu', pt: 'por', it: 'ita', ru: 'rus', tr: 'tur', zh: 'chi_sim', ja: 'jpn', ko: 'kor', hi: 'hin', ar: 'ara', bn: 'ben', ur: 'urd' };
    const langOf = l => LANGS[String(l || 'en').slice(0, 2)] || LANGS.en;
    const isPng = b => b && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
    const clean = t => String(t || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, MAX_TEXT);
    const have = new Map();
    let worker = null, workerLang = '', idleTimer = 0, busy = false, lib = null;
    const loadLib = () => window.Tesseract ? Promise.resolve() : (lib = lib || new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = () => res();
      s.onerror = () => { lib = null; rej(new Error('the bundled OCR engine is missing from this build')); };
      document.head.appendChild(s);
    }));
    async function hasLang(code) {
      if (!have.has(code)) have.set(code, fetch(BASE + 'tessdata/' + code + '.traineddata', { method: 'HEAD' }).then(r => r.ok).catch(() => false));
      return have.get(code);
    }
    async function killWorker() {
      clearTimeout(idleTimer);
      const w = worker; worker = null; workerLang = '';
      if (w) { try { await w.terminate(); } catch (_) {} }
    }
    async function viaTesseractJs(png, lang) {
      await loadLib();
      let code = langOf(lang);
      if (!(await hasLang(code))) code = 'eng';
      if (!(await hasLang(code))) throw new Error('eng.traineddata is missing from the bundled OCR data');
      if (!worker || workerLang !== code) {
        await killWorker();
        worker = await window.Tesseract.createWorker(code, 1, {
          workerPath: BASE + 'worker.min.js', corePath: BASE + 'core', langPath: BASE + 'tessdata',
          gzip: false, cacheMethod: 'none', workerBlobURL: false, errorHandler: () => {}
        });
        workerLang = code;
      }
      const w = be32(png, 16), h = be32(png, 20);
      try { await worker.setParameters({ tessedit_pageseg_mode: h && w / h > 4 ? '7' : '6' }); } catch (_) {}
      const r = await worker.recognize(new Blob([png], { type: 'image/png' }));
      clearTimeout(idleTimer); idleTimer = setTimeout(killWorker, IDLE_KILL_MS);
      return r.data.text;
    }
    async function recognize(data, lang) {
      try {
        const png = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data)
          : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
        if (!isPng(png)) return { ok: false, error: 'Invalid image' };
        if (png.length > MAX_IMAGE_BYTES) return { ok: false, error: 'Selection is too large to recognize' };
        if (busy) return { ok: false, error: 'Still recognizing the previous selection' };
        busy = true;
        try { return { ok: true, engine: 'Tesseract.js', text: clean(await viaTesseractJs(png, lang)) }; }
        catch (e) { return { ok: false, error: 'On-device recognition is unavailable (' + ((e && e.message) || e) + ').' }; }
        finally { busy = false; }
      } catch (e) { return { ok: false, error: (e && e.message) || 'Recognition failed' }; }
    }
    return { recognize };
  })();

  /* ---------- window.wb: identical to preload.js ---------- */
  const EVENTS = ['peers', 'incoming', 'sas', 'received', 'progress'];
  window.wb = {
    platform: 'android',
    recognize: d => call('hw', [d]),
    ocr: (png, lang) => OCR.recognize(png, lang),
    docToPdf: (name, buf) => call('doc:toPdf', [name, buf]),
    i18n: { fetch: f => call('i18n:fetch', [f]) },
    clearBrowserData: () => call('browser:clear', []),
    sync: {
      get: () => call('sync:get', []),
      choose: () => call('sync:choose', []),
      list: () => call('sync:list', []),
      read: n => call('sync:read', [n]),
      write: (n, t) => call('sync:write', [n, t]),
      remove: (n, ownerId) => call('sync:remove', [n, ownerId])
    },
    app: {
      ready: () => send('app:ready', []),
      board: t => send('app:board', [String(t || '')])
    },
    backup: {
      begin: () => call('backup:begin', []),
      chunk: (t, s) => call('backup:chunk', [t, s]),
      end: t => call('backup:end', [t]),
      abort: t => call('backup:abort', [t]),
      list: () => call('backup:list', []),
      read: n => call('backup:read', [n]),
      open: () => call('backup:open', [])
    },
    fetchRemoteImage: url => call('image:fetch-remote', [url]),
    view: {
      start: () => call('view:start', []),
      update: d => call('view:update', [d]),
      stop: () => call('view:stop', []),
      info: () => call('view:info', [])
    },
    updates: {
      getVersion: () => call('updates:version', []),
      check: () => call('updates:check', []),
      download: () => call('updates:download', []),
      install: () => call('updates:install', []),
      onStatus: (fn, getActivity) => {
        const off1 = on('updates:status', s => fn(s));
        const off2 = on('updates:flush-save', () => fn({ status: 'flush-save' }));
        send('updates:renderer-ready', []);
        const timer = typeof getActivity === 'function'
          ? setInterval(() => { try { call('updates:activity', [getActivity()]).catch(() => {}); } catch (_) {} }, 700) : null;
        return () => { off1(); off2(); if (timer) clearInterval(timer); };
      }
    },
    onBrowserAddImage: fn => on('browser:add-image', u => fn(u)),
    lan: {
      info: () => call('lan:info', []),
      start: () => call('lan:start', []),
      stop: () => call('lan:stop', []),
      peers: () => call('lan:peers', []),
      send: (peer, payload, count) => call('lan:send', [peer, payload, count]),
      respond: (sid, ok) => call('lan:respond', [sid, !!ok]),
      on: (ch, fn) => EVENTS.includes(ch) ? on('lan:' + ch, d => fn(d)) : () => {}
    }
  };

  /* ---------- service worker: not used inside the app (the UI is bundled in the APK) ---------- */
  try { Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true }); } catch (_) {}

  /* ---------- downloads: <a download href="blob:..."> -> Android "Save as" ---------- */
  async function saveHref(href, name) {
    try {
      const blob = await (await fetch(href)).blob();
      const key = stageBytes(new Uint8Array(await blob.arrayBuffer()));
      await call('file:save', [String(name || 'download'), blob.type || '', key]);
    } catch (e) { console.error('save failed', e); }
  }
  const isLocalHref = h => /^(blob:|data:)/i.test(String(h || ''));
  const aClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && isLocalHref(this.href)) { saveHref(this.href, this.getAttribute('download') || this.download); return; }
    return aClick.call(this);
  };
  document.addEventListener('click', e => {
    const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && isLocalHref(a.href) && !e.defaultPrevented) { e.preventDefault(); saveHref(a.href, a.getAttribute('download')); }
  }, true);

  /* ---------- notifications (checklist reminders) ---------- */
  let notifPerm = BOOT.notifications || 'default';
  const notes = new Map();
  class RbNotification extends EventTarget {
    constructor(title, opts) {
      super();
      opts = opts || {};
      this.title = String(title || ''); this.body = String(opts.body || ''); this.tag = String(opts.tag || '');
      this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
      this._id = ++seq; notes.set(this._id, this);
      if (notifPerm === 'granted') send('notify:show', [this._id, this.title, this.body, this.tag]);
    }
    close() { send('notify:close', [this._id]); notes.delete(this._id); }
    static get permission() { return notifPerm; }
    static requestPermission(cb) {
      return call('notify:permission', []).then(p => { notifPerm = p || 'denied'; if (typeof cb === 'function') cb(notifPerm); return notifPerm; });
    }
  }
  on('notify:click', id => {
    const n = notes.get(id);
    if (!n) return;
    const ev = new Event('click');
    try { if (typeof n.onclick === 'function') n.onclick(ev); } catch (e) { console.error(e); }
    n.dispatchEvent(ev);
  });
  try { Object.defineProperty(window, 'Notification', { value: RbNotification, configurable: true, writable: true }); } catch (_) {}

  /* ---------- <webview>: the Electron tag used by the in-app browser and video panel ----------
     document.createElement('webview') gives an <rb-webview> element with the same API (src, goBack, canGoBack, executeJavaScript,
     did-navigate / page-title-updated / dom-ready events ...). The page itself is a real Android WebView that the app keeps exactly
     over the element's box, so it moves, resizes, minimizes and maximizes with the floating frame. */
  const views = new Map();
  let wvSeq = 0;
  const css = document.createElement('style');
  css.textContent = 'rb-webview{display:flex;flex:1;width:100%;height:100%;border:0;background:white}';
  (document.head || document.documentElement).appendChild(css);
  class RbWebview extends HTMLElement {
    constructor() {
      super();
      this._id = ++wvSeq; this._src = ''; this._url = ''; this._title = ''; this._back = false; this._fwd = false;
      this._live = false; this._raf = 0; this._last = '';
    }
    connectedCallback() {
      if (this._live) return;
      this._live = true; views.set(this._id, this);
      send('wv:create', [this._id]);
      if (this._src) send('wv:load', [this._id, this._src]);
      const tick = () => { if (!this._live) return; this._place(); this._raf = requestAnimationFrame(tick); };
      this._raf = requestAnimationFrame(tick);
      this._iv = setInterval(() => this._place(), 250); // animation frames can be throttled; never leave the native page behind
    }
    disconnectedCallback() {
      if (!this._live) return;
      this._live = false; cancelAnimationFrame(this._raf); clearInterval(this._iv); views.delete(this._id);
      send('wv:destroy', [this._id]);
    }
    _place() {
      const r = this.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      let vis = r.width > 4 && r.height > 4 && this.getClientRects().length > 0 && document.visibilityState === 'visible';
      if (vis) { // hidden behind a dialog or menu of the app itself? then hide the native page too
        const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
        const top = document.elementFromPoint(cx, cy);
        if (top && top !== this && !this.contains(top)) vis = false;
      }
      const k = [Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d), vis ? 1 : 0].join(',');
      if (k !== this._last) { this._last = k; send('wv:rect', [this._id].concat(k.split(',').map(Number))); }
    }
    get src() { return this._url || this._src; }
    set src(u) { this._src = String(u || ''); if (this._live) send('wv:load', [this._id, this._src]); }
    getURL() { return this._url || this._src; }
    getTitle() { return this._title; }
    loadURL(u) { this.src = u; return Promise.resolve(); }
    canGoBack() { return this._back; }
    canGoForward() { return this._fwd; }
    goBack() { send('wv:back', [this._id]); }
    goForward() { send('wv:forward', [this._id]); }
    reload() { send('wv:reload', [this._id]); }
    stop() { send('wv:stop', [this._id]); }
    executeJavaScript(code) { return call('wv:exec', [this._id, String(code)]); }
    focus() { send('wv:focus', [this._id]); }
    _event(e) {
      if (e.url) this._url = e.url;
      if (typeof e.canBack === 'boolean') this._back = e.canBack;
      if (typeof e.canFwd === 'boolean') this._fwd = e.canFwd;
      if (e.title) this._title = e.title;
      const ev = new Event(e.type);
      if (e.url) ev.url = e.url;
      if (e.title) ev.title = e.title;
      if (e.type === 'did-navigate-in-page') ev.isMainFrame = true;
      this.dispatchEvent(ev);
    }
  }
  customElements.define('rb-webview', RbWebview);
  on('wv:event', e => { const v = e && views.get(e.id); if (v) v._event(e); });
  const createEl = Document.prototype.createElement;
  Document.prototype.createElement = function (name, opts) {
    return createEl.call(this, String(name).toLowerCase() === 'webview' ? 'rb-webview' : name, opts);
  };
  /* the page's own CSS targets "#mediaHub webview" */
  css.textContent += '#mediaHub rb-webview{display:flex;flex:1;width:100%;height:100%;border:0;background:white}';

  /* ---------- Android back button: close the top-most dialog / menu like Escape does on the desktop ---------- */
  on('app:back', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
    (document.activeElement || document.body || document).dispatchEvent(ev);
  });
})();
