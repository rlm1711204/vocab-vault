// The built-in maths solver — works offline, no AI. It does two jobs:
//   1. solveQuestion(q): answers the question types that are pure calculation — simplification (BODMAS, fractions, surds,
//      powers, x% of y), "what percent of", percentage change, equations in one unknown (linear or quadratic), two
//      linear equations, HCF / LCM, simple and compound interest, averages — with short steps. Word problems that need
//      reasoning ("a train crosses a pole…") are left to the AI: it returns null rather than guess.
//   2. checkSteps(solution): re-calculates every "a = b" in a written solution and reports any that don't work out.
// Pure functions; unit-tested.

// ---------- reading maths ----------
/** Exam-style maths in plain text → something the parser reads: ×→*, ÷→/, −→-, ²→^2, √→sqrt, 1,20,000→120000. */
export function normalize(s) {
  return String(s ?? "")
    .replace(/[−–—]/g, "-")
    .replace(/[×✕✖]/g, "*")
    .replace(/(\d)\s+[xX]\s+(\d)/g, "$1*$2") // "2 x 3"
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/∛/g, "cbrt")
    .replace(/√/g, "sqrt")
    .replace(/π/g, "pi")
    .replace(/(?<=\d),(?=\d{2,3}\b)/g, "") // Indian / western digit grouping
    .replace(/[₹]|\brs\.?(?=\s*\d)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FUNCS = { sqrt: Math.sqrt, cbrt: Math.cbrt };

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") {
      i++;
      continue;
    }
    const num = /^(\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ t: "n", v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    const word = /^[a-z]+/i.exec(src.slice(i));
    if (word) {
      const w = word[0].toLowerCase();
      if (w in FUNCS || w === "pi" || w === "of") out.push({ t: w in FUNCS ? "f" : w === "pi" ? "n" : "op", v: w === "pi" ? Math.PI : w === "of" ? "*" : w });
      else if (w.length === 1) out.push({ t: "v", v: w });
      else return null; // a word: not pure maths
      i += word[0].length;
      continue;
    }
    if ("+-*/^()%!".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "[" || c === "{") {
      out.push({ t: "op", v: "(" });
      i++;
      continue;
    }
    if (c === "]" || c === "}") {
      out.push({ t: "op", v: ")" });
      i++;
      continue;
    }
    return null;
  }
  return out;
}

const fact = (n) => (n < 0 || n > 170 || !Number.isInteger(n) ? NaN : n <= 1 ? 1 : n * fact(n - 1));

/**
 * Parse maths into a function of the variables: (env) => number. Returns null when the text isn't pure maths.
 * Grammar: expr = term (± term)*; term = power ((*|/) power | implicit power)*; power = unary (^ power)?;
 * unary = -unary | sqrt unary | postfix; postfix = primary (% | !)*; primary = number | var | (expr).
 */
export function parse(text) {
  const toks = tokenize(normalize(text));
  if (!toks || !toks.length) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const startsPrimary = () => peek() && (peek().t === "n" || peek().t === "v" || peek().t === "f" || isOp("("));
  function primary() {
    const t = peek();
    if (!t) throw 0;
    if (t.t === "n") return p++, () => t.v;
    if (t.t === "v") return p++, (env) => (t.v in env ? env[t.v] : NaN);
    if (isOp("(")) {
      p++;
      const e = expr();
      if (!isOp(")")) throw 0;
      p++;
      return e;
    }
    throw 0;
  }
  function postfix() {
    let e = primary();
    while (isOp("%") || isOp("!")) {
      const f = e;
      e = toks[p++].v === "%" ? (env) => f(env) / 100 : (env) => fact(f(env));
    }
    return e;
  }
  function unary() {
    if (isOp("-")) {
      p++;
      const e = unary();
      return (env) => -e(env);
    }
    if (isOp("+")) return p++, unary();
    if (peek()?.t === "f") {
      const fn = FUNCS[toks[p++].v];
      const e = unary();
      return (env) => fn(e(env));
    }
    return postfix();
  }
  function power() {
    const b = unary();
    if (isOp("^")) {
      p++;
      const ex = power();
      return (env) => Math.pow(b(env), ex(env));
    }
    return b;
  }
  function term() {
    let e = power();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = toks[p++].v;
        const a = e;
        const b = power();
        e = op === "*" ? (env) => a(env) * b(env) : (env) => a(env) / b(env);
      } else if (startsPrimary()) {
        const a = e; // implicit multiplication: 2x, 3(4 + 5), (a)(b)
        const b = power();
        e = (env) => a(env) * b(env);
      } else return e;
    }
  }
  function expr() {
    let e = term();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      const a = e;
      const b = term();
      e = op === "+" ? (env) => a(env) + b(env) : (env) => a(env) - b(env);
    }
    return e;
  }
  try {
    const f = expr();
    if (p !== toks.length) return null;
    const vars = [...new Set(toks.filter((t) => t.t === "v").map((t) => t.v))];
    return Object.assign(f, { vars });
  } catch {
    return null;
  }
}

