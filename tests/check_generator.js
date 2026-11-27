/* Проверка генератора с многократными отборами (web/tools.js → generator) по аналитическим формулам.
 * Запуск: node tests/check_generator.js */
'use strict';
const path = require('path');
const { WEB, C, DB, ok, done, rel } = require('./common');
require(path.join(WEB, 'xlsx.js'));
const T = require(path.join(WEB, 'tools.js'));

console.log('Генератор с многократными отборами');
const D = 86400;
const lam = (n) => Math.LN2 / DB[n][0];
const idx = (set, n) => set.findIndex((x) => x.name === n);

// ---- элементы набора ----
const sTh = C.buildSet(['Th-229'], {});
const els = T.elementsOf(sTh);
ok(els[0].el === 'Th' && els.some((e) => e.el === 'Ac') && els.find((e) => e.el === 'Bi').names.length === 2,
  'элементы цепочки Th-229: ' + els.map((e) => e.el + '(' + e.names.length + ')').join(' '));
ok(T.elementOf('Pa-234m') === 'Pa', 'элемент изомера Pa-234m — Pa');

// ---- один полный отбор Ac = расчёт выдержки ----
const A0 = { 'Th-229': 1e6 };
const g1 = T.generator(sTh, A0, { eff: { Ac: 1 }, interval: 10 * D, count: 1 });
const ref = C.calculate(sTh, A0, 10 * D, 2).rows;
const iAc = idx(sTh, 'Ac-225'), iRa = idx(sTh, 'Ra-225');
ok(rel(g1.eluate[0][iAc], ref[iAc].A) < 1e-12, `один отбор Ac через 10 сут: ${g1.eluate[0][iAc].toFixed(2)} Бк = выдержке ${ref[iAc].A.toFixed(2)} Бк`);
ok(g1.after[0][iAc] === 0 && rel(g1.after[0][iRa], ref[iRa].A) < 1e-12, 'после отбора Ac-225 на генераторе нет, Ra-225 остался');
ok(g1.eluate[0].every((a, i) => T.elementOf(sTh[i].name) === 'Ac' || a === 0), 'в элюате только изотопы актиния');

// ---- баланс в момент отбора: до = после + элюат ----
const g2 = T.generator(sTh, A0, { eff: { Ac: 0.9, Ra: 0.05 }, interval: 7 * D, count: 6 });
let bal = 0;
g2.before.forEach((b, k) => b.forEach((v, i) => { bal = Math.max(bal, Math.abs(v - g2.after[k][i] - g2.eluate[k][i]) / (v || 1)); }));
ok(bal < 1e-12, 'баланс при каждом отборе: до = после + элюат');

// ---- полный отбор Ra-225 каждые 14 сут: аналитика двух звеньев ----
const lT = lam('Th-229'), lR = lam('Ra-225'), tau = 14 * D;
const gR = T.generator(sTh, A0, { eff: { Ra: 1 }, interval: tau, count: 12 });
let worst = 0;
for (let k = 0; k < 12; k++) {
  const ATh = 1e6 * Math.exp(-lT * k * tau);
  const exp = ATh * lR / (lR - lT) * (Math.exp(-lT * tau) - Math.exp(-lR * tau));
  worst = Math.max(worst, rel(gR.eluate[k][iRa], exp));
}
ok(worst < 1e-10, `12 отборов Ra-225 по 14 сут совпадают с формулой (макс. отклонение ${worst.toExponential(1)})`);

// ---- неполный отбор (80 %): рекуррентная формула ----
const e = 0.8;
const gP = T.generator(sTh, A0, { eff: { Ra: e }, interval: tau, count: 8, first: 3 * D });
let NR = 0, NTh = 1e6 / lT, t = 0; worst = 0;
for (let k = 0; k < 8; k++) {
  const tk = 3 * D + k * tau, dt = tk - t;
  NR = NR * Math.exp(-lR * dt) + NTh * lT / (lR - lT) * (Math.exp(-lT * dt) - Math.exp(-lR * dt));
  NTh *= Math.exp(-lT * dt);
  const out = e * NR; NR -= out; t = tk;
  worst = Math.max(worst, rel(gP.eluate[k][iRa], lR * out));
}
ok(worst < 1e-10, `отбор 80 %, первый через 3 сут: совпадает с рекуррентной формулой (${worst.toExponential(1)})`);
ok(rel(gP.times[1] - gP.times[0], tau) < 1e-15 && gP.times[0] === 3 * D, 'моменты отборов: первый и интервал');

// ---- без отбора генератор = обычная выдержка ----
const g0 = T.generator(sTh, A0, { eff: {}, interval: 5 * D, count: 4 });
const ref20 = C.calculate(sTh, A0, 20 * D, 2).rows;
ok(g0.final.every((a, i) => rel(a, ref20[i].A) < 1e-9 || Math.abs(a - ref20[i].A) < 1e-9), 'без отбора — то же, что выдержка 20 сут');
ok(g0.eluate.every((row) => row.every((a) => a === 0)), 'без отбора элюат пустой');

// ---- отбор в момент 0 ----
const sAc = C.buildSet(['Ac-225', 'Ac-227'], {});
const gz = T.generator(sAc, { 'Ac-225': 1e6, 'Ac-227': 100 }, { eff: { Ac: 0.5 }, interval: D, count: 1, first: 0 });
ok(rel(gz.eluate[0][idx(sAc, 'Ac-225')], 5e5) < 1e-12 && rel(gz.eluate[0][idx(sAc, 'Ac-227')], 50) < 1e-12, 'отбор в момент 0 забирает долю A₀');

// ---- Th-228: свинец-212 из Ra-224 ----
const s8 = C.buildSet(['Th-228'], {});
const g8 = T.generator(s8, { 'Th-228': 1e7 }, { eff: { Pb: 1 }, interval: 2 * D, count: 1 });
const r8 = C.calculate(s8, { 'Th-228': 1e7 }, 2 * D, 2).rows;
const iPb = idx(s8, 'Pb-212');
ok(rel(g8.eluate[0][iPb], r8[iPb].A) < 1e-12, `Pb-212 из Th-228 через 2 сут: ${g8.eluate[0][iPb].toFixed(0)} Бк`);
ok(g8.eluateN[0][idx(s8, 'Pb-208')] > 0 && g8.eluate[0][idx(s8, 'Pb-208')] === 0, 'стабильный Pb-208 уходит в элюат атомами, активности не даёт');

// ---- график: зубцы на моментах отборов ----
ok(gR.series.t.length === 12 * 41 + 1 && gR.series.t[gR.series.t.length - 1] === 12 * tau, 'точки графика: 40 на интервал + отборы');

// ---- ошибки ввода ----
const err = (f) => { try { f(); return ''; } catch (x) { return x.message; } };
ok(/от 1 до/.test(err(() => T.generator(sTh, A0, { eff: { Ac: 1 }, interval: D, count: 0 }))), 'ноль отборов — понятная ошибка');
ok(/больше нуля/.test(err(() => T.generator(sTh, A0, { eff: { Ac: 1 }, interval: 0, count: 3 }))), 'нулевой интервал — понятная ошибка');

process.exitCode = done('Генератор') ? 1 : 0;
