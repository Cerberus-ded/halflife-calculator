/* Сквозная проверка веб-версии в Chromium (Playwright).
 * Запуск: node desktop/test/e2e-web.js [путь к папке web] [папка для скриншотов и скачанных файлов]
 * Проверяет: пример Th-229 + Th-228, блокировку ввода, совпадение таблицы с HLCore, график, формулы,
 * сохранение/открытие .hlc, экспорт .xlsx, правку T½, добавление/удаление цепочек, примеры, горячие клавиши,
 * мобильную ширину и тёмную тему, офлайн-режим через service worker.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const WEB = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'web'));
const OUT = path.resolve(process.argv[3] || path.join(require('os').tmpdir(), 'hlc-e2e'));
fs.mkdirSync(OUT, { recursive: true });

let failures = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ✓ ' + msg); } else { failures++; console.log('  ✗ ' + msg); }
}
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: opts.viewport || { width: 1280, height: 860 },
    colorScheme: opts.colorScheme || 'light', deviceScaleFactor: 1, ...(opts.ctx || {}) });
  if (!opts.keepFsApi) {
    // без File System Access API: проверяем путь «скачать файл» / <input type=file>
    await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('requestfailed', (r) => { if (!/icon|manifest/.test(r.url())) errors.push('не загружен ' + r.url()); });
  return { ctx, page, errors };
}
async function download(page, action) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), action()]);
  const p = path.join(OUT, d.suggestedFilename());
  await d.saveAs(p);
  return p;
}
async function menu(page, cmd) {
  const item = page.locator(`[data-cmd="${cmd}"]`);
  const m = item.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " menu ")][1]');
  await m.locator('.menu-btn').click();
  await item.click();
}

(async () => {
  const browser = await chromium.launch();
  const url = 'file://' + path.join(WEB, 'index.html');

  console.log('1. Запуск и новый документ');
  let { ctx, page, errors } = await newPage(browser);
  await page.goto(url);
  await page.waitForFunction(() => window.App && window.HLCore);
  const chips = await page.locator('#rootChips .chip').allInnerTexts();
  check(chips.length === 2 && chips[0].includes('Th-229') && chips[1].includes('Th-228'), 'по умолчанию цепочки Th-229 и Th-228: ' + chips.map((c) => c.replace(/\s*×/, '')).join(', '));
  const nInputs = await page.locator('#inputTable input[data-name]').count();
  check(nInputs > 10, `таблица ввода построена (${nInputs} полей активности)`);
  check(await page.locator('#emptyState').isHidden(), 'пустое состояние скрыто');
  check(await page.locator('#resultEmpty').isVisible(), 'до расчёта видна подсказка #resultEmpty');
  check(await page.locator('[data-cmd="export"]').isDisabled(), 'экспорт неактивен до расчёта');
  check(await page.evaluate(() => HLPicker.allRadioactive().length) > 1000, 'подсказки: в базе >1000 радионуклидов');
  await page.fill('#rootInput', 'рад');
  const sug = await page.locator('.iso-sug:not([hidden]) .iso-opt').evaluateAll((a) => a.map((o) => o.dataset.name));
  check(sug.length > 3 && sug.every((n) => /^(Ra|Rn)-/.test(n)) && sug.some((n) => n.startsWith('Ra-')) && sug.some((n) => n.startsWith('Rn-')), `«рад» → подсказки радия и радона (${sug.length})`);
  await page.locator('#rootInput').press('Escape');
  check(await page.locator('.iso-sug:not([hidden])').count() === 0, 'Esc закрывает подсказки');
  await page.fill('#rootInput', '');
  await page.screenshot({ path: path.join(OUT, '01-start.png') });

  console.log('2. Расчёт Th-229 + Th-228');
  await page.fill('#inputTable input[data-name="Th-229"]', '1e6');
  await page.fill('#inputTable input[data-name="Th-228"]', '1 000');
  await page.fill('#inputTable input[data-name="Ra-224"]', '2,5·10^2');
  check(await page.locator('#dirty').isVisible(), 'маркер несохранённых изменений');
  await page.fill('#hold', '7');
  await page.locator('#hold').press('Enter');
  await page.waitForSelector('#resultTable tbody tr');
  check(await page.locator('#inputTable input[data-name="Th-229"]').isDisabled(), 'ввод заблокирован после расчёта');
  check(await page.locator('#editBtn').isVisible() && await page.locator('#calcBtn').isHidden(), 'кнопка «Изменить данные» вместо «Рассчитать»');
  check(await page.locator('#inputPanel').evaluate((e) => e.classList.contains('locked')), '#inputPanel.locked');
  check(await page.locator('[data-cmd="export"]').isEnabled(), 'экспорт активен после расчёта');
  const title = await page.locator('#resultTitle').innerText();
  check(title.includes('7 сут'), 'заголовок результата: ' + title);
  const cmp = await page.evaluate(() => {
    const set = HLCore.buildSet(['Th-229', 'Th-228']);
    const ref = HLCore.calculate(set, { 'Th-229': 1e6, 'Th-228': 1000, 'Ra-224': 250 }, 7 * 86400, 10);
    const got = App.snapshot().result;
    let worst = 0;
    for (const r of ref.rows) {
      const g = got.find((x) => x.name === r.name);
      const d = Math.abs(g.A - r.A) / Math.max(Math.abs(r.A), 1e-300);
      if (r.A > 0) worst = Math.max(worst, d);
    }
    return { n: ref.rows.length, m: got.length, worst, ac225: got.find((x) => x.name === 'Ac-225').A, ra224: got.find((x) => x.name === 'Ra-224').A };
  });
  check(cmp.n === cmp.m && cmp.worst < 1e-12, `результат совпадает с HLCore.calculate (${cmp.m} изотопов, max отклонение ${cmp.worst})`);
  check(cmp.ac225 > 0, 'Ac-225 накопился: ' + cmp.ac225.toExponential(4) + ' Бк');
  const totals = await page.locator('#resultTable tr.total').count();
  check(totals === 3, `строки сумм: ${totals} (2 цепочки + «Всего»)`);
  await page.screenshot({ path: path.join(OUT, '02-result.png') });

  console.log('3. График');
  await page.click('.tab[data-tab="chart"]');
  const legend = await page.locator('#chartLegend label').count();
  check(legend > 5, `легенда: ${legend} серий`);
  const ink = await page.evaluate(() => {
    const cv = document.getElementById('chart');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return { n, w: cv.width, h: cv.height };
  });
  check(ink.n > 2000 && ink.w > 300 && ink.h > 200, `canvas нарисован (${ink.w}×${ink.h}, ${ink.n} точек)`);
  const box = await page.locator('#chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, '03-chart-hover.png') });
  await page.locator('#chartLegend label').nth(1).click();
  check(!(await page.locator('#chartLegend label input').nth(1).isChecked()), 'серию можно скрыть в легенде');

  console.log('4. Формулы');
  await page.click('.tab[data-tab="formulas"]');
  for (const f of ['text', 'maple', 'latex', 'python']) {
    await page.click(`.fmt[data-fmt="${f}"]`);
    const t = await page.locator('#formulaOut').innerText();
    check(t.length > 200 && !/не загружен|Не удалось/.test(t), `формат ${f}: ${t.length} символов`);
  }
  await page.click('.fmt[data-fmt="maple"]');
  const mpl = await download(page, () => page.click('#downloadFormulaBtn'));
  check(mpl.endsWith('.mpl') && fs.readFileSync(mpl, 'utf8').includes('dsolve'), 'скачан .mpl: ' + path.basename(mpl));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('#copyFormulaBtn');
  await page.waitForTimeout(150);
  check((await page.locator('#copyFormulaBtn').innerText()).includes('Скопировано'), 'кнопка «Копировать» сработала');

  console.log('5. Сохранение и открытие .hlc');
  const saved = await download(page, () => page.keyboard.press('Control+KeyS'));
  const data = JSON.parse(fs.readFileSync(saved, 'utf8'));
  check(data.format === 'halflife-calc' && data.roots.join() === 'Th-229,Th-228', 'Ctrl+S сохранил .hlc: ' + path.basename(saved));
  check(data.activities['Th-229'] === 1e6 && data.activities['Th-228'] === 1000 && data.activities['Ra-224'] === 250 && data.hold === 7 && data.holdUnit === 'd', 'в файле активности и выдержка');
  check(await page.locator('#dirty').isHidden(), 'после сохранения маркер изменений снят');
  await menu(page, 'new');
  await page.click('.tab[data-tab="result"]');
  check((await page.locator('#inputTable input[data-name="Th-229"]').inputValue()) === '0', '«Новый» очистил ввод');
  check(await page.locator('#resultEmpty').isVisible(), '«Новый» убрал результат');
  await page.setInputFiles('#fileInput', saved);
  await page.waitForFunction(() => document.querySelector('#inputTable input[data-name="Th-229"]').value !== '0');
  check((await page.locator('#inputTable input[data-name="Th-229"]').inputValue()) === '1000000', 'файл открыт, Th-229 = ' + await page.locator('#inputTable input[data-name="Th-229"]').inputValue());
  check((await page.locator('#docName').innerText()) === path.basename(saved), 'имя документа: ' + await page.locator('#docName').innerText());

  console.log('6. Несохранённые изменения');
  await page.fill('#inputTable input[data-name="Th-228"]', '5000');
  await menu(page, 'new');
  check(await page.locator('#dlg').isVisible(), 'при «Новый» с изменениями — вопрос о сохранении');
  await page.click('#dlg button[value="cancel"] >> nth=-1');
  check((await page.locator('#inputTable input[data-name="Th-228"]').inputValue()) === '5000', '«Отмена» сохранил ввод');

  console.log('7. Экспорт в Excel');
  await page.click('#calcBtn');
  await page.waitForSelector('#resultTable tbody tr');
  const xlsx = await download(page, () => page.click('#exportBtn'));
  check(xlsx.endsWith('.xlsx') && fs.statSync(xlsx).size > 2000, 'скачан ' + path.basename(xlsx));
  fs.writeFileSync(path.join(OUT, 'last.xlsx.path'), xlsx);

  console.log('8. Правка T½');
  await page.click('#editBtn');
  check(await page.locator('#inputTable input[data-name="Th-229"]').isEnabled(), '«Изменить данные» разблокировал ввод');
  await page.click('#inputTable tr[data-name="Ra-225"] td.t12');
  await page.fill('#t12Value', '15');
  await page.selectOption('#t12Unit', 'd');
  await page.locator('#t12Value').press('Enter');
  await page.waitForTimeout(50);
  check(await page.locator('#dlg').isHidden(), 'Enter в поле T½ = OK');
  check(await page.locator('#inputTable tr[data-name="Ra-225"] td.t12').evaluate((e) => e.classList.contains('overridden')), 'T½ Ra-225 помечен .overridden');
  const t12 = await page.evaluate(() => HLCore.buildSet(['Th-229'], JSON.parse(App.serialize()).overrides).find((x) => x.name === 'Ra-225').T);
  check(Math.abs(t12 - 15 * 86400) < 1e-6, 'правка в файле проекта: T½ = 15 сут');
  await menu(page, 'data');
  const dataHtml = await page.locator('#dlgBody').innerText();
  check(dataHtml.includes('польз.') && dataHtml.includes('Ac-225'), '«Ядерные данные» показывают набор и правку');
  await page.screenshot({ path: path.join(OUT, '04-data.png') });
  await page.keyboard.press('Escape');
  await menu(page, 'resetOverrides');
  await page.click('#dlg .dlg-foot button.primary');
  await page.waitForTimeout(100);
  check(!(await page.locator('#inputTable tr[data-name="Ra-225"] td.t12').evaluate((e) => e.classList.contains('overridden'))), '«Сбросить правки» вернул базу');

  console.log('9. Родоначальники');
  await page.fill('#rootInput', 'u238');
  await page.click('#addRootBtn');
  check((await page.locator('#rootChips .chip').count()) === 3 && await page.locator('#inputTable tr[data-name="Pb-206"]').count() === 1, 'добавлен U-238 (через «u238»), цепочка до Pb-206');
  for (const [inp, re] of [['Xx-999', /нет в базе/], ['Pb-208', /стабил/], ['Ra-225', /уже входит/], ['Th-229', /уже добавлен/]]) {
    await page.fill('#rootInput', inp); await page.locator('#rootInput').press('Enter');
    const msg = await page.locator('#rootError').innerText();
    check(re.test(msg), `ошибка для ${inp}: ${msg}`);
  }
  await page.click('#rootChips [data-remove="U-238"]');
  check((await page.locator('#rootChips .chip').count()) === 2 && (await page.locator('#inputTable input[data-name="Th-228"]').inputValue()) === '5000', 'цепочка удалена, введённые активности сохранились');
  await page.click('#rootChips [data-remove="Th-229"]');
  await page.click('#rootChips [data-remove="Th-228"]');
  check(await page.locator('#emptyState').isVisible(), 'без родоначальников показан #emptyState');
  await page.click('#calcBtn');
  check(/родоначальник/.test(await page.locator('#error').innerText()), 'расчёт без изотопов — понятная ошибка');

  console.log('10. Примеры');
  const presetBtns = await page.locator('#presetMenu [data-preset]').count();
  check(presetBtns >= 1, `меню «Примеры»: ${presetBtns} пунктов`);
  await page.locator('.menu-btn', { hasText: 'Примеры' }).click();
  await page.locator('#presetMenu [data-preset]').first().click();
  if (await page.locator('#dlg').isVisible()) await page.click('#dlg button[value="discard"]');
  await page.waitForTimeout(50);
  const pr = await page.evaluate(() => App.snapshot());
  check(pr.roots.length > 0 && !pr.dirty, `пример загружен: «${pr.name}» (${pr.roots.join(', ')})`);
  await page.click('#calcBtn');
  check(await page.locator('#resultTable tbody tr').count() > 0, 'пример считается');
  check(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  console.log('11. Телефон 390 px и тёмная тема');
  ({ ctx, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 }, colorScheme: 'dark', ctx: { isMobile: true, hasTouch: true } }));
  await page.goto(url);
  await page.waitForFunction(() => window.App);
  await page.fill('#inputTable input[data-name="Th-229"]', '1000000');
  await page.click('#calcBtn');
  await page.waitForSelector('#resultTable tbody tr');
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, `нет горизонтальной прокрутки страницы (scrollWidth ${sw})`);
  await page.screenshot({ path: path.join(OUT, '05-mobile-dark.png'), fullPage: true });
  await page.click('.tab[data-tab="chart"]');
  await page.locator('#chart').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, '06-mobile-chart.png') });
  check(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  console.log('12. Офлайн (service worker по http)');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(WEB, p);
    if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = srv.address().port;
  ({ ctx, page, errors } = await newPage(browser));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {}); }
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker установлен');
  await ctx.setOffline(true);
  srv.close();
  await page.reload();
  await page.waitForFunction(() => window.App, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => !!window.App && document.querySelectorAll('#inputTable input').length > 5), 'без сети страница открылась из кэша и работает');
  await ctx.close();

  console.log('13. Мост Android (window.AndroidHost)');
  ({ ctx, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } }));
  await ctx.addInitScript(() => {
    window.__saved = []; window.__copied = [];
    window.AndroidHost = { saveFile: (n, m, b) => window.__saved.push([n, m, b]), copyText: (t) => window.__copied.push(t), isAndroid: () => true };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.App);
  check(await page.evaluate(() => document.body.classList.contains('android')), 'body.android');
  await page.fill('#inputTable input[data-name="Th-229"]', '1e6');
  await menu(page, 'save');
  await page.waitForFunction(() => window.__saved.length === 1);
  const sv = await page.evaluate(() => window.__saved[0]);
  const js = JSON.parse(Buffer.from(sv[2], 'base64').toString('utf8'));
  check(sv[0] === 'расчёт.hlc' && sv[1] === 'application/json' && js.activities['Th-229'] === 1e6, 'сохранение .hlc через AndroidHost.saveFile (base64)');
  await page.click('#calcBtn');
  await menu(page, 'export');
  await page.waitForFunction(() => window.__saved.length === 2);
  const xs = await page.evaluate(() => window.__saved[1]);
  check(xs[0].endsWith('.xlsx') && Buffer.from(xs[2], 'base64').slice(0, 2).toString() === 'PK', 'экспорт .xlsx через AndroidHost.saveFile');
  await page.click('.tab[data-tab="formulas"]');
  await page.click('#copyFormulaBtn');
  check(await page.evaluate(() => window.__copied.length === 1 && window.__copied[0].length > 200), 'копирование формул через AndroidHost.copyText');
  check(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();

  await browser.close();
  console.log(`\nИтог: ${passes} проверок пройдено, ${failures} не пройдено. Файлы: ${OUT}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
