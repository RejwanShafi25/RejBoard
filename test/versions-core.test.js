'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../versions-core.js');
const { rng, board } = require('./helpers');

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR, WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const snap = (id, ago, size = 1000, named = '') => ({ id, t: NOW - ago, size, named });
const kept = (list, opts) => { const del = new Set(V.prune(list, NOW, opts)); return list.filter(x => !del.has(x.id)).map(x => x.id); };

/* ---------------- due ---------------- */
test('due: first snapshot is always due, then at most one per gap', () => {
  assert.equal(V.due(0, NOW), true);
  assert.equal(V.due(undefined, NOW), true);
  assert.equal(V.due(NOW - 9 * MIN, NOW), false);
  assert.equal(V.due(NOW - 10 * MIN, NOW), true);
  assert.equal(V.due(NOW - 1, NOW, 0), true);
});

test('due: a clock that went backwards does not stall history', () => {
  assert.equal(V.due(NOW + 5 * DAY, NOW), true);
});

test('due: garbage input never throws', () => {
  for (const x of [NaN, null, 'x', {}, -5, Infinity]) assert.equal(typeof V.due(x, NOW), 'boolean');
  assert.equal(V.due(NOW - DAY, NaN), false);
});

/* ---------------- prune ---------------- */
test('prune keeps everything when there are only a few snapshots', () => {
  const l = [snap('a', 1 * MIN), snap('b', 30 * MIN), snap('c', 3 * DAY)];
  assert.deepEqual(V.prune(l, NOW), []);
});

test('prune thins old snapshots to one per hour, day and week, and keeps the newest of each', () => {
  const l = [];
  for (let k = 0; k < 10; k++) l.push(snap('r' + k, k * MIN));                  // 10 most recent: kept
  l.push(snap('h1a', 3 * HOUR + 5 * MIN), snap('h1b', 3 * HOUR + 30 * MIN));     // same hour -> one survives
  l.push(snap('d1a', 5 * DAY), snap('d1b', 5 * DAY + 2 * HOUR));                 // same day
  l.push(snap('w1a', 60 * DAY), snap('w1b', 60 * DAY + 2 * DAY));                // probably the same week
  l.push(snap('old', 400 * DAY));                                                // beyond a year: dropped
  const k = kept(l);
  for (let i = 0; i < 10; i++) assert.ok(k.includes('r' + i));
  assert.ok(k.includes('h1a') && !k.includes('h1b'), 'newest in the hour');
  assert.ok(k.includes('d1a') && !k.includes('d1b'), 'newest in the day');
  assert.ok(!k.includes('old'));
});

test('prune never deletes named (user-saved) versions while within budget', () => {
  const l = [];
  for (let k = 0; k < 20; k++) l.push(snap('r' + k, k * MIN));
  l.push(snap('mine', 2 * DAY + 3 * MIN, 1000, 'Before exam'), snap('other', 2 * DAY + 1 * MIN));
  const k = kept(l);
  assert.ok(k.includes('mine'));
});

test('prune enforces the count budget, oldest unnamed first, never the newest', () => {
  const l = [];
  for (let k = 0; k < 40; k++) l.push(snap('s' + k, k * MIN));
  l.push(snap('named', 39 * MIN + 30e3, 10, 'keep me'));
  const k = kept(l, { keepRecent: 100, maxCount: 5 });
  assert.equal(k.length, 5);
  assert.ok(k.includes('s0'), 'newest survives');
  assert.ok(k.includes('named'), 'named survives while unnamed ones can still go');
});

test('prune enforces the size budget even when everything is named; the newest always stays', () => {
  const l = [snap('a', 1 * MIN, 600, 'n'), snap('b', 2 * MIN, 600, 'n'), snap('c', 3 * MIN, 600, 'n')];
  assert.deepEqual(kept(l, { maxBytes: 1000 }), ['a']);
  assert.deepEqual(kept([snap('huge', MIN, 1e12)], { maxBytes: 10 }), ['huge'], 'a single snapshot is never deleted');
});

test('prune ignores malformed entries and does not mutate its input', () => {
  const l = [snap('a', MIN), null, { t: 5 }, snap('b', 2 * MIN, 'NaN'), snap('c', 3 * MIN, -50)];
  const copy = JSON.stringify(l);
  assert.deepEqual(V.prune(l, NOW), []);
  assert.equal(JSON.stringify(l), copy);
  assert.deepEqual(V.prune(null, NOW), []);
  assert.deepEqual(V.prune('x', NOW), []);
});

test('prune bounds history over a simulated year of daily editing', () => {
  const l = [];
  let id = 0;
  for (let d = 0; d < 365; d++) for (let k = 0; k < 6; k++) l.push(snap('v' + id++, d * DAY + k * 10 * MIN, 50 * 1024));
  const k = kept(l);
  assert.ok(k.length <= V.POLICY.maxCount, 'never more than the count budget (' + k.length + ')');
  assert.ok(k.includes('v0'));
});

/* ---------------- estimateSize ---------------- */
test('estimateSize counts images, ink and tables, and grows with the board', () => {
  const r = rng(3), small = { items: board(r, 5) }, big = { items: board(r, 200) };
  assert.ok(V.estimateSize(big) > V.estimateSize(small));
  assert.ok(V.estimateSize({ items: [{ t: 'i', src: 'x'.repeat(1e6) }] }) >= 1e6);
  assert.ok(V.estimateSize({ items: [{ t: 's', __fp: new Float64Array(1000) }] }) >= 8000, 'packed strokes count');
  assert.ok(V.estimateSize({ items: [{ t: 's', pts: Array.from({ length: 100 }, () => [1, 2, 3]) }] }) >= 2400);
});

test('estimateSize survives junk', () => {
  for (const x of [null, undefined, 5, 'abc', {}, { items: 'no' }, { items: [null, 7, 'x', { pts: 'no' }] }]) assert.equal(typeof V.estimateSize(x), 'number');
});

/* ---------------- label ---------------- */
test('label reads naturally', () => {
  assert.equal(V.label(NOW - 20e3, NOW, 'en-GB'), 'Now');
  assert.equal(V.label(NOW - 5 * MIN, NOW, 'en-GB'), '5 minutes ago');
  assert.match(V.label(NOW - 3 * HOUR, NOW, 'en-GB'), /^Today /);
  assert.match(V.label(NOW - 40 * DAY, NOW, 'en-GB'), /2026/);
  assert.equal(V.label(NaN, NOW), '');
});

test('label speaks the app language and survives an unknown language code', () => {
  assert.equal(V.label(NOW - 5 * MIN, NOW, 'de'), 'Vor 5 Minuten');
  assert.match(V.label(NOW - 3 * HOUR, NOW, 'de'), /^Heute /);
  assert.match(V.label(NOW - 5 * MIN, NOW, 'bn'), /৫|5/);
  assert.equal(typeof V.label(NOW - 5 * MIN, NOW, 'not a locale!!'), 'string');
});
