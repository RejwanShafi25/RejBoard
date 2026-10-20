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
