'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const math = require('mathjs');
const nerdamer = require('nerdamer/all.min.js');
const E = require('../math-engine.js').create({ math, nerdamer });
const { rng } = require('./helpers');

const close = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol * (1 + Math.abs(b));
const sortNum = a => a.slice().sort((x, y) => x - y);

/* every step must be well-formed and every LaTeX string sane (balanced braces, no leaked JS values) */
function assertWellFormed(r, label) {
  assert.ok(r && typeof r === 'object', label);
  if (!r.ok) { assert.equal(typeof r.error, 'string', label + ': failures carry a message'); return; }
  assert.ok(Array.isArray(r.steps) && r.steps.length >= 1, label + ': has steps');
  const texes = [r.answer && r.answer.tex, ...r.steps.map(s => s.tex)].filter(Boolean);
  for (const s of r.steps) {
    assert.ok(s.say === undefined || typeof s.say === 'string', label);
    assert.ok(Number.isInteger(s.level) && s.level >= 0, label + ': level');
    assert.ok(s.say || s.tex, label + ': a step says or shows something');
  }
  for (const t of texes) {
    let d = 0;
    for (const ch of t.replace(/\\[{}]/g, '')) { if (ch === '{') d++; if (ch === '}') d--; assert.ok(d >= 0, label + ': unbalanced braces in ' + t); }
    assert.equal(d, 0, label + ': unbalanced braces in ' + t);
    assert.ok(!/undefined|NaN|\[object|Infinity/.test(t), label + ': leaked value in ' + t);
  }
  assert.equal(typeof r.answer.text, 'string');
  assert.equal(typeof r.answer.tex, 'string');
}

/* ---------------- solving ---------------- */
test('linear and quadratic equations: exact answers and explanations', () => {
  const cases = [
    ['2x+3=11', [4]], ['x/3 = 5', [15]], ['3(x-2)=2x+1', [7]], ['0.5x + 1 = 4', [6]],
    ['x^2-5x+6=0', [2, 3]], ['x^2=9', [-3, 3]], ['2x^2-8=0', [-2, 2]], ['x^2+4x+4=0', [-2]], ['6x^2+x-1=0', [-0.5, 1 / 3]], ['x(x-3)=0', [0, 3]]
  ];
  for (const [eq, want] of cases) {
    const r = E.solve(eq); assertWellFormed(r, eq);
    assert.equal(r.ok, true, eq);
    assert.equal(r.solutions.length, want.length, eq);
    sortNum(want).forEach((w, k) => assert.ok(close(sortNum(r.solutions)[k], w), `${eq}: ${r.solutions} vs ${want}`));
  }
});

test('irrational and complex quadratic roots keep exact forms', () => {
  const r = E.solve('x^2-2=0'); assertWellFormed(r, 'x^2-2');
  assert.match(r.answer.tex, /\\sqrt\{2\}/);
  const c = E.solve('x^2+x+1=0'); assertWellFormed(c, 'complex');
  assert.equal(c.solutions.length, 0); assert.equal(c.complex.length, 2);
  assert.ok(c.complex.every(w => close(w.re, -0.5) && close(Math.abs(w.im), Math.sqrt(3) / 2)));
  const g = E.solve('x^2-x-1=0'); assert.match(g.answer.tex, /\\sqrt\{5\}/);
});

test('higher-degree polynomials: rational roots divided out, the rest numeric', () => {
  const r = E.solve('x^3-6x^2+11x-6=0'); assertWellFormed(r, 'cubic');
  assert.deepEqual(sortNum(r.solutions).map(Math.round), [1, 2, 3]);
  const q = E.solve('x^4-1=0'); assertWellFormed(q, 'x^4-1');
  assert.deepEqual(sortNum(q.solutions), [-1, 1]); assert.equal(q.complex.length, 2);
  const f = E.solve('x^5-x-1=0'); assertWellFormed(f, 'quintic');
  assert.equal(f.solutions.length, 1); assert.ok(Math.abs(f.solutions[0] ** 5 - f.solutions[0] - 1) < 1e-9);
  const m = E.solve('2x^3-3x^2-11x+6=0'); assert.deepEqual(sortNum(m.solutions).map(v => +v.toFixed(6)), [-2, 0.5, 3]);
});

test('polynomials built from known roots are solved exactly (random)', () => {
  const r = rng(77);
  for (let t = 0; t < 40; t++) {
    const k = 2 + ((r() * 3) | 0), roots = Array.from({ length: k }, () => Math.round(r() * 14 - 7));
    const expr = roots.map(x => `(x${x < 0 ? '+' : '-'}${Math.abs(x)})`).join('*');
    const res = E.solve(math.simplify(expr).toString() + '=0');
    assertWellFormed(res, expr);
    const want = [...new Set(roots)].sort((a, b) => a - b);
    assert.equal(res.ok, true, expr);
    assert.deepEqual(sortNum(res.solutions).map(v => Math.round(v * 1e6) / 1e6), want, expr);
  }
});

test('random quadratics agree with the quadratic formula', () => {
  const r = rng(5);
  for (let t = 0; t < 60; t++) {
    const a = Math.round(r() * 8 - 4) || 1, b = Math.round(r() * 20 - 10), c = Math.round(r() * 20 - 10);
    const res = E.solve(`${a}x^2+(${b})x+(${c})=0`);
    assertWellFormed(res, `${a},${b},${c}`);
    const D = b * b - 4 * a * c;
    if (D < 0) { assert.equal(res.solutions.length, 0); assert.equal(res.complex.length, 2); continue; }
    const want = D === 0 ? [-b / (2 * a)] : sortNum([(-b - Math.sqrt(D)) / (2 * a), (-b + Math.sqrt(D)) / (2 * a)]);
    assert.equal(res.solutions.length, want.length);
    sortNum(res.solutions).forEach((v, k) => assert.ok(close(v, want[k], 1e-9), `${a},${b},${c}: ${v} vs ${want[k]}`));
  }
});

test('identities and contradictions are reported, not mis-solved', () => {
  assert.equal(E.solve('x = x').answer.text, 'every x');
  assert.equal(E.solve('x + 1 = x').answer.text, 'no solution');
  assert.equal(E.solve('2(x+1) = 2x + 2').answer.text, 'every x');
});

test('rational equations drop roots that zero a denominator', () => {
  const r = E.solve('1/x + 1/(x+1) = 1'); assertWellFormed(r, 'rational');
  assert.ok(r.solutions.every(s => Math.abs(1 / s + 1 / (s + 1) - 1) < 1e-9));
  assert.equal(r.solutions.length, 2);
  const e = E.solve('(x^2-1)/(x-1) = 2'); assertWellFormed(e, 'extraneous');
  assert.deepEqual(r.solutions.map(s => +s.toFixed(5)), [-0.61803, 1.61803]);
  assert.equal(e.solutions.length, 0, 'x = 1 makes the denominator zero');
  assert.ok(e.steps.some(s => /Discard/.test(s.say || '')));
});

test('radical, exponential, logarithmic, absolute value and trig equations', () => {
  const cases = [['sqrt(x+1)=x-1', [3]], ['2^x=8', [3]], ['3^(2x-1)=27', [2]], ['log(x+2)=1', [Math.E - 2]], ['abs(2x-3)=5', [-1, 4]], ['abs(x)=-1', []], ['2^x=-4', []]];
  for (const [eq, want] of cases) {
    const r = E.solve(eq); assertWellFormed(r, eq);
    assert.equal(r.solutions.length, want.length, eq);
    sortNum(want).forEach((w, k) => assert.ok(close(sortNum(r.solutions)[k], w), `${eq}: ${r.solutions}`));
  }
  const s = E.solve('sin(x)=1/2'); assertWellFormed(s, 'sin');
  for (const x of s.solutions) assert.ok(Math.abs(Math.sin(x) - 0.5) < 1e-9);
  assert.equal(s.solutions.length, 4);
  const c = E.solve('cos(2x)=0.3'); assertWellFormed(c, 'cos');
  for (const x of c.solutions) assert.ok(Math.abs(Math.cos(2 * x) - 0.3) < 1e-9);
  assert.equal(E.solve('sin(x)=2').solutions.length, 0);
});

test('equations with no closed form fall back to labelled numeric roots', () => {
  const r = E.solve('x = cos(x)'); assertWellFormed(r, 'x=cos x');
  assert.equal(r.solutions.length, 1); assert.ok(Math.abs(r.solutions[0] - Math.cos(r.solutions[0])) < 1e-9);
  assert.equal(r.approximate, true);
  assert.match(r.answer.tex, /\\approx/);
  const e = E.solve('e^x = x + 5'); assertWellFormed(e, 'e^x');
  for (const x of e.solutions) assert.ok(Math.abs(Math.exp(x) - x - 5) < 1e-7);
  assert.equal(e.solutions.length, 2);
});

test('letters other than the unknown are kept symbolic', () => {
  const r = E.solve('a*x+b=0'); assertWellFormed(r, 'symbolic');
  assert.match(r.answer.tex, /\\frac\{b\}\{a\}/);
  const q = E.solve('x^2 = k', { variable: 'x' }); assertWellFormed(q, 'x^2=k');
  assert.equal(q.ok, true);
});

test('linear systems: Gaussian elimination with exact fractions', () => {
  const r = E.solve('x+y=3; x-y=1'); assertWellFormed(r, '2x2');
  assert.deepEqual(r.solutions, [2, 1]);
  const t = E.solve('x+y+z=6; 2y+5z=-4; 2x+5y-z=27'); assertWellFormed(t, '3x3');
  assert.deepEqual(t.solutions.map(v => +v.toFixed(9)), [5, 3, -2]);
  const none = E.solve('x+y=1; x+y=2'); assertWellFormed(none, 'inconsistent'); assert.equal(none.answer.text, 'no solution');
  const inf = E.solve('x+y=1; 2x+2y=2'); assertWellFormed(inf, 'dependent'); assert.equal(inf.infinite, true);
  const over = E.solve('2x+y=5; x-y=1; x+2y=4'); assert.deepEqual(over.solutions, [2, 1]);
  const lines = E.solve('x/2 + y/3 = 1\n x - y = 0'); assert.deepEqual(lines.solutions.map(v => +v.toFixed(9)), [1.2, 1.2]);
});

test('random linear systems with a known solution', () => {
  const r = rng(11);
  for (let t = 0; t < 30; t++) {
    const n = 2 + ((r() * 2) | 0), want = Array.from({ length: n }, () => Math.round(r() * 10 - 5) + 0);
    const names = ['x', 'y', 'z'].slice(0, n);
    let M, tries = 0;
    do { M = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.round(r() * 8 - 4))); tries++; } while (Math.abs(math.det(M)) < 1 && tries < 50);
    const eqs = M.map(row => row.map((c, k) => `(${c})${names[k]}`).join('+') + '=' + row.reduce((a, c, k) => a + c * want[k], 0));
    const res = E.solve(eqs.join('; '));
    assertWellFormed(res, eqs.join('; '));
    assert.equal(res.ok, true);
    assert.deepEqual(res.solutions.map(v => Math.round(v * 1e6) / 1e6 + 0), want, eqs.join('; '));
  }
});

