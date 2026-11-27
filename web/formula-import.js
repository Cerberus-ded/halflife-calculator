/* Импорт формул: из текста Maple, LaTeX, Python, обычного текста формул, таблицы (CSV, вставка из Excel) и файла Excel (.xlsx)
 * восстанавливает расчёт — изотопы, постоянные распада, доли ветвлений, начальные активности и выдержку.
 * Понимает и то, что выдаёт сам калькулятор (вкладка «Формулы», экспорт в Excel), и написанное вручную:
 *   Maple:  lTh229 := 2.78E-12;  lRa224 := evalf(ln(2)/(3.6316*24*3600));  T_Pb212 := 10.64*3600;
 *           diff(NRa225(t), t) = -lRa225*NRa225(t) + lTh229*NTh229(t);  NTh229(0) = 1000/lTh229;  tk := 7*24*3600;
 *   текст:  λ_Th229 = 2.78e-12 1/с;  dN_Ra225/dt = −λ_Ra225·N_Ra225 + λ_Th229·N_Th229;  N_Th229(0) = 1000 Бк / λ_Th229
 *   LaTeX:  \lambda_{\nuc{Th}{229}} &= 2.78\cdot 10^{-12},  \frac{dN_{...}}{dt} &= ...
 *   Python: T_half = {...}, branches = [...], A0 = {...}, t = ...
 * API (window.HLImport): detect(input, name) -> формат; parse(input, name) -> модель (см. build). Работает и в Node (тесты).
 * input — строка или Uint8Array (для .xlsx; xlsx разбирается асинхронно: parseAsync).
 */
