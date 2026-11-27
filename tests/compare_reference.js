/* Сверка расчётного ядра (web/core.js) с независимым решением в 50 знаков (tests/reference.py, mpmath expm)
 * на всех примерах и дополнительных цепочках, на нескольких моментах времени.
 * Запуск: node tests/compare_reference.js   (нужны python3 и mpmath: pip install mpmath) */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { C, P, UNITS, ok, warn, done, rel } = require('./common');

const TOL = 1e-7;      // допустимое относительное расхождение
const FLOOR = 1e-10;   // значения меньше FLOOR·max по набору не сравниваются (численно пренебрежимы)

console.log('Сверка ядра с эталоном mpmath');
const cases = [];
function addCase(id, roots, A0, tSec, overrides) {
  const set = C.buildSet(roots, overrides);
  for (const f of [1e-6, 0.1, 1]) {
    const t = tSec * f;
    cases.push({ id: `${id} @ ${f === 1 ? 't' : f + '·t'}`, set, A0, t, roots, overrides });
  }
}
for (const p of P) addCase(p.id, p.roots, p.activities, p.hold * UNITS[p.holdUnit], p.overrides);
const Y = C.units.Y, D = C.units.D;
addCase('Th-229+Th-228 (данные IAEA)', ['Th-229', 'Th-228'], { 'Th-229': 1e6, 'Th-228': 1e6, 'Ra-224': 5e5, 'Bi-213': 1e4 }, 7 * D);
addCase('U-235', ['U-235'], { 'U-235': 1e4 }, 1e6 * Y);
addCase('Np-237', ['Np-237'], { 'Np-237': 1e4 }, 1e7 * Y);
addCase('Cf-252 (SF)', ['Cf-252'], { 'Cf-252': 1e6 }, 100 * Y);
addCase('Pu-241 + Am-241', ['Pu-241'], { 'Pu-241': 1e6, 'Am-241': 1e4 }, 50 * Y);
addCase('Ac-225 (с примесями в дочерних)', ['Ac-225'], { 'Ac-225': 1e6, 'Bi-213': 3e5, 'Pb-209': 1e5 }, 1 * D);

const input = {
  cases: cases.map((c) => ({
    id: c.id, t: c.t, A0: c.A0,
    nuclides: c.set.map((x) => ({ name: x.name, lambda: x.lambda, daughters: x.daughters.map((d) => [d.name, d.br]) })),
  })),
};
let ref;
try {
  ref = JSON.parse(execFileSync('python3', [path.join(__dirname, 'reference.py')],
    { input: JSON.stringify(input), maxBuffer: 1 << 26, encoding: 'utf8' }));
} catch (e) {
  console.log('  ! эталон не посчитан (нужны python3 и mpmath: pip install mpmath): ' + e.message.split('\n')[0]);
  process.exitCode = 1;
  return;
}
let worst = { d: 0 };
for (const c of cases) {
  const r = C.calculate(c.set, c.A0, c.t, 2).rows;
  const maxA = Math.max(...r.map((x) => (x.stable ? 0 : x.A)), ...c.set.map((x) => Number(c.A0[x.name]) || 0));
  const maxN = Math.max(...r.map((x) => x.N), ...c.set.map((x, i) => (x.lambda > 0 ? (Number(c.A0[x.name]) || 0) / x.lambda : 0)));
  for (const x of r) {
    const mine = x.stable ? x.N : x.A;
    const exp = ref[c.id][x.name];
    const scale = x.stable ? maxN : maxA;
    if (Math.max(Math.abs(mine), Math.abs(exp)) < FLOOR * scale) continue;
    const d = rel(mine, exp);
    if (d > worst.d) worst = { d, where: `${c.id}, ${x.name}` };
    ok(d < TOL, `${c.id}: ${x.name} программа ${mine.toExponential(9)}, эталон ${exp.toExponential(9)} (отн. ${d.toExponential(1)})`);
  }
}
console.log(`  наборов ${cases.length}; худшее расхождение ${worst.d.toExponential(2)}${worst.where ? ' (' + worst.where + ')' : ''}`);
if (worst.d > 1e-9) warn(`худшее расхождение ${worst.d.toExponential(2)} больше 1e-9`);
process.exitCode = done('Сверка с эталоном') ? 1 : 0;