test('a linear + quadratic system is solved by substitution', () => {
  const r = E.solve('x^2+y=7; x-y=1'); assertWellFormed(r, 'substitution');
  assert.equal(r.solutions.length, 2);
  for (const p of r.solutions) { assert.ok(Math.abs(p.x ** 2 + p.y - 7) < 1e-9); assert.ok(Math.abs(p.x - p.y - 1) < 1e-9); }
  const none = E.solve('x^2+y^2=1; x+y=5'); assert.equal(none.ok, true); assert.equal(none.solutions.length, 0);
});

/* ---------------- differentiation ---------------- */
const DIFFS = ['x^2*sin(x)', '(x^2+1)/(x-1)', 'sin(3x^2)', 'e^(2x)*cos(x)', 'x^x', 'sqrt(1+x^2)', '3x^4-2x+5', 'ln(x)/x', 'atan(2x)', 'tan(x)*exp(x)',
  'x^3*ln(x)', 'cos(x)^2', 'sin(x)/(1+cos(x))', '2^x', 'sqrt(x)*sin(x)', 'abs(x)*x', 'asin(x/2)', 'sinh(x)*cosh(x)', '1/(x^2+1)', '(3x-1)^5', 'exp(-x^2)', 'x^(1/3)', 'log(sin(x))', 'sec(x)', '5'];
