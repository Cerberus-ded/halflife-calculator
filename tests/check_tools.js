/* Проверка web/tools.js: чистота, подбор выдержки, погрешность, разбор выгрузки IAEA, протокол .docx.
 * Запуск: node tests/check_tools.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { WEB, C, DB, ok, done, rel } = require('./common');
require(path.join(WEB, 'xlsx.js'));
const T = require(path.join(WEB, 'tools.js'));

(async () => {
  console.log('Дополнительные расчёты (tools.js)');
  const D = 86400;
  const lam = (n) => Math.LN2 / DB[n][0];

  // ---- чистота ----
  const set = C.buildSet(['Ac-225', 'Ac-227'], {});
  const A0 = { 'Ac-225': 1e6, 'Ac-227': 100 };
  const p0 = T.purityAt(set, A0, 0, 'Ac-225', false);
  ok(rel(p0.purity, 1e6 / (1e6 + 100)) < 1e-12, `чистота при t=0: ${p0.purity}`);
  const t10 = 10 * D;
  const p10 = T.purityAt(set, A0, t10, 'Ac-225', false);
  const a227 = T.evaluator(set, { 'Ac-227': 100 })(t10).reduce((s, v) => s + v, 0);
  const a225 = T.evaluator(set, A0)(t10)[set.findIndex((x) => x.name === 'Ac-225')];
  ok(rel(p10.purity, a225 / (a225 + a227)) < 1e-9, `чистота через 10 сут без дочерних цели: ${p10.purity}`);
  const p10all = T.purityAt(set, A0, t10, 'Ac-225', true);
  ok(p10all.purity < 0.3, `чистота с дочерними цели как примесями мала: ${p10all.purity}`);
  ok(T.purityAt(set, A0, t10, 'Bi-209', false) === null, 'стабильный изотоп не может быть целью');

  // ---- подбор выдержки ----
  const sRa = C.buildSet(['Ra-225'], {});
  const m = T.findHold(sRa, { 'Ra-225': 1 }, { type: 'max', name: 'Ac-225' });
  const l1 = lam('Ra-225'), l2 = lam('Ac-225');
  const tmax = Math.log(l2 / l1) / (l2 - l1);
  ok(m.found && rel(m.t, tmax) < 1e-6, `максимум Ac-225 из Ra-225: ${(m.t / D).toFixed(4)} сут (точно ${(tmax / D).toFixed(4)})`);
  const sR4 = C.buildSet(['Ra-224'], {});
  const le = T.findHold(sR4, { 'Ra-224': 1e6 }, { type: 'le', name: 'Ra-224', value: 1e3 });
  const tle = DB['Ra-224'][0] * Math.log(1000) / Math.LN2;
  ok(le.found && rel(le.t, tle) < 1e-8, `спад Ra-224 в 1000 раз: ${(le.t / D).toFixed(5)} сут (точно ${(tle / D).toFixed(5)})`);
  const sTh = C.buildSet(['Th-229'], {});
  const ge = T.findHold(sTh, { 'Th-229': 1e6 }, { type: 'ge', name: 'Ra-225', value: 5e5 });
  const ev = T.evaluator(sTh, { 'Th-229': 1e6 });
  const iRa = sTh.findIndex((x) => x.name === 'Ra-225');
  ok(ge.found && rel(ev(ge.t)[iRa], 5e5) < 1e-8 && ev(ge.t * (1 - 1e-6))[iRa] < 5e5, `накопление Ra-225 до 5E5 Бк: ${(ge.t / D).toFixed(4)} сут`);
  ok(rel(ge.t, DB['Ra-225'][0]) < 1e-3, 'накопление до половины ≈ один T½(Ra-225)');
  const pu = T.findHold(set, A0, { type: 'purity', name: 'Ac-225', value: 0.999 });
  ok(pu.found && pu.already && isFinite(pu.until) && rel(T.purityAt(set, A0, pu.until, 'Ac-225', false).purity, 0.999) < 1e-9,
    `чистота Ac-225 ≥ 99,9 % держится до ${(pu.until / D).toFixed(3)} сут`);
  const no = T.findHold(sTh, { 'Th-229': 1e6 }, { type: 'le', name: 'Ra-225', value: 1 });
  ok(no.found && rel(no.t, DB['Th-229'][0] * Math.log2(1e6)) < 1e-3, `спад Ra-225 до 1 Бк — только вместе с Th-229: ${(no.t / C.units.Y).toFixed(0)} лет`);
  const dec = T.findHold(sR4, { 'Ra-224': 1e6 }, { type: 'max', name: 'Ra-224' });
  ok(!dec.found && /убывает/.test(dec.reason), 'у чистого распада максимума нет');

  // ---- погрешность ----
  const u1 = T.uncertainty(sR4, { 'Ra-224': 1e6 }, [0, 3 * DB['Ra-224'][0]], { uA: 0.05, uT: 0, n: 4000 });
  const iR4 = sR4.findIndex((x) => x.name === 'Ra-224');
  ok(Math.abs(u1.A[0][iR4].rel / (1.96 * 0.05) - 1) < 0.06, `±A₀ 5 % → ±${(u1.A[0][iR4].rel * 100).toFixed(2)} % (ожидается ≈9,8 %)`);
  const u2 = T.uncertainty(sR4, { 'Ra-224': 1e6 }, [3 * DB['Ra-224'][0]], { uA: 0, uT: 0.02, n: 4000 });
  const exp2 = 1.96 * 0.02 * 3 * Math.LN2;
  ok(Math.abs(u2.A[0][iR4].rel / exp2 - 1) < 0.1, `±T½ 2 % через 3 T½ → ±${(u2.A[0][iR4].rel * 100).toFixed(2)} % (≈${(exp2 * 100).toFixed(2)} %)`);
  const u3 = T.uncertainty(set, A0, [t10], { uA: 0.05, uT: 0.01, n: 1000, target: 'Ac-225' });
  ok(u3.purity && u3.purity[0].lo < p10.purity && u3.purity[0].hi > p10.purity, 'интервал чистоты накрывает номинал');

  // ---- выгрузка IAEA ----
  const csv = 'z,n,symbol,radius,unc_r,abundance,unc_a,energy_shift,energy,unc_e,ripl_shift,jp,half_life,operator_hl,unc_hl,unit_hl,half_life_sec,unc_hls,decay_1,decay_1_%,unc_1\n' +
    '90,139,Th,,,,,,0,,,"5/2+",7880,,120,y,2.48E11,,A,100,\n' +
    '88,137,Ra,,,,,,0,,,"(1/2,3/2)+",14.9,,0.2,d,1287360,,B-,100,\n' +
    '89,136,Ac,,,,,,0,,,3/2-,9.95,,0.03,d,859680,,A,100,\n' +
    '83,126,Bi,,,,,,0,,,9/2-,2.01E+19,,0.08E+19,y,6.3E26,,A,100,\n' +
    '82,126,Pb,,,52.4,,,0,,,0+,STABLE,,,,,,,,\n';
  const parsed = T.parseIaeaCsv(csv);
  const th = parsed.items.find((x) => x.name === 'Th-229');
  ok(parsed.items.length === 4 && th && rel(th.T, 7880 * C.units.Y) < 1e-12 && rel(th.u, 120 / 7880) < 1e-12, 'выгрузка IAEA разобрана (кавычки, единицы, погрешность)');
  const up = T.applyIaea(DB, parsed);
  ok(up.same >= 2 && up.changes.length === 1 && up.changes[0].name === 'Ac-225', `обновление: без изменений ${up.same}, изменён ${up.changes.map((c) => c.name).join(', ')}`);
  ok(!up.changes.some((c) => c.name === 'Bi-209'), 'стабильный в базе Bi-209 не получает период из выгрузки');
  let bad = ''; try { T.parseIaeaCsv('a,b\n1,2'); } catch (e) { bad = e.message; }
  ok(/не выгрузка IAEA/.test(bad), 'чужой CSV отклоняется с понятным сообщением');

  // ---- протокол .docx ----
  const blob = T.docx([{ h1: 'Протокол расчёта' }, { p: 'Выдержка: 7 сут' }, { table: [['Изотоп', 'A, Бк'], ['Th-229', '1E6'], ['Ra-225 & <x>', '2']], header: true, alignRight: [1] }, { mono: 'N(t) = ...\nвторая строка' }], { title: 'Тест' });
  const file = path.join(os.tmpdir(), 'hl-test-protocol.docx');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const py = spawnSync('python3', ['-c', `import zipfile,sys,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); n=z.namelist()
for k in n:
  if k.endswith('.xml') or k.endswith('.rels'): m.parseString(z.read(k))
d=z.read('word/document.xml').decode()
print('OK' if 'word/document.xml' in n and 'Ra-225 &amp; &lt;x&gt;' in d and 'Протокол расчёта' in d else 'BAD')`, file], { encoding: 'utf8' });
  ok(py.stdout.trim() === 'OK', '.docx: корректный ZIP и XML ' + (py.stderr || '').trim().slice(0, 200));

  process.exitCode = done('Дополнительные расчёты') ? 1 : 0;
})();
