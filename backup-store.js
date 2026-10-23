'use strict';
/*
 * Automatic local backups (main process). Once a day the page streams a full backup (the same JSON as the Backup button, so Restore reads it)
 * into <app data>/backups. The page never sends a path or a file name: names are made here, and only files this module wrote are listed or read.
 *
 *   begin()            -> token        a new backup in a temp file (only one at a time)
 *   chunk(token, text)                appends; refuses chunks over 64 MB and backups over MAX_TOTAL
 *   end(token)                        fsync, rename to "RejBoard backup 2026-10-22 1405.json", then rotate
 *   abort(token)                      deletes the temp file
 * Rotation keeps the newest 7 daily, 4 weekly and 6 monthly backups (and never deletes the newest one).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIX = 'RejBoard backup ';
const NAME_RE = /^RejBoard backup (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(?: \((\d{1,3})\))?\.json$/;
const MAX_CHUNK = 64 * 1048576;
const MAX_TOTAL = 8 * 1024 * 1048576;
const STALE_MS = 10 * 60e3;   // a backup nobody wrote to for 10 minutes is abandoned
const KEEP = { daily: 7, weekly: 4, monthly: 6 };

const pad = n => String(n).padStart(2, '0');
function nameFor(d) { return PREFIX + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes()) + '.json'; }
/* backup file name -> local time in ms, or null for anything that is not one of ours */
function timeOf(name) {
  const m = NAME_RE.exec(String(name || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d.getTime() + (+m[6] || 0) : null;
}
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
const weekKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return 'w' + d.getTime(); };
const monthKey = t => { const d = new Date(t); return 'm' + d.getFullYear() + '-' + d.getMonth(); };

/* names: backup file names (others are ignored). Returns the names to delete. */
function rotate(names, keep = KEEP) {
  const v = (Array.isArray(names) ? names : []).map(n => ({ n, t: timeOf(n) })).filter(x => x.t != null).sort((a, b) => b.t - a.t);
  const kept = new Set();
  if (v.length) kept.add(v[0].n);
  for (const [key, limit] of [[dayKey, keep.daily], [weekKey, keep.weekly], [monthKey, keep.monthly]]) {
    const seen = new Set();
    for (const x of v) { const k = key(x.t); if (seen.has(k)) continue; seen.add(k); if (seen.size > limit) break; kept.add(x.n); }
  }
  return v.filter(x => !kept.has(x.n)).map(x => x.n);
}

function create(dir) {
  let cur = null; // {token, tmp, fd, bytes, last}
  const ensure = () => { fs.mkdirSync(dir, { recursive: true }); return dir; };
  const drop = () => { if (!cur) return; try { fs.closeSync(cur.fd); } catch (_) {} try { fs.unlinkSync(cur.tmp); } catch (_) {} cur = null; };
  const own = t => cur && typeof t === 'string' && t.length === 32 && t === cur.token;
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    return names.filter(n => timeOf(n) != null).map(n => { try { const s = fs.statSync(path.join(dir, n)); return s.isFile() ? { name: n, size: s.size, t: timeOf(n) } : null; } catch (_) { return null; } }).filter(Boolean).sort((a, b) => b.t - a.t);
  }
  return {
    dir,
    list,
    begin() {
      if (cur && Date.now() - cur.last < STALE_MS) return { ok: false, error: 'a backup is already being written' };
      drop();
      ensure();
      const token = crypto.randomBytes(16).toString('hex'), tmp = path.join(dir, '.partial-' + token + '.json');
      cur = { token, tmp, fd: fs.openSync(tmp, 'wx', 0o600), bytes: 0, last: Date.now() };
      return { ok: true, token };
    },
    chunk(token, text) {
      if (!own(token)) return { ok: false, error: 'no such backup' };
      if (typeof text !== 'string') { drop(); return { ok: false, error: 'bad data' }; }
      const b = Buffer.from(text, 'utf8');
      if (b.length > MAX_CHUNK || cur.bytes + b.length > MAX_TOTAL) { drop(); return { ok: false, error: 'backup too large' }; }
      try { fs.writeSync(cur.fd, b); } catch (e) { drop(); return { ok: false, error: e.code === 'ENOSPC' ? 'not enough disk space' : 'could not write the backup' }; }
      cur.bytes += b.length; cur.last = Date.now();
      return { ok: true };
    },
    end(token) {
      if (!own(token)) return { ok: false, error: 'no such backup' };
      const c = cur;
      try { fs.fsyncSync(c.fd); fs.closeSync(c.fd); } catch (_) { drop(); return { ok: false, error: 'could not write the backup' }; }
      cur = null;
      let name = nameFor(new Date());
      for (let k = 2; fs.existsSync(path.join(dir, name)) && k < 1000; k++) name = name.replace(/( \(\d+\))?\.json$/, ' (' + k + ').json');
      try { fs.renameSync(c.tmp, path.join(dir, name)); } catch (_) { try { fs.unlinkSync(c.tmp); } catch (__) {} return { ok: false, error: 'could not save the backup' }; }
      const del = rotate(list().map(x => x.name));
      for (const n of del) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) {} }
      return { ok: true, name, bytes: c.bytes, deleted: del.length };
    },
    abort(token) { if (own(token)) drop(); return { ok: true }; },
    /* only a name that list() returns can be read: no paths, no other files */
    read(name) { if (!list().some(x => x.name === name)) return null; try { return fs.readFileSync(path.join(dir, name), 'utf8'); } catch (_) { return null; } },
    /* temp files left behind by a crash */
    cleanup() { try { for (const n of fs.readdirSync(dir)) if (/^\.partial-[0-9a-f]{32}\.json$/.test(n) && (!cur || path.join(dir, n) !== cur.tmp)) fs.unlinkSync(path.join(dir, n)); } catch (_) {} }
  };
}

function register(ipcMain, app, shell) {
  const store = create(path.join(app.getPath('userData'), 'backups'));
  store.cleanup();
  ipcMain.handle('backup:begin', () => { try { return store.begin(); } catch (_) { return { ok: false, error: 'could not start the backup' }; } });
  ipcMain.handle('backup:chunk', (_e, token, text) => store.chunk(token, text));
  ipcMain.handle('backup:end', (_e, token) => store.end(token));
  ipcMain.handle('backup:abort', (_e, token) => store.abort(token));
  ipcMain.handle('backup:list', () => store.list());
  ipcMain.handle('backup:read', (_e, name) => store.read(name));
  ipcMain.handle('backup:open', () => { try { fs.mkdirSync(store.dir, { recursive: true }); } catch (_) {} return shell.openPath(store.dir).then(e => !e); });
  return store;
}

module.exports = { register, create, rotate, timeOf, nameFor, MAX_CHUNK, MAX_TOTAL, KEEP };
