/* Генерация формул модели в разных форматах: текст, Maple, LaTeX, Python.
 * API: HLFormulas.text(m), .maple(m), .latex(m), .python(m), где m = {set, A0, tSec, holdText, result?}
 * (set — из HLCore.buildSet, result — из HLCore.calculate).
 * Maple-вывод повторяет структуру ручных расчётов заказчика (разделы 1–6, имена lTh229, NTh229(t), N_Th229, A_Th229).
 */
(function (global) {
  'use strict';
  const C = global.HLCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const UNIT_RU = { y: 'лет', d: 'сут', h: 'ч', min: 'мин', s: 'с' }; // год = 365,2422 сут
  const RULE = '# ' + '='.repeat(60);

  const id = (x) => C.ident(typeof x === 'string' ? x : x.name);
  const uniq = (a) => [...new Set(a)];
  const a0 = (m, x) => (x.lambda > 0 ? Number(m.A0 && m.A0[x.name]) || 0 : 0);

  /** Группы по родоначальникам в порядке набора: [{root, items}]. */
  function groups(set) {
    return uniq(set.map((x) => x.root)).map((root) => ({ root, items: set.filter((x) => x.root === root) }));
  }

  /** Число для формул: экспонента для очень малых и больших значений (2.78e-12, 1.19082e10). */
  function nm(x, d) {
    d = d || 6;
    if (x === 0 || !isFinite(x)) return C.num(x, d);
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e7) return C.num(x, d);
    return x.toExponential(d - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
  }
  /** Число как float Maple: 187000 -> 187000., 2.78e-12 -> 2.78E-12 (чтобы не было рациональных дробей). */
  const mapleFloat = (v) => (/[.e]/.test(v) ? v : v + '.').toUpperCase();
  const SRC = (s) => (s === 'user' ? 'польз.' : s);
  /** Задан ли нуклид «круглой» λ (так заказчик записал цепочку Th-229: lTh229 := 2.78E-12). */
  function roundLambda(x) {
    const u = C.halfLifeUnit(x.T);
    const mult = { y: C.units.Y, d: C.units.D, h: C.units.H, min: C.units.MIN, s: 1 }[u[1]];
    const roundT = Math.abs(u[0] * mult - x.T) <= 1e-9 * x.T;
    const l6 = Number(x.lambda.toPrecision(6));
    return !roundT && Math.abs(l6 - x.lambda) <= 1e-12 * x.lambda ? l6 : null;
  }
  /** T½ выражением в секундах: «7880 * 365.2422 * 24 * 3600». Если округление до 6 знаков
   * в удобной единице меняет значение, пишем точные секунды. */
  function hlExpr(T, style) {
    const u = C.halfLifeUnit(T);
    const mult = { y: C.units.Y, d: C.units.D, h: C.units.H, min: C.units.MIN, s: 1 }[u[1]];
    let s;
    if (Math.abs(u[0] * mult - T) > 1e-9 * T) {
      // правка пользователя в юлианских годах (365,25 сут), как в расчётах заказчика
      const yj = Number((T / (365.25 * 86400)).toPrecision(6));
      s = T >= 365.25 * 86400 && Math.abs(yj * 365.25 * 86400 - T) <= 1e-9 * T ? nm(yj, 6) + ' * 365.25 * 24 * 3600' : nm(T, 12);
    } else s = u[2] ? C.num(u[0], 6) + ' * ' + u[2].replace(/\*/g, ' * ') : nm(u[0], 6);
    return style === 'latex' ? s.replace(/ \* /g, '\\cdot ').replace(/e(-?\d+)$/, '\\cdot 10^{$1}') : s;
  }
  /** T½ для чтения человеком: «7880 лет», «32.6 мс», «294.3 нс». */
  function hlHuman(T) {
    if (T < 1) {
      for (const [f, u] of [[1e-3, 'мс'], [1e-6, 'мкс'], [1e-9, 'нс']]) if (T >= f) return `${C.num(T / f, 6)} ${u}`;
      return `${nm(T, 6)} с`;
    }
    const u = C.halfLifeUnit(T);
    return `${C.num(u[0], 6)} ${UNIT_RU[u[1]]}`;
  }
  /** Схема распада одной строкой: «β- 97.86 % → Po-213, α 2.14 % → Tl-209». */
  function scheme(x) {
    return x.daughters.map((d) => `${d.mode || ''} ${nm(d.br * 100, 6)} % → ${d.name === 'SF' ? 'деление (выбывает)' : d.name}`.trim()).join(', ');
  }
  /** Правая часть dN/dt. op — оператор умножения, N(name) — запись N, L(name) — запись λ. */
  function rhs(x, op, N, L, fmt) {
    const terms = [];
    fmt = fmt || ((v) => nm(v, 10));
    if (x.lambda > 0) terms.push(`-${L(x.name)}${op}${N(x.name)}`);
    for (const p of x.parents) terms.push(`${p.br === 1 ? '' : fmt(p.br) + op}${L(p.name)}${op}${N(p.name)}`);
    return terms.length ? terms.join(' + ').replace(/\+ -/g, '- ') : '0';
  }
  function sums(m) {
    const r = m.result.rows;
    return groups(m.set).map((g) => ({
      root: g.root,
      A: r.filter((x) => x.root === g.root && !x.stable).reduce((s, x) => s + x.A, 0),
      A0: r.filter((x) => x.root === g.root && !x.stable).reduce((s, x) => s + x.A0, 0),
    }));
  }

  // ------------------------------------------------------------------ Текст
  function text(m) {
    const L = [];
    const G = groups(m.set);
    const multi = G.length > 1;
    const head = (g) => { if (multi) L.push(`   --- Цепочка ${g.root} ---`); };
    L.push('МОДЕЛЬ РАДИОАКТИВНОГО РАСПАДА (уравнения Бейтмана)');
    L.push('Родоначальники: ' + G.map((g) => g.root).join(', ') + `.   Выдержка: ${m.holdText} = ${nm(m.tSec, 10)} с.`);
    L.push('N_X(t) — число ядер изотопа X; λ_X = ln2 / T½ — постоянная распада, 1/с;');
    L.push('A_X(t) = λ_X·N_X(t) — активность, Бк; b — доля ветви распада. Год = 365,2422 сут.');
    L.push('');
    L.push('1. Постоянные распада и схемы распада');
    for (const g of G) {
      head(g);
      for (const x of g.items) {
        if (x.lambda === 0) { L.push(`   ${x.name}: стабильный (λ = 0)`); continue; }
        L.push(`   λ_${id(x)} = ln2 / (${hlHuman(x.T)}) = ${nm(x.lambda, 6)} 1/с   [${SRC(x.src)}]`);
        if (x.daughters.length) L.push(`      распад: ${scheme(x)}`);
      }
    }
    L.push('');
    L.push('2. Система дифференциальных уравнений');
    for (const g of G) {
      head(g);
      for (const x of g.items) L.push(`   dN_${id(x)}/dt = ${rhs(x, '·', (n) => 'N_' + id(n), (n) => 'λ_' + id(n)).replace(/^-/, '−').replace(/ - /g, ' − ')}`);
    }
    L.push('');
    L.push('3. Начальные условия: N_X(0) = A_X(0) / λ_X');
    for (const g of G) {
      head(g);
      for (const x of g.items) {
        const a = a0(m, x);
        L.push(a ? `   N_${id(x)}(0) = ${nm(a, 8)} Бк / λ_${id(x)} = ${nm(a / x.lambda, 6)}` : `   N_${id(x)}(0) = 0`);
      }
    }
    L.push('');
    L.push('4. Решение (аналитическое): N_i(t) = Σ_k c_ik·exp(−λ_k·t),');
    L.push('   c_ik = Σ_j b_ji·λ_j·c_jk / (λ_i − λ_k) при k ≠ i;  c_ii = N_i(0) − Σ_{k≠i} c_ik,');
    L.push('   где сумма по j — по всем родителям изотопа i, b_ji — доля распадов j, ведущих в i.');
    if (!m.result) {
      L.push('   (коэффициенты и результат появятся после нажатия «Рассчитать»)');
      return L.join('\n');
    }
    const c = m.result.coef;
    for (const g of G) {
      head(g);
      for (const x of g.items) {
        const i = m.set.indexOf(x);
        const terms = [];
        c[i].forEach((v, k) => {
          if (v === 0) return;
          const e = m.set[k].lambda === 0 ? '' : `·exp(−λ_${id(m.set[k])}·t)`;
          terms.push(`${v < 0 ? '− ' : '+ '}${nm(Math.abs(v), 6)}${e}`);
        });
        L.push(`   N_${id(x)}(t) = ${terms.length ? terms.join(' ').replace(/^\+ /, '').replace(/^− /, '−') : '0'}`);
      }
    }
    L.push('');
    L.push(`5. Результат при t = ${m.holdText} = ${nm(m.tSec, 10)} с`);
    const S = sums(m);
    for (const g of G) {
      head(g);
      for (const x of g.items) {
        const r = m.result.rows[m.set.indexOf(x)];
        if (r.stable) L.push(`   N_${id(x)}(t) = ${nm(r.N, 6)} атомов (стабильный, накопление)`);
        else L.push(`   A_${id(x)}(t) = λ·N = ${nm(r.lambda, 6)} · ${nm(r.N, 6)} = ${nm(r.A, 6)} Бк`);
      }
      const s = S.find((z) => z.root === g.root);
      L.push(`   Сумма активностей цепочки ${g.root}: ${nm(s.A0, 6)} → ${nm(s.A, 6)} Бк`);
    }
    if (multi) L.push(`   Всего: ${nm(S.reduce((z, s) => z + s.A0, 0), 6)} → ${nm(S.reduce((z, s) => z + s.A, 0), 6)} Бк`);
    return L.join('\n');
  }

  // ------------------------------------------------------------------ Maple
  function maple(m) {
    const L = [];
    const G = groups(m.set);
    const sec = (title) => { L.push(RULE); L.push('# ' + title); L.push(RULE); };
    const seq = (lines) => lines.join(',\n');
    L.push('restart:');
    L.push('Digits := 15:');
    L.push('# Модель распада: ' + G.map((g) => g.root).join(' + ') + `, выдержка ${m.holdText}. Сформировано «Калькулятором полураспада».`);
    L.push('');
    sec('1. Постоянные распада, 1/с (lambda = ln2 / T1/2)');
    for (const g of G) {
      L.push(`# --- Цепочка ${g.root} ---`);
      for (const x of g.items) {
        if (x.lambda === 0) continue;
        const lr = roundLambda(x);
        L.push(lr != null
          ? `l${id(x)} := ${mapleFloat(nm(lr, 6))};   # ${x.name}, T1/2 = ${hlHuman(x.T)} [${SRC(x.src)}]`
          : `l${id(x)} := evalf(ln(2) / (${hlExpr(x.T)}));   # ${x.name}, T1/2 = ${hlHuman(x.T)} [${SRC(x.src)}]`);
      }
      L.push('');
    }
    sec('2. Объединенная система уравнений');
    L.push('EQ :=');
    L.push(G.map((g) => `  # --- ${g.root} ---\n` + seq(g.items.map((x) =>
      `  diff(N${id(x)}(t), t) = ${rhs(x, '*', (n) => `N${id(n)}(t)`, (n) => 'l' + id(n))}`))).join(',\n\n') + ';');
    L.push('');
    sec('3. Начальные условия: N(0) = A(0)/lambda, A(0) в Бк');
    L.push('IC :=');
    L.push(G.map((g) => `  # --- ${g.root} ---\n` + seq(g.items.map((x) => {
      const a = a0(m, x);
      return `  N${id(x)}(0) = ${a ? nm(a, 10) + '/l' + id(x) : '0'}`;
    }))).join(',\n\n') + ';');
    L.push('');
    sec('4. Численное решение');
    L.push('sol := dsolve({EQ, IC}, numeric, stiff = true, maxfun = 0, abserr = 1e-10, relerr = 1e-12, output = listprocedure) :');
    L.push('');
    sec('5. Извлечение функций N(t) для всех изотопов');
    for (const g of G) {
      L.push(`# ${g.root}`);
      for (const x of g.items) L.push(`N_${id(x)} := eval(N${id(x)}(t), sol) :`);
      L.push('');
    }
    sec('6. Функции активности A(t) = lambda * N(t)');
    for (const g of G) {
      for (const x of g.items) L.push(x.lambda > 0
        ? `A_${id(x)} := t -> l${id(x)}*N_${id(x)}(t) :`
        : `A_${id(x)} := t -> N_${id(x)}(t) : # Стабильный, показываем накопление`);
      L.push('');
    }
    sec('7. Результат после выдержки');
    L.push(`tk := ${nm(m.tSec, 12)} :   # выдержка ${m.holdText}, с`);
    const R = m.result ? m.result.rows : null;
    for (const g of G) {
      L.push(`# ${g.root}`);
      for (const x of g.items) {
        const unit = x.lambda > 0 ? 'Bq' : 'atoms';
        let line = `printf("%-8s %16.6e ${unit}\\n", "${x.name}", A_${id(x)}(tk));`;
        if (R) { const r = R[m.set.indexOf(x)]; line += `   # программа: ${nm(x.lambda > 0 ? r.A : r.N, 10)}`; }
        L.push(line);
      }
    }
    return L.join('\n');
  }

  // ------------------------------------------------------------------ LaTeX
  function nuc(name) {
    const mm = name.match(/^([A-Za-z]+)-(\d+)(\w*)$/);
    return mm ? `\\nuc{${mm[1]}}{${mm[2]}${mm[3]}}` : `\\mathrm{${name}}`;
  }
  function sci(x, d) {
    const s = nm(x, d || 6);
    const mm = s.match(/^(-?[\d.]+)e(-?\d+)$/);
    return mm ? `${mm[1]}\\cdot 10^{${mm[2]}}` : s;
  }
  function latex(m) {
    const L = [];
    const G = groups(m.set);
    const tex = (s) => String(s).replace(/([%&#_$])/g, '\\$1');
    L.push('% Модель радиоактивного распада. Сформировано «Калькулятором полураспада».');
    L.push('% Компиляция: pdflatex. Для вставки в свой документ возьмите текст между \\begin{document} и \\end{document}');
    L.push('% и добавьте в преамбулу amsmath, longtable и команду \\nuc.');
    L.push('\\documentclass[11pt]{article}');
    L.push('\\usepackage[T2A]{fontenc}');
    L.push('\\usepackage[utf8]{inputenc}');
    L.push('\\usepackage[russian]{babel}');
    L.push('\\usepackage[a4paper,margin=2cm]{geometry}');
    L.push('\\usepackage{amsmath,longtable}');
    L.push('\\allowdisplaybreaks');
    L.push('\\newcommand{\\nuc}[2]{{}^{#2}\\mathrm{#1}}');
    L.push('\\begin{document}');
    L.push('\\section*{Модель радиоактивного распада}');
    L.push(`Родоначальники: $${G.map((g) => nuc(g.root)).join(',\\ ')}$. Выдержка: ${tex(m.holdText)} ($t = ${sci(m.tSec, 10)}$~с).`);
    L.push('$N_X(t)$ --- число ядер, $\\lambda_X = \\ln 2 / T_{1/2}$ --- постоянная распада, $A_X = \\lambda_X N_X$ --- активность, Бк.');
    L.push('Год $= 365{,}2422$~сут.');
    L.push('');
    L.push('\\subsection*{1. Постоянные распада, с$^{-1}$}');
    L.push('\\begin{align*}');
    L.push(m.set.filter((x) => x.lambda > 0).map((x) =>
      roundLambda(x) != null ? `\\lambda_{${nuc(x.name)}} &= ${sci(x.lambda)}` :
      `\\lambda_{${nuc(x.name)}} &= \\frac{\\ln 2}{${hlExpr(x.T, 'latex')}} = ${sci(x.lambda)}`).join(' \\\\\n'));
    L.push('\\end{align*}');
    L.push('');
    L.push('\\subsection*{2. Система уравнений}');
    L.push('\\begin{align*}');
    L.push(m.set.map((x) => `\\frac{dN_{${nuc(x.name)}}}{dt} &= ` +
      rhs(x, '\\,', (n) => `N_{${nuc(n)}}`, (n) => `\\lambda_{${nuc(n)}}`, (v) => sci(v, 10))).join(' \\\\\n'));
    L.push('\\end{align*}');
    L.push('');
    L.push('\\subsection*{3. Начальные условия}');
    const ic = m.set.filter((x) => a0(m, x));
    L.push('$N_X(0) = A_X(0)/\\lambda_X$; для остальных изотопов $N_X(0) = 0$.');
    if (ic.length) {
      L.push('\\begin{align*}');
      L.push(ic.map((x) => `N_{${nuc(x.name)}}(0) &= \\frac{${sci(a0(m, x), 8)}}{\\lambda_{${nuc(x.name)}}} = ${sci(a0(m, x) / x.lambda)}`).join(' \\\\\n'));
      L.push('\\end{align*}');
    }
    L.push('');
    L.push('\\subsection*{4. Решение}');
    L.push('\\begin{gather*}');
    L.push('N_i(t) = \\sum_k c_{ik}\\, e^{-\\lambda_k t}, \\qquad c_{ik} = \\frac{\\sum_j b_{ji}\\,\\lambda_j\\, c_{jk}}{\\lambda_i - \\lambda_k}\\ (k \\ne i), \\qquad c_{ii} = N_i(0) - \\sum_{k \\ne i} c_{ik},');
    L.push('\\end{gather*}');
    L.push('где $b_{ji}$ --- доля распадов изотопа $j$, ведущих в изотоп $i$.');
    if (m.result) {
      L.push('');
      L.push(`\\subsection*{5. Результат при $t = ${sci(m.tSec, 10)}$~с}`);
      L.push('\\begin{longtable}{lrrr}');
      L.push('Изотоп & $A_0$, Бк & $A(t)$, Бк & $N(t)$, атомов \\\\ \\hline \\endhead');
      const S = sums(m);
      for (const g of G) {
        for (const x of g.items) {
          const r = m.result.rows[m.set.indexOf(x)];
          L.push(`$${nuc(x.name)}$ & ${r.stable ? '---' : `$${sci(r.A0)}$`} & ${r.stable ? 'стаб.' : `$${sci(r.A)}$`} & $${sci(r.N)}$ \\\\`);
        }
        const s = S.find((z) => z.root === g.root);
        L.push(`\\hline Сумма (${tex(g.root)}) & $${sci(s.A0)}$ & $${sci(s.A)}$ & \\\\ \\hline`);
      }
      L.push('\\end{longtable}');
    }
    L.push('\\end{document}');
    return L.join('\n');
  }

  // ------------------------------------------------------------------ Python
  function python(m) {
    const L = [];
    const q = (s) => JSON.stringify(s);
    L.push('# Модель радиоактивного распада: dN/dt = M·N, решение N(t) = expm(M·t)·N(0).');
    L.push('# Сформировано «Калькулятором полураспада». Запуск: pip install numpy scipy; python model.py');
    L.push('import numpy as np');
    L.push('from scipy.linalg import expm');
    L.push('');
    L.push('LN2 = np.log(2)');
    L.push('# T½ в секундах (λ = ln2/T½); None — стабильный. Год = 365,2422 сут, как в IAEA LiveChart.');
    L.push('T_half = {');
    for (const x of m.set) L.push(`    ${q(x.name)}: ${x.lambda > 0 ? nm(x.T, 12) : 'None'},  # ${x.lambda > 0 ? hlHuman(x.T) : 'стабильный'} [${SRC(x.src)}]`);
    L.push('}');
    L.push('# Ветвления: (родитель, дочерний, доля)');
    L.push('branches = [');
    for (const x of m.set) for (const p of x.parents) L.push(`    (${q(p.name)}, ${q(x.name)}, ${nm(p.br, 12)}),  # ${p.mode || ''}`);
    L.push(']');
    L.push('# Начальные активности, Бк');
    L.push('A0 = {');
    for (const x of m.set) if (a0(m, x)) L.push(`    ${q(x.name)}: ${nm(a0(m, x), 12)},`);
    L.push('}');
    L.push(`t = ${nm(m.tSec, 12)}  # выдержка ${m.holdText}, с`);
    if (m.result) {
      L.push('# Результат программы для сверки: A(t), Бк (для стабильных — N(t), атомов)');
      L.push('program = {');
      for (const r of m.result.rows) L.push(`    ${q(r.name)}: ${nm(r.stable ? r.N : r.A, 12)},`);
      L.push('}');
    } else {
      L.push('program = {}');
    }
    L.push('');
    L.push('names = list(T_half)');
    L.push('idx = {n: i for i, n in enumerate(names)}');
    L.push('lam = np.array([LN2 / T if T else 0.0 for T in T_half.values()])');
    L.push('M = np.diag(-lam)');
    L.push('for parent, child, b in branches:');
    L.push('    M[idx[child], idx[parent]] += b * lam[idx[parent]]');
    L.push('N0 = np.array([A0.get(n, 0.0) / lam[i] if lam[i] > 0 else 0.0 for i, n in enumerate(names)])');
    L.push('N = expm(M * t) @ N0');
    L.push('');
    L.push('for i, n in enumerate(names):');
    L.push('    value = lam[i] * N[i] if lam[i] > 0 else N[i]');
    L.push('    unit = "Бк" if lam[i] > 0 else "атомов (стабильный)"');
    L.push('    check = ""');
    L.push('    if n in program and max(abs(value), abs(program[n])) > 0:');
    L.push('        check = f"   отличие от программы {abs(value - program[n]) / max(abs(value), abs(program[n])):.1e}"');
    L.push('    print(f"{n:8s} {\'A\' if lam[i] > 0 else \'N\'} = {value:.6e} {unit}{check}")');
    return L.join('\n');
  }

  const api = { text, maple, latex, python };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HLFormulas = api;
})(typeof window !== 'undefined' ? window : globalThis);