test('derivatives match an independent numeric derivative', () => {
  for (const f of DIFFS) {
    const r = E.diff(f); assertWellFormed(r, f);
    assert.equal(r.ok, true, f);
    assert.equal(r.verified, true, f + ' failed its own check');
    const F = E.fnOf(f, 'x'), G = E.fnOf(r.answer.text, 'x');
    let n = 0;
    for (const x of [0.4, 0.9, 1.6, 2.3, 0.15]) { const h = 1e-5, num = (F(x + h) - F(x - h)) / (2 * h), an = G(x); if (isFinite(num) && isFinite(an)) { n++; assert.ok(Math.abs(num - an) <= 1e-4 * (1 + Math.abs(num)), `${f} at ${x}: ${an} vs ${num}`); } }
    assert.ok(n >= 3, f + ': enough sample points');
  }
});
test('derivative explanations name the rule used', () => {
  const says = f => E.diff(f).steps.map(s => s.say || '').join('|');
  assert.match(says('x^2*sin(x)'), /Product rule/);
  assert.match(says('(x^2+1)/(x-1)'), /Quotient rule/);
  assert.match(says('sin(3x^2)'), /Chain rule/);
  assert.match(says('x^x'), /logarithmic differentiation/);
  assert.match(says('x^5'), /Power rule/);
  assert.match(says('2^x'), /Exponential rule/);
});
test('second and third derivatives', () => {
  assert.equal(E.diff('x^4', { order: 2 }).answer.text.replace(/\s/g, ''), '12*x^2');
  const r = E.diff('sin(x)', { order: 3 }); assert.ok(E.fnOf(r.answer.text, 'x')(0.5) - (-Math.cos(0.5)) < 1e-9);
});
test('derivative with respect to another variable', () => {
  const r = E.diff('t^2*x', { variable: 't' }); assert.equal(r.ok, true);
  assert.ok(Math.abs(E.fnOf(r.answer.text.replace(/x/g, '3'), 't')(2) - 12) < 1e-9);
});

