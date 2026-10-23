'use strict';
/* Guards against "works in dev, broken in the installer / on the website": every script the page loads must ship, and the page must still parse. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('index.html');
const pkg = JSON.parse(read('package.json'));
const core = require('../board-core.js');

const localScripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^(https?:)?\/\//.test(s) && !s.startsWith('vendor/'));

const globToRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

test('every inline script in index.html is valid JavaScript', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  assert.ok(scripts.length >= 2);
  scripts.forEach((code, k) => assert.doesNotThrow(() => new vm.Script(code, { filename: 'index.html#script' + k }), `inline script ${k}`));
});

test('board-core.js is loaded by the page, before the script that uses it', () => {
  assert.ok(localScripts.includes('board-core.js'), 'index.html must load board-core.js');
  const tag = html.indexOf('<script src="board-core.js">');
  const use = html.indexOf('BoardCore.');
  assert.ok(tag > 0 && use > tag, 'the core must be loaded before the first use');
});

test('every local script is packaged into the desktop installer', () => {
  const files = pkg.build.files.map(globToRe);
  for (const s of ['index.html', ...localScripts]) assert.ok(files.some(re => re.test(s)), `package.json build.files is missing ${s}`);
});

test('every local script is published to the website (GitHub Pages)', () => {
  const pages = read('.github/workflows/pages.yml');
  for (const s of localScripts) {
    assert.ok(new RegExp('cp [^\\n]*\\b' + s.replace('.', '\\.') + '\\b').test(pages), `pages.yml does not copy ${s}`);
    assert.ok(new RegExp('for f in [^\\n]*\\b' + s.replace('.', '\\.') + '\\b').test(pages), `pages.yml does not check ${s}`);
  }
});

test('every local script is pre-cached for offline use', () => {
  const sw = read('sw.js');
  for (const s of localScripts) assert.ok(sw.includes(`'${s}'`), `sw.js does not pre-cache ${s}`);
});

/* Scripts that only workers load (new Worker(...) in the page, importScripts(...) in the worker) are invisible to the <script> checks above. */
const workers = [...html.matchAll(/new Worker\('([^']+)'/g)].map(m => m[1]);
const workerImports = workers.flatMap(w => [...read(w).matchAll(/importScripts\('([^']+)'/g)].map(m => m[1]));

test('worker scripts and everything they import ship in the installer and on the website', () => {
  assert.ok(workers.includes('mfr-worker.js'), 'the handwriting -> LaTeX worker is started by the page');
  assert.ok(workerImports.includes('mfr-core.js') && workerImports.includes('vendor/ort/ort.wasm.min.js'));
  const files = pkg.build.files.map(globToRe), pages = read('.github/workflows/pages.yml'), sw = read('sw.js');
  for (const s of [...workers, ...workerImports]) {
    assert.ok(files.some(re => re.test(s)), `package.json build.files is missing ${s}`);
    const esc = s.replace(/[.\/]/g, m => '\\' + m);
    assert.ok(new RegExp('for f in [^\\n]*' + esc + '\\b').test(pages), `pages.yml does not check ${s}`);
    if (!s.startsWith('vendor/')) {
      assert.ok(new RegExp('cp [^\\n]*\\b' + esc + '\\b').test(pages), `pages.yml does not copy ${s}`);
      assert.ok(sw.includes(`'${s}'`), `sw.js does not pre-cache ${s}`);
    }
  }
});

test('the ONNX Runtime loader is fetched pinned by hash, and its version matches the engine the app downloads', () => {
  const py = read('fetch_libs.py'), C = require('../mfr-core.js');
  const ver = (py.match(/onnxruntime-web@(\d+\.\d+\.\d+)\//) || [])[1];
  assert.ok(ver, 'fetch_libs.py pins an exact onnxruntime-web version');
  assert.ok(/ort\.wasm\.min\.js": "[0-9a-f]{64}"/.test(py) && /ort-wasm-simd-threaded\.mjs": "[0-9a-f]{64}"/.test(py), 'loader files are hash-checked');
  const wasm = C.MODEL.files.find(f => f.key === 'wasm');
  assert.ok(wasm && C.fileUrl(wasm).includes('onnxruntime-web@' + ver + '/'), 'the downloaded .wasm must come from the same version as the bundled loader');
});

test('a new service worker version fetches the app shell fresh, never from the HTTP cache', () => {
  const sw = read('sw.js');
  assert.ok(/addAll\(\[[^\]]+\]\.map\(u=>new Request\(u,\{cache:'reload'\}\)\)\)/.test(sw), 'install must bypass the HTTP cache, or a fresh index.html can be paired with a stale script');
});

test('the service worker never stores a second copy of the model download', () => {
  const sw = read('sw.js'), w = read('mfr-worker.js');
  assert.ok(/cache: 'no-store'/.test(w), 'the worker downloads with cache: no-store');
  assert.ok(/e\.request\.cache==='no-store'\)return/.test(sw), 'sw.js lets no-store requests through untouched');
});

test('recognized LaTeX is only ever put into the editor as text', () => {
  const block = html.slice(html.indexOf('async function hwMath'), html.indexOf('const mrepOff'));
  assert.ok(block.includes("$('#ml').value=r.latex"));
  assert.ok(!/innerHTML/.test(block), 'no markup built from model output');
});

test('every BoardCore function the page calls exists', () => {
  const used = new Set([...html.matchAll(/BoardCore\.(\w+)/g)].map(m => m[1]));
  assert.ok(used.size > 5);
  for (const name of used) assert.equal(typeof core[name], 'function', `BoardCore.${name} is used by index.html but not exported`);
});

test('the core logic lives only in board-core.js (no stale copies in the page)', () => {
  for (const fn of ['packItems', 'unpackItems', 'dbPackItems', 'dbUnpackItems', 'dbLazy', 'lcSig', 'addIdx', 'trimHist']) {
    assert.ok(!new RegExp('function ' + fn + '\\s*\\(').test(html), `index.html still defines ${fn}()`);
  }
});

test('the npm scripts the docs promise exist', () => {
  for (const s of ['start', 'test', 'test:smoke', 'dist']) assert.ok(pkg.scripts[s], `npm script "${s}" is missing`);
});

test('every page the desktop app opens is packaged', () => {
  const main = read('main.js');
  const pages = [...main.matchAll(/loadFile\('([^']+)'/g)].map(m => m[1]);
  assert.ok(pages.includes('index.html') && pages.includes('splash.html'));
  const files = pkg.build.files.map(globToRe);
  for (const p of pages) assert.ok(files.some(re => re.test(p)), `package.json build.files is missing ${p}`);
  assert.ok(files.some(re => re.test('icon-192.png')), 'the start-up window needs icon-192.png');
});

test('the start-up window only ever writes the board name as text', () => {
  const splash = read('splash.html');
  assert.ok(splash.includes('textContent'));
  assert.ok(!/innerHTML|document\.write|eval\(/.test(splash), 'no markup injection from the board name');
});

test('every vendor library the page loads is downloaded by fetch_libs.py and checked by CI', () => {
  const loaded = new Set([...html.matchAll(/'(vendor\/[A-Za-z0-9._-]+\.js)'/g)].map(m => m[1].replace('vendor/', '')));
  assert.ok(loaded.size >= 6, 'found the vendor libraries the page references: ' + [...loaded]);
  const fetchPy = read('fetch_libs.py'), pages = read('.github/workflows/pages.yml'), build = read('.github/workflows/build.yml');
  for (const f of loaded) {
    assert.ok(fetchPy.includes('"' + f + '"'), `fetch_libs.py does not download ${f}`);
    assert.ok(pages.includes('vendor/' + f), `pages.yml does not check vendor/${f}`);
    if (/pdf|jspdf|tex-svg|math|nerdamer/.test(f)) assert.ok(build.includes(f), `build.yml does not check ${f}`);
  }
});

test('the math libraries used in the app are the same versions the tests run against', () => {
  const fetchPy = read('fetch_libs.py');
  assert.ok(fetchPy.includes('mathjs/' + pkg.devDependencies.mathjs.replace(/^[^\d]*/, '') + '/'), 'mathjs version in fetch_libs.py differs from package.json');
  assert.ok(fetchPy.includes('nerdamer@' + pkg.devDependencies.nerdamer.replace(/^[^\d]*/, '') + '/'), 'nerdamer version in fetch_libs.py differs from package.json');
  assert.ok(html.includes('mathjs/' + pkg.devDependencies.mathjs.replace(/^[^\d]*/, '') + '/math.min.js'), 'CDN fallback version for mathjs differs');
  assert.ok(html.includes('nerdamer@' + pkg.devDependencies.nerdamer.replace(/^[^\d]*/, '') + '/all.min.js'), 'CDN fallback version for nerdamer differs');
});

test('the math tools are not loaded at start-up', () => {
  assert.ok(!/<script[^>]+src="vendor\/(math|nerdamer)/.test(html), 'math.min.js / nerdamer must be loaded lazily');
  assert.ok(!/lib\('vendor\/(math|nerdamer)/.test(html));
});
