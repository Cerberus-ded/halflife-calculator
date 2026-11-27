/* Импорт формул (web/formula-import.js):
 *  - всё, что выдаёт калькулятор (Maple, текст, LaTeX, Python, Excel), загружается обратно: те же изотопы, правки T½,
 *    активности, выдержка и тот же результат;
 *  - код Maple, написанный вручную (как у заказчика: ≔ и →, λ числом и через ln(2)/T½), текст, таблица, Python, LaTeX;
 *  - понятные ошибки с номером строки.
 * Запуск: node tests/check_import.js */
'use strict';
const path = require('path');
const { C, F, P, ok, done, modelFromPreset, rel, WEB } = require('./common');
require(path.join(WEB, 'xlsx.js'));
const I = require(path.join(WEB, 'formula-import.js'));

console.log('Импорт формул: Maple, LaTeX, Python, текст, таблица, Excel');

function sameResult(tag, r, m, tol = 1e-9) {
  const set = C.buildSet(r.roots, r.overrides);
  const res = C.calculate(set, r.activities, r.tSec, 2);
  const scaleA = Math.max(...m.result.rows.map((x) => (x.stable ? 0 : Math.max(x.A, x.A0))));
  let worst = 0;
  for (const x of m.result.rows) {
    const y = res.rows.find((z) => z.name === x.name);
    if (!ok(!!y, `${tag}: в расчёте есть ${x.name}`)) continue;
    if (!x.stable && Math.max(x.A, y.A) > 1e-9 * scaleA) worst = Math.max(worst, rel(x.A, y.A));
  }
  ok(res.rows.length === m.result.rows.length, `${tag}: тот же набор изотопов (${res.rows.length})`);
  ok(worst < tol, `${tag}: тот же результат (отличие ${worst.toExponential(1)})`);
}