/* ---------------- integration ---------------- */
const INTS = ['x^2+3x', 'sin(2x)', '1/(3x+1)', 'x*(x+1)', 'exp(-x^2)', 'x*sin(x)', '1/(x^2+1)', '(2x+1)^3', 'cos(3x+1)', 'e^(2x)', '5', 'x', '1/x', 'sqrt(x)', 'x^(-2)', 'sin(x)^2', '4x^3-2x+7'];
test('antiderivatives differentiate back to the integrand', () => {
  for (const f of INTS) {
    const r = E.integrate(f); assertWellFormed(r, f);
    assert.equal(r.ok, true, f);
    assert.equal(r.verified, true, f + ' failed its own check');
    const F = E.fnOf(r.answer.text.replace(/\s*\+\s*C$/, ''), 'x'), g = E.fnOf(f, 'x');
    for (const x of [0.4, 0.9, 1.6, 2.3]) { const h = 1e-5, num = (F(x + h) - F(x - h)) / (2 * h); if (isFinite(num) && isFinite(g(x))) assert.ok(Math.abs(num - g(x)) <= 1e-4 * (1 + Math.abs(g(x))), `${f} at ${x}: ${num} vs ${g(x)}`); }
  }
});
test('definite integrals', () => {
  const val = (f, a, b) => E.integrate(f, { lower: String(a), upper: String(b) }).value;
  assert.ok(close(val('x^2', 0, 3), 9));
  assert.ok(close(val('sin(x)', 0, 'pi'.replace('pi', String(Math.PI))), 2, 1e-6));
  assert.ok(close(val('exp(-x^2)', 0, 1), 0.746824132812427, 1e-6));
  assert.ok(close(val('1/x', 1, Math.E), 1, 1e-6));
  const hard = E.integrate('sin(x)/x', { lower: '0.001', upper: '3' }); assertWellFormed(hard, 'numeric');
  assert.equal(hard.ok, true); assert.ok(close(hard.value, 1.847652, 1e-4), String(hard.value));
});
test('integral explanations name the rule used', () => {
  const says = f => E.integrate(f).steps.map(s => s.say || '').join('|');
  assert.match(says('x^2+3x'), /Sum/); assert.match(says('3x^2'), /Constant multiple/); assert.match(says('x^3'), /Power rule/);
  assert.match(says('1/(3x+1)'), /ln/); assert.match(says('e^(2x)'), /e\^u/);
});

