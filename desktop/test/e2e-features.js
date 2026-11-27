/* Сценарии удобств (Playwright): единицы активности, «Ещё сроки», выдержка по датам, файл, Excel.
 * Запуск: node desktop/test/e2e-features.js [папка для скриншотов]. Компьютер 1280 px (светлая) и телефон 390 px (тёмная). */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch();
  for (const [vw, vh, tag, scheme] of [[1280, 860, 'desk', 'light'], [390, 844, 'phone', 'dark']]) {
    const p = await b.newPage({ viewport: { width: vw, height: vh }, colorScheme: scheme });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); // блоки «Дополнительно» раскрыты
    await p.evaluate(() => { window.__saved = []; window.HLSaveHook = async (blob, name) => { window.__saved.push({ name, blob }); return true; }; });
    // единица МБк, Th-229 = 1 МБк, Ra-224 = 0,02 МБк
    await p.selectOption('#actUnit', 'MBq');
    check((await p.textContent('#a0Head')) === 'A₀, МБк', tag + ': заголовок A₀ в МБк');
    await p.fill('#inputTable input[data-name="Th-229"]', '1');
    await p.fill('#inputTable input[data-name="Ra-224"]', '0,02');
    await p.fill('#holdExtra', '1; 14, 30');
    await p.click('#calcBtn'); await p.waitForTimeout(300);
    const snap = await p.evaluate(() => App.snapshot());
    const th = snap.result.find((x) => x.name === 'Th-229');
    check(Math.abs(th.A0 - 1e6) < 1e-6, tag + ': ядро получило 1e6 Бк');
    const title = await p.textContent('#resultTitle');
    check(title === 'Результат через 1; 7; 14; 30 сут', tag + ': заголовок ' + title);
    const heads = await p.$$eval('#resultTable thead th', (a) => a.map((x) => x.textContent));
    check(heads.join('|') === 'Изотоп|A₀, МБк|A(1 сут), МБк|A(7 сут), МБк|A(14 сут), МБк|A(30 сут), МБк|N(7 сут), атомов', tag + ': колонки ' + heads.join('|'));
    const ra225 = await p.$$eval('#resultTable tbody tr', (rows) => { const r = rows.find((x) => x.querySelector('.iso') && x.querySelector('.iso').textContent === 'Ra-225'); return Array.from(r.querySelectorAll('td.num')).map((td) => td.textContent); });
    // Ra-225 от 1 МБк Th-229: 1 - exp(-ln2*t/14.9)
    const exp = [1, 7, 14, 30].map((t) => 1 - Math.exp(-Math.LN2 * t / 14.9));
    const got = ra225.slice(1, 5).map((s) => Number(s.replace(/\s/g, '').replace(',', '.').replace('E', 'e')));
    check(got.every((g, i) => Math.abs(g - exp[i]) / exp[i] < 2e-3), tag + ': Ra-225 по срокам ' + got.join(' / '));
    if (OUT) await p.screenshot({ path: `${OUT}/feat-${tag}-result.png`, fullPage: tag === 'phone' });
    await p.click('[data-tab=chart]'); await p.waitForTimeout(200);
    const note = await p.textContent('#tp-chart .toolbar-note');
    check(note.includes('МБк'), tag + ': подпись графика ' + note);
    if (OUT) await p.screenshot({ path: `${OUT}/feat-${tag}-chart.png` });
    // Excel
    await p.click('[data-tab=result]');
    await p.click('#exportBtn'); await p.waitForTimeout(300);
    const xl = await p.evaluate(async () => { const s = window.__saved.pop(); return { name: s.name, size: s.blob.size }; });
    check(xl.name.endsWith('.xlsx') && xl.size > 1000, tag + ': Excel ' + xl.name + ' ' + xl.size);
    // разблокировать, даты
    await p.click('#editBtn');
    await p.click('#holdDatesBtn'); await p.waitForTimeout(200);
    await p.fill('#dateFrom', '2026-12-01T10:00');
    await p.fill('#dateTo', '2026-12-08T22:00');
    const prev = await p.textContent('#dateResult');
    check(prev === 'Выдержка: 7 сут 12 ч', tag + ': подсказка ' + prev);
    if (OUT) await p.screenshot({ path: `${OUT}/feat-${tag}-dates.png` });
    await p.click('#dlg .dlg-foot button.primary'); await p.waitForTimeout(200);
    check((await p.inputValue('#hold')) === '7,5', tag + ': выдержка 7,5 сут по датам, есть ' + (await p.inputValue('#hold')));
    check(!(await p.isHidden('#holdDates')), tag + ': строка с датами видна');
    await p.selectOption('#holdUnit', 'h');
    check((await p.inputValue('#hold')) === '180', tag + ': в часах 180, есть ' + (await p.inputValue('#hold')));
    // файл
    const data = JSON.parse(await p.evaluate(() => App.serialize()));
    check(data.actUnit === 'MBq' && data.dates && data.dates.from === '2026-12-01T10:00' && JSON.stringify(data.holdExtra) === '[1,14,30]', tag + ': файл хранит единицу, даты, сроки');
    await p.evaluate((t) => App.loadText(t, 'x.hlc'), JSON.stringify(data));
    check((await p.inputValue('#actUnit')) === 'MBq' && (await p.inputValue('#holdExtra')) === '1; 14; 30' && !(await p.isHidden('#holdDates')), tag + ': файл открывается обратно');
    // ручная правка выдержки снимает даты
    await p.fill('#hold', '5');
    check(await p.isHidden('#holdDates'), tag + ': ручная выдержка убирает даты');
    // неверные сроки
    await p.fill('#holdExtra', '1; abc');
    await p.click('#calcBtn');
    check((await p.textContent('#error')).includes('дополнительные сроки'), tag + ': ошибка в сроках');
    await p.fill('#holdExtra', '');
    await p.click('#calcBtn'); await p.waitForTimeout(200);
    const heads2 = await p.$$eval('#resultTable thead th', (a) => a.map((x) => x.textContent));
    check(heads2.join('|') === 'Изотоп|A₀, МБк|A(t), МБк|N(t), атомов', tag + ': один срок — прежние колонки');
    if (OUT) await p.screenshot({ path: `${OUT}/feat-${tag}-input.png`, fullPage: tag === 'phone' });
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!ov, tag + ': нет горизонтальной прокрутки страницы');
    check(errs.length === 0, tag + ': ошибок JS нет ' + errs.join('; '));
    await p.close();
  }
  await b.close();
  console.log(fails ? `Итог удобств: не пройдено ${fails}` : 'Итог удобств: все проверки пройдены');
  process.exitCode = fails ? 1 : 0;
})();
