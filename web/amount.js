/* Масса, количество вещества и удельная активность нуклидов (без DOM, проверяется в Node).
 * Атомные массы — window.NUCMASS (web/masses.js, AME 2020); если массы нет, берётся массовое число.
 * API: window.HLAmount = {NA, molarMass, specificActivity, gramsFromAtoms, atomsFromGrams, gramsFromActivity,
 *   activityFromGrams, massUnit, MASS_UNITS}.
 * Масса — в граммах, активность — в Бк, λ — в 1/с.
 */
(function (global) {
  'use strict';
  const NA = 6.02214076e23; // постоянная Авогадро, 1/моль (точное значение SI)
  const masses = () => global.NUCMASS || (typeof require === 'function' ? require('./masses.js') : {});

  /** Молярная масса, г/моль (численно равна атомной массе в а. е. м.). {M, exact: false} — взято массовое число. */
  function molarMass(name) {
    const m = masses()[name];
    if (m > 0) return { M: m, exact: true };
    const a = /^[A-Z][a-z]?-(\d+)/.exec(String(name));
    return { M: a ? Number(a[1]) : NaN, exact: false };
  }
  /** Удельная активность чистого нуклида, Бк/г: λ·N_A/M. */
  function specificActivity(name, lambda) { return lambda > 0 ? lambda * NA / molarMass(name).M : 0; }
  const gramsFromAtoms = (N, name) => N * molarMass(name).M / NA;
  const atomsFromGrams = (g, name) => g * NA / molarMass(name).M;
  const gramsFromActivity = (A, name, lambda) => (lambda > 0 ? A / specificActivity(name, lambda) : NaN);
  const activityFromGrams = (g, name, lambda) => g * specificActivity(name, lambda);

  // Единицы массы для показа: от граммов до аттограммов
  const MASS_UNITS = [
    { key: 'kg', f: 1e3, ru: 'кг' }, { key: 'g', f: 1, ru: 'г' }, { key: 'mg', f: 1e-3, ru: 'мг' }, { key: 'ug', f: 1e-6, ru: 'мкг' },
    { key: 'ng', f: 1e-9, ru: 'нг' }, { key: 'pg', f: 1e-12, ru: 'пг' }, { key: 'fg', f: 1e-15, ru: 'фг' }, { key: 'ag', f: 1e-18, ru: 'аг' },
  ];
  /** Единица, в которой наибольшее значение (г) будет от 1 до 1000; для нуля — граммы. */
  function massUnit(maxGrams) {
    if (!(maxGrams > 0) || !isFinite(maxGrams)) return MASS_UNITS[1];
    for (const u of MASS_UNITS.slice(1)) if (maxGrams >= u.f) return u;
    return MASS_UNITS[MASS_UNITS.length - 1];
  }

  const api = { NA, molarMass, specificActivity, gramsFromAtoms, atomsFromGrams, gramsFromActivity, activityFromGrams, massUnit, MASS_UNITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HLAmount = api;
})(typeof window !== 'undefined' ? window : globalThis);
