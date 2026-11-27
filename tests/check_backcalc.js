/* Проверка обратного расчёта (HLTools.backCalc): начальная активность по активности, измеренной позже.
 * Сверка с аналитическими ответами и с прямым расчётом. Запуск: node tests/check_backcalc.js */
'use strict';
const path = require('path');
const { WEB, C, DB, ok, done, rel } = require('./common');
const T = require(path.join(WEB, 'tools.js'));

console.log('Пересчёт от измерения (backCalc)');
const D = 86400;
const lam = (n) => Math.LN2 / DB[n][0];

// один изотоп: A0 = A·exp(λt)
{
  const set = C.buildSet(['Cs-137'], {});
  const t = 10 * C.units.Y;
  const r = T.backCalc(set, { 'Cs-137': 1 }, 'Cs-137', t, 1000);
  ok(r.ok && rel(r.A0['Cs-137'], 1000 * Math.exp(lam('Cs-137') * t)) < 1e-12, `Cs-137 через 10 лет: A0 = ${r.A0 && r.A0['Cs-137']}`);
  const r0 = T.backCalc(set, { 'Cs-137': 1 }, 'Cs-137', 0, 1000);
  ok(r0.ok && rel(r0.A0['Cs-137'], 1000) < 1e-14, 'через 0 — та же активность');
}

// дочерний изотоп: Mo-99 → Tc-99m (ветвь 87,73 %), аналитика Бейтмана
{
  const set = C.buildSet(['Mo-99'], {});
  const t = 24 * 3600;
  const l1 = lam('Mo-99'), l2 = lam('Tc-99m');
  const b = DB['Mo-99'][2].find((d) => d[0] === 'Tc-99m')[1];
  const perUnit = b * l2 / (l2 - l1) * (Math.exp(-l1 * t) - Math.exp(-l2 * t)); // A(Tc-99m) при A0(Mo-99) = 1 Бк
  const r = T.backCalc(set, { 'Mo-99': 1 }, 'Tc-99m', t, 5e8);
  ok(r.ok && rel(r.A0['Mo-99'], 5e8 / perUnit) < 1e-9, `Mo-99 по Tc-99m через сутки: ${r.A0 && r.A0['Mo-99']} (ожидается ${5e8 / perUnit})`);
  ok(r.ok && rel(r.perBase, perUnit) < 1e-9, 'выход дочернего на 1 Бк родителя');
}

// проверка прямым расчётом: найденные A0 дают измеренное значение
{
  const set = C.buildSet(['Ac-225'], {});
  const t = 3 * D;
  const r = T.backCalc(set, { 'Ac-225': 1 }, 'Bi-213', t, 2.5e6);
  const back = C.calculate(set, r.A0, t, 2).rows.find((x) => x.name === 'Bi-213').A;
  ok(r.ok && rel(back, 2.5e6) < 1e-10, `Ac-225 по Bi-213: прямой расчёт даёт ${back}`);
  // соотношение из таблицы сохраняется
  const set2 = C.buildSet(['Th-229', 'Th-228'], {});
  const base = { 'Th-229': 1e6, 'Th-228': 1e3 };
  const r2 = T.backCalc(set2, base, 'Ra-224', 7 * D, 4321);
  ok(r2.ok && rel(r2.A0['Th-229'] / r2.A0['Th-228'], 1000) < 1e-12, 'соотношение начальных активностей сохранено');
  const back2 = C.calculate(set2, r2.A0, 7 * D, 2).rows.find((x) => x.name === 'Ra-224').A;
  ok(rel(back2, 4321) < 1e-10, `Th-229 + Th-228 по Ra-224: прямой расчёт даёт ${back2}`);
}

// ошибки
{
  const set = C.buildSet(['Ac-225', 'Cs-137'], {});
  let r = T.backCalc(set, { 'Cs-137': 1 }, 'Bi-213', D, 100);
  ok(!r.ok && /не образуется из Cs-137/.test(r.reason), 'изотоп из другой цепочки: ' + r.reason);
  r = T.backCalc(set, { 'Ac-225': 1 }, 'Bi-213', 0, 100);
  ok(!r.ok && /ещё не образовался/.test(r.reason), 'дочерний в момент 0: ' + r.reason);
  r = T.backCalc(set, { 'Ac-225': 1 }, 'Bi-209', D, 100);
  ok(!r.ok && /стабилен/.test(r.reason), 'стабильный: ' + r.reason);
  r = T.backCalc(set, { 'Ac-225': 1 }, 'Ac-225', D, 0);
  ok(!r.ok && /больше нуля/.test(r.reason), 'нулевое измерение: ' + r.reason);
  r = T.backCalc(set, { 'Ac-225': 1 }, 'Ac-225', -5, 10);
  ok(!r.ok, 'отрицательное время отклонено');
  r = T.backCalc(set, {}, 'Ac-225', D, 10);
  ok(!r.ok && /Не от чего/.test(r.reason), 'пустая база: ' + r.reason);
  r = T.backCalc(set, { 'Ac-225': 1 }, 'U-238', D, 10);
  ok(!r.ok && /нет в цепочке/.test(r.reason), 'нет в наборе: ' + r.reason);
  r = T.backCalc(C.buildSet(['Po-212'], {}), { 'Po-212': 1 }, 'Po-212', 3600, 10);
  ok(!r.ok && /распадается полностью|пределы/.test(r.reason), 'полностью распавшийся за час Po-212: ' + r.reason);
}

process.exit(done('Пересчёт от измерения') ? 1 : 0);
