// "Open on your phone": a read-only, live view of the open board for devices on the same network. Runs in the Electron main process.
// - Opt-in and temporary: the server exists only between start() and stop() (or quitting the app).
// - The URL carries a random 128-bit key; any other path gets 404. GET only, no cookies, nothing is ever written.
// - The page shows pictures of the board's pages that the app hands over (update()), and polls for a newer version.
const http = require('http'), os = require('os'), crypto = require('crypto');
const PORT = 41236, MAX_PAGES = 60, MAX_PAGE_BYTES = 24 * 1024 * 1024;
const lv = { server: null, key: '', port: 0, ver: 0, title: '', pages: [] };

/* the address a phone on the same Wi-Fi reaches: a private IPv4 if there is one */
function lanAddress() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const i of list || []) if ((i.family === 'IPv4' || i.family === 4) && !i.internal) all.push({ name, a: i.address });
  const priv = a => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  const virt = n => /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|utun|tailscale/i.test(n);
  const pick = all.find(x => priv(x.a) && !virt(x.name)) || all.find(x => priv(x.a)) || all[0];
  return pick ? pick.a : '127.0.0.1';
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(lv.title || 'RejBoard')}</title>
<style>body{margin:0;background:#ecebf3;font:15px system-ui,sans-serif;color:#222}header{position:sticky;top:0;background:#fff;padding:10px 14px;box-shadow:0 1px 6px #0002;display:flex;gap:8px;align-items:center}
header b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header span{font-size:12px;opacity:.6}main{display:flex;flex-direction:column;align-items:center;gap:14px;padding:14px}
img{max-width:100%;height:auto;background:#fff;box-shadow:0 2px 10px #0002;border-radius:4px}footer{text-align:center;font-size:12px;opacity:.55;padding:10px 0 20px}</style></head>
<body><header><b id="t">${esc(lv.title || 'RejBoard')}</b><span id="s">Live · read-only</span></header><main id="m"></main><footer>Made with RejBoard</footer><script src="view.js"></script></body></html>`;
const script = `(()=>{let v=-1;const m=document.getElementById('m'),t=document.getElementById('t'),s=document.getElementById('s');
async function tick(){try{const r=await fetch('state.json',{cache:'no-store'});if(!r.ok){s.textContent='Sharing stopped';return}const j=await r.json();
 if(j.ver!==v){v=j.ver;t.textContent=j.title;document.title=j.title;m.replaceChildren(...Array.from({length:j.pages},(_,k)=>{const i=new Image();i.alt='Page '+(k+1);i.src='p'+(k+1)+'.png?v='+j.ver;return i}))}
 s.textContent='Live · read-only · updated '+new Date(j.at).toLocaleTimeString();setTimeout(tick,2000)}catch(e){s.textContent='Not reachable, retrying…';setTimeout(tick,4000)}}tick()})();`;

function handle(req, res) {
  const head = (code, type, extra) => res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" }, extra || {}));
  if (req.method !== 'GET') { head(405, 'text/plain'); return res.end('Read-only'); }
  const u = new URL(req.url, 'http://x'), parts = u.pathname.split('/').filter(Boolean);
  /* /v/<key>/ ...  the key is compared in constant time */
  const ok = parts[0] === 'v' && parts[1] && parts[1].length === lv.key.length && crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(lv.key));
  if (!ok) { head(404, 'text/plain'); return res.end('Not found'); }
  if (parts.length === 2 && !u.pathname.endsWith('/')) { res.writeHead(301, { Location: u.pathname + '/' }); return res.end(); }
  const f = parts[2] || '';
  if (f === '') { head(200, 'text/html; charset=utf-8'); return res.end(page()); }
  if (f === 'view.js') { head(200, 'text/javascript; charset=utf-8'); return res.end(script); }
  if (f === 'state.json') { head(200, 'application/json'); return res.end(JSON.stringify({ ver: lv.ver, title: lv.title, pages: lv.pages.length, at: lv.at || Date.now() })); }
  const m = /^p(\d+)\.png$/.exec(f), p = m && lv.pages[+m[1] - 1];
  if (p) { head(200, 'image/png', { 'Content-Length': p.length }); return res.end(p); }
  head(404, 'text/plain'); res.end('Not found');
}

async function start() {
  if (lv.server) return info();
  lv.key = crypto.randomBytes(16).toString('hex'); lv.ver = 0; lv.pages = []; lv.title = '';
  const server = http.createServer(handle);
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', e => { if (e.code === 'EADDRINUSE') { server.listen(0, '0.0.0.0'); } else reject(e); });
    server.listen(PORT, '0.0.0.0', resolve); server.once('listening', resolve);
  });
  lv.server = server; lv.port = server.address().port;
  return info();
}
const info = () => lv.server ? { on: true, url: `http://${lanAddress()}:${lv.port}/v/${lv.key}/`, port: lv.port } : { on: false };
/* the app sends {title, pages: [Uint8Array png, ...]} whenever the board changes */
function update(d) {
  if (!lv.server || !d) return false;
  const pages = (Array.isArray(d.pages) ? d.pages : []).slice(0, MAX_PAGES).map(b => Buffer.from(b)).filter(b => b.length > 8 && b.length <= MAX_PAGE_BYTES && b[0] === 0x89 && b[1] === 0x50);
  lv.title = String(d.title || 'RejBoard').slice(0, 120); lv.pages = pages; lv.ver++; lv.at = Date.now();
  return true;
}
function stop() { if (lv.server) { try { lv.server.closeAllConnections && lv.server.closeAllConnections(); } catch (_) {} lv.server.close(); } lv.server = null; lv.key = ''; lv.pages = []; return { on: false }; }
module.exports = { start, stop, update, info, _handle: handle, _lv: lv };