/* ---------------- simplify / expand / factor / limit / evaluate ---------------- */
test('expand, factor and simplify agree with the input at random points', () => {
  const cases = [['expand', '(x+1)^3'], ['expand', '(x-2)(x+3)(x-1)'], ['expand', '(2x+1)^2 - (x-1)^2'], ['factor', 'x^3-6x^2+11x-6'], ['factor', '2x^2-x-1'], ['factor', 'x^2-2'], ['factor', 'x^4-1'], ['factor', '6x^2+5x-4'],
    ['simplify', '(x^2-1)/(x-1)'], ['simplify', 'sin(x)^2+cos(x)^2'], ['simplify', '2x+3x-x'], ['simplify', '(x+1)^2-(x-1)^2'], ['simplify', 'x/(x+1) + 1/(x+1)']];
  for (const [mode, expr] of cases) {
    const r = E.run(mode, expr); assertWellFormed(r, mode + ' ' + expr);
    assert.equal(r.ok, true, mode + ' ' + expr); assert.equal(r.verified, true, mode + ' ' + expr);
    const f = E.fnOf(expr, 'x'), g = E.fnOf(r.answer.text, 'x');
    for (const x of [0.37, 1.9, -2.6, 4.2]) { const a = f(x), b = g(x); if (isFinite(a) && isFinite(b)) assert.ok(close(b, a, 1e-9), `${mode} ${expr} at ${x}`); }
  }
  assert.match(E.run('factor', 'x^3-6x^2+11x-6').answer.tex, /\(x - 1\)\(x - 2\)\(x - 3\)/);
  assert.match(E.run('factor', '2x^2-x-1').answer.tex, /\(2x \+ 1\)\(x - 1\)/);
  assert.equal(E.run('simplify', '(x^2-1)/(x-1)').answer.tex, 'x + 1');
  assert.equal(E.run('simplify', 'sin(x)^2+cos(x)^2').answer.text, '1');
  assert.equal(E.run('expand', '(x+1)^3').answer.tex, 'x^{3} + 3x^{2} + 3x + 1');
});
test('limits and plain evaluation', () => {
  assert.equal(E.run('limit', 'sin(x)/x', { at: '0' }).answer.text, '1');
  assert.equal(E.run('limit', '(x^2-1)/(x-1)', { at: '1' }).answer.text, '2');
  const ev = E.run('eval', '2^10 + sqrt(16)'); assertWellFormed(ev, 'eval'); assert.equal(ev.answer.text, '1028');
  assert.match(E.run('eval', '1/0').answer.text, /Infinity/);
});

/* ---------------- robustness ---------------- */
test('bad input produces a friendly failure, never an exception', () => {
  const junk = ['', '   ', '((', '2x+', 'x==y==z', 'sin(', '1/0 = x', 'x = = 1', '!!!', 'a b c d e f', '0=0', 'x^1000000 = 1', '9'.repeat(900), 'foo(x) = 1', '×÷', 'solve x'];
  for (const mode of ['solve', 'diff', 'int', 'simplify', 'expand', 'factor', 'limit', 'eval']) {
    for (const j of junk) {
      let r;
      assert.doesNotThrow(() => { r = E.run(mode, j); }, `${mode}(${j.slice(0, 20)})`);
      assert.ok(r && typeof r.ok === 'boolean', `${mode}(${j.slice(0, 20)})`);
      if (!r.ok) assert.equal(typeof r.error, 'string');
      else assertWellFormed(r, `${mode}(${j.slice(0, 20)})`);
    }
  }
  assert.equal(E.run('nonsense', 'x').ok, false);
});
test('typographic input is understood', () => {
  const r = E.solve('2×x − 3 = 5'); assert.deepEqual(r.solutions, [4]);
  assert.deepEqual(E.solve('x² = 9').solutions, [-3, 3]);
  assert.ok(close(E.solve('√x = 3').solutions[0], 9));
  assert.ok(close(E.solve('ln(x) = 2').solutions[0], Math.exp(2)));
});
test('every answer is plain text that other code can parse back', () => {
  for (const [m, i] of [['solve', 'x^2-3x+2=0'], ['diff', 'x^3'], ['int', 'x^2'], ['expand', '(x+2)^2'], ['factor', 'x^2-9'], ['simplify', '2x+2x']]) {
    const r = E.run(m, i); assert.equal(r.ok, true);
    assert.equal(typeof r.answer.text, 'string'); assert.ok(r.answer.text.length > 0); assert.ok(!/\\/.test(r.answer.text.replace(/\\approx/g, '')), m + ' plain text must not contain LaTeX: ' + r.answer.text);
  }
});
test('the engine is quick enough for interactive use', () => {
  const t = process.hrtime.bigint();
  for (const [m, i] of [['solve', 'x^3-6x^2+11x-6=0'], ['solve', 'x+y=3; x-y=1'], ['diff', 'x^2*sin(x)'], ['int', 'x^2+3x'], ['factor', 'x^4-1'], ['solve', 'x = cos(x)']]) E.run(m, i);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(`  six typical problems solved in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 4000, 'too slow: ' + ms);
});
