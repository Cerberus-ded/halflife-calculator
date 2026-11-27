/* Расчётное ядро: построение цепочек распада по базе нуклидов и
 * аналитическое решение системы уравнений Бейтмана.
 * Единицы: λ — с⁻¹, время — с, активность — Бк, N — число атомов. A = λ·N.
 */
(function (global) {
  'use strict';

  const LN2 = Math.LN2;
  // Год = 365,2422 сут — как в IAEA LiveChart (тропический год)
  const Y = 365.2422 * 24 * 3600, D = 86400, H = 3600, MIN = 60;
  const DB = () => global.NUCDB || {};

  // ---------- имена ----------
  /** Нормализует ввод пользователя: "th229", "229Th", "Th 229", "ra-224" -> "Th-229". */
  function normalizeName(s) {
    s = String(s || '').trim().replace(/[\s_]+/g, '').replace(/[–—]/g, '-');
    let m = s.match(/^([A-Za-z]{1,2})-?(\d{1,3})(m|n)?$/i) || null;
    let sym, a, meta;
    if (m) { sym = m[1]; a = m[2]; meta = m[3] || ''; }
    else {
      m = s.match(/^(\d{1,3})(m|n)?-?([A-Za-z]{1,2})$/i);
      if (!m) return null;
      a = m[1]; meta = m[2] || ''; sym = m[3];
    }
    sym = sym[0].toUpperCase() + sym.slice(1).toLowerCase();
    const name = sym + '-' + Number(a) + meta.toLowerCase();
    return DB()[name] ? name : null;
  }
  /** Короткий идентификатор для формул: Th-229 -> Th229, Pa-234m -> Pa234m. */
  const ident = (name) => name.replace('-', '');

  // ---------- данные нуклида с учётом пользовательских правок ----------
  function nuclide(name, overrides) {
    const rec = DB()[name];
    if (!rec) throw new Error('Нет в базе: ' + name);
    const ov = (overrides && overrides[name]) || {};
    const T = ov.T != null ? ov.T : rec[0];
    return {
      name, id: ident(name),
      T: T == null ? Infinity : T,
      lambda: T == null || !isFinite(T) ? 0 : LN2 / T,
      src: ov.T != null ? 'user' : ({ I: 'IAEA', C: 'ICRP-107', S: 'стабильный' })[rec[1]],
      daughters: (ov.d || rec[2]).map(([n, b, mode]) => ({ name: n, br: b, mode })),
    };
  }

  /**
   * Строит набор нуклидов: все родоначальники и все их потомки.
   * Возвращает список в топологическом порядке (родители раньше дочерних)
   * с полем root — от какого родоначальника нуклид впервые достигнут.
   */
  function buildSet(roots, overrides) {
    const seen = new Map();
    const order = [];
    const visiting = new Set();
    function visit(name, root) {
      if (seen.has(name)) return;
      if (visiting.has(name)) throw new Error('Цикл в схеме распада: ' + name);
      visiting.add(name);
      const nu = nuclide(name, overrides);
      for (const d of nu.daughters) if (d.name !== 'SF' && DB()[d.name]) visit(d.name, root);
      visiting.delete(name);
      nu.root = root;
      seen.set(name, nu);
      order.push(nu);
    }
    for (const r of roots) visit(r, r);
    order.reverse(); // обратный постпорядок DFS = топологический порядок
    // стабильно группируем по родоначальнику, сохраняя топологию внутри
    const byRoot = roots.map((r) => order.filter((n) => n.root === r));
    const list = [].concat(...byRoot);
    // проверяем, что родители всегда раньше потомков (при слиянии цепочек)
    const pos = new Map(list.map((n, i) => [n.name, i]));
    let ok = list.every((n) => n.daughters.every((d) => !pos.has(d.name) || pos.get(d.name) > pos.get(n.name)));
    const final = ok ? list : order;
    final.forEach((n) => {
      n.parents = [];
    });
    const idx = new Map(final.map((n, i) => [n.name, i]));
    final.forEach((n, j) => n.daughters.forEach((d) => {
      if (idx.has(d.name)) final[idx.get(d.name)].parents.push({ name: n.name, j, br: d.br, mode: d.mode });
    }));
    return final;
  }

  /**
   * Аналитическое решение для набора (топологический порядок).
   * N_i(t) = Σ_k c[i][k]·e^{-λ_k t};  c[i][k] = Σ_j b_ji λ_j c[j][k] / (λ_i − λ_k), k≠i;
   * c[i][i] = N_i(0) − Σ_{k≠i} c[i][k].
   * Вычисление ведётся в форме N_i = N_i(0)e^{-λ_i t} + Σ_{k≠i} c_ik (e^{-λ_k t} − e^{-λ_i t})
   * с expm1, чтобы не терять точность при малых t.
   */
  function solve(set, N0) {
    const n = set.length;
    const lam = set.map((x) => x.lambda);
    // совпадающие λ у предка и потомка — сдвигаем на 1e-9 относительных (влияние пренебрежимо)
    for (let i = 0; i < n; i++) for (let k = 0; k < i; k++)
      if (lam[i] === lam[k] && lam[i] > 0) lam[i] *= 1 + 1e-9;
    const c = [];
    for (let i = 0; i < n; i++) {
      const row = new Array(n).fill(0);
      for (const p of set[i].parents) {
        const f = p.br * lam[p.j];
        const cj = c[p.j];
        for (let k = 0; k < n; k++) {
          if (k === i || cj[k] === 0) continue;
          row[k] += f * cj[k] / (lam[i] - lam[k]);
        }
      }
      let s = 0;
      for (let k = 0; k < n; k++) if (k !== i) s += row[k];
      row[i] = (N0[i] || 0) - s;
      c.push(row);
    }
    function diffExp(lk, li, t) {
      if (li > lk) return Math.exp(-lk * t) * -Math.expm1(-(li - lk) * t);
      return Math.exp(-li * t) * Math.expm1(-(lk - li) * t);
    }
    function N(t) {
      return c.map((row, i) => {
        let s = (N0[i] || 0) * Math.exp(-lam[i] * t);
        for (let k = 0; k < n; k++) if (k !== i && row[k] !== 0) s += row[k] * diffExp(lam[k], lam[i], t);
        return Math.max(s, 0);
      });
    }
    return { N, coef: c, lambda: lam };
  }

  /** Полный расчёт. A0: {имя: Бк}. Возвращает строки результата, ряд для графика и коэффициенты. */
  function calculate(set, A0, tSec, points) {
    const N0 = set.map((x) => (x.lambda > 0 ? (Number(A0[x.name]) || 0) / x.lambda : 0));
    const sol = solve(set, N0);
    const N = sol.N(tSec);
    const rows = set.map((x, i) => ({
      name: x.name, root: x.root, stable: x.lambda === 0, lambda: x.lambda, T: x.T, src: x.src,
      A0: x.lambda > 0 ? Number(A0[x.name]) || 0 : 0, N0: N0[i], N: N[i], A: x.lambda * N[i],
    }));
    const series = { t: [], A: [] };
    const P = points || 300;
    for (let p = 0; p <= P; p++) {
      const t = tSec * p / P;
      series.t.push(t);
      series.A.push(sol.N(t).map((v, i) => set[i].lambda * v));
    }
    return { rows, series, coef: sol.coef, N0 };
  }

  // ---------- форматирование ----------
  // Выбор единицы для T½: значение с наименьшим числом значащих цифр (при равенстве — крупная единица).
  const HL_UNITS = [[Y, 'y', 'лет', '365.2422*24*3600'], [D, 'd', 'сут', '24*3600'], [H, 'h', 'ч', '3600'],
    [MIN, 'min', 'мин', '60'], [1, 's', 'с', ''], [1e-3, 'ms', 'мс', '1e-3'], [1e-6, 'us', 'мкс', '1e-6'], [1e-9, 'ns', 'нс', '1e-9']];
  function sigDigits(v) {
    const s = Number(v.toPrecision(6)).toExponential().split('e')[0].replace('-', '').replace('.', '');
    return s.replace(/0+$/, '').length || 1;
  }
  function pickUnit(T, allowSub) {
    let best = null;
    const last = HL_UNITS.length - 1;
    HL_UNITS.forEach((u, i) => {
      if (!allowSub && u[0] < 1) return;
      const v = T / u[0];
      if (v < 1 && (allowSub ? i < last : u[0] !== 1)) return;
      const d = sigDigits(v);
      const score = d + 1.01 * i; // при близкой «круглости» предпочитаем крупную единицу
      if (!best || score < best.score) best = { u, v: Number(v.toPrecision(6)), score };
    });
    return best || { u: HL_UNITS[4], v: T };
  }
  function fmtHalfLife(T) {
    if (!isFinite(T)) return 'стабильный';
    const b = pickUnit(T, true);
    return fmtNum(b.v, 6) + ' ' + b.u[2];
  }
  function fmtNum(x, digits) {
    if (x === 0) return '0';
    if (!isFinite(x)) return '∞';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e6) return Number(x.toPrecision(digits || 4)).toLocaleString('ru-RU', { maximumFractionDigits: 6 });
    return x.toExponential((digits || 4) - 1).replace('.', ',').replace('e+', 'E').replace('e', 'E');
  }
  /** Число для формул (точка, экспонента в стиле e-12). */
  function num(x, digits) {
    if (x === 0) return '0';
    const s = x.toPrecision(digits || 6);
    return s.includes('e') ? s.replace(/\.?0+e/, 'e').replace('e+', 'e') : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }
  /** Подбор удобной единицы для T½ в формулах: [значение, код единицы, множитель в секундах]. */
  function halfLifeUnit(T) {
    if (!isFinite(T)) return null;
    const b = pickUnit(T, false);
    return [b.v, b.u[1], b.u[3]];
  }

  const api = { normalizeName, ident, nuclide, buildSet, solve, calculate, fmtHalfLife, fmtNum, num, halfLifeUnit,
    units: { Y, D, H, MIN }, LN2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HLCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
