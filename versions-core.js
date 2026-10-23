/* RejBoard version history core: when to take a snapshot of a board and which snapshots to keep.
   No DOM and no storage in here, so it runs in the app (as the global `VersionsCore`) and under `node --test`.

   - Snapshots are taken while you work (at most one every few minutes per board), before a version is restored and when you ask for one.
   - Retention thins them out the way backups usually are: everything recent, then one per hour, one per day, one per week.
   - Every board also has a count and a size budget, so history can never fill the disk. The newest snapshot is never dropped. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VersionsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;
  const POLICY = {
    gapMs: 10 * MIN,          // automatic snapshots: at most one per board per 10 minutes of editing
    keepRecent: 10,           // the newest 10 are always kept
    hourlyFor: DAY,           // then one per hour for a day,
    dailyFor: 30 * DAY,       // one per day for a month,
    weeklyFor: 52 * WEEK,     // and one per week for a year
    maxCount: 60,
    maxBytes: 80 * 1048576    // per board
  };

  /* Rough stored size of a board record in bytes: strings (images, PDF pages) count fully, ink points 8 bytes per number.
     Fast on huge boards: it never serializes anything. Packed strokes (__fp Float64Array) and plain point arrays both count. */
  function estimateSize(rec) {
    if (!rec || typeof rec !== 'object') return 0;
    let n = 256;
    const items = Array.isArray(rec.items) ? rec.items : [];
    for (const i of items) {
      if (!i || typeof i !== 'object') continue;
      n += 160;
      for (const k in i) {
        const v = i[k];
        if (typeof v === 'string') n += v.length;
        else if (v && typeof v.byteLength === 'number') n += v.byteLength;
        else if (k === 'pts' && Array.isArray(v)) n += v.length * ((v[0] && v[0].length) || 3) * 8;
        else if (k === 'cells' && Array.isArray(v)) for (const r of v) if (Array.isArray(r)) for (const c of r) n += typeof c === 'string' ? c.length + 8 : 8;
      }
    }
    if (typeof rec.th === 'string') n += rec.th.length;
    return n;
  }

  /* Should an automatic snapshot be taken now? last = time of the newest snapshot of this board (0 or undefined if none). */
  function due(last, now, gapMs = POLICY.gapMs) {
    if (!Number.isFinite(now)) return false;
    if (!Number.isFinite(last) || last <= 0) return true;
    if (last > now) return true; // the clock went backwards: do not stall history for hours
    return now - last >= gapMs;
  }

  /* list: [{id, t, size, named}] for ONE board, any order. Returns the ids to delete.
     named (user-saved) versions survive the hourly/daily/weekly thinning but still count towards the budgets. */
  function prune(list, now, opts) {
    const P = Object.assign({}, POLICY, opts || {});
    const v = (Array.isArray(list) ? list : []).filter(x => x && x.id != null).slice()
      .sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0));
    if (!v.length) return [];
    const keep = new Set(), seen = new Set();
    v.forEach((x, k) => {
      const t = Number(x.t) || 0, age = Math.max(0, now - t);
      if (k < P.keepRecent || x.named) { keep.add(x.id); return; }
      let bucket = null;
      if (age < P.hourlyFor) bucket = 'h' + Math.floor(t / HOUR);
      else if (age < P.dailyFor) bucket = 'd' + Math.floor(t / DAY);
      else if (age < P.weeklyFor) bucket = 'w' + Math.floor(t / WEEK);
      if (bucket && !seen.has(bucket)) { seen.add(bucket); keep.add(x.id); } // the newest one in each bucket
    });
    /* budgets: drop the oldest kept ones (unnamed first) until both fit; the newest always stays */
    let kept = v.filter(x => keep.has(x.id));
    const bytes = () => kept.reduce((a, x) => a + Math.max(0, Number(x.size) || 0), 0);
    const dropOldest = pred => { for (let k = kept.length - 1; k > 0; k--) if (pred(kept[k])) { keep.delete(kept[k].id); kept.splice(k, 1); return true; } return false; };
    while ((kept.length > P.maxCount || bytes() > P.maxBytes) && (dropOldest(x => !x.named) || dropOldest(() => true))) { /* keep dropping */ }
    return v.filter(x => !keep.has(x.id)).map(x => x.id);
  }

  /* A human label for a snapshot time, relative to now, in the app's language ("5 minutes ago", "Yesterday 14:05", "3 Mar 2026 09:12").
     The wording comes from the browser's own Intl data, so every language gets it right without translation packs. */
  function label(t, now, locale) {
    if (!Number.isFinite(t)) return '';
    let loc = locale;
    try { new Intl.DateTimeFormat(loc); } catch (_) { loc = undefined; }
    const d = new Date(t), age = now - t;
    const cap = s => s.charAt(0).toLocaleUpperCase(loc) + s.slice(1);
    const rt = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }) : null;
    const hm = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    if (age >= 0 && age < MIN) return rt ? cap(rt.format(0, 'second')) : 'Just now';
    if (age >= 0 && age < HOUR) return rt ? cap(rt.format(-Math.round(age / MIN), 'minute')) : Math.round(age / MIN) + ' min ago';
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    if (t >= today.getTime() && t <= now + MIN) return (rt ? cap(rt.format(0, 'day')) : 'Today') + ' ' + hm;
    if (t >= today.getTime() - DAY && t < today.getTime()) return (rt ? cap(rt.format(-1, 'day')) : 'Yesterday') + ' ' + hm;
    return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + hm;
  }

  return { POLICY, estimateSize, due, prune, label };
});
