// Local-network board sharing (Windows / macOS / Linux). Runs in the Electron main process.
// - Discovery: UDP broadcast of {name, port} on the LAN (only while "Receive" is on).
// - Transfer: TCP. Fresh X25519 key exchange per transfer -> HKDF -> AES-256-GCM per direction.
// - The receiver's user must confirm a 6-digit code that both screens show (defeats man-in-the-middle).
// - Encryption exists ONLY on the wire. Boards are never written to disk encrypted or otherwise altered.
const net = require('net'), dgram = require('dgram'), os = require('os'), crypto = require('crypto');
const DISC_PORT = 41234, TCP_PORT = 41235, MAX_BYTES = 1024 * 1024 * 1024, CHUNK = 256 * 1024, FRAME_MAX = 4 * 1024 * 1024;
const X_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const lan = { on: false, id: crypto.randomUUID(), server: null, port: 0, udp: null, timer: null, peers: new Map(), sessions: new Map(), sig: '', win: null };
const emit = (ch, d) => { try { lan.win && !lan.win.isDestroyed() && lan.win.webContents.send('lan:' + ch, d); } catch (_) {} };
const myName = () => String(os.hostname()).slice(0, 48);
const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').slice(0, 64);
const fmtCode = n => { const s = String(n).padStart(6, '0'); return s.slice(0, 3) + ' ' + s.slice(3); };
const addrs = () => { const o = []; for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if ((i.family === 'IPv4' || i.family === 4) && !i.internal) o.push(i.address); return o; };
const bcast = () => { const o = new Set(['255.255.255.255']); for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) { if ((i.family !== 'IPv4' && i.family !== 4) || i.internal) continue; const ip = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number); o.add(ip.map((x, k) => x | (~m[k] & 255)).join('.')); } return [...o]; };

/* ---- crypto ---- */
function newKeys() { const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519'); return { priv: privateKey, pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32) }; }
function derive(priv, theirRaw, pubC, pubS) {
  if (theirRaw.length !== 32) throw new Error('Bad key');
  const pk = crypto.createPublicKey({ key: Buffer.concat([X_PREFIX, theirRaw]), format: 'der', type: 'spki' });
  const secret = crypto.diffieHellman({ privateKey: priv, publicKey: pk });
  const salt = Buffer.concat([pubC, pubS]), k = (info, n) => Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'rejboard-lan-v1 ' + info, n));
  return { c2s: k('c2s', 32), s2c: k('s2c', 32), sas: k('sas', 4).readUInt32BE(0) % 1000000 };
}
class Chan {
  constructor(sock) { this.s = sock; this.buf = Buffer.alloc(0); this.sk = null; this.rk = null; this.sn = 0n; this.rn = 0n; this.max = 4096; this.onmsg = null;
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.pump(); }); }
  pump() { while (this.buf.length >= 4) { const n = this.buf.readUInt32BE(0); if (n > this.max) return this.s.destroy(new Error('Frame too large'));
    if (this.buf.length < 4 + n) return; const body = this.buf.subarray(4, 4 + n); this.buf = this.buf.subarray(4 + n);
    let m; try { m = this.rk ? this.dec(body) : body; } catch (e) { return this.s.destroy(new Error('Decryption failed — data was tampered with or the keys do not match')); }
    try { this.onmsg && this.onmsg(m); } catch (e) { return this.s.destroy(e); } } }
  nonce(n) { const b = Buffer.alloc(12); b.writeBigUInt64BE(n, 4); return b; }
  enc(p) { const c = crypto.createCipheriv('aes-256-gcm', this.sk, this.nonce(this.sn++)); const ct = Buffer.concat([c.update(p), c.final()]); return Buffer.concat([ct, c.getAuthTag()]); }
  dec(b) { if (b.length < 16) throw new Error('short'); const d = crypto.createDecipheriv('aes-256-gcm', this.rk, this.nonce(this.rn++)); d.setAuthTag(b.subarray(b.length - 16)); return Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]); }
  raw(b) { const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return this.s.write(Buffer.concat([h, b])); }
  send(p) { return this.raw(this.enc(p)); }
}
const ctrl = o => Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(o))]);
const parseCtrl = m => { if (m[0] !== 1) throw new Error('Unexpected message'); return JSON.parse(m.subarray(1).toString('utf8')); };