/** The value of pure-number maths, or null. */
export function evaluate(text) {
  const f = parse(text);
  if (!f || f.vars.length) return null;
  const v = f({});
  return Number.isFinite(v) ? v : null;
}

// ---------- writing numbers ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/** A fraction p/q (q ≤ 10000) equal to x, or null. */
export function toFraction(x) {
  if (!Number.isFinite(x) || Number.isInteger(x)) return null;
  let [h1, h0, k1, k0, b] = [1, 0, 0, 1, x];
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(b);
    [h1, h0] = [a * h1 + h0, h1];
    [k1, k0] = [a * k1 + k0, k1];
    if (k1 > 10000) return null;
    if (Math.abs(x - h1 / k1) < 1e-9 * Math.max(1, Math.abs(x))) return [h1, k1];
    b = 1 / (b - a);
    if (!Number.isFinite(b)) break;
  }
  return null;
}

/** 6, 2.5, "5/6 (≈ 0.8333)", 1.4142 — as a person would write the answer. */
export function fmt(x) {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x))) return String(r);
  const short = Number(x.toFixed(4));
  if (Math.abs(short - x) < 1e-12) return String(short); // ends within 4 decimals
  const fr = toFraction(x);
  return fr && fr[1] <= 1000 ? `${fr[0]}/${fr[1]} (≈ ${short})` : String(short);
}

/** True when two answers are the same number (units and words ignored; 1/2 = 0.5 = 50%? no — % stays %). */
export function sameAnswer(a, b) {
  const num = (s) => {
    const t = String(s ?? "").replace(/[,₹]/g, "").trim();
    const frac = /-?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/.exec(t);
    if (frac) return evaluate(frac[0]);
    const m = /-?\d+(?:\.\d+)?/.exec(t);
    return m ? Number(m[0]) : null;
  };
  const x = num(a);
  const y = num(b);
  if (x == null || y == null) return null;
  return Math.abs(x - y) <= 1e-6 + 0.005 * Math.max(Math.abs(x), Math.abs(y));
}

// ---------- solving questions ----------
const N = "(\\d+(?:\\.\\d+)?)";
const numsIn = (s) => (normalize(s).match(/\d+(?:\.\d+)?/g) || []).map(Number);