(function (global) {
  'use strict';
  const C = global.HLCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const DB = () => global.NUCDB || {};
  const LN2 = Math.LN2;
  const YEAR = C.units.Y;
  const UNIT_SEC = { s: 1, min: 60, h: 3600, d: 86400, y: YEAR };
  const FORMAT_RU = { maple: 'Maple', latex: 'LaTeX', python: 'Python', text: 'текст формул', table: 'таблица активностей', xlsx: 'Excel', hlc: 'файл расчёта' };

  class ImportError extends Error {
    constructor(msg, line) { super(line ? `Строка ${line}: ${msg}` : msg); this.line = line || null; }
  }

  // ------------------------------------------------------------------ числа и единицы
  /** Значащие цифры записи числа: «2.78E-12» → 3, «187000.» → 6, «1000000» → 1, «0.00235» → 3. */
  function sigDigits(lit) {
    const m = String(lit).trim().match(/^[+-]?(\d*)(\.(\d*))?/);
    if (!m) return 0;
    const intPart = m[1] || '', frac = m[3] || '', hasPoint = !!m[2];
    let s = (intPart + frac).replace(/^0+/, '');
    if (!hasPoint) s = s.replace(/0+$/, '');
    return Math.max(1, s.length);
  }
  /** Число, записанное одним литералом («2.78E-12», «2.787*10^(-12)», «187000.»), иначе null. */
  function literalOf(src) {
    const m = String(src).match(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:\*\s*10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?)?\s*$/);
    return m ? Number(m[1]) * (m[2] ? Math.pow(10, Number(m[2])) : 1) : null;
  }
  const ACT_UNITS = [
    [/^(бк|bq)$/i, 1], [/^(кбк|kbq)$/i, 1e3], [/^(мбк|mbq)$/i, 1e6], [/^(гбк|gbq)$/i, 1e9], [/^(тбк|tbq)$/i, 1e12],
    [/^(ки|ci)$/i, 3.7e10], [/^(мки|mci)$/i, 3.7e7], [/^(мкки|uci|µci|μci)$/i, 3.7e4],
  ];
  /** Множитель единицы активности к Бк; «МБк» и «мБк» в жизни не путают — мБк считаем МБк, как и пишут чаще всего. */
  function actFactor(u) {
    if (!u) return 1;
    const s = u.trim().replace(/\.$/, '');
    if (s === 'МБк' || s === 'MBq') return 1e6;
    for (const [re, f] of ACT_UNITS) if (re.test(s)) return f;
    return null;
  }
  const TIME_UNITS = [
    [/^(лет|год|года|годы|г|y|yr|yrs|year|years|a)$/i, 'y'], [/^(сут|сутки|суток|сут\.|дн|день|дня|дней|d|day|days)$/i, 'd'],
    [/^(ч|час|часа|часов|h|hr|hrs|hour|hours)$/i, 'h'], [/^(мин|минута|минуты|минут|min|mins|minute|minutes)$/i, 'min'],
    [/^(с|сек|секунда|секунды|секунд|s|sec|secs|second|seconds)$/i, 's'],
  ];
  const SUB_SEC = { 'мс': 1e-3, 'ms': 1e-3, 'мкс': 1e-6, 'us': 1e-6, 'µs': 1e-6, 'μs': 1e-6, 'нс': 1e-9, 'ns': 1e-9 };
  /** Единица времени → код (y, d, h, min, s) или null. */
  function timeUnit(u) {
    const s = String(u || '').trim().replace(/\.$/, '');
    for (const [re, code] of TIME_UNITS) if (re.test(s)) return code;
    return null;
  }
  /** Время текстом («7901.07 лет», «32.6 мс») → секунды и точность записи. */
  function timeFromText(s) {
    const m = String(s).trim().match(/^([\d.]+(?:[eE][+-]?\d+)?)\s*([A-Za-zА-Яа-яёµμ.]+)$/);
    if (!m) return null;
    const v = Number(m[1]);
    if (!(v >= 0)) return null;
    const u = m[2].replace(/\.$/, '');
    if (SUB_SEC[u.toLowerCase()]) return { sec: v * SUB_SEC[u.toLowerCase()], digits: sigDigits(m[1]), value: v, mult: SUB_SEC[u.toLowerCase()] };
    const code = timeUnit(u);
    return code ? { sec: v * UNIT_SEC[code], digits: sigDigits(m[1]), value: v, unit: code, mult: UNIT_SEC[code] } : null;
  }
  /** Подходящая единица для выдержки, заданной в секундах. */
  function holdFromSeconds(sec) {
    for (const u of ['y', 'd', 'h', 'min']) {
      const v = sec / UNIT_SEC[u];
      // «круглое» число в этой единице (не больше 6 значащих цифр): 400 сут, а не 1,0951… лет
      if (v >= 1 && Math.abs(Number(v.toPrecision(6)) - v) <= 1e-12 * v) return { value: Number(v.toPrecision(6)), unit: u };
    }
    for (const u of ['y', 'd', 'h', 'min']) if (sec / UNIT_SEC[u] >= 1) return { value: Number((sec / UNIT_SEC[u]).toPrecision(10)), unit: u };
    return { value: Number(sec.toPrecision(10)), unit: 's' };
  }
  /** «выдержка 7 сут» в комментарии или подписи: выдержка в единицах пользователя. */
  function holdFromWords(text) {
    const m = String(text).match(/выдержк[аиуе]\s*[:=]?\s*(\d[\d.,]*(?:[eE][+-]?\d+)?)\s*(лет|года?|сут(?:ок|ки)?|дн(?:ей|я)?|ч(?:ас(?:а|ов)?)?|мин(?:ут[аы]?)?|сек(?:унд[аы]?)?|с)(?![А-Яа-яё])/i);
    if (!m) return null;
    const v = Number(m[1].replace(',', '.')), u = timeUnit(m[2]);
    return v >= 0 && u ? { value: v, unit: u, sec: v * UNIT_SEC[u] } : null;
  }

  // ------------------------------------------------------------------ выражения
  // Токены: num (v, d — значащие цифры), name, op. Поддержаны + - * / ^ ** скобки, вызовы f(...), неявное умножение «2 x».
  function tokenize(src, line0) {
    const toks = [];
    const re = /\s+|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_Ͱ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*)|(\*\*|:=|->|[-+*/^(),=\[\]{}<>!.])|(.)/gy;
    let m, line = line0 || 1;
    re.lastIndex = 0;
    while (re.lastIndex < src.length && (m = re.exec(src))) {
      if (m[0].trim() === '') { line += (m[0].match(/\n/g) || []).length; continue; }
      if (m[1] != null) toks.push({ t: 'num', v: Number(m[1]), d: /[.eE]/.test(m[1]) ? sigDigits(m[1].replace(/[eE].*/, '')) : Infinity, line });
      else if (m[2] != null) toks.push({ t: 'name', v: m[2], line });
      else if (m[3] != null) toks.push({ t: 'op', v: m[3] === '**' ? '^' : m[3], line });
      else if (m[4] === ';') throw new ImportError('не закрыта скобка: оператор дошёл до «;»', line);
      else throw new ImportError(`непонятный знак «${m[4]}»`, line);
    }
    return toks;
  }
  function parseExpr(src, line0) {
    const toks = tokenize(src, line0);
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
    const fail = (msg) => { throw new ImportError(msg, (toks[i] || toks[toks.length - 1] || {}).line || line0); };
    function expr() {
      let a = term();
      while (isOp('+') || isOp('-')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: term() }; }
      return a;
    }
    function startsPrimary() { const k = peek(); return k && (k.t === 'num' || k.t === 'name' || (k.t === 'op' && k.v === '(')); }
    function term() {
      let a = unary();
      for (;;) {
        if (isOp('*') || isOp('/')) { const op = toks[i++].v; a = { t: 'bin', op, a, b: unary() }; }
        else if (startsPrimary()) a = { t: 'bin', op: '*', a, b: unary() }; // неявное умножение: «0.9786 λ_Bi213 N_Bi213»
        else return a;
      }
    }
    function unary() {
      if (isOp('-')) { i++; return { t: 'neg', a: unary() }; }
      if (isOp('+')) { i++; return unary(); }
      return power();
    }
    function power() {
      const a = primary();
      if (isOp('^')) { i++; return { t: 'bin', op: '^', a, b: unary() }; }
      return a;
    }
    function primary() {
      const k = peek();
      if (!k) fail('выражение оборвалось');
      if (k.t === 'num') { i++; return { t: 'num', v: k.v, d: k.d }; }
      if (k.t === 'name') {
        i++;
        let name = k.v;
        while (isOp('.') && toks[i + 1] && toks[i + 1].t === 'name') { name += '.' + toks[i + 1].v; i += 2; } // np.log, math.exp
        if (isOp('(')) {
          i++;
          const args = [];
          if (!isOp(')')) { args.push(expr()); while (isOp(',')) { i++; args.push(expr()); } }
          if (!isOp(')')) fail(`не закрыта скобка после ${name}(`);
          i++;
          return { t: 'call', f: name, args };
        }
        return { t: 'name', n: name };
      }
      if (isOp('(')) {
        i++;
        const a = expr();
        if (!isOp(')')) fail('не закрыта скобка');
        i++;
        return a;
      }
      fail(`неожиданное «${k.v}»`);
    }
    const ast = expr();
    if (i < toks.length) fail(`лишнее «${toks[i].v}»`);
    return ast;
  }

  /** Имя нуклида из идентификатора формул: Th229 → Th-229, Pa234m → Pa-234m (только из базы). */
  function nuclideFromId(s) {
    const m = String(s).match(/^([A-Z][a-z]?)_?(\d{1,3})(m\d?|n)?$/);
    return m ? C.normalizeName(m[1] + m[2] + (m[3] || '')) : null;
  }
  /** Разбор имени из формул: постоянная распада, T½, число ядер или прочая переменная. */
  function classifyName(name) {
    let m;
    if ((m = name.match(/^(?:l|lam|lambda|λ)_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)$/))) { const n = nuclideFromId(m[1]); if (n) return { kind: 'lambda', name: n }; }
    if ((m = name.match(/^(?:T|Thalf|T12|T_half|Th)_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)$/))) { const n = nuclideFromId(m[1]); if (n) return { kind: 'T', name: n }; }
    if ((m = name.match(/^N_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)$/))) { const n = nuclideFromId(m[1]); if (n) return { kind: 'N', name: n }; }
    if ((m = name.match(/^(?:A|A0)_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)$/))) { const n = nuclideFromId(m[1]); if (n) return { kind: 'A', name: n }; }
    return null;
  }
  const FUNCS = {
    ln: Math.log, log: Math.log, 'np.log': Math.log, 'math.log': Math.log, log10: Math.log10, 'np.log10': Math.log10, 'math.log10': Math.log10,
    exp: Math.exp, 'np.exp': Math.exp, 'math.exp': Math.exp, sqrt: Math.sqrt, 'np.sqrt': Math.sqrt, 'math.sqrt': Math.sqrt, abs: Math.abs,
    evalf: (x) => x, float: (x) => x, Float: (x) => x, evalhf: (x) => x,
  };
  const CONSTS = { Pi: Math.PI, pi: Math.PI, 'np.pi': Math.PI, 'math.pi': Math.PI, LN2: LN2, ln2: LN2 };

  /**
   * Линейная форма выражения: {c: число, v: Map(имя нуклида → коэффициент при N), d: точность записи}.
   * env(name) → число или undefined. Произведение двух N, деление на N и N под функцией — ошибка (уравнения Бейтмана линейны).
   */
  function linear(node, env, line) {
    const fail = (msg) => { throw new ImportError(msg, line); };
    const K = (c, d) => ({ c, v: new Map(), d: d == null ? Infinity : d });
    const isConst = (x) => x.v.size === 0;
    switch (node.t) {
      case 'num': return K(node.v, node.d);
      case 'neg': { const a = linear(node.a, env, line); const v = new Map(); a.v.forEach((x, k) => v.set(k, -x)); return { c: -a.c, v, d: a.d }; }
      case 'name': {
        const cls = classifyName(node.n);
        if (cls && cls.kind === 'N') { const r = K(0); r.v.set(cls.name, 1); return r; }
        const val = env(node.n);
        if (val != null) return K(val.v, val.d);
        if (node.n in CONSTS) return K(CONSTS[node.n]);
        if (cls && cls.kind === 'lambda') fail(`не задана постоянная распада ${node.n}`);
        fail(`неизвестное имя «${node.n}»`);
      }
      // eslint-disable-next-line no-fallthrough
      case 'call': {
        const cls = classifyName(node.f);
        if (cls && cls.kind === 'N') {
          const a = node.args[0];
          if (node.args.length === 1 && a && a.t === 'name' && a.n === 't') { const r = K(0); r.v.set(cls.name, 1); return r; }
          fail(`${node.f}(…) в уравнении должно быть записано как ${node.f}(t)`);
        }
        const f = FUNCS[node.f];
        if (!f) {
          const val = env(node.f);
          if (val != null && node.args.length === 1) { const a = linear(node.args[0], env, line); if (isConst(a)) return K(val.v * a.c, Math.min(val.d, a.d)); }
          fail(`неизвестная функция «${node.f}»`);
        }
        const args = node.args.map((x) => linear(x, env, line));
        if (!args.length || !args.every(isConst)) fail(`в ${node.f}(…) должно быть число`);
        return K(f(args[0].c), args[0].d);
      }
      case 'bin': {
        const a = linear(node.a, env, line), b = linear(node.b, env, line);
        const d = Math.min(a.d, b.d);
        if (node.op === '+' || node.op === '-') {
          const s = node.op === '+' ? 1 : -1;
          const v = new Map(a.v);
          b.v.forEach((x, k) => v.set(k, (v.get(k) || 0) + s * x));
          return { c: a.c + s * b.c, v, d };
        }
        if (node.op === '*') {
          if (!isConst(a) && !isConst(b)) fail('произведение двух N — уравнения Бейтмана линейны');
          const [k, x] = isConst(a) ? [a.c, b] : [b.c, a];
          const v = new Map(); x.v.forEach((y, n) => v.set(n, y * k));
          return { c: x.c * k, v, d };
        }
        if (node.op === '/') {
          if (!isConst(b)) fail('деление на N');
          if (b.c === 0) fail('деление на ноль');
          const v = new Map(); a.v.forEach((y, n) => v.set(n, y / b.c));
          return { c: a.c / b.c, v, d };
        }
        if (node.op === '^') {
          if (!isConst(a) || !isConst(b)) fail('N в степени');
          return K(Math.pow(a.c, b.c), d);
        }
      }
    }
    fail('не удалось разобрать выражение');
  }
  /** Значение выражения-числа: {v, d}. */
  function constant(src, env, line) {
    const r = linear(parseExpr(src, line), env, line);
    if (r.v.size) throw new ImportError('ожидалось число, а в выражении есть N', line);
    if (!isFinite(r.c)) throw new ImportError('число вне допустимого диапазона', line);
    return { v: r.c, d: r.d };
  }

  // ------------------------------------------------------------------ сырая модель
  /**
   * Сырая модель: что прямо записано в файле.
   *   lam: Map(нуклид → [{v, d, src}])   — постоянные распада (могут быть заданы и через T½)
   *   eqs: Map(нуклид → {ast | lin, line}) — правые части dN/dt
   *   ic:  Map(нуклид → {N | A, line})    — начальные условия (N(0) — атомы, A — Бк)
   *   branches: [{from, to, br}]          — ветвления, если заданы явно (Python)
   *   stable: Set                         — явно стабильные
   *   hold: {tSec, value?, unit?}
   */
  function raw(format) {
    return { format, lam: new Map(), eqs: new Map(), ic: new Map(), branches: null, stable: new Set(), names: [], hold: null, notes: [], warnings: [], vars: new Map() };
  }
  function addName(R, n) { if (!R.names.includes(n)) R.names.push(n); }
  /** raw — число, как оно записано (λ или T½ в единице mult секунд), чтобы узнать округлённое значение базы. */
  function addLam(R, n, v, d, src, raw) {
    if (!(v >= 0) || !isFinite(v)) throw new ImportError(`постоянная распада ${n} должна быть положительным числом`);
    if (!R.lam.has(n)) R.lam.set(n, []);
    R.lam.get(n).push({ v, d, src, raw: raw || null });
    addName(R, n);
  }
  function envOf(R) {
    return (name) => {
      const cls = classifyName(name);
      if (cls && cls.kind === 'lambda' && R.lam.has(cls.name)) return R.lam.get(cls.name)[0];
      if (cls && cls.kind === 'lambda' && DB()[cls.name] && DB()[cls.name][0] > 0) {
        // постоянная используется, но не задана — берём из базы и говорим об этом
        if (!R.fromDb) R.fromDb = new Set();
        if (!R.fromDb.has(cls.name)) { R.fromDb.add(cls.name); R.warnings.push(`${name} в файле не задана — взята из базы (T½ = ${C.fmtHalfLife(DB()[cls.name][0])})`); }
        return { v: LN2 / DB()[cls.name][0], d: 15 };
      }
      if (R.vars.has(name)) return R.vars.get(name);
      return undefined;
    };
  }
  function setHold(R, sec, words, line) {
    if (!(sec >= 0) || !isFinite(sec)) throw new ImportError('время выдержки должно быть неотрицательным числом', line);
    const h = words && Math.abs(words.sec - sec) <= 1e-6 * Math.max(sec, 1) ? words : holdFromSeconds(sec);
    R.hold = { tSec: sec, value: h.value, unit: h.unit };
  }

  // ------------------------------------------------------------------ Maple
  /** Делит текст Maple на операторы (по «;» и «:», кроме «:=»), убирая комментарии и строки. */
  function mapleStatements(text) {
    const out = [];
    let cur = '', line = 1, startLine = 1, depth = 0, inStr = false;
    const push = (term) => { if (cur.trim()) out.push({ src: cur, line: startLine, term }); cur = ''; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { cur += ch === '\n' ? ' ' : (ch === '"' ? '"' : 's'); if (ch === '"') inStr = false; if (ch === '\n') line++; continue; }
      if (ch === '#') { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
      if (ch === '"') { inStr = true; cur += '"'; continue; }
      if (ch === '\n') { line++; cur += '\n'; continue; }
      if (!cur.trim()) startLine = line;
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (depth <= 0 && (ch === ';' || (ch === ':' && text[i + 1] !== '=' && text[i + 1] !== ':'))) { depth = 0; push(ch); continue; }
      cur += ch;
    }
    if (inStr) throw new ImportError('не закрыта кавычка «"»', line);
    if (cur.trim()) out.push({ src: cur, line: startLine, term: null });
    return out;
  }
  /** Делит по запятым верхнего уровня. */
  function splitTop(src, sep) {
    const parts = [];
    let depth = 0, cur = '', off = 0, start = 0;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (depth === 0 && ch === (sep || ',')) { parts.push({ s: cur, off: start }); cur = ''; start = i + 1; continue; }
      cur += ch;
    }
    parts.push({ s: cur, off: start });
    void off;
    return parts;
  }
  const lineAt = (src, off, line0) => line0 + (src.slice(0, off).match(/\n/g) || []).length + (src.slice(off).match(/^\s*/)[0].match(/\n/g) || []).length;
  const TIME_VARS = /^(tk|t_k|tend|t_end|thold|t_hold|tvyd|t_vyd|tout|t_out|t1|tau)$/i;

  function parseMaple(text) {
    const R = raw('maple');
    const words = holdFromWords(text);
    // Двумерная запись Maple при копировании: ≔ и →; знаки минуса и умножения из Word
    text = text.replace(/≔/g, ':=').replace(/→/g, '->').replace(/[−–]/g, '-').replace(/[·×⋅]/g, '*');
    const stmts = mapleStatements(text);
    const timeUses = new Set();
    for (const st of stmts) {
      let src = st.src.replace(/^\s+/, '');
      const line = st.line;
      for (const m of src.matchAll(/\bA_?\w+\(\s*([A-Za-z_]\w*)\s*\)/g)) if (m[1] !== 't') timeUses.add(m[1]);
      const asg = src.match(/^([A-Za-z_][\w]*)\s*:=\s*([\s\S]*)$/);
      if (/^(restart|with\s*\(|Digits\b|interface\s*\(|printf\s*\(|print\s*\(|lprint\s*\(|plot|odeplot|display|sol\b)/.test(src)) continue;
      let body = src;
      if (asg) {
        const [, name, rhs] = asg;
        if (/^\s*(t|x)\s*->/.test(rhs) || /^\s*proc\b/.test(rhs)) continue;     // A_X := t -> ...
        if (/^\s*(eval|dsolve|subs|rhs|lhs|op|unapply|plots)\b/.test(rhs)) continue;
        if (/\bdiff\s*\(|\(\s*0\s*\)\s*=/.test(rhs)) body = rhs;                // EQ := ..., IC := ...
        else {
          const cls = classifyName(name);
          const val = constant(rhs, envOf(R), line + (src.slice(0, src.indexOf(rhs)).match(/\n/g) || []).length);
          const lit = literalOf(rhs);
          if (cls && cls.kind === 'lambda') addLam(R, cls.name, val.v, val.d, 'lambda', lit != null ? { x: lit, q: 'lambda' } : null);
          else if (cls && cls.kind === 'T') addLam(R, cls.name, LN2 / val.v, val.d, 'T', lit != null ? { x: lit, q: 'T', mult: 1 } : null);
          else if (cls && cls.kind === 'A') { R.ic.set(cls.name, { A: val.v, line }); addName(R, cls.name); }
          else R.vars.set(name, val);
          continue;
        }
      }
      body = body.replace(/^\s*[{[]([\s\S]*)[}\]]\s*$/, '$1');
      for (const part of splitTop(body)) {
        const s = part.s.trim();
        if (!s) continue;
        const pl = lineAt(body, part.off, line);
        let m;
        if ((m = s.match(/^diff\s*\(\s*(\w+)\s*\(\s*t\s*\)\s*,\s*t\s*\)\s*=\s*([\s\S]+)$/)) || (m = s.match(/^D\s*\(\s*(\w+)\s*\)\s*\(\s*t\s*\)\s*=\s*([\s\S]+)$/))) {
          const cls = classifyName(m[1]);
          if (!cls || cls.kind !== 'N') throw new ImportError(`не понял, какой это изотоп: ${m[1]}(t). Ожидалось имя вида NTh229(t)`, pl);
          if (R.eqs.has(cls.name)) throw new ImportError(`второе уравнение для ${cls.name}`, pl);
          R.eqs.set(cls.name, { ast: parseExpr(m[2], pl), line: pl });
          addName(R, cls.name);
        } else if ((m = s.match(/^(\w+)\s*\(\s*0\s*\)\s*=\s*([\s\S]+)$/))) {
          const cls = classifyName(m[1]);
          if (!cls || cls.kind !== 'N') throw new ImportError(`не понял начальное условие ${m[1]}(0)`, pl);
          R.ic.set(cls.name, { ast: parseExpr(m[2], pl), line: pl });
          addName(R, cls.name);
        } else if (/=/.test(s) && /\bdiff\b/.test(s)) {
          throw new ImportError('уравнение записано не в виде diff(NX(t), t) = …', pl);
        }
      }
    }
    // время выдержки: tk := … (или переменная, от которой вызываются A_X(…))
    for (const [k, v] of R.vars) if (TIME_VARS.test(k) || timeUses.has(k)) { setHold(R, v.v, words); break; }
    if (!R.hold && words) R.hold = { tSec: words.sec, value: words.value, unit: words.unit };
    return R;
  }

  // ------------------------------------------------------------------ текст формул калькулятора
  /** Приводит текст к синтаксису выражений: − → -, · → *, λ_X и N_X остаются именами. */
  const plain = (s) => s.replace(/[−–]/g, '-').replace(/[·×⋅]/g, '*').replace(/\bln\s*2\b/g, 'ln(2)').replace(/ | /g, ' ');
  function parseText(text) {
    const R = raw('text');
    const words = holdFromWords(text);
    const lines = text.split(/\r?\n/);
    lines.forEach((ln0, k) => {
      const line = k + 1;
      const ln = plain(ln0).trim();
      let m;
      if (!ln || /^#/.test(ln)) return;
      if ((m = ln.match(/^(?:λ|l|lambda)_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)\s*=\s*(.+)$/))) {
        const n = nuclideFromId(m[1]);
        if (!n) throw new ImportError(`изотоп ${m[1]} не найден в базе`, line);
        // «ln2 / (7901.07 лет) = 2.78e-12 1/с   [польз.]»: все представления — и T½, и λ
        const parts = m[2].replace(/\[[^\]]*\]/g, '').split('=').map((s) => s.trim()).filter(Boolean);
        let got = false;
        for (const p of parts) {
          const t = p.match(/^ln\(2\)\s*\/\s*\((.+)\)$/);
          if (t) { const tt = timeFromText(t[1]); if (tt && tt.sec > 0) { addLam(R, n, LN2 / tt.sec, tt.digits, 'T', { x: tt.value, q: 'T', mult: tt.mult }); got = true; } continue; }
          const v = p.replace(/\s*(1\/с|1\/s|с\^-1|с-1|s\^-1|с\^\(-1\))\s*$/, '');
          const lit = literalOf(v);
          try { const c = constant(v, envOf(R), line); addLam(R, n, c.v, c.d, 'lambda', lit != null ? { x: lit, q: 'lambda' } : null); got = true; } catch (e) { /* подпись, не число */ }
        }
        if (!got) throw new ImportError(`не понял значение постоянной распада ${n}`, line);
      } else if ((m = ln.match(/^(?:T½|T1\/2|T_?(?:half|12))_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)\s*=\s*(.+)$/))) {
        const n = nuclideFromId(m[1]);
        const tt = n && timeFromText(m[2].trim());
        if (!n || !tt) throw new ImportError('не понял период полураспада', line);
        addLam(R, n, LN2 / tt.sec, tt.digits, 'T', { x: tt.value, q: 'T', mult: tt.mult });
      } else if ((m = ln.match(/^(\w+):\s*стабильный/))) {
        const n = C.normalizeName(m[1]); if (n) { R.stable.add(n); addName(R, n); }
      } else if ((m = ln.match(/^dN_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)\s*\/\s*dt\s*=\s*(.+)$/))) {
        const n = nuclideFromId(m[1]);
        if (!n) throw new ImportError(`изотоп ${m[1]} не найден в базе`, line);
        R.eqs.set(n, { ast: parseExpr(m[2], line), line });
        addName(R, n);
      } else if ((m = ln.match(/^N_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)\(0\)\s*=\s*(.+)$/))) {
        const n = nuclideFromId(m[1]);
        if (!n) throw new ImportError(`изотоп ${m[1]} не найден в базе`, line);
        const a = m[2].match(/^([\d.]+(?:[eE][+-]?\d+)?)\s*(Бк|кБк|МБк|ГБк|ТБк|Ки|мКи|мкКи|Bq|kBq|MBq|GBq|TBq|Ci|mCi|uCi)\s*\//);
        if (a) R.ic.set(n, { A: Number(a[1]) * actFactor(a[2]), line });
        else R.ic.set(n, { ast: parseExpr(m[2].split('=')[0], line), line });
        addName(R, n);
      } else if ((m = ln.match(/^A0?_?([A-Z][a-z]?_?\d{1,3}(?:m\d?|n)?)(?:\(0\))?\s*=\s*([\d.]+(?:[eE][+-]?\d+)?)\s*(Бк|кБк|МБк|ГБк|ТБк|Ки|мКи|мкКи|Bq|kBq|MBq|GBq|TBq|Ci|mCi|uCi)?\s*$/))) {
        const n = nuclideFromId(m[1]);
        if (n) { R.ic.set(n, { A: Number(m[2]) * (actFactor(m[3]) || 1), line }); addName(R, n); }
      } else if ((m = ln.match(/Выдержка:\s*[^=]*=\s*([\d.]+(?:[eE][+-]?\d+)?)\s*с\b/))) {
        setHold(R, Number(m[1]), words, line);
      }
    });
    if (!R.hold && words) R.hold = { tSec: words.sec, value: words.value, unit: words.unit };
    return R;
  }

  // ------------------------------------------------------------------ LaTeX
  /** Заменяет \frac{a}{b} на ((a)/(b)) с учётом вложенных скобок. */
  function unfrac(s) {
    const grab = (i) => {
      if (s[i] !== '{') { const m = s.slice(i).match(/^\s*(\\?\w|\d)/); return m ? [m[1], i + m[0].length] : null; }
      let d = 0;
      for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1]; }
      return null;
    };
    for (let guard = 0; guard < 1000; guard++) {
      const k = s.lastIndexOf('\\frac');
      const k2 = s.lastIndexOf('\\dfrac');
      const at = Math.max(k, k2);
      if (at < 0) break;
      const len = at === k2 && k2 >= 0 && k2 >= k ? 6 : 5;
      const a = grab(at + len); if (!a) break;
      const b = grab(a[1]); if (!b) break;
      s = s.slice(0, at) + `((${a[0]})/(${b[0]}))` + s.slice(b[1]);
    }
    return s;
  }
  function latexToPlain(s) {
    s = s.replace(/\\nuc\{(\w+)\}\{(\d+\w*)\}/g, '$1$2')
      .replace(/\{\}\^\{(\d+)(m?)\}\s*\\mathrm\{([A-Za-z]{1,2})\}/g, '$3$1$2')
      .replace(/\^\{(\d+)(m?)\}\s*\\mathrm\{([A-Za-z]{1,2})\}/g, '$3$1$2')
      .replace(/\\mathrm\{([A-Za-z]{1,2})-(\d+m?)\}/g, '$1$2');
    s = s.replace(/\\frac\{d\s*N_\{?(\w+)\}?(?:\(t\))?\}\{d\s*t\}/g, 'dN_$1/dt')
      .replace(/\\lambda_\{?(\w+)\}?/g, 'λ_$1').replace(/\bN_\{(\w+)\}/g, 'N_$1');
    s = unfrac(s);
    s = s.replace(/\\left\s*([([])/g, '$1').replace(/\\right\s*([)\]])/g, '$1')
      .replace(/\\(?:cdot|times)/g, '*').replace(/\\,|\\!|\\;|\\:|\\quad|\\qquad|~/g, ' ')
      .replace(/\\ln\s*\{?\s*2\s*\}?/g, 'ln(2)').replace(/\\(ln|exp|log)\b/g, '$1')
      .replace(/\\mathrm\{([^{}]*)\}|\\text\{([^{}]*)\}/g, (x, a, b) => a || b || '')
      .replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/[{}]/g, ' ').replace(/&/g, '').replace(/\$/g, '');
    return s.replace(/[−–]/g, '-');
  }
  function parseLatex(text) {
    const words = holdFromWords(text.replace(/\\,|~/g, ' '));
    let body = text.replace(/(^|[^\\])%.*$/gm, '$1');
    const tMatch = body.match(/\$\s*t\s*=\s*([^$]+)\$\s*~?\s*с/);
    body = body.replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}/g, '\n').replace(/\\\\/g, '\n');
    const lines = body.split('\n').map((l) => latexToPlain(l));
    const R = parseText(lines.join('\n'));
    R.format = 'latex';
    if (tMatch && !R.hold) setHold(R, constant(latexToPlain(tMatch[1]), () => undefined).v, words);
    if (!R.hold && words) R.hold = { tSec: words.sec, value: words.value, unit: words.unit };
    return R;
  }

  // ------------------------------------------------------------------ Python
  function pyBlock(text, name) {
    const re = new RegExp('^\\s*' + name + '\\s*=\\s*([\\[{])', 'm');
    const m = re.exec(text);
    if (!m) return null;
    const open = m[1], close = open === '{' ? '}' : ']';
    let d = 0, i = m.index + m[0].length - 1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === open) d++;
      else if (text[j] === close && --d === 0) return { src: text.slice(i + 1, j), line: (text.slice(0, i).match(/\n/g) || []).length + 1 };
    }
    throw new ImportError(`не закрыта скобка в ${name}`, (text.slice(0, i).match(/\n/g) || []).length + 1);
  }
  function parsePython(text) {
    const R = raw('python');
    const words = holdFromWords(text);
    const body = text.replace(/#.*$/gm, '');
    const env = envOf(R);
    for (const m of body.matchAll(/^([A-Za-z_]\w*)\s*=\s*([^\n[{]+)$/gm)) { // простые константы: year = 365.25*86400
      try { R.vars.set(m[1], constant(m[2], env)); } catch (e) { /* не число */ }
    }
    const items = (blk) => splitTop(blk.src).map((p) => ({ s: p.s.trim(), line: lineAt(blk.src, p.off, blk.line) })).filter((p) => p.s);
    const th = pyBlock(body, '(?:T_half|T12|Thalf|half_life|half_lives)');
    const lm = pyBlock(body, '(?:lam|lambdas|lambda_|decay_const)');
    for (const [blk, kind] of [[th, 'T'], [lm, 'lambda']]) {
      if (!blk) continue;
      for (const it of items(blk)) {
        const m = it.s.match(/^["']([^"']+)["']\s*:\s*([\s\S]+)$/);
        if (!m) throw new ImportError('ожидалась запись "Изотоп": значение', it.line);
        const n = C.normalizeName(m[1]);
        if (!n) throw new ImportError(`изотоп ${m[1]} не найден в базе`, it.line);
        if (/^None$/.test(m[2].trim()) || (kind === 'lambda' && Number(m[2]) === 0)) { R.stable.add(n); addName(R, n); continue; }
        const c = constant(m[2], env, it.line);
        const lit = literalOf(m[2]);
        addLam(R, n, kind === 'T' ? LN2 / c.v : c.v, c.d, kind, lit != null ? { x: lit, q: kind, mult: 1 } : null);
      }
    }
    const br = pyBlock(body, '(?:branches|branching)');
    if (br) {
      R.branches = [];
      for (const it of items(br)) {
        const m = it.s.match(/^\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*,\s*([\s\S]+)\)$/);
        if (!m) throw new ImportError('ветвление записывается как ("родитель", "дочерний", доля)', it.line);
        const a = C.normalizeName(m[1]), b = C.normalizeName(m[2]);
        if (!a || !b) throw new ImportError(`изотоп ${a ? m[2] : m[1]} не найден в базе`, it.line);
        R.branches.push({ from: a, to: b, br: constant(m[3], env, it.line).v, d: constant(m[3], env, it.line).d });
        addName(R, a); addName(R, b);
      }
    }
    const a0 = pyBlock(body, '(?:A0|A_0|activities)');
    if (a0) for (const it of items(a0)) {
      const m = it.s.match(/^["']([^"']+)["']\s*:\s*([\s\S]+)$/);
      if (!m) throw new ImportError('ожидалась запись "Изотоп": активность', it.line);
      const n = C.normalizeName(m[1]);
      if (!n) throw new ImportError(`изотоп ${m[1]} не найден в базе`, it.line);
      R.ic.set(n, { A: constant(m[2], env, it.line).v, line: it.line });
      addName(R, n);
    }
    const t = body.match(/^(?:t|t_hold|thold|tk)\s*=\s*([^\n]+)$/m);
    if (t) setHold(R, constant(t[1], env).v, words);
    else if (words) R.hold = { tSec: words.sec, value: words.value, unit: words.unit };
    return R;
  }

  // ------------------------------------------------------------------ таблица (CSV, вставка из Excel)
  const ROW_RE = /^\s*["']?([A-Za-z]{1,2}[- ]?\d{1,3}m?|\d{1,3}m?[- ]?[A-Za-z]{1,2})["']?\s*[;,\t=: ]\s*["']?\s*(\d[\d\s.,]*(?:[eE][+-]?\d+)?)\s*["']?\s*([A-Za-zА-Яа-яµμ]+)?\s*[;,\t]*\s*$/;
  function tableNumber(s) {
    s = s.replace(/[\s  ]/g, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    return Number(s);
  }
  function looksLikeTable(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = lines.filter((l) => ROW_RE.test(l) && C.normalizeName(l.match(ROW_RE)[1]));
    return rows.length >= 1 && rows.length >= lines.length - 3;
  }
  function parseTable(text) {
    const R = raw('table');
    R.tableOnly = true;
    text.split(/\r?\n/).forEach((ln, k) => {
      const m = ln.match(ROW_RE);
      if (!m) return;
      const n = C.normalizeName(m[1]);
      if (!n) { R.warnings.push(`строка ${k + 1}: изотоп ${m[1]} не найден в базе`); return; }
      const f = actFactor(m[3]);
      if (m[3] && f == null) { R.warnings.push(`строка ${k + 1}: непонятная единица «${m[3]}», считаю Бк`); }
      R.ic.set(n, { A: tableNumber(m[2]) * (f || 1), line: k + 1 });
      addName(R, n);
    });
    const w = holdFromWords(text);
    if (w) R.hold = { tSec: w.sec, value: w.value, unit: w.unit };
    return R;
  }

  // ------------------------------------------------------------------ Excel (.xlsx)
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new ImportError('Этот браузер не умеет распаковывать сжатые файлы Excel. Сохраните таблицу как CSV или откройте калькулятор в новом браузере.');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  /** Читает ZIP: {имя файла → Uint8Array}. Поддерживает хранение без сжатия и deflate. */
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new ImportError('Файл Excel повреждён (не найден каталог ZIP).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new ImportError('Файл Excel повреждён.');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|workbook\.xml)$|^xl\/_rels\/workbook\.xml\.rels$/.test(name)) continue;
      const lh = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = bytes.subarray(lh, lh + csize);
      files[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
      if (!files[name]) throw new ImportError('Файл Excel сжат неизвестным способом.');
    }
    return files;
  }
  const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c)).replace(/&amp;/g, '&');
  /** Листы книги: [{name, rows: [[значения]]}]. */
  async function readXlsx(bytes) {
    const files = await unzip(bytes);
    const dec = new TextDecoder();
    const txt = (n) => (files[n] ? dec.decode(files[n]) : '');
    const shared = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
    const wb = txt('xl/workbook.xml'), rels = txt('xl/_rels/workbook.xml.rels');
    const relMap = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [(m[0].match(/Id="([^"]+)"/) || [])[1], (m[0].match(/Target="([^"]+)"/) || [])[1]]));
    const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m, i) => {
      const nm = xmlText((m[0].match(/name="([^"]*)"/) || [])[1] || `Лист${i + 1}`);
      const rid = (m[0].match(/r:id="([^"]+)"/) || [])[1];
      let target = relMap[rid] || `worksheets/sheet${i + 1}.xml`;
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      return { name: nm, file: 'xl/' + target };
    });
    return sheets.map((s) => {
      const xml = txt(s.file);
      const rows = [];
      for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = cm[1], inner = cm[2] || '';
          const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
          const col = ref ? ref.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
          const t = (attrs.match(/t="([^"]+)"/) || [])[1];
          const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          let val;
          if (t === 's') val = shared[Number(v)];
          else if (t === 'inlineStr') val = xmlText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
          else if (t === 'str' || t === 'b' || t === 'e') val = v != null ? xmlText(v) : '';
          else val = v != null && v !== '' ? Number(v) : '';
          row[col] = val;
        }
        rows.push(Array.from(row, (x) => (x === undefined ? '' : x)));
      }
      return { name: s.name, rows };
    });
  }
  /** Модель из книги: лист «Формулы» (текст калькулятора), иначе таблица «Изотоп | A₀». */
  function fromSheets(sheets) {
    const tables = sheets.map(tableFromSheet).filter(Boolean);
    const f = sheets.find((s) => /формул/i.test(s.name));
    if (f) {
      const text = f.rows.map((r) => r.filter((x) => x !== '').join(' ')).join('\n');
      if (/dN_\w+\s*\/\s*dt/.test(text)) {
        const R = parseText(text);
        R.format = 'xlsx';
        // T½ в секундах из таблицы результата точнее 6 знаков текста формул — ставим их первыми
        if (tables[0]) for (const [n, reps] of tables[0].lam) if (R.lam.has(n)) R.lam.set(n, reps.concat(R.lam.get(n)));
        return R;
      }
    }
    if (tables.length) return tables[0];
    throw new ImportError('В книге Excel не нашлось ни листа «Формулы», ни таблицы со столбцами «Изотоп» и «A₀».');
  }
  function tableFromSheet(s) {
    {
      const R = raw('xlsx');
      R.tableOnly = true;
      let head = -1, cIso = -1, cA = -1, cT = -1, f = 1, unitCol = '';
      let holdSec = null, holdWords = null;
      s.rows.forEach((r, i) => {
        const k = String(r[0] || '').trim();
        if (/^Выдержка, с$/i.test(k) && typeof r[1] === 'number') holdSec = r[1];
        if (/^Выдержка$/i.test(k)) holdWords = holdFromWords('выдержка ' + r[1]);
        if (/^Единица активности$/i.test(k)) unitCol = String(r[1] || '');
        if (head < 0) {
          const iso = r.findIndex((x) => /^(изотоп|нуклид|isotope|nuclide)$/i.test(String(x).trim()));
          const a = r.findIndex((x) => /^(A₀|A0|A\(0\)|активность|начальная активность|activity)(?=[\s,(]|$)/i.test(String(x).trim()));
          if (iso >= 0 && a >= 0) {
            head = i; cIso = iso; cA = a;
            cT = r.findIndex((x) => /^T½,\s*с$|^T1\/2,\s*с$/i.test(String(x).trim()));
            const um = String(r[a]).match(/,\s*(\S+)\s*$/);
            f = actFactor(um ? um[1] : unitCol) || 1;
          }
        }
      });
      if (head < 0) return null;
      for (let i = head + 1; i < s.rows.length; i++) {
        const r = s.rows[i];
        const n = C.normalizeName(String(r[cIso] || ''));
        if (!n) continue;
        const a = typeof r[cA] === 'number' ? r[cA] : tableNumber(String(r[cA] || ''));
        if (a > 0) R.ic.set(n, { A: a * f, line: i + 1 });
        if (cT >= 0 && typeof r[cT] === 'number' && r[cT] > 0) addLam(R, n, LN2 / r[cT], 15, 'T', { x: r[cT], q: 'T', mult: 1 });
        addName(R, n);
      }
      if (!R.names.length) return null;
      if (holdSec != null) setHold(R, holdSec, holdWords);
      else if (holdWords) R.hold = { tSec: holdWords.sec, value: holdWords.value, unit: holdWords.unit };
      return R;
    }
  }

  // ------------------------------------------------------------------ определение формата
  function detect(input, name) {
    if (input instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer)) {
      const b = input instanceof Uint8Array ? input : new Uint8Array(input);
      return b[0] === 0x50 && b[1] === 0x4b ? 'xlsx' : null;
    }
    const s = String(input || '').replace(/^﻿/, '');
    const ext = (String(name || '').match(/\.(\w+)$/) || [])[1];
    if (/^\s*\{/.test(s)) { try { const d = JSON.parse(s); if (d && (d.format || d.roots)) return 'hlc'; } catch (e) { /* не JSON */ } }
    if (/\\(begin|frac|lambda|nuc|documentclass)\b/.test(s)) return 'latex';
    if (/^\s*(import numpy|from scipy|import math)|^\s*(T_half|branches|half_lives?)\s*=\s*[[{]/m.test(s)) return 'python';
    if (/\bdiff\s*\(\s*\w+\s*\(\s*t\s*\)\s*,\s*t\s*\)|:=|≔/.test(s) || ext === 'mpl' || ext === 'mw') return 'maple';
    if (/dN_?\w+\s*\/\s*dt|^\s*λ_\w+\s*=/m.test(s)) return 'text';
    if (looksLikeTable(s)) return 'table';
    return null;
  }

  // ------------------------------------------------------------------ сборка расчёта
  const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
  /**
   * Совпадает ли значение из файла с базой. Значение базы считается записанным, если совпадает точно (1e-9)
   * или если запись — это значение базы, округлённое до 6 или 12 значащих цифр (так печатают текст, LaTeX и Python).
   * Число, записанное короче и не равное округлению базы (2.78E-12, 10.62 ч), — значение автора файла.
   */
  const roundsTo = (x, q) => [6, 10, 12].some((P) => close(x, Number(q.toPrecision(P)), 1e-12));
  function sameAsDb(rep, dbT) {
    if (!(dbT > 0) || !isFinite(dbT)) return false;
    const dbLam = LN2 / dbT;
    if (close(rep.v, dbLam, 1e-9)) return true;
    if (!rep.raw) return false;
    const q = rep.raw.q === 'T' ? dbT / (rep.raw.mult || 1) : dbLam;
    return roundsTo(rep.raw.x, q);
  }
  const round12 = (x) => Number(x.toPrecision(12));

  /**
   * Из сырой модели — данные для калькулятора:
   * {format, roots, activities (Бк), hold, holdUnit, tSec, overrides {имя: {T?, d?}}, nuclides: [...], notes, warnings}.
   * nuclides: {name, lambda, lambdaDb, T, src: 'db'|'file', stable, daughters, branchSrc: 'db'|'file', A0}
   */
  function build(R) {
    const db = DB();
    const warnings = R.warnings;
    const overrides = {};
    const names = R.names.slice();
    if (!names.length) throw new ImportError('В тексте не нашлось ни одного изотопа: ни уравнений dN/dt, ни постоянных распада, ни активностей.');
    // постоянные распада из файла
    const lamFile = new Map();
    const env = envOf(R);
    const M = new Map(); // уравнения: имя → Map(имя → коэффициент)
    for (const [n, e] of R.eqs) {
      const lin = e.lin || linear(e.ast, env, e.line);
      if (lin.c !== 0) throw new ImportError(`в уравнении для ${n} есть слагаемое без N: ${C.num(lin.c, 6)}`, e.line);
      M.set(n, lin.v);
      for (const k of lin.v.keys()) if (!names.includes(k)) names.push(k);
    }
    for (const n of names) {
      const reps = R.lam.get(n) || [];
      const row = M.get(n);
      if (row && row.has(n)) {
        const self = -row.get(n);
        if (self < 0) throw new ImportError(`в уравнении для ${n} убыль записана со знаком «+»`, R.eqs.get(n).line);
        if (!reps.length) reps.push({ v: self, d: 15, src: 'eq' });
        else if (!close(reps[0].v, self, 1e-9)) throw new ImportError(`в уравнении для ${n} коэффициент убыли (${C.num(self, 6)}) не равен постоянной распада (${C.num(reps[0].v, 6)})`, R.eqs.get(n).line);
      }
      if (row && !row.has(n) && reps.length) warnings.push(`${n}: в уравнении нет убыли −λ·N, хотя постоянная распада задана`);
      if (reps.length) lamFile.set(n, reps);
    }
    const nuclides = [];
    const lam = new Map();
    for (const n of names) {
      if (!db[n]) throw new ImportError(`изотопа ${n} нет в базе`);
      const dbT = db[n][0], dbLam = dbT ? LN2 / dbT : 0;
      const reps = lamFile.get(n);
      let value = dbLam, src = 'db';
      const stableInFile = R.stable.has(n) || (M.has(n) && !M.get(n).has(n) && !reps);
      if (reps && reps.length) {
        if (reps.some((r) => sameAsDb(r, dbT))) value = dbLam;
        else {
          // самая точная запись: выражение (ln(2)/(…)) точно по замыслу автора; число — не грубее 6 знаков
          // (короткая запись «2.78E-12» означает ровно это число); при равной точности — сама λ, а не T½
          const prec = (r) => (r.raw ? Math.max(r.d, 6) : r.src === 'eq' ? 15 : Infinity);
          const best = reps.slice().sort((x, y) => (prec(y) - prec(x)) || ((y.src !== 'T') - (x.src !== 'T')))[0];
          value = best.v; src = 'file';
        }
      } else if (stableInFile && dbLam > 1e-20) {
        warnings.push(`${n}: в файле стабильный, по базе T½ = ${C.fmtHalfLife(dbT)} — взяты данные базы`);
      } else if (!reps && !stableInFile && dbLam === 0 && M.has(n)) {
        value = 0;
      } else if (!reps && !M.has(n) && !R.tableOnly && dbLam > 0 && !R.ic.has(n)) {
        warnings.push(`${n}: в файле нет ни уравнения, ни постоянной распада — взяты данные базы`);
      }
      if (src === 'file' && !(value > 0)) { src = 'db'; value = dbLam; }
      if (src === 'file') overrides[n] = { T: LN2 / value };
      lam.set(n, value);
      nuclides.push({ name: n, lambda: value, lambdaDb: dbLam, T: value > 0 ? LN2 / value : Infinity, src, stable: value === 0 });
    }
    // ветвления из уравнений (или явного списка Python)
    let fileBranches = null;
    if (R.branches) {
      fileBranches = new Map();
      for (const b of R.branches) { if (!fileBranches.has(b.from)) fileBranches.set(b.from, []); fileBranches.get(b.from).push({ name: b.to, br: b.br, d: b.d }); }
    } else if (M.size) {
      fileBranches = new Map();
      for (const [child, row] of M) for (const [par, coef] of row) {
        if (par === child) continue;
        const lp = lamFile.has(par) ? lamFile.get(par)[0].v : lam.get(par);
        if (!(lp > 0)) throw new ImportError(`в уравнении для ${child} есть приток от ${par}, но ${par} не распадается`, R.eqs.get(child).line);
        if (coef < 0) throw new ImportError(`приток от ${par} к ${child} записан со знаком «−»`, R.eqs.get(child).line);
        if (!fileBranches.has(par)) fileBranches.set(par, []);
        const br = coef / lp;
        fileBranches.get(par).push({ name: child, br: Math.abs(br - 1) < 1e-12 ? 1 : br, d: 15 });
      }
    }
    if (fileBranches) {
      for (const nu of nuclides) {
        if (nu.stable) { nu.branchSrc = 'db'; continue; }
        const fromFile = fileBranches.get(nu.name) || [];
        const dbD = (db[nu.name][2] || []).filter(([d]) => d !== 'SF' && db[d]);
        const sum = fromFile.reduce((s, x) => s + x.br, 0);
        if (sum > 1 + 1e-6) throw new ImportError(`сумма долей ветвлений ${nu.name} больше 1 (${C.num(sum, 6)})`);
        const same = fromFile.length === dbD.length && fromFile.every((x) => {
          const d = dbD.find(([n]) => n === x.name);
          return d && (close(x.br, d[1], 1e-9) || [10, 12].some((P) => close(x.br, Number(d[1].toPrecision(P)), 1e-12)));
        });
        // нет ни одного дочернего в файле (система оборвана на этом изотопе) — достраиваем цепочку по базе
        if (same || (!fromFile.length && dbD.length)) { nu.branchSrc = 'db'; nu.daughters = dbD.map(([n, b]) => ({ name: n, br: b })); continue; }
        nu.branchSrc = 'file';
        nu.daughters = fromFile.map((x) => ({ name: x.name, br: x.br }));
        const modes = Object.fromEntries((db[nu.name][2] || []).map(([n, , mode]) => [n, mode]));
        overrides[nu.name] = Object.assign(overrides[nu.name] || {}, { d: fromFile.map((x) => [x.name, round12(x.br), modes[x.name] || ''].filter((v, i) => i < 2 || v)) });
        const missing = dbD.filter(([n]) => !fromFile.some((x) => x.name === n));
        if (missing.length) warnings.push(`${nu.name}: в файле нет ветви ${missing.map(([n, b]) => `→ ${n} (${C.num(b * 100, 4)} %)`).join(', ')} — расчёт пойдёт как в файле`);
      }
    } else {
      for (const nu of nuclides) { nu.branchSrc = 'db'; nu.daughters = (db[nu.name][2] || []).filter(([d]) => d !== 'SF' && db[d]).map(([n, b]) => ({ name: n, br: b })); }
    }
    // начальные активности
    const activities = {};
    for (const [n, ic] of R.ic) {
      const l = lamFile.has(n) ? lamFile.get(n)[0].v : lam.get(n);
      let A;
      if (ic.A != null) A = ic.A;
      else {
        const N0 = linear(ic.ast, env, ic.line);
        if (N0.v.size) throw new ImportError(`начальное условие ${n}(0) должно быть числом`, ic.line);
        if (N0.c < 0) throw new ImportError(`отрицательное начальное условие для ${n}`, ic.line);
        if (N0.c > 0 && !(l > 0)) { warnings.push(`${n}: стабильный, начальное количество (${C.num(N0.c, 6)} атомов) калькулятор не учитывает`); continue; }
        A = N0.c * l;
      }
      if (!(A >= 0) || !isFinite(A)) throw new ImportError(`непонятная начальная активность для ${n}`, ic.line);
      if (A > 0) { if (!(lam.get(n) > 0)) { warnings.push(`${n}: стабильный, начальная активность не нужна`); continue; } activities[n] = round12(A); }
      const nu = nuclides.find((x) => x.name === n); if (nu) nu.A0 = A;
    }
    // родоначальники: изотопы, у которых в модели нет родителей
    const hasParent = new Set();
    for (const nu of nuclides) for (const d of nu.daughters || []) if (names.includes(d.name)) hasParent.add(d.name);
    let roots;
    if (R.tableOnly) {
      // только активности: цепочки строит база; корни — изотопы, не происходящие от других из списка
      const listed = nuclides.filter((x) => !x.stable).map((x) => x.name);
      roots = listed.filter((n) => !listed.some((p) => p !== n && C.buildSet([p]).some((x) => x.name === n)));
      if (!roots.length) throw new ImportError('В таблице нет радиоактивных изотопов.');
    } else {
      // без родителя в файле; изотоп только с λ (без уравнения и N(0)) родоначальником не считаем
      let cand = nuclides.filter((x) => !hasParent.has(x.name) && !x.stable).map((x) => x.name);
      if (R.eqs.size) cand = cand.filter((n) => R.eqs.has(n) || R.ic.has(n));
      // и не тот, до которого цепочка другого родоначальника доходит по базе
      roots = cand.filter((n) => !cand.some((p) => p !== n && C.buildSet([p], overrides).some((x) => x.name === n)));
    }
    if (!roots.length) throw new ImportError('Не удалось найти изотоп-родоначальник: у каждого изотопа есть родитель (цикл в схеме?).');
    // проверка: набор калькулятора совпадает с моделью файла
    let set;
    try { set = C.buildSet(roots, overrides); } catch (e) { throw new ImportError(e.message); }
    if (!R.tableOnly) {
      const inSet = new Set(set.map((x) => x.name));
      const lost = names.filter((n) => !inSet.has(n));
      if (lost.length) warnings.push(`не вошли в расчёт (нет связи с родоначальниками): ${lost.join(', ')}`);
      const extra = set.filter((x) => !names.includes(x.name)).map((x) => x.name);
      if (extra.length) warnings.push(`добавлены по базе: ${extra.join(', ')}`);
    }
    const hold = R.hold || null;
    if (!hold) warnings.push('время выдержки в файле не найдено — оставлено текущее');
    return {
      format: R.format, formatRu: FORMAT_RU[R.format] || R.format, roots, activities, overrides,
      hold: hold ? hold.value : null, holdUnit: hold ? hold.unit : null, tSec: hold ? hold.tSec : null,
      nuclides, set: set.map((x) => x.name), warnings, notes: R.notes,
    };
  }

  function parseRaw(input, name) {
    const fmt = detect(input, name);
    const s = typeof input === 'string' ? input.replace(/^﻿/, '') : input;
    switch (fmt) {
      case 'maple': return parseMaple(s);
      case 'latex': return parseLatex(s);
      case 'python': return parsePython(s);
      case 'text': return parseText(s);
      case 'table': return parseTable(s);
      default: throw new ImportError('Не удалось узнать формат. Поддерживаются: Maple (.mpl), LaTeX (.tex), Python (.py), текст формул калькулятора (.txt), таблица «изотоп — активность» (CSV) и Excel (.xlsx).');
    }
  }
  /** Разбор текста (синхронно). Для .xlsx — parseAsync. */
  function parse(input, name) {
    if (detect(input, name) === 'hlc') throw new ImportError('Это файл расчёта .hlc — он открывается как обычно.');
    return build(parseRaw(input, name));
  }
  async function parseAsync(input, name) {
    if (detect(input, name) === 'xlsx') return build(fromSheets(await readXlsx(input instanceof Uint8Array ? input : new Uint8Array(input))));
    return parse(input, name);
  }

  const api = { detect, parse, parseAsync, readXlsx, parseExpr, linear, sigDigits, FORMAT_RU, ImportError, _raw: parseRaw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HLImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