(async () => {
  // 1. Обратная загрузка всего, что выдаёт калькулятор
  for (const p of P) {
    const m = modelFromPreset(p, true);
    for (const fmt of ['maple', 'text', 'latex', 'python']) {
      const tag = `${p.id}/${fmt}`;
      const txt = F[fmt](m);
      ok(I.detect(txt, 'x') === fmt, `${tag}: формат узнан`);
      let r;
      try { r = I.parse(txt, 'model'); } catch (e) { ok(false, `${tag}: разбор без ошибок (${e.message})`); continue; }
      ok(JSON.stringify(r.roots) === JSON.stringify(p.roots), `${tag}: родоначальники ${r.roots}`);
      ok(JSON.stringify(Object.keys(r.overrides).sort()) === JSON.stringify(Object.keys(p.overrides || {}).sort()), `${tag}: правки T½ те же`);
      // в тексте числа с 6 значащими цифрами — правки T½ восстанавливаются с той же точностью
      const tol = fmt === 'text' ? 1e-5 : 1e-9;
      for (const [n, o] of Object.entries(p.overrides || {})) ok(r.overrides[n] && rel(r.overrides[n].T, o.T) < tol, `${tag}: правка ${n} (${r.overrides[n] ? rel(r.overrides[n].T, o.T).toExponential(1) : '—'})`);
      for (const [n, a] of Object.entries(p.activities)) if (a > 0) ok(rel(r.activities[n] || 0, a) < 1e-12, `${tag}: A₀ ${n}`);
      ok(r.hold === p.hold && r.holdUnit === p.holdUnit, `${tag}: выдержка ${r.hold} ${r.holdUnit}`);
      ok(r.warnings.length === 0, `${tag}: без замечаний ${r.warnings.join('; ')}`);
      sameResult(tag, r, m, tol);
    }
  }

  // 2. Excel: книга калькулятора (с листом «Формулы» и без), пересжатая deflate (как после сохранения в Excel)
  const p = P.find((x) => x.id === 'customer-th229-th228');
  const m = modelFromPreset(p, true);
  const rows = [['Калькулятор полураспада — результат расчёта'], ['Родоначальники', p.roots.join(', ')], ['Выдержка', m.holdText], ['Выдержка, с', m.tSec], ['Единица активности', 'кБк'], [],
    ['Цепочка', 'Изотоп', 'T½', 'T½, с', 'λ, 1/с', 'Источник T½', 'A₀, кБк', 'N₀, атомов', 'A(t), кБк', 'N(t), атомов']];
  for (const x of m.result.rows) rows.push([x.root, x.name, C.fmtHalfLife(x.T), x.stable ? '' : x.T, x.lambda, '', x.stable ? '' : x.A0 / 1000, x.N0, x.stable ? '' : x.A / 1000, x.N]);
  const books = {
    'с листом «Формулы»': [{ name: 'Результат', rows }, { name: 'Формулы', rows: F.text(m).split('\n').map((l) => [l]) }],
    'только таблица': [{ name: 'Результат', rows }],
  };
  for (const [tag, sheets] of Object.entries(books)) {
    const bytes = new Uint8Array(await globalThis.HLXlsx.build(sheets).arrayBuffer());
    ok(I.detect(bytes) === 'xlsx', `Excel ${tag}: формат узнан`);
    try {
      const r = await I.parseAsync(bytes, 'x.xlsx');
      ok(r.format === 'xlsx' && r.hold === 7 && r.holdUnit === 'd', `Excel ${tag}: выдержка 7 сут`);
      ok(rel(r.activities['Th-229'], 1e6) < 1e-12 && rel(r.activities['Th-228'], 1e4) < 1e-12, `Excel ${tag}: активности в Бк из кБк`);
      sameResult(`Excel ${tag}`, r, m);
    } catch (e) { ok(false, `Excel ${tag}: разбор (${e.message})`); }
  }
  // deflate: пересобираем ZIP со сжатием средствами Node
  {
    const zlib = require('zlib');
    const src = new Uint8Array(await globalThis.HLXlsx.build(books['с листом «Формулы»']).arrayBuffer());
    const out = rezip(src, zlib);
    try {
      const r = await I.parseAsync(out, 'x.xlsx');
      sameResult('Excel deflate', r, m);
    } catch (e) { ok(false, `Excel deflate: разбор (${e.message})`); }
  }

  // 3. Написанное вручную
  const customer = [
    'lTh229 ≔ 2.78E-12;', 'lRa225 ≔ 5.38E-7;', 'lAc225 ≔ 8.08E-7;', 'lFr221 ≔ 2.35E-3;', 'lAt217 ≔ 2.12E1;', 'lBi213 ≔ 2.53E-4;',
    'lPo213 ≔ 1.87E5;', 'lTl209 ≔ 5.34E-3;', 'lPb209 ≔ 5.95E-5;',
    'lTh228 ≔ evalf(ln(2) / (1.9116 * 365.25 * 24 * 3600));', 'lPb212 ≔ evalf(ln(2) / (10.62 * 3600));',
    'EQ ≔', '  diff(NTh229(t), t) = -lTh229*NTh229(t),', '  diff(NRa225(t), t) = -lRa225*NRa225(t) + lTh229*NTh229(t),',
    '  diff(NAc225(t), t) = -lAc225*NAc225(t) + lRa225*NRa225(t),', '  diff(NFr221(t), t) = -lFr221*NFr221(t) + lAc225*NAc225(t),',
    '  diff(NAt217(t), t) = -lAt217*NAt217(t) + lFr221*NFr221(t),', '  diff(NBi213(t), t) = -lBi213*NBi213(t) + lAt217*NAt217(t),',
    '  diff(NPo213(t), t) = -lPo213*NPo213(t) + 0.9786*lBi213*NBi213(t),', '  diff(NTl209(t), t) = -lTl209*NTl209(t) + 0.0214*lBi213*NBi213(t),',
    '  diff(NPb209(t), t) = -lPb209*NPb209(t) + lPo213*NPo213(t) + lTl209*NTl209(t),', '  diff(NBi209(t), t) = lPb209*NPb209(t),',
    '  diff(NTh228(t), t) = -lTh228*NTh228(t),', '  diff(NRa224(t), t) = -lRa224*NRa224(t) + lTh228*NTh228(t);',
    'IC ≔ NTh229(0) = 1000000/lTh229, NTh228(0) = 10000/lTh228:',
    'sol ≔ dsolve({EQ, IC}, numeric, stiff = true, output = listprocedure) :',
    'A_Th229 ≔ t → lTh229*N_Th229(t) :', 'tk ≔ 7*24*3600 :', 'printf("%-8s %16.6e Bq\\n", "Th-229", A_Th229(tk));',
  ].join('\n');
  try {
    const r = I.parse(customer, 'Расчёт.mpl');
    ok(r.format === 'maple', 'Maple заказчика: формат');
    ok(JSON.stringify(r.roots) === '["Th-229","Th-228"]', 'Maple заказчика: родоначальники');
    ok(rel(r.overrides['Th-229'].T, Math.LN2 / 2.78e-12) < 1e-12, 'Maple заказчика: λ Th-229 = 2.78E-12 как в файле');
    ok(rel(r.overrides['Th-228'].T, 1.9116 * 365.25 * 86400) < 1e-12, 'Maple заказчика: T½ Th-228 в юлианских годах');
    ok(rel(r.overrides['Pb-212'].T, 10.62 * 3600) < 1e-12, 'Maple заказчика: T½ Pb-212 = 10.62 ч (в базе 10.622)');
    ok(!r.overrides['Ra-224'], 'Maple заказчика: λ Ra-224 не задана — из базы');
    ok(r.warnings.some((w) => /lRa224/.test(w)), 'Maple заказчика: сказано, что lRa224 взята из базы');
    ok(r.overrides['At-217'] && JSON.stringify(r.overrides['At-217'].d.map((d) => d[0])) === '["Bi-213"]', 'Maple заказчика: At-217 → только Bi-213, как в файле');
    ok(r.warnings.some((w) => /At-217: в файле нет ветви → Rn-217/.test(w)), 'Maple заказчика: замечание о ветви Rn-217');
    ok(r.set.includes('Rn-220') && r.warnings.some((w) => /добавлены по базе/.test(w)), 'Maple заказчика: цепочка Th-228 достроена по базе');
    ok(r.hold === 7 && r.holdUnit === 'd', 'Maple заказчика: выдержка tk = 7 сут');
    ok(r.activities['Th-229'] === 1e6 && r.activities['Th-228'] === 1e4, 'Maple заказчика: активности из N(0) = A/λ');
  } catch (e) { ok(false, 'Maple заказчика: разбор (' + e.message + ')'); }

  const cases = [
    ['текст вручную', 'λ_Cs137 = 7.3e-10 1/с\ndN_Cs137/dt = −λ_Cs137·N_Cs137\nA_Cs137(0) = 37 кБк\nвыдержка 10 лет', (r) =>
      r.format === 'text' && r.activities['Cs-137'] === 37000 && r.hold === 10 && r.holdUnit === 'y' && r.overrides['Cs-137'] && r.set.includes('Ba-137m')],
    ['таблица CSV', 'Изотоп;Активность, Бк\nCs-137;1000\nSr-90;2,5e3\nвыдержка 30 сут', (r) =>
      r.format === 'table' && JSON.stringify(r.roots) === '["Cs-137","Sr-90"]' && r.activities['Sr-90'] === 2500 && r.hold === 30],
    ['вставка из Excel', 'Ac-225\t1 000 000\tБк\nAc-227\t50\tмкКи', (r) =>
      r.format === 'table' && r.activities['Ac-225'] === 1e6 && rel(r.activities['Ac-227'], 50 * 3.7e4) < 1e-12 && r.hold === null],
    ['Python вручную', 'import numpy as np\nday = 86400\nT_half = {"I-131": 8.0252*day, "Xe-131m": 11.84*day, "Xe-131": None}\nbranches = [("I-131", "Xe-131m", 0.0109), ("I-131", "Xe-131", 0.9891), ("Xe-131m", "Xe-131", 1)]\nA0 = {"I-131": 3.7e9}\nt = 14*day  # выдержка 14 сут', (r) =>
      r.format === 'python' && r.activities['I-131'] === 3.7e9 && r.hold === 14 && r.holdUnit === 'd'],
    ['LaTeX вручную', '\\begin{align*}\\lambda_{\\nuc{Sr}{90}} &= \\frac{\\ln 2}{28.91\\cdot 365.2422\\cdot 24\\cdot 3600}\\\\ \\frac{dN_{\\nuc{Sr}{90}}}{dt} &= -\\lambda_{\\nuc{Sr}{90}}\\,N_{\\nuc{Sr}{90}} \\\\ N_{\\nuc{Sr}{90}}(0) &= \\frac{1000}{\\lambda_{\\nuc{Sr}{90}}}\\end{align*} Выдержка: 1 лет', (r) =>
      r.format === 'latex' && r.activities['Sr-90'] === 1000 && r.hold === 1 && r.holdUnit === 'y' && r.set.includes('Y-90')],
    ['Maple: T½ и свои переменные', 'year := 365.25*24*3600:\nT_Ra224 := 3.66*24*3600:\ndiff(NRa224(t),t) = -lRa224*NRa224(t);\nNRa224(0) = 5e5/lRa224;\ntk := 0.5*year:', (r) =>
      r.overrides['Ra-224'] && rel(r.overrides['Ra-224'].T, 3.66 * 86400) < 1e-12 && r.activities['Ra-224'] === 5e5 && rel(r.tSec, 0.5 * 365.25 * 86400) < 1e-12],
  ];
  for (const [tag, txt, check] of cases) {
    try { const r = I.parse(txt, 'x'); ok(check(r), `${tag}: ${JSON.stringify({ roots: r.roots, A: r.activities, hold: [r.hold, r.holdUnit] })}`); } catch (e) { ok(false, `${tag}: разбор (${e.message})`); }
  }

  // 4. Ошибки — с номером строки и понятным текстом
  const errs = [
    ['скобка', 'lTh229 := 1e-12;\nlRa225 := evalf(ln(2)/(14.9*24*3600);\n', /Строка 2: не закрыта скобка/],
    ['нелинейность', 'lTh229 := 1e-12;\ndiff(NTh229(t),t) = -lTh229*NTh229(t)*NTh229(t);', /Строка 2: произведение двух N/],
    ['неизвестный изотоп', 'diff(NXx999(t),t) = -lXx999*NXx999(t);', /не понял, какой это изотоп/],
    ['знак убыли', 'lCs137 := 7.3e-10;\ndiff(NCs137(t),t) = lCs137*NCs137(t);', /убыль записана со знаком «\+»/],
    ['ветви больше 1', 'lBi212 := 1.9e-4;\ndiff(NBi212(t),t) = -lBi212*NBi212(t);\ndiff(NPo212(t),t) = -lPo212*NPo212(t) + 0.7*lBi212*NBi212(t);\ndiff(NTl208(t),t) = -lTl208*NTl208(t) + 0.5*lBi212*NBi212(t);', /сумма долей ветвлений Bi-212 больше 1/],
    ['непонятный текст', 'привет, как дела', /Не удалось узнать формат/, 'заметки.txt'],
    ['пустой .mpl', 'привет, как дела', /не нашлось ни одного изотопа/],
    ['рабочий лист Maple .mw (XML)', '<?xml version="1.0" encoding="UTF-8"?>\n<Worksheet><Text-field><Input>lTh229 := 1e-12;\ndiff(NTh229(t), t) = -lTh229*NTh229(t);</Input></Text-field></Worksheet>', /Maple Input \(\.mpl\)/, 'расчёт.mw'],
    ['XML без расширения .mw', '<?xml version="1.0"?><Worksheet></Worksheet>', /рабочий лист Maple/, 'x.txt'],
  ];
  for (const [tag, txt, re, name] of errs) {
    try { I.parse(txt, name || 'x.mpl'); ok(false, `ошибка «${tag}» не замечена`); } catch (e) { ok(re.test(e.message), `ошибка «${tag}»: ${e.message}`); }
  }
  ok(I.detect('{"format":"halflife-calc","roots":["Th-229"]}') === 'hlc', 'файл .hlc узнаётся и открывается как обычно');

  process.exitCode = done('Импорт формул') ? 1 : 0;
})();

/** Пересобирает ZIP со сжатием deflate (как сохраняет Excel). */
function rezip(src, zlib) {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let eocd = src.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count; k++) {
    const csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = src.subarray(p + 46, p + 46 + nlen);
    const lh = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    entries.push({ name, data: src.subarray(lh, lh + csize), crc: dv.getUint32(p + 16, true) });
    p += 46 + nlen + xlen + clen;
  }
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const comp = zlib.deflateRawSync(e.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(e.crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(e.data.length, 22); h.writeUInt16LE(e.name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(e.name.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, Buffer.from(e.name), comp);
    central.push(c, Buffer.from(e.name));
    offset += 30 + e.name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}
