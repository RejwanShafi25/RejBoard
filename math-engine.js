/* RejBoard math engine: equation solver, derivatives, integrals, simplify / expand / factor, all with step-by-step explanations.
   Pure logic on top of two libraries it is handed (so it runs in the app and under `node --test`):
     math     = mathjs   (parsing, numeric evaluation, exact fractions, LaTeX output)
     nerdamer = Nerdamer (symbolic algebra and calculus; used for exact answers, and always cross-checked numerically)
   Every answer is verified by substituting it back or differentiating it, and when no exact method works the engine falls back to a
   clearly labelled numeric answer instead of failing, so there is always something correct to show. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = { create: factory };
  else root.MathEngine = { create: factory };
})(typeof self !== 'undefined' ? self : this, function create(deps) {
  'use strict';
  const math = deps.math, N = deps.nerdamer;
  const CONSTS = new Set(['pi', 'e', 'i', 'Infinity', 'NaN', 'tau', 'phi']);
  const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'sqrt', 'abs', 'cbrt']);

  /* ---------- text, parsing, LaTeX ---------- */
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\u00d7\u00b7\u22c5]/g, '*').replace(/\u00f7/g, '/').replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/\u00b2/g, '^2').replace(/\u00b3/g, '^3').replace(/\u03c0/g, 'pi')
      .replace(/\u221a\s*\(/g, 'sqrt(').replace(/\u221a\s*([A-Za-z0-9.]+)/g, 'sqrt($1)')
      .replace(/\*\*/g, '^').replace(/\bln\s*\(/g, 'log(').replace(/(^|[^a-zA-Z])([a-zA-Z])\s*\(/g, '$1$2*(').replace(/\barc(sin|cos|tan)\b/g, 'a$1')
      .replace(/\s+/g, ' ').trim();
  }
  const parse = s => math.parse(clean(s));
  function tex(s) {
    try { return (typeof s === 'string' ? parse(s) : s).toTex({ parenthesis: 'auto', implicit: 'hide' }).replace(/~/g, '\\,'); }
    catch (e) { try { return N(clean(String(s))).toTeX(); } catch (e2) { return String(s); } }
  }
  function symbols(s) {
    const out = [];
    parse(s).traverse((n, path, parent) => {
      if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn') && !CONSTS.has(n.name) && !out.includes(n.name)) out.push(n.name);
    });
    return out;
  }
  function pickVar(syms, want) {
    if (want && syms.includes(want)) return want;
    if (syms.includes('x')) return 'x';
    return syms.length ? syms.slice().sort()[0] : 'x';
  }
  /* numeric function of one variable (NaN where undefined or complex) */
  function fnOf(s, v) {
    const code = parse(s).compile();
    return x => {
      try {
        const r = code.evaluate({ [v]: x });
        if (typeof r === 'number') return r;
        if (r && typeof r.re === 'number') return Math.abs(r.im) < 1e-9 * (1 + Math.abs(r.re)) ? r.re : NaN;
        return NaN;
      } catch (e) { return NaN; }
    };
  }
  const isNum = v => typeof v === 'number' && isFinite(v);
  function fmt(x, d) {
    if (!isNum(x)) return String(x);
    d = d == null ? 10 : d;
    const r = Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    return String(Math.abs(r) < 1e-12 ? 0 : r);
  }
  /* ---------- exact fractions (small, deterministic, no BigInt) ---------- */
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; };
  const lcm = (a, b) => a / gcd(a, b) * b;
  class Fr {
    constructor(n, d) { d = d === undefined ? 1 : d; if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); this.n = n / g + 0; this.d = d / g; }
    static of(x) {
      if (x instanceof Fr) return x;
      if (Number.isInteger(x)) return new Fr(x, 1);
      const sgn = x < 0 ? -1 : 1, ax = Math.abs(x);
      let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = ax;
      for (let i = 0; i < 40; i++) {
        const a = Math.floor(b), h2 = a * h1 + h0, k2 = a * k1 + k0;
        h0 = h1; h1 = h2; k0 = k1; k1 = k2;
        if (Math.abs(ax - h1 / k1) < 1e-12 * Math.max(1, ax) || k1 > 1e6) break;
        b = 1 / (b - a);
      }
      return new Fr(sgn * h1, k1);
    }
    static parse(t) {
      t = String(t).trim();
      const m = /^(-?[\d.]+(?:e[-+]?\d+)?)\/(-?[\d.]+(?:e[-+]?\d+)?)$/i.exec(t);
      if (m) return Fr.of(Number(m[1])).div(Fr.of(Number(m[2])));
      const v = Number(t);
      if (!isFinite(v) || t === '') throw new Error('nonnumeric');
      return Fr.of(v);
    }
    add(o) { o = Fr.of(o); return new Fr(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Fr.of(o); return new Fr(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Fr.of(o); return new Fr(this.n * o.n, this.d * o.d); }
    div(o) { o = Fr.of(o); return new Fr(this.n * o.d, this.d * o.n); }
    neg() { return new Fr(-this.n, this.d); }
    abs() { return new Fr(Math.abs(this.n), this.d); }
    get zero() { return this.n === 0; }
    get neg_() { return this.n < 0; }
    get one() { return this.n === 1 && this.d === 1; }
    eq(o) { o = Fr.of(o); return this.n === o.n && this.d === o.d; }
    num() { return this.n / this.d; }
    tex() { return this.d === 1 ? String(this.n) : (this.n < 0 ? '-' : '') + '\\frac{' + Math.abs(this.n) + '}{' + this.d + '}'; }
    str() { return this.d === 1 ? String(this.n) : this.n + '/' + this.d; }
  }
  const step = (say, tx, level) => ({ say, tex: tx || null, level: level || 0 });
  const done = (title, steps, answer, extra) => Object.assign({ ok: true, title, steps, answer }, extra || {});
  const fail = (msg, extra) => Object.assign({ ok: false, error: msg, steps: [], answer: null }, extra || {});
  const ans = (texS, plain, list) => ({ tex: texS, text: plain, list: list || null });
  function containsSym(node, v) { let f = false; node.traverse((n, p, par) => { if (n.isSymbolNode && n.name === v && !(par && par.isFunctionNode && p === 'fn')) f = true; }); return f; }

  /* ---------- polynomials ---------- */
  /* coefficients [c0, c1, ...] (ascending, exact) of expression s in variable v, or null when s is not a polynomial in v with numeric coefficients */
  function polyCoeffs(s, v) {
    try {
      const node = parse(s);
      let ok = true;
      node.traverse((n, path, parent) => {
        if (n.isFunctionNode) ok = false;
        if (n.isSymbolNode && !(parent && parent.isFunctionNode && path === 'fn') && n.name !== v && !CONSTS.has(n.name)) ok = false;
        if (n.isOperatorNode && n.op === '^') {
          let k = null; try { k = n.args[1].compile().evaluate(); } catch (_) {}
          if (containsSym(n.args[1], v) || (containsSym(n.args[0], v) && !(Number.isInteger(k) && k >= 0 && k <= 12))) ok = false;
        }
        if (n.isOperatorNode && n.op === '/' && containsSym(n.args[1], v)) ok = false;
      });
      if (!ok) return null;
      if (node.toString().indexOf('pi') >= 0 || /\be\b/.test(node.toString()) || /\bi\b/.test(node.toString())) return null; // keep it exact and rational
      const raw = N('coeffs(' + clean(s) + ',' + v + ')').toString().trim();
      if (raw[0] !== '[') return null;
      const out = raw.slice(1, -1).split(',').map(t => Fr.parse(t));
      while (out.length > 1 && out[out.length - 1].zero) out.pop();
      return out;
    } catch (e) { return null; }
  }
  function polyTex(c, v) {
    const parts = [];
    for (let k = c.length - 1; k >= 0; k--) {
      if (c[k].zero) continue;
      const neg = c[k].neg_, ab = c[k].abs();
      const pow = k === 0 ? '' : v + (k > 1 ? '^{' + k + '}' : '');
      const coef = k === 0 ? ab.tex() : (ab.one ? '' : ab.tex());
      parts.push((parts.length ? (neg ? ' - ' : ' + ') : (neg ? '-' : '')) + coef + pow);
    }
    return parts.join('') || '0';
  }
  /* complex roots of a polynomial with numeric coefficients (Durand-Kerner) */
  function polyRoots(c) {
    const n = c.length - 1;
    if (n < 1) return [];
    const a = c.map(k => k.num()), lead = a[n], p = a.map(k => k / lead);
    const ev = z => p.reduceRight((acc, k) => math.add(math.multiply(acc, z), k), math.complex(0, 0));
    let z = [];
    const r = 1 + Math.max(...p.slice(0, n).map(Math.abs));
    for (let k = 0; k < n; k++) z.push(math.complex(r * Math.cos(2 * Math.PI * k / n + 0.4), r * Math.sin(2 * Math.PI * k / n + 0.4)));
    for (let it = 0; it < 600; it++) {
      let delta = 0;
      z = z.map((zk, k) => {
        let den = math.complex(1, 0);
        for (let j = 0; j < n; j++) if (j !== k) den = math.multiply(den, math.subtract(zk, z[j]));
        const d = math.divide(ev(zk), den);
        delta = Math.max(delta, math.abs(d));
        return math.subtract(zk, d);
      });
      if (delta < 1e-14) break;
    }
    return z.map(w => ({ re: Math.abs(w.re) < 1e-10 ? 0 : w.re, im: Math.abs(w.im) < 1e-9 ? 0 : w.im }));
  }
  const cxTex = w => (w.re === 0 ? '' : fmt(w.re, 6) + (w.im > 0 ? ' + ' : ' - ')) + (w.re === 0 && w.im < 0 ? '-' : '') + (Math.abs(w.im) === 1 ? '' : fmt(Math.abs(w.im), 6)) + 'i';

  /* ---------- numeric roots of any one-variable function ---------- */
  function numericRoots(f, lo, hi, maxN) {
    lo = lo == null ? -50 : lo; hi = hi == null ? 50 : hi; maxN = maxN || 20;
    const n = 6000, xs = [], found = [];
    let px = null, py = null;
    const add = r => { if (isFinite(r) && !found.some(q => Math.abs(q - r) < 1e-7 * (1 + Math.abs(r)))) found.push(r); };
    for (let k = 0; k <= n; k++) {
      const x = lo + (hi - lo) * k / n, y = f(x);
      xs.push([x, y]);
      if (isNum(y) && Math.abs(y) < 1e-13) add(x);
      if (isNum(y) && isNum(py) && ((py < 0 && y > 0) || (py > 0 && y < 0))) {
        let a = px, b = x, fa = py;
        for (let i = 0; i < 100; i++) { const m = (a + b) / 2, fm = f(m); if (!isNum(fm)) break; if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m; }
        const r = (a + b) / 2;
        if (Math.abs(f(r)) < 1e-6 * (1 + Math.abs(py))) add(r); // rejects jumps across poles
      }
      px = x; py = y;
    }
    for (let k = 1; k < xs.length - 1; k++) { // touching roots (even multiplicity)
      const [, y] = xs[k];
      if (!isNum(y) || !isNum(xs[k - 1][1]) || !isNum(xs[k + 1][1])) continue;
      const a = Math.abs(xs[k - 1][1]), b = Math.abs(y), c = Math.abs(xs[k + 1][1]);
      if (b <= a && b <= c && b < 1e-3) {
        let l = xs[k - 1][0], h = xs[k + 1][0];
        for (let i = 0; i < 120; i++) { const m1 = l + (h - l) / 3, m2 = h - (h - l) / 3; if (Math.abs(f(m1)) < Math.abs(f(m2))) h = m2; else l = m1; }
        const r = (l + h) / 2;
        if (Math.abs(f(r)) < 1e-9) add(r);
      }
    }
    return found.sort((p, q) => p - q).slice(0, maxN);
  }

  /* ---------- SOLVE ---------- */
  function splitEq(text) {
    const t = clean(text).replace(/==/g, '=');
    const parts = t.split('=');
    if (parts.length === 1) return { l: parts[0], r: '0', implied: true };
    if (parts.length !== 2) throw new Error('Use exactly one "=" per equation.');
    return { l: parts[0].trim(), r: parts[1].trim() };
  }
  const eqTex = (l, r) => tex(l) + ' = ' + tex(r);

  function solve(text, opts) {
    opts = opts || {};
    const raw = String(text || '');
    if (/[;\n]/.test(raw.trim())) return solveSystem(raw.split(/[;\n]+/).map(s => s.trim()).filter(Boolean), opts);
    let eq;
    try { eq = splitEq(raw); parse(eq.l); parse(eq.r); } catch (e) { return fail(e.message && /Use exactly/.test(e.message) ? e.message : 'I could not read that equation. Check the brackets and operators.'); }
    const f0 = '(' + eq.l + ')-(' + eq.r + ')';
    const syms = symbols(f0);
    if (!syms.length) return fail('There is no unknown to solve for.');
    for (const side of [eq.l, eq.r]) { if (!symbols(side).length) { let c; try { c = math.evaluate(side); } catch (e) { c = NaN; } if (typeof c === 'number' && !isFinite(c)) return fail('That equation divides by zero.'); } }
    const v = pickVar(syms, opts.variable);
    const steps = [step('Start with the equation', eqTex(eq.l, eq.r))];
    if (eq.implied) steps.push(step('No "=" was given, so I solve expression = 0.'));
    const others = syms.filter(s => s !== v);
    if (others.length) { steps.push(step('Solving for ' + v + '; the other letters (' + others.join(', ') + ') are treated as constants.')); return solveSymbolic(eq, v, steps, syms); }
    const poly = polyCoeffs(f0, v);
    if (poly) return solvePoly(eq, v, poly, steps);
    const rat = rationalBranch(eq, f0, v, steps);
    if (rat) return rat;
    return solveGeneral(eq, f0, v, steps);
  }

  function checkSteps(eq, v, sols, steps) {
    const L = fnOf(eq.l, v), R = fnOf(eq.r, v), lines = [];
    for (const s of sols) {
      if (typeof s !== 'number') continue;
      const l = L(s), r = R(s);
      if (isNum(l) && isNum(r)) lines.push(step(v + ' = ' + fmt(s, 6) + ':   ' + fmt(l, 6) + ' = ' + fmt(r, 6) + (Math.abs(l - r) < 1e-6 * (1 + Math.abs(l)) ? '   \u2713' : '   \u2717'), null, 1));
    }
    if (lines.length) steps.push(step('Check by substituting back into the original equation:'), ...lines);
  }

  function solvePoly(eq, v, c, steps) {
    const deg = c.length - 1;
    if (deg === 0) {
      return c[0].zero
        ? done('Solve', steps.concat(step('Both sides are equal for every value, so the equation is an identity.')), ans('\\text{every } ' + v, 'every ' + v), { solutions: [], identity: true })
        : done('Solve', steps.concat(step('The unknown cancels and leaves ' + c[0].str() + ' = 0, which is never true.')), ans('\\text{no solution}', 'no solution'), { solutions: [] });
    }
    steps.push(step('Move everything to one side and collect like terms', polyTex(c, v) + ' = 0'));
    const r = polyRootsExact(c, v, steps, 0);
    return finishPoly(eq, v, r.real, r.exact, steps, r.complex);
  }

  /* roots of a polynomial with explanation; real roots as numbers, exact TeX forms alongside */
  function polyRootsExact(c, v, steps, lvl) {
    const deg = c.length - 1;
    let real = [], exact = [], complex = [];
    if (deg === 1) {
      const a = c[1], b = c[0], x = b.neg().div(a);
      steps.push(step('Subtract the constant from both sides', (a.one ? '' : a.tex()) + v + ' = ' + b.neg().tex(), lvl));
      if (!a.one) steps.push(step('Divide both sides by ' + a.str(), v + ' = ' + x.tex(), lvl));
      if (x.d !== 1) steps.push(step('As a decimal', v + ' \\approx ' + fmt(x.num(), 6), lvl));
      return { real: [x.num()], exact: [x.tex()], complex };
    }
    if (deg === 2) {
      const a = c[2], b = c[1], cc = c[0];
      steps.push(step('This is a quadratic with a = ' + a.str() + ', b = ' + b.str() + ', c = ' + cc.str(), null, lvl));
      const D = b.mul(b).sub(a.mul(cc).mul(4));
      steps.push(step('Discriminant D = b\u00b2 \u2212 4ac', 'D = (' + b.tex() + ')^2 - 4\\cdot(' + a.tex() + ')\\cdot(' + cc.tex() + ') = ' + D.tex(), lvl));
      const two = a.mul(2);
      if (D.num() > 0) {
        steps.push(step('D > 0, so there are two different real solutions', v + ' = \\frac{-b \\pm \\sqrt{D}}{2a} = \\frac{' + b.neg().tex() + ' \\pm \\sqrt{' + D.tex() + '}}{' + two.tex() + '}', lvl));
        const rt = fracSqrt(D);
        if (rt.exact) {
          const e1 = b.neg().sub(rt.value).div(two), e2 = b.neg().add(rt.value).div(two);
          const pair = [e1, e2].sort((p, q) => p.num() - q.num());
          steps.push(step('\u221aD = ' + rt.value.str() + ' is a rational number, so both solutions are exact', v + '_1 = ' + pair[0].tex() + ',\\quad ' + v + '_2 = ' + pair[1].tex(), lvl));
          return { real: pair.map(p => p.num()), exact: pair.map(p => p.tex()), complex };
        }
        const x = [(-b.num() - Math.sqrt(D.num())) / (2 * a.num()), (-b.num() + Math.sqrt(D.num())) / (2 * a.num())].sort((p, q) => p - q);
        const ex = radicalPair(b, two, D);
        steps.push(step('Simplify the square root', v + '_1 = ' + ex[0] + ',\\quad ' + v + '_2 = ' + ex[1], lvl));
        steps.push(step('As decimals', v + '_1 \\approx ' + fmt(x[0], 6) + ',\\quad ' + v + '_2 \\approx ' + fmt(x[1], 6), lvl));
        return { real: x, exact: ex, complex };
      }
      if (D.zero) {
        const x = b.neg().div(two);
        steps.push(step('D = 0, so there is exactly one (repeated) solution', v + ' = \\frac{-b}{2a} = ' + x.tex(), lvl));
        return { real: [x.num()], exact: [x.tex()], complex };
      }
      const rt = fracSqrt(D.neg()), re = b.neg().div(two);
      const im = rt.exact ? rt.value.div(two).abs() : null;
      steps.push(step('D < 0, so there are no real solutions; the two solutions are complex numbers', v + ' = \\frac{-b \\pm i\\sqrt{-D}}{2a}', lvl));
      const imNum = Math.sqrt(-D.num()) / (2 * Math.abs(a.num()));
      const w1 = { re: re.num(), im: -imNum }, w2 = { re: re.num(), im: imNum };
      const t1 = im ? (re.zero ? '' : re.tex() + ' - ') + (im.one ? '' : im.tex()) + 'i' : cxTex(w1), t2 = im ? (re.zero ? '' : re.tex() + ' + ') + (im.one ? '' : im.tex()) + 'i' : cxTex(w2);
      steps.push(step('Complex solutions', v + '_1 = ' + t1 + ',\\quad ' + v + '_2 = ' + t2, lvl));
      return { real: [], exact: [t1, t2], complex: [w1, w2] };
    }
    // degree >= 3: rational-root theorem, divide out the roots found, then finish with a quadratic / numerics
    let rest = c.slice();
    const found = [];
    const common = rest.reduce((m, k) => lcm(m, k.d), 1), ints = rest.map(k => Math.round(k.num() * common));
    const cand = rationalCandidates(ints);
    if (cand.length) steps.push(step('Look for rational roots p/q (p divides the constant term, q divides the leading coefficient)', null, lvl));
    for (const cd of cand) {
      const rr = new Fr(cd[0], cd[1]);
      let guard = 0;
      while (rest.length > 2 && guard++ < 12) {
        const q = syntheticDivide(rest, rr);
        if (!q) break;
        steps.push(step(v + ' = ' + rr.str() + ' is a root, so ' + (rr.zero ? v : '(' + v + (rr.neg_ ? ' + ' + rr.abs().str() : ' \u2212 ' + rr.str()) + ')') + ' is a factor; divide it out', polyTex(q, v) + ' = 0', lvl + 1));
        found.push(rr); rest = q;
      }
    }
    if (found.length) steps.push(step('So far the polynomial factors as', found.map(r => r.zero ? v : '(' + v + (r.neg_ ? ' + ' + r.abs().tex() : ' - ' + r.tex()) + ')').join('') + '\\,\\left(' + polyTex(rest, v) + '\\right) = 0', lvl));
    real = found.map(r => r.num()); exact = found.map(r => r.tex());
    if (rest.length >= 2) {
      if (rest.length <= 3) {
        steps.push(step('Solve the remaining factor ' + polyTex(rest, v) + ' = 0', null, lvl));
        const sub = polyRootsExact(rest, v, steps, lvl + 1);
        real = real.concat(sub.real); exact = exact.concat(sub.exact); complex = complex.concat(sub.complex);
      } else {
        steps.push(step('The remaining factor ' + polyTex(rest, v) + ' has no more rational roots; its roots are found numerically', null, lvl));
        const rts = polyRoots(rest);
        for (const w of rts) { if (w.im === 0) { real.push(w.re); exact.push(fmt(w.re, 6)); } else if (w.im > 0 || !rts.some(o => Math.abs(o.re - w.re) < 1e-7 && Math.abs(o.im + w.im) < 1e-7)) { complex.push(w); } }
        for (const w of rts) if (w.im < 0 && !complex.includes(w)) complex.push(w);
        complex = dedupeComplex(complex);
      }
    }
    const order = real.map((x, k) => [x, exact[k]]).sort((p, q) => p[0] - q[0]);
    const uniq = [];
    for (const o of order) { const hit = uniq.find(u => Math.abs(u[0] - o[0]) < 1e-9 * (1 + Math.abs(o[0]))); if (hit) hit[2]++; else uniq.push([o[0], o[1], 1]); }
    for (const u of uniq) if (u[2] > 1) steps.push(step(v + ' = ' + fmt(u[0], 6) + ' is a root of multiplicity ' + u[2] + ': it appears ' + u[2] + ' times in the factorisation but counts as one solution', null, lvl));
    return { real: uniq.map(o => o[0]), exact: uniq.map(o => o[1]).concat(complex.map(cxTex)), complex };
  }
  function dedupeComplex(list) { const out = []; for (const w of list) if (!out.some(o => Math.abs(o.re - w.re) < 1e-7 && Math.abs(o.im - w.im) < 1e-7)) out.push(w); return out.sort((a, b) => a.re - b.re || a.im - b.im); }

  function finishPoly(eq, v, sols, exact, steps, cx) {
    checkSteps(eq, v, sols, steps);
    const list = exact.map((e, k) => v + (exact.length > 1 ? '_{' + (k + 1) + '}' : '') + ' = ' + e);
    const plain = sols.map(s => fmt(s, 6)).concat((cx || []).map(w => cxTex(w).replace(/\\/g, '')));
    return done('Solve', steps, ans(list.join(',\\; ') || '\\text{no real solution}', plain.join(', ') || 'no real solution', exact), { solutions: sols, complex: cx || [] });
  }
  /* sqrt of a rational: exact when numerator and denominator are perfect squares */
  function fracSqrt(D) {
    const sn = Math.round(Math.sqrt(D.n)), sd = Math.round(Math.sqrt(D.d));
    return sn * sn === D.n && sd * sd === D.d ? { exact: true, value: new Fr(sn, sd) } : { exact: false };
  }
  /* (-b \pm sqrt(D)) / (2a) with the radical simplified: the two real roots as TeX, smaller first */
  function radicalPair(b, two, D) {
    const m = D.n * D.d; // sqrt(n/d) = sqrt(n*d)/d
    let k = 1, r = m;
    for (let f = 2; f * f <= r; f++) while (r % (f * f) === 0) { r /= f * f; k *= f; }
    const A = b.neg().div(two), B = new Fr(k, D.d).div(two).abs();
    const q = lcm(A.d, B.d), na = A.mul(q).num(), nb = B.mul(q).num();
    const g = gcd(gcd(na, nb), q);
    const qa = na / g, qb = nb / g, qq = q / g;
    const rad = (qb === 1 ? '' : qb) + '\\sqrt{' + r + '}';
    const lo = qa === 0 ? '-' + rad : qa + ' - ' + rad, hi = qa === 0 ? rad : qa + ' + ' + rad;
    const wrap = t => qq === 1 ? t : '\\frac{' + t + '}{' + qq + '}';
    return [wrap(lo), wrap(hi)]; // A - B*sqrt(r) < A + B*sqrt(r) because B is taken positive
  }
  function divisors(n) { n = Math.abs(n); const out = []; for (let k = 1; k * k <= n; k++) if (n % k === 0) { out.push(k); if (k * k !== n) out.push(n / k); } return out.sort((a, b) => a - b); }
  function rationalCandidates(ints) {
    const lead = ints[ints.length - 1];
    let z = 0; while (z < ints.length && ints[z] === 0) z++;
    const out = [];
    if (z > 0) out.push([0, 1]);
    const cst = ints[z];
    if (!cst || !lead || Math.abs(cst) > 1e7 || Math.abs(lead) > 1e7) return out;
    for (const p of divisors(cst)) for (const q of divisors(lead)) if (gcd(p, q) === 1) { out.push([p, q]); out.push([-p, q]); }
    return out;
  }
  /* divide polynomial c by (x - r) when r is an exact root; returns the quotient or null */
  function syntheticDivide(c, r) {
    const n = c.length - 1, q = new Array(n);
    let carry = new Fr(0);
    for (let k = n; k >= 1; k--) { carry = c[k].add(carry.mul(r)); q[k - 1] = carry; }
    return c[0].add(carry.mul(r)).zero ? q : null;
  }

  /* an equation with x in a denominator: combine into one fraction, solve the numerator, drop roots that zero the denominator */
  function rationalBranch(eq, f0, v, steps) {
    let rz;
    try { rz = math.rationalize(f0, {}, true); } catch (e) { return null; }
    const num = rz.numerator && rz.numerator.toString(), den = rz.denominator && rz.denominator.toString();
    if (!num || !den || den === '1') return null;
    const pn = polyCoeffs(num, v), pd = polyCoeffs(den, v);
    if (!pn || !pd || pd.length < 2) return null;
    steps.push(step('Combine everything into a single fraction', '\\frac{' + polyTex(pn, v) + '}{' + polyTex(pd, v) + '} = 0'));
    steps.push(step('A fraction is zero only when its numerator is zero (and its denominator is not)', polyTex(pn, v) + ' = 0'));
    const r = polyRootsExact(pn, v, steps, 1);
    const keep = [], dropped = [];
    r.real.forEach((x, k) => { if (Math.abs(evalPolyNum(pd, x)) < 1e-9) dropped.push(x); else keep.push([x, r.exact[k]]); });
    if (dropped.length) steps.push(step('Discard ' + v + ' = ' + dropped.map(x => fmt(x, 6)).join(', ') + ': it makes the denominator zero, so it is not allowed'));
    const cx = (r.complex || []);
    return finishPoly(eq, v, keep.map(k => k[0]), keep.map(k => k[1]).concat(cx.length ? [] : []), steps, cx);
  }
  const evalPolyNum = (c, x) => c.reduceRight((a, k) => a * x + k.num(), 0);

  function solveGeneral(eq, f0, v, steps) {
    const f = fnOf(f0, v);
    steps.push(step('Rewrite as f(' + v + ') = 0', tex(f0) + ' = 0'));
    const pat = trigPattern(eq, v);
    if (pat) {
      steps.push(...pat.steps);
      const good = pat.sols.filter(s => { const y = f(s); return isNum(y) && Math.abs(y) < 1e-7; });
      if (good.length || !pat.sols.length) { checkSteps(eq, v, good, steps); return done('Solve', steps, ans(pat.answerTex, pat.answerText, good.map(g => fmt(g, 6))), { solutions: good, general: true }); }
    }
    // symbolic attempt; accepted only when every candidate checks out in the original equation
    let cand = null;
    try {
      const out = N.solve(clean(eq.l) + '=' + clean(eq.r), v).toString().replace(/^\[|\]$/g, '');
      if (out && !/solve|integrate|error|NaN|undefined/.test(out) && out.length < 400) cand = out.split(/,(?![^(]*\))/).map(t => t.trim()).filter(Boolean);
    } catch (e) { cand = null; }
    if (cand && cand.some(t => /\d{6,}/.test(t) || /^-?\d+\.\d+(e[-+]?\d+)?$/i.test(t))) cand = null; // long fractions / decimals are numeric approximations, not algebraic answers
    if (cand && cand.length && cand.length <= 12) {
      const L = fnOf(eq.l, v), R = fnOf(eq.r, v);
      const vals = cand.map(t => { try { const val = math.evaluate(t); return typeof val === 'number' ? val : NaN; } catch (e) { return NaN; } });
      const good = [], bad = [];
      cand.forEach((t, k) => { const x = vals[k]; if (!isNum(x)) return; if (Math.abs(L(x) - R(x)) < 1e-6 * (1 + Math.abs(L(x)))) good.push({ t, x }); else bad.push(fmt(x, 6)); });
      if (good.length) {
        steps.push(step('Solve algebraically (isolate ' + v + ', clear denominators, square both sides, ...)'));
        if (bad.length) steps.push(step('Discard extraneous candidate(s) that do not satisfy the original equation: ' + v + ' = ' + bad.join(', ')));
        good.sort((a, b) => a.x - b.x);
        const exact = good.map(g => { let t = ''; try { t = N(g.t).toTeX(); } catch (e) { t = ''; } return !t || /\d{7,}/.test(t) ? fmt(g.x, 6) : t; });
        return finishPoly(eq, v, good.map(g => g.x), exact, steps, []);
      }
    }
    const roots = numericRoots(f, -50, 50, 20);
    steps.push(step('No closed form was found, so the roots are located numerically: sign changes of f on [\u221250, 50], refined by bisection'));
    if (!roots.length) return done('Solve', steps.concat(step('No real solution was found in [\u221250, 50].')), ans('\\text{no real solution found in } [-50, 50]', 'no real solution found in [-50, 50]'), { solutions: [], approximate: true });
    const res = finishPoly(eq, v, roots, roots.map(r => fmt(r, 6)), steps, []);
    res.approximate = true; res.answer.tex = res.answer.tex.replace(/ = /g, ' \\approx ');
    return res;
  }
  const linSolveTex = (v, core, L, x) => { const n = core + (L.b === 0 ? '' : (L.b > 0 ? ' - ' : ' + ') + fmt(Math.abs(L.b), 6)); return v + ' = ' + (L.a === 1 ? n : '\\frac{' + n + '}{' + fmt(L.a, 6) + '}') + ' \\approx ' + fmt(x, 6); };
  /* trig(a x + b) = c, a^(a x + b) = c, log(a x + b) = c, abs(a x + b) = c: exact general solutions */
  function trigPattern(eq, v) {
    let l, r;
    try { l = parse(eq.l); r = parse(eq.r); } catch (e) { return null; }
    const hasV = n => containsSym(n, v);
    let fnNode, cNode;
    if (hasV(l) && !hasV(r)) { fnNode = l; cNode = r; } else if (hasV(r) && !hasV(l)) { fnNode = r; cNode = l; } else return null;
    while (fnNode.isParenthesisNode) fnNode = fnNode.content;
    let c;
    try { c = cNode.compile().evaluate(); } catch (e) { return null; }
    if (typeof c !== 'number' || !isFinite(c)) return null;
    const lin = argNode => { const co = polyCoeffs(argNode.toString(), v); return co && co.length === 2 ? { a: co[1].num(), b: co[0].num(), aS: co[1].str(), bS: co[0].str() } : null; };
    const steps = [];
    const argStr = L => (L.a === 1 ? '' : L.aS) + v + (L.b === 0 ? '' : (L.b > 0 ? ' + ' : ' - ') + fmt(Math.abs(L.b), 6));
    if (fnNode.isFunctionNode && fnNode.args.length === 1 && ['sin', 'cos', 'tan'].includes(fnNode.fn.name)) {
      const k = fnNode.fn.name, L = lin(fnNode.args[0]);
      if (!L || L.a === 0) return null;
      if ((k === 'sin' || k === 'cos') && Math.abs(c) > 1) return { steps: [step(k + ' of anything is between \u22121 and 1, and ' + fmt(c) + ' is outside that range, so there is no real solution.')], sols: [], answerTex: '\\text{no real solution}', answerText: 'no real solution' };
      const u = k === 'sin' ? [Math.asin(c), Math.PI - Math.asin(c)] : k === 'cos' ? [Math.acos(c), -Math.acos(c)] : [Math.atan(c)];
      const period = k === 'tan' ? Math.PI : 2 * Math.PI;
      steps.push(step('Take the inverse ' + k + ' of both sides: with u = ' + argStr(L), 'u = ' + (k === 'sin' ? '\\arcsin' : k === 'cos' ? '\\arccos' : '\\arctan') + '(' + fmt(c, 6) + ') = ' + fmt(u[0], 6) + (k === 'tan' ? '' : '\\ \\text{ or } \\ ' + fmt(u[1], 6))));
      steps.push(step('Add whole periods (n any integer) and solve for ' + v, v + ' = \\frac{u + ' + (k === 'tan' ? '\\pi' : '2\\pi') + ' n - (' + fmt(L.b, 6) + ')}{' + fmt(L.a, 6) + '}'));
      const sols = [];
      for (const uu of u) for (let n = -8; n <= 8; n++) { const x = (uu + n * period - L.b) / L.a; if (Math.abs(x) <= 2 * Math.PI + 1e-9) sols.push(x); }
      const uniq = [...new Set(sols.map(s => fmt(s, 9)))].map(Number).sort((a, b) => a - b);
      steps.push(step('Solutions with ' + v + ' between \u22122\u03c0 and 2\u03c0', uniq.map(s => v + ' \\approx ' + fmt(s, 4)).join(',\\; ')));
      return { steps, sols: uniq, answerTex: uniq.map(s => v + ' \\approx ' + fmt(s, 4)).join(',\\; ') + '\\ \\ (\\text{plus whole periods})', answerText: uniq.map(s => fmt(s, 4)).join(', ') + ' (plus whole periods)' };
    }
    if (fnNode.isOperatorNode && fnNode.op === '^' && !hasV(fnNode.args[0]) && hasV(fnNode.args[1])) {
      let base; try { base = fnNode.args[0].compile().evaluate(); } catch (e) { return null; }
      const L = lin(fnNode.args[1]);
      if (typeof base === 'number' && base > 0 && base !== 1 && L && L.a !== 0) {
        if (c <= 0) return { steps: [step('A positive base raised to any real power is positive, and ' + fmt(c) + ' is not, so there is no real solution.')], sols: [], answerTex: '\\text{no real solution}', answerText: 'no real solution' };
        steps.push(step('Take the logarithm of both sides', tex(fnNode.toString()) + ' = ' + fmt(c, 6) + ' \\Rightarrow (' + tex(fnNode.args[1].toString()) + ')\\ln(' + tex(fnNode.args[0].toString()) + ') = \\ln(' + fmt(c, 6) + ')'));
        const x = (Math.log(c) / Math.log(base) - L.b) / L.a;
        steps.push(step('Solve for ' + v, linSolveTex(v, '\\frac{\\ln ' + fmt(c, 6) + '}{\\ln ' + fmt(base, 6) + '}', L, x)));
        const exactX = Math.abs(x - Math.round(x)) < 1e-12 ? String(Math.round(x)) : null;
        return { steps, sols: [x], answerTex: v + (exactX ? ' = ' + exactX : ' \\approx ' + fmt(x, 6)), answerText: exactX || fmt(x, 6) };
      }
    }
    if (fnNode.isFunctionNode && fnNode.fn.name === 'log' && fnNode.args.length === 1) {
      const L = lin(fnNode.args[0]);
      if (L && L.a !== 0) {
        const x = (Math.exp(c) - L.b) / L.a;
        steps.push(step('Undo the logarithm by raising e to both sides', tex(fnNode.args[0].toString()) + ' = e^{' + fmt(c, 6) + '}'));
        steps.push(step('Solve for ' + v, linSolveTex(v, 'e^{' + fmt(c, 6) + '}', L, x)));
        return { steps, sols: [x], answerTex: v + ' \\approx ' + fmt(x, 6), answerText: fmt(x, 6) };
      }
    }
    if (fnNode.isFunctionNode && fnNode.fn.name === 'abs' && fnNode.args.length === 1) {
      const L = lin(fnNode.args[0]);
      if (L && L.a !== 0) {
        if (c < 0) return { steps: [step('An absolute value is never negative, so there is no solution.')], sols: [], answerTex: '\\text{no solution}', answerText: 'no solution' };
        steps.push(step('|u| = c means u = c or u = \u2212c', tex(fnNode.args[0].toString()) + ' = ' + fmt(c, 6) + '\\ \\text{ or } \\ ' + tex(fnNode.args[0].toString()) + ' = ' + fmt(-c, 6)));
        const xs = [...new Set([(c - L.b) / L.a, (-c - L.b) / L.a].map(s => fmt(s, 9)))].map(Number).sort((a, b) => a - b);
        steps.push(step('Solve each', xs.map(s => v + ' = ' + fmt(s, 6)).join(',\\; ')));
        return { steps, sols: xs, answerTex: xs.map(s => v + ' = ' + fmt(s, 6)).join(',\\; '), answerText: xs.map(s => fmt(s, 6)).join(', ') };
      }
    }
    return null;
  }

  /* an equation with several letters: solve for one of them symbolically */
  function solveSymbolic(eq, v, steps, syms) {
    try {
      const out = N.solve(clean(eq.l) + '=' + clean(eq.r), v).toString().replace(/^\[|\]$/g, '');
      if (!out || /solve|error|undefined/.test(out)) throw new Error('no');
      const items = out.split(/,(?![^(]*\))/).map(t => t.trim()).filter(Boolean);
      const texs = items.map(t => N(t).toTeX());
      steps.push(step('Isolate ' + v + ' (the other letters stay as symbols)'));
      return done('Solve', steps, ans(texs.map((t, k) => v + (texs.length > 1 ? '_{' + (k + 1) + '}' : '') + ' = ' + t).join(',\\; '), items.join(', '), texs), { symbolic: true, variables: syms });
    } catch (e) { return fail('I could not solve for ' + v + ' symbolically. Try giving the other letters numeric values.', { variables: syms }); }
  }

  /* ---------- systems ---------- */
  /* Is fs (an expression string) affine in all of vars?  Returns the row [coef..., rhs] or null. */
  function affineRow(fs, vars) {
    let code;
    try { code = parse(fs).compile(); } catch (e) { return null; }
    const at = sc => { const o = {}; vars.forEach(x => { o[x] = sc[x] || 0; }); try { const r = code.evaluate(o); return typeof r === 'number' ? r : NaN; } catch (e) { return NaN; } };
    const c0 = at({}), row = [];
    if (!isFinite(c0)) return null;
    for (const x of vars) { const y = at({ [x]: 1 }); if (!isFinite(y)) return null; row.push(Fr.of(Math.round((y - c0) * 1e9) / 1e9)); }
    row.push(Fr.of(Math.round(-c0 * 1e9) / 1e9));
    for (let t = 0; t < 4; t++) { // affine means a straight line: test random points
      const probe = {}; vars.forEach((x, k) => { probe[x] = ((k + 2) * (t + 1.3)) % 7 - 2.9; });
      const pred = vars.reduce((a, x, k) => a + row[k].num() * probe[x], c0), act = at(probe);
      if (!isFinite(act) || Math.abs(act - pred) > 1e-7 * (1 + Math.abs(pred))) return null;
    }
    return row;
  }

  function solveSystem(eqs, opts) {
    const parsed = [];
    for (const e of eqs) { let q; try { q = splitEq(e); parse(q.l); parse(q.r); } catch (err) { return fail('I could not read the equation "' + e + '".'); } parsed.push(q); }
    const fs = parsed.map(q => '(' + q.l + ')-(' + q.r + ')');
    const vars = [];
    fs.forEach(s => symbols(s).forEach(x => { if (!vars.includes(x)) vars.push(x); }));
    vars.sort();
    if (!vars.length) return fail('There are no unknowns.');
    const steps = [step('The system', '\\begin{cases}' + parsed.map(q => eqTex(q.l, q.r)).join('\\\\') + '\\end{cases}')];
    const rows = fs.map(s => affineRow(s, vars));
    if (rows.every(Boolean) && vars.length <= 6 && rows.length <= 8) return gauss(rows, vars, steps);
    const sub = substitution(parsed, fs, vars, steps);
    if (sub) return sub;
    return fail('I could not solve this system exactly. Systems with more than two nonlinear equations need a numeric method.', { variables: vars });
  }

  const matTex = (rows, n) => '\\left[\\begin{array}{' + 'c'.repeat(n) + '|c}' + rows.map(r => r.map(k => k.tex()).join(' & ')).join(' \\\\ ') + '\\end{array}\\right]';
  function gauss(rows0, vars, steps) {
    const n = vars.length, m = rows0.length;
    const A = rows0.map(r => r.slice());
    steps.push(step('All equations are linear, so use Gaussian elimination on the augmented matrix [coefficients | constants]', matTex(A, n)));
    let r = 0;
    const pivots = [];
    for (let c = 0; c < n && r < m; c++) {
      let p = -1; for (let i = r; i < m; i++) if (!A[i][c].zero) { p = i; break; }
      if (p < 0) continue;
      if (p !== r) { [A[p], A[r]] = [A[r], A[p]]; steps.push(step('Swap row ' + (r + 1) + ' and row ' + (p + 1), matTex(A, n), 1)); }
      const pv = A[r][c];
      if (!pv.one) { A[r] = A[r].map(k => k.div(pv)); steps.push(step('Divide row ' + (r + 1) + ' by ' + pv.str(), matTex(A, n), 1)); }
      for (let i = 0; i < m; i++) {
        if (i === r || A[i][c].zero) continue;
        const k = A[i][c];
        A[i] = A[i].map((x, j) => x.sub(k.mul(A[r][j])));
        steps.push(step('Row ' + (i + 1) + ' \u2192 row ' + (i + 1) + (k.neg_ ? ' + ' : ' \u2212 ') + (k.abs().one ? '' : k.abs().str() + '\u00b7') + 'row ' + (r + 1), matTex(A, n), 1));
      }
      pivots.push(c); r++;
    }
    for (let i = r; i < m; i++) if (A[i].slice(0, n).every(k => k.zero) && !A[i][n].zero) return done('Solve', steps.concat(step('A row reads 0 = ' + A[i][n].str() + ', which is impossible, so the system has no solution.')), ans('\\text{no solution}', 'no solution'), { solutions: [] });
    if (pivots.length < n) {
      const free = vars.filter((x, k) => !pivots.includes(k));
      steps.push(step('There are fewer independent equations than unknowns, so there are infinitely many solutions; ' + free.join(', ') + (free.length > 1 ? ' are free.' : ' is free.')));
      const lines = pivots.map((c, i) => vars[c] + ' = ' + A[i][n].tex() + free.map(f => { const co = A[i][vars.indexOf(f)]; return co.zero ? '' : (co.neg_ ? ' + ' : ' - ') + (co.abs().one ? '' : co.abs().tex()) + f; }).join(''));
      return done('Solve', steps.concat(step('Express the leading unknowns through the free ones', lines.join('\\\\'))), ans(lines.join(',\\; '), lines.join(', ').replace(/\\frac\{(-?\d+)\}\{(\d+)\}/g, '$1/$2')), { solutions: [], infinite: true });
    }
    const sol = vars.map((x, k) => ({ x, v: A[pivots.indexOf(k)][n] }));
    steps.push(step('Read off the solution', sol.map(s => s.x + ' = ' + s.v.tex()).join(',\\; ')));
    const chk = rows0.every(row => { let t = new Fr(0); sol.forEach((s, k) => { t = t.add(row[k].mul(s.v)); }); return t.eq(row[n]); });
    steps.push(step(chk ? 'Check: every original equation is satisfied. \u2713' : 'Check failed \u2717'));
    return done('Solve', steps, ans(sol.map(s => s.x + ' = ' + s.v.tex()).join(',\\; '), sol.map(s => s.x + ' = ' + s.v.str()).join(', '), sol.map(s => s.x + ' = ' + s.v.str())), { solutions: sol.map(s => s.v.num()), variables: vars });
  }

  /* two equations in two unknowns where one equation is linear in one unknown: solve it, substitute into the other */
  function substitution(parsed, fs, vars, steps) {
    if (parsed.length !== 2 || vars.length !== 2) return null;
    const linearIn = (f, x, o) => { const code = parse(f).compile(); for (const t of [0.7, -1.9, 2.3]) { const g = xx => { try { return code.evaluate({ [x]: xx, [o]: t }); } catch (e) { return NaN; } }; const a = g(0), b = g(1), c = g(2); if (!isFinite(a + b + c) || Math.abs(a - 2 * b + c) > 1e-9 * (1 + Math.abs(a) + Math.abs(b)) || Math.abs(b - a) < 1e-12) return false; } return true; };
    for (let i = 0; i < 2; i++) for (const x of vars) {
      const other = vars.find(y => y !== x);
      if (!linearIn(fs[i], x, other)) continue;
      let xs;
      try { xs = N.solve(clean(parsed[i].l) + '=' + clean(parsed[i].r), x).toString().replace(/^\[|\]$/g, ''); } catch (e) { continue; }
      if (!xs || /,/.test(xs.replace(/\([^)]*\)/g, ''))) continue;
      const j = 1 - i;
      steps.push(step('Solve equation ' + (i + 1) + ' for ' + x, x + ' = ' + N(xs).toTeX()));
      let subbed = fs[j].replace(new RegExp('\\b' + x + '\\b', 'g'), '(' + xs + ')');
      try { subbed = math.simplify(subbed).toString(); } catch (e) {}
      steps.push(step('Substitute that into equation ' + (j + 1) + ', leaving one unknown (' + other + ')', tex(subbed) + ' = 0'));
      const inner = solve(subbed + '=0', { variable: other });
      if (!inner.ok) return null;
      steps.push(step('Solve for ' + other + ':'), ...inner.steps.slice(1).map(s => Object.assign({}, s, { level: (s.level || 0) + 1 })));
      if (!inner.solutions || !inner.solutions.length) return done('Solve', steps.concat(step('There is no real value of ' + other + ', so the system has no real solution.')), ans('\\text{no real solution}', 'no real solution'), { solutions: [] });
      const pairs = inner.solutions.map(val => ({ [other]: val, [x]: math.evaluate(xs, { [other]: val }) }));
      const show = (p, sep) => vars.map(n => n + ' = ' + fmt(p[n], 6)).join(sep);
      steps.push(step('Put each value back to get ' + x, pairs.map(p => show(p, ',\\ ')).join('\\qquad\\text{and}\\qquad ')));
      return done('Solve', steps, ans(pairs.map(p => show(p, ',\\ ')).join(';\\quad '), pairs.map(p => show(p, ', ')).join('; ')), { solutions: pairs, variables: vars });
    }
    return null;
  }

  /* ---------- presentation helpers ---------- */
  /* Nerdamer's LaTeX with proper function names */
  const ntex = s => {
    try {
      return N(clean(String(s))).toTeX()
        .replace(/\\mathrm\{(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh)\}/g, '\\$1').replace(/\\mathrm\{log\}/g, '\\ln')
        .replace(/\\mathrm\{a(sin|cos|tan)\}/g, '\\arc$1').replace(/\\mathrm\{erf\}/g, '\\operatorname{erf}');
    } catch (e) { return tex(s); }
  };
  /* short human text for a sub-expression inside a sentence: x ^ 2 -> x², * -> · */
  const pretty = str => { try { return parse(str).toString({ parenthesis: 'auto' }).replace(/\s*\^\s*2\b/g, '\u00b2').replace(/\s*\^\s*3\b/g, '\u00b3').replace(/\s*\*\s*/g, '\u00b7').replace(/\blog\(/g, 'ln('); } catch (e) { return String(str); } };

  /* ---------- polynomial algebra on exact coefficients ---------- */
  const polyTrim = c => { while (c.length > 1 && c[c.length - 1].zero) c.pop(); return c; };
  function polyDivmod(a, b) {
    a = polyTrim(a.slice());
    const q = new Array(Math.max(a.length - b.length + 1, 1)).fill(null).map(() => new Fr(0));
    while (a.length >= b.length && !(a.length === 1 && a[0].zero)) {
      const k = a.length - b.length, f = a[a.length - 1].div(b[b.length - 1]);
      q[k] = f;
      for (let i = 0; i < b.length; i++) a[i + k] = a[i + k].sub(f.mul(b[i]));
      a.pop();
      while (a.length > 1 && a[a.length - 1].zero) a.pop();
      if (!a.length) a = [new Fr(0)];
    }
    return [polyTrim(q), a];
  }
  function polyGcd(a, b) {
    a = polyTrim(a.slice()); b = polyTrim(b.slice());
    while (!(b.length === 1 && b[0].zero)) { const r = polyDivmod(a, b)[1]; a = b; b = r; }
    const lead = a[a.length - 1];
    return a.map(k => k.div(lead)); // monic
  }
  /* evaluable and readable: x^3 + 3*x^2 - x/2 + 1 */
  function polyPlainStr(c, v) {
    const parts = [];
    for (let k = c.length - 1; k >= 0; k--) {
      if (c[k].zero) continue;
      const neg = c[k].neg_, ab = c[k].abs();
      const num = ab.d === 1 ? String(ab.n) : '(' + ab.str() + ')';
      const t = k === 0 ? num : (ab.one ? '' : num + '*') + v + (k > 1 ? '^' + k : '');
      parts.push((parts.length ? (neg ? ' - ' : ' + ') : (neg ? '-' : '')) + t);
    }
    return parts.join('') || '0';
  }
  /* c = lead * product of (x - r) factors * primitive remainder.  Returns { tex, plain } */
  function factorPoly(c, v) {
    c = polyTrim(c.slice());
    const common = c.reduce((m, k) => lcm(m, k.d), 1);
    let ints = c.map(k => Math.round(k.num() * common));
    let g = ints.reduce((m, k) => gcd(m, k), 0) || 1;
    if (ints[ints.length - 1] < 0) g = -g;
    let lead = new Fr(g, common);
    let rest = ints.map(k => new Fr(k / g));
    const roots = [];
    while (rest.length > 2) {
      const cm = rest.reduce((m, k) => lcm(m, k.d), 1), iv = rest.map(k => Math.round(k.num() * cm));
      let hit = null;
      for (const cd of rationalCandidates(iv)) { const r = new Fr(cd[0], cd[1]), q = syntheticDivide(rest, r); if (q) { hit = { r, q }; break; } }
      if (!hit) break;
      roots.push(hit.r); rest = hit.q;
    }
    if (rest.length === 2) { roots.push(rest[0].neg().div(rest[1])); lead = lead.mul(rest[1]); rest = [new Fr(1)]; }
    else if (rest.length > 2) { const cm = rest.reduce((m, k) => lcm(m, k.d), 1), iv = rest.map(k => Math.round(k.num() * cm)), gg = iv.reduce((m, k) => gcd(m, k), 0) || 1; lead = lead.mul(new Fr(gg, cm)); rest = iv.map(k => new Fr(k / gg)); }
    else lead = lead.mul(rest[0]);
    const groups = [];
    for (const r of roots.sort((a, b) => a.num() - b.num())) { const hit = groups.find(x => x.r.eq(r)); if (hit) hit.k++; else groups.push({ r, k: 1 }); }
    const ft = [], fp = [];
    for (const { r, k } of groups) {
      // (x - n/d) = (d x - n) / d : keep integer factors, push the denominator into the leading constant
      lead = lead.mul(new Fr(1, Math.pow(r.d, k)));
      const lin = (r.d === 1 ? '' : r.d) + v + (r.neg_ ? ' + ' + Math.abs(r.n) : r.n === 0 ? '' : ' - ' + r.n);
      ft.push('(' + lin + ')' + (k > 1 ? '^{' + k + '}' : '')); fp.push('(' + lin.replace(/(\d)([a-z])/g, '$1*$2') + ')' + (k > 1 ? '^' + k : ''));
    }
    if (rest.length > 2) { ft.push('\\left(' + polyTex(rest, v) + '\\right)'); fp.push('(' + polyPlainStr(rest, v) + ')'); }
    let lt = lead.one ? '' : lead.n === -1 && lead.d === 1 ? '-' : lead.tex();
    return { tex: lt + ft.join(''), plain: (lead.one ? '' : '(' + lead.str() + ')*') + (fp.join('*') || '1'), roots, rest };
  }
  /* rational function in v: one cancelled fraction N/D, or null */
  function ratForm(s, v) {
    let rz;
    try { rz = math.rationalize(s, {}, true); } catch (e) { return null; }
    const nn = rz.numerator && polyCoeffs(rz.numerator.toString(), v), dd = polyCoeffs((rz.denominator || '1').toString(), v);
    if (!nn || !dd) return null;
    let n = nn, d = dd, g = null;
    if (d.length > 1 && n.length > 0) { const gg = polyGcd(n, d); if (gg.length > 1) { g = gg; n = polyDivmod(n, gg)[0]; d = polyDivmod(d, gg)[0]; } }
    // scale so the denominator has integer coefficients and a positive leading coefficient
    const cm = [...n, ...d].reduce((m, k) => lcm(m, k.d), 1);
    let sc = new Fr(cm), lead = d[d.length - 1].mul(sc);
    if (lead.neg_) sc = sc.neg();
    n = n.map(k => k.mul(sc)); d = d.map(k => k.mul(sc));
    const gi = [...n, ...d].reduce((m, k) => gcd(m, Math.round(k.num())), 0) || 1;
    n = n.map(k => k.div(gi)); d = d.map(k => k.div(gi));
    const nTex = d.length === 1 ? null : factorPoly(n.length === 1 && n[0].zero ? [new Fr(0)] : n, v).tex.replace(/^$/, '1');
    const dTex = factorPoly(d, v).tex;
    const num = polyTex(n, v);
    const tx = d.length === 1 && d[0].one ? num : '\\frac{' + (n.length > 1 ? (nTex && nTex.length < num.length + 6 ? nTex : num) : num) + '}{' + dTex + '}';
    const plain = d.length === 1 && d[0].one ? polyPlainStr(n, v) : '(' + polyPlainStr(n, v) + ')/(' + polyPlainStr(d, v) + ')';
    return { tex: tx, plain, cancelled: g, num: n, den: d };
  }

  /* Several correct forms of the same function: pick the neatest.  raw = the rule-engine result, orig = what was differentiated,
     nerd() = Nerdamer's answer. Candidates are checked numerically against raw before they are allowed. */
  function bestForm(raw, orig, v, nerd) {
    const cands = [];
    try { const sm = math.simplify(raw).toString(); cands.push({ plain: sm, tex: tex(sm), len: sm.length }); } catch (e) { cands.push({ plain: raw, tex: tex(raw), len: raw.length + 20 }); }
    try { const rf = ratForm(raw, v); if (rf) cands.push({ plain: rf.plain, tex: rf.tex, len: rf.tex.length * 0.6, rational: true }); } catch (e) {}
    try { const nd = nerd(); if (nd && !/diff\(|error/i.test(nd)) cands.push({ plain: nd, tex: ntex(nd), len: nd.length }); } catch (e) {}
    const ok = cands.filter(c => { const eq = sameFunction(raw, c.plain, v); return eq !== false; });
    const pool = ok.length ? ok : cands.slice(0, 1);
    const rat = pool.find(c => c.rational);
    if (rat) return rat;
    return pool.sort((a, b) => a.len - b.len)[0];
  }
  function sameFunction(a, b, v) {
    const f = fnOf(a, v), g = fnOf(b, v);
    let n = 0;
    for (const x of [0.37, 1.3, -0.8, 2.9, -2.2, 0.05, 4.1, 0.61]) { const p = f(x), q = g(x); if (isNum(p) && isNum(q)) { n++; if (Math.abs(p - q) > 1e-7 * (1 + Math.abs(p))) return false; } }
    return n > 0 ? true : null;
  }

  /* ---------- DIFFERENTIATE ---------- */
  const Tp = x => '\\left(' + tex(x) + '\\right)';
  const has = (s, v) => { try { return containsSym(parse(s), v); } catch (e) { return true; } };
  const P = s => '(' + s + ')';
  /* d/dv of expression string s; appends explanation steps; returns the derivative as an (unsimplified) expression string */
  function dnode(s, v, steps, lvl) {
    let node = parse(s);
    while (node.isParenthesisNode) node = node.content;
    const str = node.toString({ parenthesis: 'all' });
    if (!containsSym(node, v)) { steps.push(step('Constant rule', '\\frac{d}{d' + v + '}\\left(' + tex(str) + '\\right) = 0', lvl)); return '0'; }
    if (node.isSymbolNode) { steps.push(step('The derivative of ' + v + ' is 1', null, lvl)); return '1'; }
    if (node.isOperatorNode && node.fn === 'unaryMinus') { const d = dnode(node.args[0].toString(), v, steps, lvl + 1); return '-' + P(d); }
    if (node.isOperatorNode && node.fn === 'unaryPlus') return dnode(node.args[0].toString(), v, steps, lvl);
    const a = node.args && node.args[0] && node.args[0].toString({ parenthesis: 'all' }), b = node.args && node.args[1] && node.args[1].toString({ parenthesis: 'all' });
    const d = x => '\\frac{d}{d' + v + '}';
    if (node.isOperatorNode && (node.op === '+' || node.op === '-')) {
      steps.push(step('Sum / difference rule: differentiate each term', d() + '\\left(' + tex(str) + '\\right) = ' + d() + '\\left(' + tex(a) + '\\right)' + node.op + d() + '\\left(' + tex(b) + '\\right)', lvl));
      const da = dnode(a, v, steps, lvl + 1), db = dnode(b, v, steps, lvl + 1);
      return P(da) + node.op + P(db);
    }
    if (node.isOperatorNode && node.op === '*') {
      const ha = containsSym(node.args[0], v), hb = containsSym(node.args[1], v);
      if (!ha || !hb) {
        const k = ha ? b : a, g = ha ? a : b;
        steps.push(step('Constant multiple rule: ' + pretty(k) + ' stays in front', d() + '\\left(' + tex(str) + '\\right) = ' + tex(k) + '\\cdot ' + d() + '\\left(' + tex(g) + '\\right)', lvl));
        if (g === v) return P(k);
        const dg = dnode(g, v, steps, lvl + 1);
        return P(k) + '*' + P(dg);
      }
      steps.push(step('Product rule: (u\u00b7w)\u2032 = u\u2032w + uw\u2032, with u = ' + pretty(a) + ', w = ' + pretty(b), d() + '\\left(' + tex(str) + '\\right) = u\'w + uw\'', lvl));
      const da = dnode(a, v, steps, lvl + 1), db = dnode(b, v, steps, lvl + 1);
      steps.push(step('Combine', Tp(da) + '\\cdot ' + Tp(b) + ' + ' + Tp(a) + '\\cdot ' + Tp(db), lvl + 1));
      return P(da) + '*' + P(b) + '+' + P(a) + '*' + P(db);
    }
    if (node.isOperatorNode && node.op === '/') {
      if (!containsSym(node.args[1], v)) {
        steps.push(step('Constant divisor: differentiate the numerator and divide', null, lvl));
        const da = dnode(a, v, steps, lvl + 1);
        return P(da) + '/' + P(b);
      }
      steps.push(step('Quotient rule: (u/w)\u2032 = (u\u2032w \u2212 uw\u2032) / w\u00b2, with u = ' + pretty(a) + ', w = ' + pretty(b), null, lvl));
      const da = dnode(a, v, steps, lvl + 1), db = dnode(b, v, steps, lvl + 1);
      steps.push(step('Combine', '\\frac{' + Tp(da) + '\\cdot ' + Tp(b) + ' - ' + Tp(a) + '\\cdot ' + Tp(db) + '}{' + Tp(b) + '^2}', lvl + 1));
      return '((' + da + ')*' + P(b) + '-' + P(a) + '*(' + db + '))/(' + P(b) + ')^2';
    }
    if (node.isOperatorNode && node.op === '^') {
      const ha = containsSym(node.args[0], v), hb = containsSym(node.args[1], v);
      if (ha && !hb) {
        if (a === v) { steps.push(step('Power rule: (' + v + '\u207f)\u2032 = n\u00b7' + v + '\u207f\u207b\u00b9, with n = ' + pretty(b), d() + '\\left(' + tex(str) + '\\right) = ' + tex(b + '*' + v + '^(' + b + '-1)'), lvl)); return P(b) + '*' + v + '^(' + b + '-1)'; }
        steps.push(step('Power rule with the chain rule: (u\u207f)\u2032 = n\u00b7u\u207f\u207b\u00b9\u00b7u\u2032, with u = ' + pretty(a) + ' and n = ' + pretty(b), null, lvl));
        const da = dnode(a, v, steps, lvl + 1);
        return P(b) + '*' + P(a) + '^(' + b + '-1)*' + P(da);
      }
      if (!ha && hb) {
        const isE = a === 'e';
        steps.push(step(isE ? 'Exponential rule: (e^u)\u2032 = e^u\u00b7u\u2032, with u = ' + b : 'Exponential rule: (a^u)\u2032 = a^u\u00b7ln(a)\u00b7u\u2032, with a = ' + a + ' and u = ' + b, null, lvl));
        const db = dnode(b, v, steps, lvl + 1);
        return isE ? P(str) + '*' + P(db) : P(str) + '*log(' + a + ')*' + P(db);
      }
      steps.push(step('Both base and exponent contain ' + v + ': use logarithmic differentiation, (f^g)\u2032 = f^g\u00b7(g\u2032 ln f + g f\u2032/f)', null, lvl));
      const da = dnode(a, v, steps, lvl + 1), db = dnode(b, v, steps, lvl + 1);
      return P(str) + '*(' + P(db) + '*log(' + a + ')+' + P(b) + '*' + P(da) + '/' + P(a) + ')';
    }
    if (node.isFunctionNode && node.args.length === 1) {
      const name = node.fn.name, u = node.args[0].toString({ parenthesis: 'all' });
      const T = {
        sin: 'cos(U)', cos: '-sin(U)', tan: '1/cos(U)^2', cot: '-1/sin(U)^2', sec: 'sec(U)*tan(U)', csc: '-csc(U)*cot(U)',
        asin: '1/sqrt(1-U^2)', acos: '-1/sqrt(1-U^2)', atan: '1/(1+U^2)', sinh: 'cosh(U)', cosh: 'sinh(U)', tanh: '1/cosh(U)^2',
        exp: 'exp(U)', log: '1/U', sqrt: '1/(2*sqrt(U))', abs: 'abs(U)/U', cbrt: '1/(3*cbrt(U)^2)'
      }[name];
      if (T) {
        const outer = T.replace(/U/g, '(' + u + ')');
        const isX = u === v;
        steps.push(step((isX ? 'Standard derivative' : 'Chain rule: (f(u))\u2032 = f\u2032(u)\u00b7u\u2032, with u = ' + pretty(u)) + ' of ' + (name === 'log' ? 'ln' : name), d() + '\\left(' + tex(str) + '\\right) = ' + tex(outer) + (isX ? '' : '\\cdot u\''), lvl));
        if (isX) return outer;
        const du = dnode(u, v, steps, lvl + 1);
        return P(outer) + '*' + P(du);
      }
    }
    throw new Error('I do not know how to differentiate ' + str);
  }

  function diff(text, opts) {
    opts = opts || {};
    let expr = clean(String(text).replace(/^\s*(d\/d[a-z]|f\s*\(\s*[a-z]\s*\)\s*=|y\s*=)\s*/i, ''));
    let order = Math.max(1, Math.min(4, opts.order | 0 || 1));
    try { parse(expr); } catch (e) { return fail('I could not read that expression.'); }
    const syms = symbols(expr);
    const v = pickVar(syms, opts.variable);
    const steps = [step('Differentiate with respect to ' + v, 'f(' + v + ') = ' + tex(expr))];
    let cur = expr, lastTex = '';
    try {
      for (let k = 1; k <= order; k++) {
        if (order > 1) steps.push(step('Derivative number ' + k, null));
        const raw = dnode(cur, v, steps, 0);
        const best = bestForm(raw, cur, v, () => N('diff(' + clean(cur) + ',' + v + ')').toString());
        steps.push(step('Simplify', 'f' + "'".repeat(k) + '(' + v + ') = ' + best.tex));
        cur = best.plain; lastTex = best.tex;
      }
    } catch (e) {
      // fall back to Nerdamer for forms the rule engine does not cover
      try { let c = expr; for (let k = 0; k < order; k++) c = N('diff(' + c + ',' + v + ')').toString(); const out = c; return verifyDiff(expr, out, v, steps.concat(step('Differentiated with the symbolic engine (no rule-by-rule breakdown for this form)')), true); } catch (e2) { return fail('I could not differentiate that: ' + (e && e.message)); }
    }
    return verifyDiff(expr, cur, v, steps, false, order, lastTex);
  }
  function verifyDiff(expr, derivStr, v, steps, viaNerd, order, texOverride) {
    order = order || 1;
    const f = fnOf(expr, v), g = fnOf(derivStr, v);
    let worst = 0, n = 0;
    for (const x of [0.37, 0.91, 1.7, -0.6, 2.4, -1.3, 3.1, 0.12]) {
      const h = 1e-4 * Math.max(1, Math.abs(x));
      let num;
      if (order === 1) num = (f(x + h) - f(x - h)) / (2 * h);
      else continue;
      const an = g(x);
      if (isNum(num) && isNum(an)) { worst = Math.max(worst, Math.abs(num - an) / (1 + Math.abs(num))); n++; }
    }
    const ok = n === 0 || worst < 1e-4;
    if (order === 1) steps.push(step(n ? (ok ? 'Check: the result agrees with a numeric derivative at ' + n + ' sample points. \u2713' : 'Warning: the result differs from a numeric derivative (check the input).') : 'Check skipped (the function is undefined at the sample points).'));
    let t = texOverride;
    if (!t) { try { t = tex(derivStr); } catch (e) { t = derivStr; } }
    return done('Differentiate', steps, ans("f" + "'".repeat(order) + '(' + v + ') = ' + t, derivStr), { verified: ok });
  }

  /* ---------- INTEGRATE ---------- */
  /* antiderivative of s (string) by rules, appending steps; returns the antiderivative string or null when no rule applies */
  function inode(s, v, steps, lvl) {
    let node = parse(s);
    while (node.isParenthesisNode) node = node.content;
    const str = node.toString({ parenthesis: 'all' });
    const I = e => '\\int ' + tex(e) + '\\,d' + v;
    if (!containsSym(node, v)) { steps.push(step('Constant rule: \u222b k dx = kx', I(str) + ' = ' + tex(str + '*' + v), lvl)); return P(str) + '*' + v; }
    if (node.isSymbolNode) { steps.push(step('Power rule with n = 1', I(v) + ' = \\frac{' + v + '^2}{2}', lvl)); return v + '^2/2'; }
    if (node.isOperatorNode && node.fn === 'unaryMinus') { const r = inode(node.args[0].toString(), v, steps, lvl + 1); return r === null ? null : '-' + P(r); }
    if (node.isOperatorNode && (node.op === '+' || node.op === '-')) {
      steps.push(step('Sum / difference rule: integrate each term separately', I(str) + ' = ' + I(node.args[0].toString({ parenthesis: 'all' })) + node.op + I(node.args[1].toString({ parenthesis: 'all' })), lvl));
      const a = inode(node.args[0].toString({ parenthesis: 'all' }), v, steps, lvl + 1); if (a === null) return null;
      const b = inode(node.args[1].toString({ parenthesis: 'all' }), v, steps, lvl + 1); if (b === null) return null;
      return P(a) + node.op + P(b);
    }
    if (node.isOperatorNode && (node.op === '*' || node.op === '/')) {
      const ha = containsSym(node.args[0], v), hb = containsSym(node.args[1], v);
      if (node.op === '*' && (!ha || !hb)) {
        const k = ha ? node.args[1].toString({ parenthesis: 'all' }) : node.args[0].toString({ parenthesis: 'all' }), g = ha ? node.args[0].toString({ parenthesis: 'all' }) : node.args[1].toString({ parenthesis: 'all' });
        steps.push(step('Constant multiple rule: ' + tex(k) + ' comes out of the integral', I(str) + ' = ' + tex(k) + I(g), lvl));
        const r = inode(g, v, steps, lvl + 1); return r === null ? null : P(k) + '*' + P(r);
      }
      if (node.op === '/' && !hb) {
        steps.push(step('Constant divisor: divide after integrating', null, lvl));
        const r = inode(node.args[0].toString({ parenthesis: 'all' }), v, steps, lvl + 1); return r === null ? null : P(r) + '/' + P(node.args[1].toString({ parenthesis: 'all' }));
      }
      if (node.op === '/' && !ha) {
        const L = linear(node.args[1], v), k = node.args[0].toString({ parenthesis: 'all' });
        if (L) { steps.push(step('1/(ax + b) integrates to ln|ax + b| / a', I(str) + ' = ' + (k === '1' ? '' : tex(k) + '\\cdot') + '\\frac{1}{' + fmt(L.a) + '}\\ln\\left|' + tex(node.args[1].toString()) + '\\right|', lvl)); return P(k) + '*log(abs(' + node.args[1].toString({ parenthesis: 'all' }) + '))/(' + L.aS + ')'; }
      }
      if (node.op === '*') {
        // polynomial product: expand and integrate term by term
        const pc = polyCoeffs(str, v);
        if (pc) { const ex = polyTex(pc, v); steps.push(step('Expand the product first', I(str) + ' = ' + I(ex.replace(/\\frac\{(\d+)\}\{(\d+)\}/g, '($1/$2)').replace(/[{}]/g, m => m === '{' ? '(' : ')')), lvl)); return inode(N('expand(' + str + ')').toString(), v, steps, lvl + 1); }
      }
    }
    if (node.isOperatorNode && node.op === '^') {
      const ha = containsSym(node.args[0], v), hb = containsSym(node.args[1], v);
      const a = node.args[0].toString({ parenthesis: 'all' }), b = node.args[1].toString({ parenthesis: 'all' });
      if (ha && !hb) {
        let n; try { n = node.args[1].compile().evaluate(); } catch (e) { n = null; }
        const L = linear(node.args[0], v);
        if (typeof n === 'number' && L) {
          if (Math.abs(n + 1) < 1e-12) { steps.push(step('n = \u22121: \u222b u\u207b\u00b9 du = ln|u|', I(str) + ' = \\frac{1}{' + fmt(L.a) + '}\\ln\\left|' + tex(a) + '\\right|', lvl)); return 'log(abs(' + a + '))/(' + L.aS + ')'; }
          steps.push(step(L.a === 1 && L.b === 0 ? 'Power rule: \u222b x\u207f dx = x\u207f\u207a\u00b9/(n+1)' : 'Power rule with the substitution u = ' + tex(a), I(str) + ' = \\frac{' + tex(P(a)) + '^{' + fmt(n + 1, 8) + '}}{' + fmt(n + 1, 8) + (L.a === 1 ? '' : '\\cdot ' + fmt(L.a)) + '}', lvl));
          return P(a) + '^(' + fmt(n + 1, 12) + ')/(' + fmt(n + 1, 12) + '*' + L.aS + ')';
        }
      }
      if (!ha && hb) {
        const L = linear(node.args[1], v);
        if (L) { const isE = a === 'e'; steps.push(step(isE ? '\u222b e^u du = e^u (with u = ' + tex(b) + ')' : '\u222b a^u du = a^u / ln a (with u = ' + tex(b) + ')', null, lvl)); return isE ? P(str) + '/(' + L.aS + ')' : P(str) + '/(log(' + a + ')*' + L.aS + ')'; }
      }
    }
    if (node.isFunctionNode && node.args.length === 1) {
      const name = node.fn.name, L = linear(node.args[0], v), u = node.args[0].toString({ parenthesis: 'all' });
      const T = { sin: '-cos(U)', cos: 'sin(U)', exp: 'exp(U)', sinh: 'cosh(U)', cosh: 'sinh(U)', tan: '-log(abs(cos(U)))', sec: 'log(abs(sec(U)+tan(U)))' }[name];
      if (T && L) {
        steps.push(step('Standard integral of ' + name + (L.a === 1 && L.b === 0 ? '' : ', divided by the inner coefficient ' + fmt(L.a)), I(str) + ' = \\frac{1}{' + fmt(L.a) + '}\\cdot ' + Tp(T.replace(/U/g, '(' + u + ')')), lvl));
        return '(' + T.replace(/U/g, '(' + u + ')') + ')/(' + L.aS + ')';
      }
    }
    return null;
  }
  function linear(node, v) {
    try { const co = polyCoeffs(node.toString ? node.toString() : String(node), v); if (co && co.length === 2) return { a: co[1].num(), b: co[0].num(), aS: co[1].str() }; } catch (e) {}
    return null;
  }

  function integrate(text, opts) {
    opts = opts || {};
    let expr = clean(text).replace(/^\s*(\u222b|int(egral)?\s*)\s*/i, '').replace(/\s*d[a-z]\s*$/i, m => (/d[a-z]$/.test(m) && opts.stripD !== false && symbols(clean(text).replace(/\s*d[a-z]\s*$/i, '')).length >= 0 && /\s/.test(m) ? '' : m));
    try { parse(expr); } catch (e) { return fail('I could not read that expression.'); }
    const syms = symbols(expr), v = pickVar(syms, opts.variable);
    const hasBounds = opts.lower != null && opts.upper != null && String(opts.lower).trim() !== '' && String(opts.upper).trim() !== '';
    const steps = [step(hasBounds ? 'Evaluate the definite integral' : 'Find the antiderivative', (hasBounds ? '\\int_{' + tex(String(opts.lower)) + '}^{' + tex(String(opts.upper)) + '}' : '\\int') + ' ' + tex(expr) + '\\,d' + v)];
    let anti = null, how = 'rules';
    try { anti = inode(expr, v, steps, 0); } catch (e) { anti = null; }
    if (anti === null) {
      steps.length = 1;
      try {
        const out = N('integrate(' + expr + ',' + v + ')').toString();
        if (out && !/integrate\(/.test(out) && !/error/i.test(out)) { anti = out; how = 'engine'; steps.push(step('No elementary rule applies directly (substitution, parts, ... would be needed), so the symbolic engine finds the antiderivative.')); }
      } catch (e) { anti = null; }
    }
    if (anti === null) {
      if (!hasBounds) return fail('I could not find a closed-form antiderivative for that.');
      return numericDefinite(expr, v, opts, steps);
    }
    let simp = anti, simpTex = null;
    try { simp = math.simplify(anti).toString(); } catch (e) {}
    try { // Nerdamer's form is often neater for polynomials and trig; it must agree with ours (up to the constant) and ours must not need |.|
      const nd = N('integrate(' + clean(expr) + ',' + v + ')').toString();
      if (nd && !/integrate\(|error/i.test(nd) && !/log|abs/.test(simp) && nd.length <= simp.length + 4) { const f0 = fnOf(expr, v), g0 = fnOf(nd, v); let ok0 = true, c0 = 0; for (const x of [0.37, 1.3, 2.9]) { const h = 1e-4 * Math.max(1, x), dn = (g0(x + h) - g0(x - h)) / (2 * h); if (isNum(dn) && Math.abs(dn - f0(x)) > 1e-3 * (1 + Math.abs(f0(x)))) ok0 = false; if (isNum(dn)) c0++; } if (ok0 && c0) { simp = nd; simpTex = ntex(nd); } }
    } catch (e) {}
    if (!simpTex) simpTex = tex(simp);
    if (how === 'rules') steps.push(step('Put it together', '\\int ' + tex(expr) + '\\,d' + v + ' = ' + simpTex + ' + C'));
    // verify by differentiating numerically
    const f = fnOf(expr, v), F2 = fnOf(simp, v);
    let worst = 0, n = 0;
    for (const x of [0.37, 0.91, 1.7, 2.4, 3.1, 0.62, 1.25]) { const h = 1e-4 * Math.max(1, Math.abs(x)), num = (F2(x + h) - F2(x - h)) / (2 * h), an = f(x); if (isNum(num) && isNum(an)) { worst = Math.max(worst, Math.abs(num - an) / (1 + Math.abs(an))); n++; } }
    let ok = n === 0 || worst < 1e-3;
    if (how === 'engine' && (n === 0 || !ok)) { // cannot verify it: do not present it
      if (!hasBounds) return fail('I could not find an antiderivative that I can verify for that function.');
      return numericDefinite(expr, v, opts, [steps[0]]);
    }
    steps.push(step(n ? (ok ? 'Check: differentiating the result gives back the original function. \u2713' : 'Warning: the derivative of the result does not match the original function.') : 'Check skipped (undefined at the sample points).'));
    if (!hasBounds) return done('Integrate', steps, ans('\\int ' + tex(expr) + '\\,d' + v + ' = ' + simpTex + ' + C', simp + ' + C'), { verified: ok });
    let lo, hi;
    try { lo = math.evaluate(clean(String(opts.lower))); hi = math.evaluate(clean(String(opts.upper))); } catch (e) { return fail('I could not read the bounds.'); }
    const Fa = F2(lo), Fb = F2(hi);
    if (!isNum(Fa) || !isNum(Fb)) return numericDefinite(expr, v, opts, [steps[0]]);
    steps.push(step('Evaluate F at the bounds: F(b) \u2212 F(a)', 'F(' + fmt(hi, 6) + ') - F(' + fmt(lo, 6) + ') = ' + fmt(Fb, 8) + ' - ' + fmt(Fa, 8)));
    const val = Fb - Fa;
    if (!isNum(val)) return numericDefinite(expr, v, opts, steps);
    steps.push(step('Result', '\\int_{' + fmt(lo, 6) + '}^{' + fmt(hi, 6) + '} ' + tex(expr) + '\\,d' + v + ' = ' + fmt(val, 8)));
    return done('Integrate', steps, ans('\\int_{' + fmt(lo, 6) + '}^{' + fmt(hi, 6) + '} ' + tex(expr) + '\\,d' + v + ' = ' + fmt(val, 8), fmt(val, 8)), { value: val, verified: ok });
  }
  function numericDefinite(expr, v, opts, steps) {
    let lo, hi;
    try { lo = math.evaluate(clean(String(opts.lower))); hi = math.evaluate(clean(String(opts.upper))); } catch (e) { return fail('I could not read the bounds.'); }
    const f = fnOf(expr, v);
    const simpson = (a, b, n) => { const h = (b - a) / n; let s = f(a) + f(b); for (let k = 1; k < n; k++) s += f(a + k * h) * (k % 2 ? 4 : 2); return s * h / 3; };
    let prev = simpson(lo, hi, 200), val = prev;
    for (let n = 400; n <= 12800; n *= 2) { val = simpson(lo, hi, n); if (Math.abs(val - prev) < 1e-10 * (1 + Math.abs(val))) break; prev = val; }
    if (!isNum(val)) return fail('The integral could not be evaluated (the function may be undefined on the interval).');
    steps.push(step('There is no elementary antiderivative, so the definite integral is computed numerically (adaptive Simpson rule)'));
    steps.push(step('Result', '\\int_{' + fmt(lo, 6) + '}^{' + fmt(hi, 6) + '} ' + tex(expr) + '\\,d' + v + ' \\approx ' + fmt(val, 8)));
    return done('Integrate', steps, ans('\\int_{' + fmt(lo, 6) + '}^{' + fmt(hi, 6) + '} ' + tex(expr) + '\\,d' + v + ' \\approx ' + fmt(val, 8), fmt(val, 8)), { value: val, approximate: true });
  }

  /* ---------- SIMPLIFY / EXPAND / FACTOR / EVALUATE ---------- */
  function transform(kind, text, opts) {
    const expr = clean(text);
    try { parse(expr); } catch (e) { return fail('I could not read that expression.'); }
    const syms = symbols(expr), v = pickVar(syms, opts && opts.variable);
    const steps = [step({ simplify: 'Simplify', expand: 'Expand', factor: 'Factor' }[kind] + ' the expression', tex(expr))];
    const pc = syms.length <= 1 ? polyCoeffs(expr, v) : null;
    let outTex, outPlain, extra = {};
    try {
      if (kind === 'expand') {
        if (pc) { steps.push(step('Multiply out the brackets and collect like terms')); outTex = polyTex(pc, v); outPlain = polyPlainStr(pc, v); }
        else { outPlain = N('expand(' + expr + ')').toString(); outTex = ntex(outPlain); steps.push(step('Multiply out the brackets and collect like terms')); }
      } else if (kind === 'factor') {
        if (pc && pc.length > 1) {
          const fp = factorPoly(pc, v);
          if (pc.length > 2) {
            const sol = solve(expr + '=0', { variable: v });
            if (sol.ok && sol.solutions && sol.solutions.length) steps.push(step('Find the roots (where the expression is zero); each rational root r gives a factor (' + v + ' \u2212 r)', 'f(' + v + ') = 0 \\Rightarrow ' + sol.answer.tex));
          }
          if (fp.roots.length === 0) steps.push(step('This polynomial has no rational roots, so it does not factor further over the rationals.'));
          outTex = fp.tex || '1'; outPlain = fp.plain;
        } else { outPlain = N('factor(' + expr + ')').toString(); outTex = ntex(outPlain); }
      } else { // simplify
        const rf = syms.length === 1 ? ratForm(expr, v) : null;
        const ff = syms.length === 1 ? fnOf(expr, v) : null;
        let konst = null;
        if (ff) { const ys = [0.37, 1.3, -0.8, 2.9, -2.2, 0.61, 4.1].map(ff).filter(isNum); if (ys.length >= 4 && ys.every(y => Math.abs(y - ys[0]) < 1e-12 * (1 + Math.abs(ys[0])))) konst = ys[0]; }
        if (konst !== null && !pc) {
          steps.push(step('The expression has the same value for every ' + v + ' (an identity), so it equals a constant'));
          const fr = Fr.of(konst);
          outTex = Math.abs(fr.num() - konst) < 1e-12 ? fr.tex() : fmt(konst, 10); outPlain = Math.abs(fr.num() - konst) < 1e-12 ? fr.str() : fmt(konst, 10);
        } else if (rf && /\//.test(expr)) {
          steps.push(step('Write everything as a single fraction'));
          if (rf.cancelled) { const gf = factorPoly(rf.cancelled, v); steps.push(step('Cancel the common factor ' + gf.plain.replace(/\*/g, '') + ' from the numerator and denominator (the original is undefined where it is zero)')); extra.cancelled = true; }
          outTex = rf.tex; outPlain = rf.plain;
        } else {
          let best = math.simplify(expr).toString(), bestTex = null;
          try { const alt = N(expr).toString(); if (sameFunction(expr, alt, v) && alt.length < best.length && !/NaN/.test(alt)) { best = alt; bestTex = ntex(alt); } } catch (e) {}
          steps.push(step('Combine and simplify using algebra and trig identities'));
          outPlain = best; outTex = bestTex || tex(best);
        }
      }
    } catch (e) { return fail('I could not ' + kind + ' that expression.'); }
    steps.push(step('Result', outTex));
    const same = sameFunction(expr, outPlain, v);
    steps.push(step(same === false ? 'Warning: the result does not match the original at sample points.' : same ? 'Check: the original and the result agree at sample points. \u2713' : 'Check skipped (undefined at the sample points).'));
    return done(kind[0].toUpperCase() + kind.slice(1), steps, ans(outTex, outPlain), Object.assign({ verified: same !== false }, extra));
  }
  function evaluate(text) {
    const expr = clean(text);
    try {
      const r = math.evaluate(expr);
      const s = math.format(r, { precision: 14 });
      return done('Evaluate', [step('Evaluate', tex(expr)), step('Result', null)], ans(tex(expr) + ' = ' + (typeof r === 'number' ? fmt(r, 12) : s), s));
    } catch (e) { return fail('I could not evaluate that: ' + e.message); }
  }

  /* ---------- LIMIT ---------- */
  function limit(text, opts) {
    const expr = clean(text);
    const syms = symbols(expr), v = pickVar(syms, opts && opts.variable);
    const at = String((opts && opts.at) == null ? '0' : opts.at).trim() || '0';
    try {
      const out = N('limit(' + expr + ',' + v + ',' + clean(at) + ')').toString();
      const steps = [step('Find the limit', '\\lim_{' + v + ' \\to ' + tex(at) + '} ' + tex(expr)), step('Result', null)];
      return done('Limit', steps, ans('\\lim_{' + v + ' \\to ' + tex(at) + '} ' + tex(expr) + ' = ' + tex(out), out));
    } catch (e) { return fail('I could not find that limit.'); }
  }

  /* ---------- input checks ---------- */
  const KNOWN_FN = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'exp', 'log', 'sqrt', 'abs', 'cbrt', 'log10', 'log2', 'floor', 'ceil', 'round', 'sign', 'erf', 'gamma', 'atan2', 'min', 'max', 'pow', 'mod']);
  function checkInput(text, mode) {
    if (/\^\s*\(?\s*-?\d{3,}/.test(text)) return 'That exponent is too large to work with.';
    if (/\d{16,}/.test(text.replace(/[.,\s]/g, ''))) return 'That number has too many digits.';
    if ((text.match(/\(/g) || []).length > 60) return 'That expression has too many brackets.';
    const parts = mode === 'solve' ? text.split(/[;\n=]+/) : [text];
    for (const part of parts) {
      if (!part.trim()) continue;
      let node;
      try { node = parse(part); } catch (e) { continue; } // unreadable input is reported by the mode itself
      let bad = null;
      node.traverse(n => { if (n.isFunctionNode && n.fn && n.fn.name && !KNOWN_FN.has(n.fn.name) && !bad) bad = n.fn.name; });
      if (bad) return 'I do not know the function "' + bad + '". Use sin, cos, tan, exp, log (natural), sqrt, abs, asin, acos, atan, sinh, cosh, tanh.';
    }
    if (mode !== 'solve' && /=/.test(text.replace(/^\s*(f\s*\(\s*[a-z]\s*\)|y)\s*=/i, ''))) return 'Remove the "=" sign: this tool works on an expression, not an equation.';
    return null;
  }

  /* ---------- entry point ---------- */
  function run(mode, input, opts) {
    opts = opts || {};
    const text = String(input == null ? '' : input).trim();
    if (!text) return fail('Type an equation or expression first.');
    if (text.length > 600) return fail('That input is too long.');
    const bad = checkInput(text, mode);
    if (bad) return fail(bad);
    try {
      switch (mode) {
        case 'solve': return solve(text, opts);
        case 'diff': return diff(text, opts);
        case 'int': return integrate(text, opts);
        case 'simplify': return transform('simplify', text, opts);
        case 'expand': return transform('expand', text, opts);
        case 'factor': return transform('factor', text, opts);
        case 'limit': return limit(text, opts);
        case 'eval': return evaluate(text);
        default: return fail('Unknown mode ' + mode);
      }
    } catch (e) { return fail('Something went wrong while working this out' + (e && e.message ? ' (' + e.message + ')' : '') + '.'); }
  }

  return { run, solve, diff, integrate, transform, evaluate, limit, clean, tex, symbols, polyCoeffs, numericRoots, polyRoots, fnOf };
});
