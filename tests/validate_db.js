/* Проверка базы нуклидов web/nucdb.js: целостность схем распада и сверка с опорными значениями.
 * Запуск: node tests/validate_db.js */
'use strict';
const { C, DB, ok, warn, done } = require('./common');

console.log('База нуклидов');
const names = Object.keys(DB);
ok(names.length > 1000, `в базе ${names.length} нуклидов (ожидается > 1000)`);

for (const n of names) {
  const [T, src, d] = DB[n];
  ok(/^[A-Z][a-z]?-\d{1,3}[mn]?\d?$/.test(n), `${n}: имя в формате "Th-229"`);
  ok(C.normalizeName(n) === n, `${n}: normalizeName возвращает то же имя`);
  ok(['I', 'C', 'S'].includes(src), `${n}: источник I/C/S, а не ${src}`);
  if (T === null) {
    ok(src === 'S' && d.length === 0, `${n}: стабильный без дочерних`);
    continue;
  }
  ok(T > 0 && isFinite(T), `${n}: T½ > 0 (${T})`);
  ok(d.length > 0, `${n}: у радиоактивного есть схема распада`);
  let sum = 0;
  for (const [dn, br, mode] of d) {
    sum += br;
    ok(br > 0 && br <= 1, `${n} → ${dn}: доля в (0, 1] (${br})`);
    ok(dn === 'SF' || DB[dn], `${n} → ${dn}: дочерний есть в базе`);
    ok(typeof mode === 'string' && mode.length > 0, `${n} → ${dn}: указан тип распада`);
    ok(dn !== n, `${n}: не распадается сам в себя`);
  }
  // Сумма долей: допускается погрешность округления исходных оценённых данных (до 10⁻⁴ сверх 1, до 0,1 % недостачи).
  ok(sum <= 1 + 1e-4, `${n}: сумма долей ≤ 1 (${sum})`);
  if (sum > 1 + 1e-9) warn(`${n}: сумма долей ${+sum.toFixed(7)} > 1`);
  ok(sum >= 0.999, `${n}: сумма долей ≥ 0,999 — нет потерянных ветвей (${sum})`);
  try { C.buildSet([n]); } catch (e) { ok(false, `${n}: цепочка строится (${e.message})`); }
}

// Цепочки заказчика (фото, Maple): λ из базы должны совпадать с его значениями в пределах округления.
const customer = {
  'Th-229': 2.78e-12, 'Ra-225': 5.38e-7, 'Ac-225': 8.08e-7, 'Fr-221': 2.35e-3, 'At-217': 2.12e1,
  'Bi-213': 2.53e-4, 'Po-213': 1.87e5, 'Tl-209': 5.34e-3, 'Pb-209': 5.95e-5,
  'Th-228': Math.LN2 / (1.9116 * 365.25 * 86400), 'Ra-224': Math.LN2 / (3.6316 * 86400), 'Rn-220': Math.LN2 / 55.6,
  'Po-216': Math.LN2 / 0.145, 'Pb-212': Math.LN2 / (10.62 * 3600), 'Bi-212': Math.LN2 / (60.55 * 60),
  'Po-212': Math.LN2 / 0.294e-6, 'Tl-208': Math.LN2 / (3.053 * 60),
};
for (const [n, lam] of Object.entries(customer)) {
  const l = C.nuclide(n).lambda;
  ok(Math.abs(l / lam - 1) < 5e-3, `${n}: λ базы ${l.toExponential(4)} совпадает с расчётом заказчика ${lam.toExponential(4)} (±0,5 %)`);
}
// Схемы цепочек заказчика: состав и ветвления Bi-213 и Bi-212 как на фото.
const set = C.buildSet(['Th-229', 'Th-228']).map((x) => x.name);
for (const n of ['Th-229', 'Ra-225', 'Ac-225', 'Fr-221', 'At-217', 'Bi-213', 'Po-213', 'Tl-209', 'Pb-209', 'Bi-209',
  'Th-228', 'Ra-224', 'Rn-220', 'Po-216', 'Pb-212', 'Bi-212', 'Po-212', 'Tl-208', 'Pb-208'])
  ok(set.includes(n), `набор Th-229 + Th-228 содержит ${n}`);
const br = (p, d) => (DB[p][2].find((x) => x[0] === d) || [])[1];
ok(Math.abs(br('Bi-213', 'Po-213') - 0.9786) < 1e-3, 'Bi-213 → Po-213 ≈ 0,9786 (как на фото)');
ok(Math.abs(br('Bi-213', 'Tl-209') - 0.0214) < 1e-3, 'Bi-213 → Tl-209 ≈ 0,0214 (как на фото)');
ok(Math.abs(br('Bi-212', 'Po-212') - 0.6406) < 1e-3, 'Bi-212 → Po-212 ≈ 0,6406 (как на фото)');
ok(Math.abs(br('Bi-212', 'Tl-208') - 0.3594) < 1e-3, 'Bi-212 → Tl-208 ≈ 0,3594 (как на фото)');

// Опорные T½ широко известных нуклидов (IAEA LiveChart / ENSDF), допуск 0,5 %.
const Y = C.units.Y, D = C.units.D, H = C.units.H;
const known = {
  'H-3': 12.32 * Y, 'C-14': 5700 * Y, 'Co-60': 5.2714 * Y, 'Sr-90': 28.91 * Y, 'Y-90': 64.05 * H,
  'Mo-99': 65.924 * H, 'I-131': 8.0252 * D, 'Cs-137': 30.08 * Y, 'Ra-226': 1600 * Y, 'Rn-222': 3.8235 * D,
  'Th-232': 1.40e10 * Y, 'U-235': 7.04e8 * Y, 'U-238': 4.468e9 * Y, 'Pu-239': 24110 * Y, 'Am-241': 432.6 * Y,
  'Po-210': 138.376 * D, 'Ac-225': 9.92 * D, 'Ra-223': 11.43 * D, 'Lu-177': 6.6443 * D, 'F-18': 109.77 * 60,
};
for (const [n, T] of Object.entries(known))
  ok(DB[n] && Math.abs(DB[n][0] / T - 1) < 5e-3, `${n}: T½ ${DB[n] && C.fmtHalfLife(DB[n][0])} ≈ опорному значению`);

process.exitCode = done('База нуклидов') ? 1 : 0;