/* ---- receiving ---- */
function onConn(sock) {
  if (!lan.on || lan.sessions.size >= 3) return sock.destroy();
  const sid = crypto.randomUUID(), ch = new Chan(sock), keys = newKeys(); let stage = 0, size = 0, got = 0, chunks = [], name = '', code = '';
  const sess = { sock, ch, respond: null }; lan.sessions.set(sid, sess);
  sock.setTimeout(20000, () => sock.destroy()); sock.on('error', () => {}); sock.on('close', () => lan.sessions.delete(sid));
  ch.onmsg = m => {
    if (stage === 0) {                                   // client hello (plain: public key only)
      const h = JSON.parse(m.toString('utf8')); if (h.v !== 1) throw new Error('Version'); const theirPub = Buffer.from(h.pub, 'base64'); name = clean(h.name) || sock.remoteAddress;
      const k = derive(keys.priv, theirPub, theirPub, keys.pub); code = fmtCode(k.sas);
      ch.raw(Buffer.from(JSON.stringify({ v: 1, pub: keys.pub.toString('base64') }))); ch.sk = k.s2c; ch.rk = k.c2s; ch.max = FRAME_MAX; stage = 1; return;
    }
    if (stage === 1) {                                   // encrypted offer
      const o = parseCtrl(m); if (o.t !== 'offer' || !(o.size > 0 && o.size <= MAX_BYTES)) throw new Error('Bad offer'); size = o.size; stage = 2;
      sess.respond = ok => { if (stage !== 2) return; if (!ok) { try { ch.send(ctrl({ t: 'reject' })); } catch (_) {} stage = 9; return sock.end(); } stage = 3; sock.setTimeout(60000, () => sock.destroy()); ch.send(ctrl({ t: 'accept' })); };
      sock.setTimeout(120000, () => { sess.respond(false); sock.destroy(); });
      emit('incoming', { sid, name, code, count: Math.max(0, Math.min(+o.count || 0, 100000)), size, host: sock.remoteAddress }); return;
    }
    if (stage === 3) {                                   // encrypted data chunks
      if (m[0] !== 2) throw new Error('Unexpected message'); const c = m.subarray(1); got += c.length; if (got > size) throw new Error('Too much data'); chunks.push(c); emit('progress', { role: 'recv', sid, name, sent: got, total: size });
      if (got === size) { stage = 4; const payload = Buffer.concat(chunks).toString('utf8'); chunks = []; emit('received', { from: name, payload }); ch.send(ctrl({ t: 'done' })); sock.end(); }
      return;
    }
    throw new Error('Unexpected message');
  };
}

/* ---- sending ---- */
function send(peer, payload, count) {
  return new Promise(resolve => {
    const data = Buffer.from(String(payload), 'utf8'); let done = false, stage = 0;
    if (!peer || typeof peer.host !== 'string' || !/^[A-Za-z0-9.\-]{1,253}$/.test(peer.host)) return resolve({ ok: false, error: 'Invalid address.' });
    if (data.length > MAX_BYTES) return resolve({ ok: false, error: 'Too much data to send at once (limit 1 GB).' });
    const sock = net.connect({ host: peer.host, port: +peer.port || TCP_PORT }), ch = new Chan(sock), keys = newKeys();
    const fin = r => { if (done) return; done = true; try { sock.destroy(); } catch (_) {} resolve(r); };
    sock.setTimeout(10000, () => fin({ ok: false, error: 'Could not reach that computer (timed out). Is “Receive boards” on there, and is a firewall blocking the app?' }));
    sock.on('error', e => fin({ ok: false, error: e.code === 'ECONNREFUSED' ? 'That computer is not receiving. Turn on “Receive boards” there.' : e.message }));
    sock.on('close', () => fin({ ok: false, error: stage >= 3 ? 'Connection closed before the transfer finished.' : 'The other computer closed the connection.' }));
    sock.on('connect', () => ch.raw(Buffer.from(JSON.stringify({ v: 1, pub: keys.pub.toString('base64'), name: myName() }))));
    ch.onmsg = async m => {
      if (stage === 0) {                                 // server hello
        const h = JSON.parse(m.toString('utf8')), theirPub = Buffer.from(h.pub, 'base64'), k = derive(keys.priv, theirPub, keys.pub, theirPub);
        ch.sk = k.c2s; ch.rk = k.s2c; ch.max = FRAME_MAX; stage = 1; sock.setTimeout(150000, () => fin({ ok: false, error: 'The other computer did not respond in time.' }));
        emit('sas', { code: fmtCode(k.sas) }); ch.send(ctrl({ t: 'offer', size: data.length, count: count || 0 })); return;
      }
      const c = parseCtrl(m);
      if (c.t === 'reject') return fin({ ok: false, error: 'The other computer declined the boards.' });
      if (c.t === 'done') return fin({ ok: true, count: count || 0 });
      if (c.t === 'accept' && stage === 1) {
        stage = 3; sock.setTimeout(60000, () => fin({ ok: false, error: 'Transfer timed out.' }));
        emit('progress', { role: 'send', sent: 0, total: data.length });
        for (let o = 0; o < data.length && !done; o += CHUNK) {
          const end = Math.min(o + CHUNK, data.length);
          if (!ch.send(Buffer.concat([Buffer.from([2]), data.subarray(o, end)]))) await new Promise(r => sock.once('drain', r));
          emit('progress', { role: 'send', sent: end, total: data.length });
        }
      }
    };
  });
}

