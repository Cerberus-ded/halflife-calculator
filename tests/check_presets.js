/* Проверка примеров web/presets.js и текстов web/help.js. Запуск: node tests/check_presets.js */
'use strict';
const { C, P, H, DB, UNITS, ok, done } = require('./common');

console.log('Примеры и справка');
ok(Array.isArray(P) && P.length >= 6 && P.length <= 12, `примеров ${P.length} (ожидается 6–12)`);
const ids = new Set();
for (const p of P) {
  const tag = `пример «${p.title}»`;
  ok(typeof p.id === 'string' && /^[a-z0-9-]+$/.test(p.id) && !ids.has(p.id), `${tag}: уникальный id ${p.id}`);
  ids.add(p.id);
  ok(typeof p.title === 'string' && p.title.length > 3, `${tag}: есть заголовок`);
  ok(typeof p.description === 'string' && p.description.length > 20, `${tag}: есть описание`);
  ok(Array.isArray(p.roots) && p.roots.length > 0, `${tag}: есть родоначальники`);
  for (const r of p.roots) ok(DB[r] && DB[r][0] !== null, `${tag}: родоначальник ${r} есть в базе и радиоактивен`);
  ok(p.hold > 0 && UNITS[p.holdUnit], `${tag}: выдержка ${p.hold} ${p.holdUnit}`);
  for (const [n, o] of Object.entries(p.overrides || {}))
    ok(DB[n] && o.T > 0 && isFinite(o.T), `${tag}: правка T½ для ${n} корректна`);
  let set;
  try { set = C.buildSet(p.roots, p.overrides); } catch (e) { ok(false, `${tag}: набор строится (${e.message})`); continue; }
  const inSet = new Map(set.map((x) => [x.name, x]));
  for (const [n, a] of Object.entries(p.activities)) {
    ok(inSet.has(n), `${tag}: активность задана для ${n} из набора`);
    ok(inSet.has(n) && inSet.get(n).lambda > 0, `${tag}: ${n} радиоактивен (у стабильных ввода нет)`);
    ok(typeof a === 'number' && a > 0 && isFinite(a), `${tag}: A₀(${n}) = ${a} Бк > 0`);
  }
  for (const n of Object.keys(p.overrides || {})) ok(inSet.has(n), `${tag}: правка T½ для ${n} из набора`);
  const r = C.calculate(set, p.activities, p.hold * UNITS[p.holdUnit], 50);
  ok(r.rows.every((x) => isFinite(x.A) && x.A >= 0 && isFinite(x.N) && x.N >= 0), `${tag}: результат конечный и неотрицательный`);
  ok(r.rows.some((x) => x.A > 0), `${tag}: результат не нулевой`);
  ok(r.series.A.every((row) => row.every((v) => isFinite(v) && v >= 0)), `${tag}: ряд для графика корректен`);
}

// Пример заказчика: λ — ровно как на фото.
const cust = P.find((p) => p.id === 'customer-th229-th228');
if (ok(cust, 'есть пример «Th-229 + Th-228 (как в расчётах заказчика)»')) {
  const photo = { 'Th-229': 2.78e-12, 'Ra-225': 5.38e-7, 'Ac-225': 8.08e-7, 'Fr-221': 2.35e-3, 'At-217': 21.2,
    'Bi-213': 2.53e-4, 'Po-213': 1.87e5, 'Tl-209': 5.34e-3, 'Pb-209': 5.95e-5 };
  for (const [n, l] of Object.entries(photo))
    ok(Math.abs(C.nuclide(n, cust.overrides).lambda / l - 1) < 1e-12, `заказчик: λ(${n}) = ${l} как на фото`);
  ok(Math.abs(cust.overrides['Th-228'].T - 1.9116 * 365.25 * 86400) < 1e-3, 'заказчик: T½(Th-228) = 1,9116·365,25 сут');
  ok(cust.hold === 7 && cust.holdUnit === 'd', 'заказчик: выдержка 7 сут');
}

// Справка
for (const k of ['guide', 'about', 'dataNotes']) {
  ok(typeof H[k] === 'string' && H[k].length > 200, `HLHelp.${k}: текст есть`);
  ok(!/undefined|NaN|\$\{/.test(H[k] || ''), `HLHelp.${k}: нет незаполненных подстановок`);
  const open = ((H[k] || '').match(/<(ol|ul|li|table|tr|td|p|h3)\b/g) || []).length;
  const close = ((H[k] || '').match(/<\/(ol|ul|li|table|tr|td|p|h3)>/g) || []).length;
  ok(open === close, `HLHelp.${k}: теги сбалансированы (${open}/${close})`);
}
ok(/\d/.test(H.about) && H.about.includes(String(Object.keys(DB).length).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')),
  'HLHelp.about: число нуклидов совпадает с базой');

process.exitCode = done('Примеры и справка') ? 1 : 0;
