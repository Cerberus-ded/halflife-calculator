/* Проверка масс нуклидов и пересчёта масса ↔ активность (web/masses.js, web/amount.js).
 * Запуск: node tests/check_mass.js */
'use strict';
const path = require('path');
const { WEB, C, DB, ok, done, rel } = require('./common');
const M = require(path.join(WEB, 'masses.js'));
const AM = require(path.join(WEB, 'amount.js'));

console.log('Масса и удельная активность');
const lam = (n) => Math.LN2 / DB[n][0];

// ---- таблица масс ----
const names = Object.keys(DB);
const noMass = names.filter((n) => !(M[n] > 0));
ok(noMass.length === 0, `масса есть у всех ${names.length} нуклидов базы` + (noMass.length ? ': нет у ' + noMass.slice(0, 5).join(', ') : ''));
let worst = { n: '', d: 0 };
for (const n of names) { const d = Math.abs(M[n] - Number(n.split('-')[1].replace(/\D+$/, ''))); if (d > worst.d) worst = { n, d }; }
ok(worst.d < 0.15, `масса отличается от массового числа не больше чем на 0,15 а. е. м. (максимум у ${worst.n}: ${worst.d.toFixed(4)})`);
for (const [n, ref] of [['H-3', 3.01604928], ['C-14', 14.00324199], ['Co-60', 59.93381554], ['Ra-226', 226.0254082], ['Th-229', 229.0317614], ['U-238', 238.0507869], ['Pu-239', 239.0521616]]) {
  ok(Math.abs(M[n] - ref) < 2e-6, `${n}: ${M[n]} а. е. м. (AME 2020: ${ref})`);
}
ok(M['Tc-99m'] === M['Tc-99'] && M['Pa-234m'] === M['Pa-234'], 'изомеры берут массу основного состояния');
ok(AM.molarMass('Xx-999').exact === false && AM.molarMass('Xx-999').M === 999, 'нет в таблице — массовое число');

// ---- удельная активность (справочные значения, Бк/г) ----
const SA = [['H-3', 3.57e14], ['C-14', 1.65e11], ['Co-60', 4.18e13], ['Ra-226', 3.66e10], ['Pu-239', 2.30e9], ['U-238', 1.24e4], ['Th-229', 7.33e9]];
for (const [n, ref] of SA) {
  const a = AM.specificActivity(n, lam(n));
  ok(rel(a, ref) < 0.006, `удельная активность ${n}: ${a.toExponential(3)} Бк/г (справочно ${ref.toExponential(2)})`);
}
ok(AM.specificActivity('Pb-208', 0) === 0, 'у стабильного удельная активность 0');

// ---- пересчёты ----
const g = AM.gramsFromActivity(3.7e10, 'Ra-226', lam('Ra-226'));
ok(Math.abs(g - 1.0115) < 0.003, `1 Ки Ra-226 ≈ 1,01 г: ${g.toFixed(4)} г`);
ok(rel(AM.activityFromGrams(g, 'Ra-226', lam('Ra-226')), 3.7e10) < 1e-12, 'масса → активность → масса');
ok(rel(AM.atomsFromGrams(AM.gramsFromAtoms(1e18, 'U-238'), 'U-238'), 1e18) < 1e-12, 'атомы → масса → атомы');
ok(rel(AM.gramsFromAtoms(AM.NA, 'C-14'), M['C-14']) < 1e-12, 'моль C-14 весит M граммов');

// ---- единица показа ----
ok(AM.massUnit(2.3e-3).ru === 'мг' && AM.massUnit(5e-7).ru === 'нг' && AM.massUnit(0).ru === 'г' && AM.massUnit(12).ru === 'г' && AM.massUnit(1e-21).ru === 'аг',
  'единица массы для столбца: мг, нг, г, г, аг');

// ---- согласованность с расчётом ----
const set = C.buildSet(['Th-229'], {});
const res = C.calculate(set, { 'Th-229': 1e6 }, 30 * 86400, 2);
const th = res.rows.find((r) => r.name === 'Th-229');
ok(rel(AM.gramsFromAtoms(th.N0, 'Th-229'), 1e6 / AM.specificActivity('Th-229', th.lambda)) < 1e-12, 'масса из N₀ расчёта = A₀ / удельная активность');

process.exitCode = done('Масса') ? 1 : 0;
