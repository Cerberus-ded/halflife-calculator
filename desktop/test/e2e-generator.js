/* Сценарий окна «Генератор: многократные отборы» (Playwright).
 * Запуск: node desktop/test/e2e-generator.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.').replace('E', 'e'));

const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Th-229'], activities: { 'Th-229': 1e6 }, hold: 7, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: генератор с многократными отборами');
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    ctx.setDefaultTimeout(10000);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => {
      window.__saved = [];
      window.HLSaveHook = async (blob, name) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); window.__saved.push({ name, b64: btoa(s) }); return true; };
    });
    await p.evaluate((t) => App.loadText(t, 'генератор.hlc'), DOC);

    // ---- окно и значения по умолчанию ----
    await p.evaluate(() => { App.run('generator'); }); await p.waitForTimeout(150);
    check(await p.isVisible('#genInterval'), 'окно генератора открылось');
    const els = await p.$$eval('#dlgBody .gen-eff', (a) => a.map((x) => x.dataset.el + '=' + x.value));
    check(els[0].startsWith('Th=') && els.includes('Ra=100'), 'элементы цепочки, по умолчанию извлекается Ra: ' + els.join(' '));
    check(await p.$eval('#dlg button[value="use"]', (e) => e.disabled), '«Элюат в расчёт» недоступна до расчёта');

    // ---- ошибка ввода ----
    await p.fill('#genCount', '0');
    await p.click('#dlg button[value="run"]'); await p.waitForTimeout(100);
    check(await p.isVisible('#genErr') && /целое число от 1 до 1000/.test(await p.textContent('#genErr')), 'ошибка: число отборов 0');

    // ---- 5 отборов Ac каждые 10 сут ----
    await p.fill('#genCount', '5');
    await p.fill('#genInterval', '10');
    await p.fill('#dlgBody .gen-eff[data-el="Ra"]', '');
    await p.fill('#dlgBody .gen-eff[data-el="Ac"]', '100');
    await p.press('#genCount', 'Enter'); await p.waitForTimeout(200);
    check(!(await p.isVisible('#genErr')), 'ошибки нет');
    const rows = await p.$$eval('#genOut .gen-table tbody tr', (a) => a.map((r) => Array.from(r.cells).map((c) => c.textContent)));
    const heads = await p.$$eval('#genOut .gen-table thead th', (a) => a.map((x) => x.textContent));
    check(rows.length === 5 && heads[2] === 'Ac-225, Бк' && heads.length === 3, `таблица отборов: ${rows.length} строк, столбцы ${heads.join(' | ')}`);
    const exp = await p.evaluate(() => { const s = HLCore.buildSet(['Th-229'], {}); const r = HLCore.calculate(s, { 'Th-229': 1e6 }, 10 * 86400, 2).rows; return r.find((x) => x.name === 'Ac-225').A; });
    check(Math.abs(num(rows[0][2]) / exp - 1) < 1e-3, `первый отбор Ac-225: ${rows[0][2]} Бк (выдержка 10 сут: ${exp.toFixed(0)})`);
    // Ra-225 остаётся на генераторе и накапливается, поэтому выход Ac-225 от отбора к отбору растёт
    const ys = rows.map((r) => num(r[2]));
    check(num(rows[4][1]) === 50 && ys.every((v, k) => !k || v > ys[k - 1]), 'отборы через 10…50 сут, выход Ac-225 растёт: ' + rows.map((r) => r[2]).join(' → '));
    check(/Отборов: 5, каждые 10 сут, первый через 10 сут; извлекается Ac 100 %/.test(await p.textContent('#genOut .gen-sum')), 'сводка: ' + (await p.textContent('#genOut .gen-sum')).slice(0, 90));
    const ink = await p.$eval('#genChart', (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    check(ink > 2000, 'график нарисован (' + ink + ' точек)');
    check(!(await p.$eval('#dlg button[value="use"]', (e) => e.disabled)), '«Элюат в расчёт» стала доступна');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'gen-desk.png') });

    // ---- файл хранит настройки ----
    const saved = JSON.parse(await p.evaluate(() => App.serialize()));
    check(saved.generator && saved.generator.interval === 10 && saved.generator.count === 5 && saved.generator.eff.Ac === 100 && !saved.generator.eff.Ra, 'в файле настройки генератора: ' + JSON.stringify(saved.generator));

    // ---- Excel ----
    await p.click('#dlg button[value="xlsx"]'); await p.waitForTimeout(300);
    const xl = await p.evaluate(() => window.__saved.pop());
    const xbuf = xl ? Buffer.from(xl.b64, 'base64') : Buffer.alloc(0);
    check(xl && xl.name === 'генератор-генератор.xlsx' && xbuf.includes(Buffer.from('Генератор перед отбором')), 'Excel: ' + (xl && xl.name));
    check(await p.isVisible('#genOut'), 'после Excel окно осталось открытым');

    // ---- элюат 2 → новый расчёт ----
    await p.selectOption('#genPick', '1');
    await p.click('#dlg button[value="use"]'); await p.waitForTimeout(200);
    check(/Несохранённые изменения/.test(await p.textContent('#dlgTitle')), 'перед заменой предлагается сохранить');
    await p.click('#dlg button[value="discard"]'); await p.waitForTimeout(300);
    const snap = await p.evaluate(() => App.snapshot());
    check(snap.roots.join() === 'Ac-225' && snap.locked && snap.name === 'элюат 2', `элюат открыт: ${snap.roots.join()} «${snap.name}», расчёт выполнен`);
    const a0 = await p.evaluate(() => JSON.parse(App.serialize()).activities['Ac-225']);
    check(Math.abs(a0 / num(rows[1][2]) - 1) < 1e-3, `A₀(Ac-225) = активность отбора 2: ${a0}`);
    check(await p.inputValue('#targetSel') === 'Ac-225', 'целевой изотоп элюата — Ac-225');
    check(!(await p.evaluate(() => JSON.parse(App.serialize()).generator)), 'у элюата нет настроек генератора');

    // ---- открытие файла с генератором считает сразу ----
    await p.evaluate((t) => { App.loadText(t, 'g.hlc'); }, JSON.stringify(saved)); await p.waitForTimeout(100);
    await p.evaluate(() => { App.run('generator'); }); await p.waitForTimeout(200);
    check((await p.$$('#genOut .gen-table tbody tr')).length === 5 && await p.inputValue('#genCount') === '5', 'файл с генератором: окно сразу показывает отборы');
    await p.click('#dlg button[value="cancel"]');

    // ---- телефон, тёмная тема ----
    const ph = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
    ph.setDefaultTimeout(10000);
    ph.on('pageerror', (e) => errs.push('phone: ' + e.message));
    await ph.goto(PAGE);
    await ph.evaluate((t) => App.loadText(t, 'g.hlc'), JSON.stringify(saved));
    await ph.evaluate(() => { App.run('generator'); }); await ph.waitForTimeout(250);
    const fit = await ph.evaluate(() => { const d = document.getElementById('dlg').getBoundingClientRect(); return d.left >= 0 && d.right <= window.innerWidth + 0.5 && document.documentElement.scrollWidth <= window.innerWidth; });
    check(fit, 'телефон: окно по ширине экрана, без горизонтальной прокрутки');
    if (OUT) {
      await ph.screenshot({ path: path.join(OUT, 'gen-phone.png') });
      await ph.evaluate(() => document.getElementById('genOut').scrollIntoView());
      await ph.screenshot({ path: path.join(OUT, 'gen-phone-out.png') });
    }
  } catch (e) { fails++; console.log('  ✗ сценарий прерван: ' + e.message.split('\n')[0]); }
  finally { await b.close(); }
  check(errs.length === 0, 'ошибок JS нет ' + errs.join('; '));
  console.log(fails ? `Итог: не пройдено ${fails}` : 'Итог: все проверки пройдены');
  process.exitCode = fails ? 1 : 0;
})();