function hcfLcm(q) {
  const m = /\b(h\.?c\.?f|g\.?c\.?d|l\.?c\.?m|highest common factor|lowest common multiple|least common multiple|greatest common divisor)\b[^0-9]*((?:\d+\s*(?:,|and|&)\s*)+\d+)/i.exec(q);
  if (!m || /\b(h\.?c\.?f|l\.?c\.?m)\b.*\b(h\.?c\.?f|l\.?c\.?m)\b/i.test(q)) return null;
  const nums = (m[2].match(/\d+/g) || []).map(Number);
  if (nums.length < 2 || nums.some((n) => n <= 0 || n > 1e9)) return null;
  const isH = /h\.?c\.?f|g\.?c\.?d|highest|greatest/i.test(m[1]);
  const h = nums.reduce(gcd);
  const l = nums.reduce((a, b) => (a * b) / gcd(a, b));
  const factor = (n) => {
    const f = [];
    for (let d = 2; d * d <= n; d++) while (n % d === 0) f.push(d), (n /= d);
    if (n > 1) f.push(n);
    return f.join(" × ") || "1";
  };
  return {
    answer: String(isH ? h : l),
    steps: [...nums.map((n) => `${n} = ${factor(n)}`), isH ? `HCF = product of the common prime factors = ${h}` : `LCM = product of the highest powers of all primes = ${l}`],
    method: isH ? "HCF by prime factors" : "LCM by prime factors",
  };
}

function interest(q) {
  const t = normalize(q).toLowerCase();
  const simple = /simple interest|\bs\.?\s?i\.?\b/.test(t);
  const compound = /compound interest|\bc\.?\s?i\.?\b|compounded/.test(t);
  if (simple === compound) return null;
  if (/\bfind\b.*\b(rate|time|principal|sum)\b|\b(rate|time|principal)\b\s*(is|=)\s*\?|what (is the )?(rate|time|sum|principal)/.test(t)) return null;
  const rate = new RegExp(`${N}\\s*%`).exec(t);
  const years = new RegExp(`${N}\\s*(years?|yrs?)`).exec(t);
  const months = new RegExp(`${N}\\s*months?`).exec(t);
  const rateNum = rate ? Number(rate[1]) : null;
  const time = years ? Number(years[1]) : months ? Number(months[1]) / 12 : null;
  if (rateNum == null || time == null) return null;
  const rest = numsIn(t).filter((n) => n !== rateNum && n !== Number(years?.[1]) && n !== Number(months?.[1]));
  const P = rest.find((n) => n >= 50);
  if (!P) return null;
  const amountAsked = /\bamount\b/.test(t) && !/interest\s*(on|for|is|=|\?)/.test(t.replace(/compound interest|simple interest/, ""));
  if (simple) {
    const si = (P * rateNum * time) / 100;
    return {
      answer: amountAsked ? `₹${fmt(P + si)}` : `₹${fmt(si)}`,
      steps: [`SI = P × R × T / 100 = ${P} × ${rateNum} × ${fmt(time)} / 100 = ${fmt(si)}`, ...(amountAsked ? [`Amount = P + SI = ${P} + ${fmt(si)} = ${fmt(P + si)}`] : [])],
      method: "Simple interest formula",
    };
  }
  const per = /half[- ]?year|six months|semi[- ]?annual/.test(t) ? 2 : /quarter/.test(t) ? 4 : /month(ly)?\s*compound|compounded monthly/.test(t) ? 12 : 1;
  const r = rateNum / per;
  const n = time * per;
  const A = P * Math.pow(1 + r / 100, n);
  const ci = A - P;
  return {
    answer: amountAsked ? `₹${fmt(Math.round(A * 100) / 100)}` : `₹${fmt(Math.round(ci * 100) / 100)}`,
    steps: [
      ...(per > 1 ? [`Compounded ${per} times a year: rate ${rateNum}/${per} = ${fmt(r)}% for ${fmt(n)} periods`] : []),
      `A = P(1 + r/100)^n = ${P} × (1 + ${fmt(r)}/100)^${fmt(n)} = ${fmt(Math.round(A * 100) / 100)}`,
      ...(amountAsked ? [] : [`CI = A − P = ${fmt(Math.round(A * 100) / 100)} − ${P} = ${fmt(Math.round(ci * 100) / 100)}`]),
    ],
    method: "Compound interest formula",
  };
}