/* ---- discovery ---- */
function announce() {
  const now = Date.now(); let ch = false;
  for (const [id, p] of lan.peers) if (now - p.seen > 7000) { lan.peers.delete(id); ch = true; }
  const msg = Buffer.from(JSON.stringify({ app: 'rejboard-lan', v: 1, id: lan.id, name: myName(), port: lan.port }));
  for (const a of bcast()) try { lan.udp.send(msg, DISC_PORT, a); } catch (_) {}
  pushPeers(ch);
}
const peerList = () => [...lan.peers.values()].map(({ id, name, host, port }) => ({ id, name, host, port }));
function pushPeers(force) { const l = peerList(), sig = JSON.stringify(l); if (force || sig !== lan.sig) { lan.sig = sig; emit('peers', l); } }
function startUdp() {
  const u = lan.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  u.on('error', () => {});
  u.on('message', (b, r) => { try { const d = JSON.parse(b.toString('utf8')); if (d.app !== 'rejboard-lan' || d.id === lan.id || !(d.port > 0 && d.port < 65536)) return;
    lan.peers.set(d.id, { id: d.id, name: clean(d.name) || r.address, host: r.address, port: d.port, seen: Date.now() }); pushPeers(); } catch (_) {} });
  u.bind(DISC_PORT, () => { try { u.setBroadcast(true); } catch (_) {} announce(); lan.timer = setInterval(announce, 2000); });
}
const info = extra => ({ on: lan.on, name: myName(), addrs: addrs(), port: lan.port, ...extra });
async function start() {
  if (lan.on) return info();
  const srv = net.createServer(onConn); srv.on('error', () => {});
  const listen = p => new Promise((res, rej) => { srv.once('error', rej); srv.listen(p, '0.0.0.0', () => { srv.removeListener('error', rej); res(); }); });
  try { await listen(TCP_PORT); } catch (e) { try { await listen(0); } catch (e2) { return info({ error: 'Could not open a network port: ' + e2.message }); } }
  lan.server = srv; lan.port = srv.address().port; lan.on = true; startUdp(); return info();
}
async function stop() {
  lan.on = false; clearInterval(lan.timer); for (const s of lan.sessions.values()) try { s.sock.destroy(); } catch (_) {}
  lan.sessions.clear(); try { lan.server && lan.server.close(); } catch (_) {} try { lan.udp && lan.udp.close(); } catch (_) {}
  lan.server = lan.udp = null; lan.port = 0; lan.peers.clear(); lan.sig = ''; return info();
}
function register(ipcMain, win) {
  lan.win = win;
  ipcMain.handle('lan:info', () => info());
  ipcMain.handle('lan:start', () => start());
  ipcMain.handle('lan:stop', () => stop());
  ipcMain.handle('lan:peers', () => peerList());
  ipcMain.handle('lan:send', (_e, peer, payload, count) => send(peer, payload, count));
  ipcMain.handle('lan:respond', (_e, sid, ok) => { const s = lan.sessions.get(sid); if (s && s.respond) s.respond(!!ok); });
}
module.exports = { register, _test: { send, start, stop, lan, onConn } };
