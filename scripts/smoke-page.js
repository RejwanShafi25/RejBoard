/* End-to-end smoke test, executed INSIDE the real app page (Electron via `npm run test:smoke`, or paste into a browser console on a dev server).
   It builds a crowded board, saves it to the real IndexedDB, draws / scrolls / zooms / lassos / moves / erases through the real input handlers,
   checks Undo/Redo and the stored format, and compares the screen cache with an independent render. It evaluates to a result object. */
(async () => {
  const out = { checks: [], perf: {}, errors: [] };
  const ok = (name, cond, detail) => out.checks.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.addEventListener('error', e => out.errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', e => out.errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));

  for (let i = 0; i < 100 && !(typeof S !== 'undefined' && typeof BoardCore !== 'undefined' && typeof draw0 === 'function'); i++) await sleep(100);
  ok('app and BoardCore loaded', typeof S !== 'undefined' && typeof BoardCore === 'object');
  if (out.checks[0].ok === false) return out;
  /* the app opens its last board (or a blank one) and shows the home screen asynchronously: wait for that, or it would replace the board we are about to build */
  const hm = document.getElementById('hm');
  for (let i = 0; i < 200 && !(hm && !hm.hidden && S.id); i++) await sleep(100);
  ok('app finished starting up', hm && !hm.hidden && !!S.id);
  await sleep(300);
  if (hm) hm.hidden = true;

  /* ----- a crowded board ----- */
  let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tools = ['fount', 'calli', 'soft', 'ball', 'pencil', 'hrd', 'hsq', 'hch'];
  const items = [];
  for (let n = 0; n < 1500; n++) {
    const tool = tools[n % 8], hl = tool[0] === 'h', pts = [];
    let x = rnd() * 1400, y = rnd() * 5000, a = rnd() * 6;
    for (let k = 0; k < (hl ? 30 : 60); k++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 3; y += Math.sin(a) * 3; pts.push([x, y, 0.3 + rnd() * 0.5, 0]); }
    items.push({ t: 's', tool, color: hl ? '#aaaaaa' : '#222222', size: hl ? 14 : 3, sens: 0.6, ang: 135, opacity: hl ? 35 : 100, pts, tl: false });
  }
  S.items = items; S.id = 'smoke-board'; S.title = 'smoke'; S.eph = false; S.ox = 0; S.oy = -1500; S.z = 1; S.fast = true;
  if (typeof hist !== 'undefined') { hist.length = 0; fut.length = 0; }
  DIRTY = true;
  const planJson = JSON.stringify(S.items);

  /* ----- storage round trip through the real IndexedDB ----- */
  let t0 = performance.now();
  await saveNow();
  out.perf.saveMs = Math.round(performance.now() - t0);
  const rec = await tx('readonly', s => s.get('smoke-board'));
  ok('board saved and read back identical', rec && JSON.stringify(rec.items) === planJson);
  const raw = await new Promise(res => { DB.then(d => { const q = d.transaction('n').objectStore('n').get('smoke-board'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); });
  ok('stored in the compact format', raw && raw.items.some(i => i.__w) && raw.items.find(i => i.__w).pts instanceof Float64Array);

  /* ----- older (plain) records and the Storage switch ----- */
  const legacy = { id: 'smoke-legacy', title: 'legacy', items: JSON.parse(planJson).slice(0, 40), bg: 'white', t: Date.now() };
  await new Promise(res => DB.then(d => { const t = d.transaction('n', 'readwrite'); t.objectStore('n').put(legacy); t.oncomplete = () => res(); }));
  const lr = await tx('readonly', s => s.get('smoke-legacy'));
  ok('legacy plain board still opens', lr && JSON.stringify(lr.items) === JSON.stringify(legacy.items));
  const nOff = await dbConvertAll(false);
  const rawOff = await new Promise(res => DB.then(d => { const q = d.transaction('n').objectStore('n').getAll(); q.onsuccess = () => res(q.result); }));
  ok('compact storage off converts every board back to the classic format', nOff >= 1 && rawOff.every(r => !Array.isArray(r.items) || r.items.every(i => !i.__w && (!i.pts || Array.isArray(i.pts)))));
  const lrOff = await tx('readonly', s => s.get('smoke-board'));
  ok('converted board is unchanged', JSON.stringify(lrOff.items) === planJson);
  const nOn = await dbConvertAll(true);
  const lrOn = await tx('readonly', s => s.get('smoke-board'));
  ok('compact storage on converts again, still unchanged', nOn >= 1 && JSON.stringify(lrOn.items) === planJson);

  /* ----- Settings -> Storage switch (the downgrade safety valve), through the real button ----- */
  const rawBoard = () => new Promise(res => DB.then(d => { const q = d.transaction('n').objectStore('n').get('smoke-board'); q.onsuccess = () => res(q.result); }));
  openSettings(); await sleep(300);
  const storageBtn = [...document.querySelectorAll('#stm span')].find(x => x.textContent === 'Compact board storage');
  const sb = storageBtn && storageBtn.parentElement.querySelector('button');
  ok('Settings has the Compact board storage switch, On by default', sb && sb.textContent === 'On', sb && sb.textContent);
  if (sb) {
    sb.click(); await sleep(1500);
    ok('switching it Off converts stored boards to the classic format', ST.dbPack === false && !(await rawBoard()).items.some(i => i.__w));
    sb.click(); await sleep(1500);
    ok('switching it On packs them again, nothing lost', ST.dbPack === true && (await rawBoard()).items.some(i => i.__w) && JSON.stringify((await tx('readonly', s => s.get('smoke-board'))).items) === planJson);
  }
  const sx = document.getElementById('sx'); if (sx) sx.click();

  /* ----- the screen cache is built while idle, and matches an independent render ----- */
  setTool('fount'); draw();
  for (let i = 0; i < 40 && !LC.ok; i++) await sleep(100);
  ok('layer cache warms up while idle', LC.ok, 'document.hidden=' + document.hidden + ', heavy=' + lcHeavy());
  /* Read pixels through a scratch canvas: calling getImageData on the cache itself can make the browser switch it to software rendering mid-test, which changes anti-aliasing. */
  const scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const readLC = () => { scratch.canvas.width = LC.w; scratch.canvas.height = LC.h; scratch.drawImage(LC.c, 0, 0); return scratch.getImageData(0, 0, LC.w, LC.h).data; };
  let lastBox = '';
  const diffFrac = (a, b) => { let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const W = cv.width; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) { n++; const p = i / 4, x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } lastBox = n ? ' box ' + [x0, y0, x1, y1] : ''; return n / (a.length / 4); };
  /* What you see comes from the layer cache, which scrolling / drawing / erasing keep up to date incrementally. Take a copy of it, rebuild it from
     scratch into the SAME canvas (so both use the same renderer) and compare: any drift in the incremental updates shows up as a difference. */
  const cacheMatches = async what => {
    await sleep(700); lcSync();
    const snap = new Uint8ClampedArray(readLC());
    LC.ok = false; lcSync();
    const f = diffFrac(snap, readLC());
    ok('cache matches a fresh render after ' + what, f < 0.01, (f * 100).toFixed(3) + '% of pixels differ' + lastBox);
  };
  await cacheMatches('opening');

  /* ----- timing helper ----- */
  const frames = [];
  const d0 = window.draw0; window.draw0 = function () { const t = performance.now(); d0(); frames.push(performance.now() - t); };
  const stat = a => a.length ? { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), max: +Math.max(...a).toFixed(1), n: a.length } : { avg: 0, max: 0, n: 0 };
  const rr = cv.getBoundingClientRect();
  const ev = (type, x, y, extra) => cv.dispatchEvent(new PointerEvent(type, Object.assign({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: rr.left + x, clientY: rr.top + y, bubbles: true }, extra)));
  const T = f => { const t = performance.now(); f(); return performance.now() - t; };

  /* ----- drawing ----- */
  const n0 = S.items.length, downs = [], ups = [];
  frames.length = 0;
  for (let s = 0; s < 5; s++) {
    downs.push(T(() => ev('pointerdown', 200, 250 + s * 40)));
    for (let i = 0; i < 25; i++) { ev('pointermove', 200 + i * 6, 250 + s * 40 + Math.sin(i / 3) * 15); await sleep(8); }
    ups.push(T(() => ev('pointerup', 360, 250 + s * 40)));
    await sleep(60);
  }
  out.perf.penDown = stat(downs); out.perf.penUp = stat(ups); out.perf.penFrames = stat(frames);
  ok('five strokes were added', S.items.length === n0 + 5, S.items.length - n0);
  ok('stroke start/finish stays responsive', Math.max(...ups) < 150 && Math.max(...downs.slice(1)) < 150, 'down ' + out.perf.penDown.max + ' ms, up ' + out.perf.penUp.max + ' ms');
  await cacheMatches('drawing');

  /* ----- undo / redo exactness ----- */
  const afterJson = JSON.stringify(S.items), histBefore = hist.map(h => h.__add ? 'add' : 'full').join(',');
  for (let i = 0; i < 5; i++) undo();
  ok('undo x5 restores the board exactly', JSON.stringify(S.items) === planJson, 'history was [' + histBefore + '], items ' + S.items.length + ' vs ' + items.length);
  for (let i = 0; i < 5; i++) redo();
  ok('redo x5 restores the strokes exactly', JSON.stringify(S.items) === afterJson);

  /* ----- eraser ----- */
  setTool('erase'); const before = JSON.stringify(S.items);
  ev('pointerdown', 150, 200); for (let i = 0; i < 25; i++) { ev('pointermove', 150 + i * 10, 200 + i * 5); await sleep(8); } ev('pointerup', 400, 325);
  await sleep(60);
  ok('eraser changed the board', JSON.stringify(S.items) !== before);
  await cacheMatches('erasing');
  undo(); ok('undo restores what the eraser removed', JSON.stringify(S.items) === before);

  /* ----- scrolling, zooming ----- */
  await sleep(900); // let the idle cache rebuild finish, as it does between real actions
  frames.length = 0;
  for (const dy of [90, 90, -50, 160, -200, 70]) { cv.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); await sleep(40); }
  out.perf.scrollFrames = stat(frames);
  await cacheMatches('scrolling');
  frames.length = 0;
  for (let i = 0; i < 8; i++) { zoomAt(1.08, 400, 300); await sleep(30); }
  out.perf.zoomFrames = stat(frames);
  await sleep(500); await cacheMatches('zooming in');
  for (let i = 0; i < 8; i++) { zoomAt(0.9, 400, 300); await sleep(30); }
  await sleep(500); await cacheMatches('zooming out');
  S.z = 1; S.ox = 0; S.oy = -1500; LC.ok = false; draw(); await sleep(700);

  /* ----- the cache never shows stale ink, even if something changes the board without telling it ----- */
  await sleep(900); lcSync();
  const victim = S.items.findIndex(i => i.t === 's' && i.tool === 'ball'), oldColor = S.items[victim].color;
  S.items[victim].color = '#ff0000';                    // behind the cache's back: no draw(), no flag
  await sleep(250);                                     // longer than the guard's re-check interval
  cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); await sleep(120);
  ok('a silent change to the board is noticed and the cache rebuilt', LC.sig === lcSig(), 'LC.sig ' + LC.sig + ' vs board ' + lcSig());
  S.items[victim].color = oldColor; LC.ok = false; draw(); await sleep(400);

  /* ----- lasso and moving a selection ----- */
  setTool('lasso'); frames.length = 0;
  ev('pointerdown', 20, 40); for (let i = 0; i < 12; i++) { ev('pointermove', 20 + i * 60, 40 + (i % 3) * 8); await sleep(25); } ev('pointermove', 760, 600); ev('pointermove', 20, 600); ev('pointerup', 20, 600);
  out.perf.lassoFrames = stat(frames);
  ok('lasso selected something', S.sel.length > 0, 'selected ' + S.sel.length + ', tool ' + S.tool + ', view ' + [S.ox, S.oy, S.z] + ', visible hidden=' + document.hidden);
  setTool('select'); S.sel = S.items.slice(10, 22); draw(); await sleep(700);
  const b = bnds(S.sel), mx = (b[0] + b[2]) / 2 * S.z + S.ox, my = (b[1] + b[3]) / 2 * S.z + S.oy, mvBefore = JSON.stringify(S.items);
  frames.length = 0;
  ev('pointerdown', mx, my); for (let i = 1; i <= 10; i++) { ev('pointermove', mx + i * 8, my + i * 5); await sleep(35); } ev('pointerup', mx + 80, my + 50);
  out.perf.moveFrames = stat(frames);
  ok('selection moved', JSON.stringify(S.items) !== mvBefore);
  await cacheMatches('moving a selection');
  undo(); ok('undo puts the selection back', JSON.stringify(S.items) === mvBefore);
  window.draw0 = d0;

  /* ----- performance sanity (deliberately loose: a software-rendered CI machine must pass, a lost fast path must not) ----- */
  ok('scrolling frames stay cheap', out.perf.scrollFrames.avg < 80, JSON.stringify(out.perf.scrollFrames));
  ok('zoom frames stay cheap', out.perf.zoomFrames.avg < 80, JSON.stringify(out.perf.zoomFrames));
  ok('lasso frames stay cheap', out.perf.lassoFrames.avg < 80, JSON.stringify(out.perf.lassoFrames));

  /* ----- clean up ----- */
  await tx('readwrite', s => s.delete('smoke-board')); await tx('readwrite', s => s.delete('smoke-legacy'));
  ok('no uncaught errors', out.errors.length === 0, out.errors.join(' | '));
  return out;
})()