function average(q) {
  const m = /\b(?:average|mean)\s+of\s+((?:-?\d+(?:\.\d+)?\s*(?:,|and|&)\s*)+-?\d+(?:\.\d+)?)\s*(?:\?|\.|$)/i.exec(normalize(q));
  if (!m) return null;
  const nums = (m[1].match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length < 2) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return { answer: fmt(sum / nums.length), steps: [`Sum = ${nums.join(" + ")} = ${fmt(sum)}`, `Average = ${fmt(sum)} ÷ ${nums.length} = ${fmt(sum / nums.length)}`], method: "Sum ÷ count" };
}

function percentOf(q) {
  const t = normalize(q).toLowerCase();
  let m = new RegExp(`what (?:percent|percentage|%) of ${N} is ${N}`).exec(t);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return { answer: `${fmt((b / a) * 100)}%`, steps: [`${b} ÷ ${a} × 100 = ${fmt((b / a) * 100)}%`], method: "Part ÷ whole × 100" };
  }
  m = new RegExp(`${N} is what (?:percent|percentage|%) of ${N}`).exec(t);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return { answer: `${fmt((a / b) * 100)}%`, steps: [`${a} ÷ ${b} × 100 = ${fmt((a / b) * 100)}%`], method: "Part ÷ whole × 100" };
  }
  m = new RegExp(`(increase|decrease|rise|fall|change)[^0-9]*from ${N} to ${N}`).exec(t) || new RegExp(`from ${N} to ${N}[^0-9]*(increase|decrease|rise|fall|change)`).exec(t);
  if (m && /percent|%/.test(t)) {
    const nums = m.slice(1).filter((x) => /^\d/.test(x)).map(Number);
    const [a, b] = nums;
    const ch = ((b - a) / a) * 100;
    return {
      answer: `${fmt(Math.abs(ch))}% ${ch >= 0 ? "increase" : "decrease"}`,
      steps: [`Change = ${b} − ${a} = ${fmt(b - a)}`, `% change = ${fmt(b - a)} ÷ ${a} × 100 = ${fmt(ch)}%`],
      method: "Change ÷ original × 100",
    };
  }
  return null;
}

/** The longest stretch of maths around "=" in a sentence ("If 3x + 5 = 20, find x" → "3x + 5 = 20"). */
function equationsIn(q) {
  const t = normalize(q);
  const MATH = "[0-9a-z+\\-*/^().% ]";
  const re = new RegExp(`(${MATH}*[0-9a-z)]\\s*)=(\\s*[-0-9a-z(]${MATH}*)`, "gi");
  const out = [];
  for (const part of t.split(/,|;|\band\b|\bthen\b|\bfind\b|\bwhat\b|\bsolve\b|\bif\b|\bwhere\b|:/i)) {
    re.lastIndex = 0;
    const m = re.exec(part);
    if (m) {
      const lhs = m[1].trim().replace(/^(?:[a-z]{2,}\s+)+/i, "");
      const rhs = m[2].trim().replace(/(?:\s+[a-z]{2,})+$/i, "").replace(/[.\s]+$/, "");
      const L = parse(lhs);
      const R = parse(rhs);
      if (L && R) out.push({ text: `${lhs} = ${rhs}`, L, R, vars: [...new Set([...L.vars, ...R.vars])] });
    }
  }
  return out;
}

/** f(v) = 0 as a polynomial of degree ≤ 2, from samples: [a, b, c] for ax² + bx + c, or null if not one. */
function quadFit(f) {
  const y0 = f(0);
  const y1 = f(1);
  const y2 = f(2);
  const c = y0;
  const a = (y2 - 2 * y1 + y0) / 2;
  const b = y1 - y0 - a;
  const ok = [3, -1, 7, 0.5].every((x) => Math.abs(f(x) - (a * x * x + b * x + c)) < 1e-6 * Math.max(1, Math.abs(f(x))));
  return ok && [a, b, c].every(Number.isFinite) ? [a, b, c].map((v) => (Math.abs(v) < 1e-12 ? 0 : v)) : null;
}

