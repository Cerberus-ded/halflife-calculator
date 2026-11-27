/* Сценарий «Загрузка и экспорт формул» (Playwright):
 *  - Файл → Экспорт формул… в каждом формате, файл открывается обратно через «Файл → Открыть…»: окно загрузки,
 *    «Загрузить», тот же набор изотопов и тот же результат;
 *  - книга Excel калькулятора (.xlsx) открывается обратно;
 *  - код заказчика (≔, →) перетаскиванием: замечания, ветвление At-217 из файла, метка «из формул» в «Ядерных данных»,
 *    ветвление сохраняется в .hlc и переживает повторное открытие; «Сбросить правки» его убирает;
 *  - ошибка в файле — окно с номером строки, неизвестное расширение — подсказка; «Отмена» ничего не меняет;
 *  - окно загрузки на телефоне не шире экрана.
 * Запуск: node desktop/test/e2e-import.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

const CUSTOMER = [
  'lTh229 ≔ 2.78E-12;', 'lRa225 ≔ 5.38E-7;', 'lAc225 ≔ 8.08E-7;', 'lFr221 ≔ 2.35E-3;', 'lAt217 ≔ 2.12E1;', 'lBi213 ≔ 2.53E-4;',
  'lPo213 ≔ 1.87E5;', 'lTl209 ≔ 5.34E-3;', 'lPb209 ≔ 5.95E-5;',
  'EQ ≔', '  diff(NTh229(t), t) = -lTh229*NTh229(t),', '  diff(NRa225(t), t) = -lRa225*NRa225(t) + lTh229*NTh229(t),',
  '  diff(NAc225(t), t) = -lAc225*NAc225(t) + lRa225*NRa225(t),', '  diff(NFr221(t), t) = -lFr221*NFr221(t) + lAc225*NAc225(t),',
  '  diff(NAt217(t), t) = -lAt217*NAt217(t) + lFr221*NFr221(t),', '  diff(NBi213(t), t) = -lBi213*NBi213(t) + lAt217*NAt217(t),',
  '  diff(NPo213(t), t) = -lPo213*NPo213(t) + 0.9786*lBi213*NBi213(t),', '  diff(NTl209(t), t) = -lTl209*NTl209(t) + 0.0214*lBi213*NBi213(t),',
  '  diff(NPb209(t), t) = -lPb209*NPb209(t) + lPo213*NPo213(t) + lTl209*NTl209(t),', '  diff(NBi209(t), t) = lPb209*NPb209(t);',
  'IC ≔ NTh229(0) = 1000000/lTh229, NRa225(0)=0, NAc225(0)=0:',
  'sol ≔ dsolve({EQ, IC}, numeric, stiff = true, output = listprocedure) :',
  'A_Th229 ≔ t → lTh229*N_Th229(t) :', 'tk ≔ 7*24*3600 :',
].join('\n');

(async () => {
  console.log('Сценарий: загрузка и экспорт формул');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    ctx.setDefaultTimeout(10000);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* нет хранилища */ } });
    await p.reload();
    await p.waitForFunction(() => window.App && window.HLImport);
    // сохранение файлов — в память страницы (как на claude.ai через HLSaveHook)
    await p.evaluate(() => {
      window.__saved = [];
      window.HLSaveHook = async (blob, name) => { window.__saved.push({ name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) }); return true; };
    });
    const lastSaved = async () => { const s = await p.evaluate(() => window.__saved[window.__saved.length - 1]); return s && { name: s.name, buffer: Buffer.from(s.bytes) }; };
    const menu = async (cmd) => {
      const item = p.locator(`[data-cmd="${cmd}"]`);
      await item.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " menu ")][1]').locator('.menu-btn').click();
      await item.click();
    };
    const dlgTitle = () => p.locator('#dlgTitle').innerText();
    const dlgText = () => p.locator('#dlgBody').innerText();
    const open = async (name, buffer) => {
      await p.setInputFiles('#fileInput', { name, mimeType: 'application/octet-stream', buffer });
      await p.waitForSelector('#dlg[open]');
    };
    const snap = () => p.evaluate(() => App.snapshot());
    const sameResult = (a, c) => {
      if (!a.result || !c.result || a.result.length !== c.result.length) return Infinity;
      let w = 0;
      const scale = Math.max(...a.result.map((x) => x.A0 || 0), ...a.result.map((x) => x.A || 0));
      for (const x of a.result) { const y = c.result.find((z) => z.name === x.name); if (!y) return Infinity; if (Math.max(x.A, y.A) > 1e-9 * scale) w = Math.max(w, rel(x.A, y.A)); }
      return w;
    };

    // 1. пример заказчика → расчёт → экспорт формул в каждом формате → открыть обратно
    await p.locator('.menu-btn', { hasText: 'Примеры' }).click();
    await p.click('#presetMenu [data-preset="customer-th229-th228"]');
    await p.click('#calcBtn');
    const ref = await snap();
    check(ref.result && ref.result.length === ref.set.length, `пример заказчика посчитан: ${ref.set.length} изотопов`);
    for (const [fmt, ext, label] of [['maple', '.mpl', 'Maple'], ['latex', '.tex', 'LaTeX'], ['python', '.py', 'Python'], ['text', '.txt', 'Текст']]) {
      const n0 = await p.evaluate(() => window.__saved.length);
      await menu('exportFormulas');
      check(await dlgTitle() === 'Экспорт формул', `${label}: окно «Экспорт формул»`);
      await p.click(`#dlg button[value="${fmt}"]`);
      await p.waitForFunction((n) => window.__saved.length > n, n0);
      const f = await lastSaved();
      check(f && f.name.endsWith(ext), `${label}: сохранён файл ${f && f.name}`);
      await open(f.name, f.buffer);
      if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
      check(await dlgTitle() === 'Загрузка формул', `${label}: окно «Загрузка формул»`);
      const t = await dlgText();
      check(new RegExp(label === 'Текст' ? 'текст формул' : label, 'i').test(t) && /Th-229, Th-228/.test(t) && /7\s+сут/.test(t), `${label}: формат, родоначальники и выдержка в окне`);
      check(await p.locator('#dlgBody .import-table tbody tr:not(.chain)').count() === ref.set.length, `${label}: в окне все ${ref.set.length} изотопов`);
      check(await p.locator('#dlgBody .import-table td.t12.overridden').count() >= 3, `${label}: правки T½ заказчика помечены «из файла»`);
      await p.click('#dlg button[value="ok"]');
      await p.waitForTimeout(100);
      const s = await snap();
      const w = sameResult(ref, s);
      check(JSON.stringify(s.set) === JSON.stringify(ref.set) && w < (fmt === 'text' ? 1e-5 : 1e-9), `${label}: тот же набор и результат (отличие ${w.toExponential(1)})`);
      check(s.dirty && s.name === f.name.replace(/\.\w+$/, ''), `${label}: документ «${s.name}», не сохранён`);
      await p.click('#editBtn').catch(() => {});
    }

    // 2. Excel калькулятора → открыть обратно (снова исходный пример: текст выше загружен с 6 знаками)
    await p.locator('.menu-btn', { hasText: 'Примеры' }).click();
    await p.click('#presetMenu [data-preset="customer-th229-th228"]');
    if (await p.locator('#dlg[open]').count()) await p.click('#dlg button[value="discard"]');
    await p.click('#calcBtn');
    await menu('export');
    await p.waitForFunction(() => window.__saved.some((x) => /\.xlsx$/.test(x.name)));
    const xl = await lastSaved();
    await open(xl.name, xl.buffer);
    if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
    check(await dlgTitle() === 'Загрузка формул' && /Excel/.test(await dlgText()), 'Excel: окно загрузки, формат Excel');
    await p.click('#dlg button[value="ok"]');
    await p.waitForTimeout(100);
    { const s = await snap(); const w = sameResult(ref, s); check(w < 1e-9, `Excel: тот же результат (отличие ${w.toExponential(1)})`); }

    // 3. «Отмена» ничего не меняет
    const before = await p.evaluate(() => App.serialize().replace(/"saved": "[^"]+"/, ''));
    await open('a.csv', Buffer.from('Изотоп;Активность, Бк\nCs-137;1000'));
    if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
    check(await dlgTitle() === 'Загрузка формул' && /таблица/i.test(await dlgText()), 'CSV: окно загрузки');
    await p.click('#dlg button[value="cancel"]');
    check(await p.evaluate(() => App.serialize().replace(/"saved": "[^"]+"/, '')) === before, '«Отмена» — расчёт не изменился');

    // 4. код заказчика перетаскиванием
    await p.evaluate(() => { const n = document.querySelector('#dirty'); if (n) n.hidden = true; });
    const drop = (name, text) => p.evaluate(([name, text]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], name, { type: 'text/plain' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [name, text]);
    await drop('Расчёт заказчика.mpl', CUSTOMER);
    await p.waitForSelector('#dlg[open]');
    if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
    const t4 = await dlgText();
    check(await dlgTitle() === 'Загрузка формул' && /Maple/.test(t4), 'Maple перетаскиванием: окно загрузки');
    check(/At-217: в файле нет ветви → Rn-217/.test(t4), 'замечание: в файле нет ветви At-217 → Rn-217');
    check(/Выдержка: 7\s+сут/.test(t4), 'выдержка tk = 7 сут');
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'import-dialog.png') });
    await p.click('#dlg button[value="ok"]');
    await p.waitForTimeout(100);
    const s4 = await snap();
    check(s4.roots.join() === 'Th-229' && !s4.set.includes('Rn-217') && s4.result, `загружено: ${s4.roots.join(', ')}, ${s4.set.length} изотопов, посчитано`);
    const A0 = s4.result.find((x) => x.name === 'Th-229').A0;
    check(rel(A0, 1e6) < 1e-12, `A₀ Th-229 = 1e6 Бк из N(0) = 1000000/λ (${A0})`);
    // ветвление из файла: «Ядерные данные» и файл .hlc
    await menu('data');
    check(/из формул/.test(await p.locator('#dlgBody').innerText()), '«Ядерные данные»: ветвление At-217 помечено «из формул»');
    await p.click('#dlg button[value="ok"]');
    const hlc = await p.evaluate(() => App.serialize());
    const d = JSON.parse(hlc);
    check(d.overrides['At-217'] && d.overrides['At-217'].d && d.overrides['At-217'].d[0][0] === 'Bi-213', 'в .hlc сохранено ветвление At-217 → Bi-213');
    await p.evaluate((t) => App.loadText(t, 'повтор.hlc', {}), hlc);
    check(!(await snap()).set.includes('Rn-217'), '.hlc открыт повторно — ветвление осталось');
    await menu('resetOverrides');
    check(/ветвления распада/.test(await dlgText()), '«Сбросить правки» упоминает ветвления');
    await p.click('#dlg button[value="ok"]');
    await p.waitForTimeout(50);
    check((await snap()).set.includes('Rn-217'), 'после сброса — ветвь Rn-217 по базе вернулась');

    // 5. ошибки
    await open('ошибка.mpl', Buffer.from('lTh229 := 1e-12;\nlRa225 := evalf(ln(2)/(14.9*24*3600);\n'));
    if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
    check(await dlgTitle() === 'Не удалось загрузить формулы' && /Строка 2: не закрыта скобка/.test(await dlgText()), 'ошибка в файле — с номером строки: ' + (await dlgText()).slice(0, 80));
    await p.click('#dlg button[value="ok"]');
    await drop('картинка.png', 'x');
    await p.waitForSelector('#dlg[open]');
    check(/\.mpl/.test(await dlgText()) && /\.xlsx/.test(await dlgText()), 'неизвестное расширение — подсказка, что можно открыть');
    await p.click('#dlg button[value="ok"]');

    // 6. меню: «Открыть…» подсказывает форматы, «Экспорт формул…» один
    check(await p.locator('[data-cmd="exportFormulas"]').count() === 1, 'в меню один пункт «Экспорт формул…»');
    check(/Maple/.test(await p.getAttribute('[data-cmd="open"]', 'title')), '«Открыть…»: подсказка о формулах');
    check(/\.mpl/.test(await p.getAttribute('#fileInput', 'accept')), 'выбор файла принимает .mpl и другие форматы');

    // 7. телефон: окно загрузки не шире экрана
    await p.setViewportSize({ width: 390, height: 844 });
    await drop('Расчёт заказчика.mpl', CUSTOMER);
    await p.waitForSelector('#dlg[open]');
    if (await dlgTitle() === 'Несохранённые изменения') { await p.click('#dlg button[value="discard"]'); await p.waitForSelector('#dlg[open]'); }
    const ph = await p.evaluate(() => ({ r: document.getElementById('dlg').getBoundingClientRect().right, vw: innerWidth, sw: document.documentElement.scrollWidth }));
    check(ph.r <= ph.vw + 0.5 && ph.sw <= ph.vw, `на телефоне окно загрузки в пределах экрана (${Math.round(ph.r)} из ${ph.vw})`);
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'import-phone.png') });
    await p.click('#dlg button[value="cancel"]');

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Загрузка и экспорт формул: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