function equations(q) {
  const eqs = equationsIn(q);
  if (!eqs.length) return null;
  const vars = [...new Set(eqs.flatMap((e) => e.vars))];
  if (eqs.length >= 2 && vars.length === 2) {
    // Two linear equations: a1x + b1y = c1, a2x + b2y = c2 (Cramer's rule).
    const [x, y] = vars.sort();
    const coef = (e) => {
      const g = (vx, vy) => e.L({ [x]: vx, [y]: vy }) - e.R({ [x]: vx, [y]: vy });
      const c = -g(0, 0);
      const a = g(1, 0) + c;
      const b = g(0, 1) + c;
      const lin = Math.abs(g(2, 3) - (2 * a + 3 * b - c)) < 1e-9 && Math.abs(g(-1, 5) - (-a + 5 * b - c)) < 1e-9;
      return lin ? [a, b, c] : null;
    };
    const [e1, e2] = eqs.map(coef);
    if (!e1 || !e2) return null;
    const D = e1[0] * e2[1] - e2[0] * e1[1];
    if (Math.abs(D) < 1e-12) return null;
    const vx = (e1[2] * e2[1] - e2[2] * e1[1]) / D;
    const vy = (e1[0] * e2[2] - e2[0] * e1[2]) / D;
    const asked = new RegExp(`find (?:the value of )?(${x}|${y})\\b(?!\\s*[a-z])`, "i").exec(normalize(q))?.[1];
    return {
      answer: asked ? fmt(asked === x ? vx : vy) : `${x} = ${fmt(vx)}, ${y} = ${fmt(vy)}`,
      steps: [eqs[0].text, eqs[1].text, `Solving together (elimination): ${x} = ${fmt(vx)}, ${y} = ${fmt(vy)}`],
      method: "Two linear equations",
    };
  }
  if (vars.length !== 1) return null;
  const v = vars[0];
  const e = eqs[0];
  const f = (val) => e.L({ [v]: val }) - e.R({ [v]: val });
  const fit = quadFit(f);
  if (!fit) return null;
  const [a, b, c] = fit;
  if (a === 0) {
    if (b === 0) return null;
    const r = -c / b;
    return { answer: `${v} = ${fmt(r)}`, steps: [e.text, `${fmt(b)}${v} = ${fmt(-c)}`, `${v} = ${fmt(-c)} ÷ ${fmt(b)} = ${fmt(r)}`], method: "Linear equation" };
  }
  const D = b * b - 4 * a * c;
  const show = `${fmt(a)}${v}² ${b < 0 ? "−" : "+"} ${fmt(Math.abs(b))}${v} ${c < 0 ? "−" : "+"} ${fmt(Math.abs(c))} = 0`;
  if (D < -1e-12) return { answer: "No real roots", steps: [show, `D = b² − 4ac = ${fmt(D)} < 0`], method: "Quadratic equation" };
  const r1 = (-b + Math.sqrt(Math.max(0, D))) / (2 * a);
  const r2 = (-b - Math.sqrt(Math.max(0, D))) / (2 * a);
  const roots = [...new Set([r1, r2].map(fmt))];
  return {
    answer: `${v} = ${roots.join(" or ")}`,
    steps: [show, `D = b² − 4ac = ${fmt(D)}`, `${v} = (−b ± √D) / 2a = ${roots.join(" or ")}`, ...(r1 * r2 !== 0 ? [`Check: sum of roots = ${fmt(-b / a)}, product = ${fmt(c / a)}`] : [])],
    method: "Quadratic formula",
  };
}

/** A pure calculation: "Simplify: 3/4 + 5/6 × 2", "Find the value of √144 + ∛125", "What is 25% of 480?". */
function simplify(q) {
  const t = normalize(q);
  const m =
    /(?:simplify|evaluate|calculate|compute|find the value of|value of|what is|find|solve)\s*:?\s*(.+?)\s*(?:=\s*\?|\?|=\s*$|\.)?\s*$/i.exec(t) ||
    /^(.+?)\s*=\s*\??\s*$/.exec(t) ||
    [null, t.replace(/[?.]\s*$/, "")];
  const expr = m[1].replace(/\s*(?:is equal to|equals|is)\s*$/i, "").trim();
  if (!/[+\-*/^%]|sqrt|cbrt|!/.test(expr)) return null;
  const v = evaluate(expr);
  if (v == null) return null;
  const pretty = String(expr).replace(/\*/g, " × ").replace(/sqrt/g, "√").replace(/cbrt/g, "∛").replace(/\s+/g, " ");
  const fr = toFraction(v);
  return { answer: fmt(v), steps: [`${pretty} = ${fmt(v)}${fr && fr[1] <= 1000 && !fmt(v).includes("/") ? ` = ${fr[0]}/${fr[1]}` : ""}`], method: "Calculated (BODMAS)" };
}

/**
 * Solve a question if it is a pure calculation. Returns {answer, steps: [...], method} or null (word problems,
 * anything ambiguous). Never guesses: every detector only fires on an exact shape.
 */
export function solveQuestion(q) {
  const text = String(q || "").trim();
  if (!text || text.length > 400) return null;
  for (const solver of [hcfLcm, interest, average, percentOf, equations, simplify]) {
    try {
      const r = solver(text);
      if (r) return r;
    } catch {
      /* not this shape */
    }
  }
  return null;
}

// ---------- checking written solutions ----------
// The maths right next to an "=": what ends the left side and what starts the right side. "of" counts as × between
// numbers ("10% of 10000"); a label before it ("Year 1 interest =", "SP =") or words after it ("6 days") are left out.
const M = "(?:[0-9.()+\\-*/^%√∛π×÷−²³!\\s]|\\bof\\b)";
const LEFT = new RegExp(`(?:^|[^a-z0-9])(${M}+)$`, "i");
const RIGHT = new RegExp(`^(${M}+)`, "i");

function valueOf(t) {
  const x = String(t || "")
    .replace(/^\s*of\b|\bof\s*$/gi, "") // "1/6 of [the work]"
    .trim();
  if (!/\d/.test(x) || /^[*/^%!]/.test(x)) return null;
  const v = evaluate(x);
  return v == null ? null : { v, pct: /%\s*$/.test(x), pctOf: /^(-?\d+(?:\.\d+)?)\s*%\s*of\b/i.exec(x) };
}

/**
 * Re-calculate every "a = b" in a solution. Returns {checked, wrong: [{line, left, right, expected}]}. Lines with
 * "≈" (rounded) are skipped, as are sides that aren't plain numbers (formulas with letters, words).
 */
export function checkSteps(solution) {
  let checked = 0;
  const wrong = [];
  const close = (x, y) => Math.abs(x - y) <= 1e-6 + 0.005 * Math.max(Math.abs(x), Math.abs(y));
  for (const line of String(solution || "").split("\n")) {
    if (/[≈~]|approx/i.test(line)) continue;
    const parts = line.split(/=(?!=)/);
    for (let i = 0; i + 1 < parts.length; i++) {
      const L = LEFT.exec(parts[i].split(/[,;:]/).pop());
      const R = RIGHT.exec(parts[i + 1].split(/[,;]/)[0]);
      const a = L && valueOf(L[1]);
      const b = R && valueOf(R[1]);
      if (!a || !b) continue;
      checked += 1;
      const ok =
        close(a.v, b.v) ||
        (b.pct && close(a.v, b.v * 100)) || // "25/125 × 100 = 20%"
        (a.pct && close(a.v * 100, b.v)) ||
        (b.pctOf && close(a.v, Number(b.pctOf[1]))) || // "10 + 10 + 1 = 21% of 10000"
        (a.pctOf && close(Number(a.pctOf[1]), b.v));
      if (!ok) wrong.push({ line: line.trim(), left: L[1].trim(), right: R[1].trim(), expected: fmt(a.v) });
    }
  }
  return { checked, wrong };
}
