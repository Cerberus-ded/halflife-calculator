/* Сценарий массы: столбец «атомы / масса / моль», окно «Масса и активность», Excel (Playwright).
 * Запуск: node desktop/test/e2e-mass.js [папка для скриншотов]. */
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
  console.log('Сценарий: масса и активность');
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    ctx.setDefaultTimeout(10000);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* нет хранилища */ } });
    await p.reload();
    await p.evaluate(() => {
      window.__saved = [];
      window.HLSaveHook = async (blob, name) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); window.__saved.push({ name, b64: btoa(s) }); return true; };
    });
    await p.evaluate((t) => App.loadText(t, 'm.hlc'), DOC);
    await p.click('#calcBtn'); await p.waitForTimeout(200);
    await p.check('#showAtoms');
    const thCell = async () => p.$$eval('#resultTable tbody tr', (rows) => { const r = rows.find((x) => x.querySelector('.iso') && x.querySelector('.iso').textContent === 'Th-229'); const c = r.querySelectorAll('td'); return c[c.length - 1].textContent; });
    check((await p.textContent('#amountBtn')) === 'N(t), атомов', 'столбец по умолчанию — атомы: ' + await p.textContent('#amountBtn'));
    await p.click('#amountBtn');
    const mh = await p.textContent('#amountBtn');
    const g = 1e6 / (Math.LN2 / (7880 * 365.2422 * 86400) * 6.02214076e23 / 229.0317614);
    check(mh === 'm(t), мкг' && Math.abs(num(await thCell()) / (g * 1e6) - 1) < 2e-3, `масса Th-229: ${await thCell()} мкг (≈${(g * 1e6).toFixed(1)})`);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'mass-table.png') });
    await p.click('#amountBtn');
    check((await p.textContent('#amountBtn')) === 'n(t), моль' && Math.abs(num(await thCell()) / (g / 229.0317614) - 1) < 2e-3, 'количество вещества Th-229: ' + await thCell() + ' моль');
    await p.click('#amountBtn');
    check((await p.textContent('#amountBtn')).startsWith('N('), 'третье нажатие возвращает атомы');
    await p.click('#amountBtn');
    await p.reload(); await p.evaluate((t) => App.loadText(t, 'm.hlc'), DOC); await p.click('#calcBtn'); await p.waitForTimeout(150);
    check((await p.textContent('#amountBtn')).startsWith('m('), 'выбор «масса» запоминается');
    await p.evaluate(() => {
      window.__saved = [];
      window.HLSaveHook = async (blob, name) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); window.__saved.push({ name, b64: btoa(s) }); return true; };
    });
    await p.click('#exportBtn'); await p.waitForTimeout(300);
    const xl = await p.evaluate(() => window.__saved.pop());
    check(xl && Buffer.from(xl.b64, 'base64').includes(Buffer.from('m(t), г')), 'Excel: столбец массы m(t), г');

    // ---- окно «Масса и активность» ----
    await p.evaluate(() => { App.run('mass'); }); await p.waitForTimeout(150);
    check(await p.inputValue('#massName') === 'Th-229' && Math.abs(num(await p.inputValue('#massA')) / 7.329e6 - 1) < 1e-3, 'по умолчанию изотоп из таблицы, 1 мг = ' + await p.inputValue('#massA') + ' Бк');
    await p.fill('#massName', 'ra226'); await p.selectOption('#massGU', 'g'); await p.fill('#massG', '1'); await p.waitForTimeout(100);
    const a = num(await p.inputValue('#massA'));
    check(Math.abs(a / 3.658e10 - 1) < 3e-3, `1 г Ra-226 = ${await p.inputValue('#massA')} Бк`);
    check(/Удельная активность: 3,6\d+E10 Бк\/г/.test(await p.textContent('#massOut')), 'удельная активность Ra-226: ' + (await p.textContent('#massOut')).slice(0, 90));
    await p.selectOption('#massAU', 'Ci'); await p.waitForTimeout(100);
    check(Math.abs(num(await p.inputValue('#massA')) - 0.98865) < 2e-3 && num(await p.inputValue('#massG')) === 1, 'смена единицы активности: 1 г = ' + await p.inputValue('#massA') + ' Ки');
    await p.fill('#massA', '1'); await p.waitForTimeout(100);
    check(Math.abs(num(await p.inputValue('#massG')) - 1.0115) < 3e-3, '1 Ки Ra-226 = ' + await p.inputValue('#massG') + ' г');
    await p.fill('#massName', 'Zz-1'); await p.waitForTimeout(100);
    check(await p.isVisible('#massErr'), 'неизвестный изотоп — подсказка');
    await p.fill('#massName', 'Ra-226'); await p.waitForTimeout(100);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'mass-desk.png') });
    await p.click('#dlg button[value="use"]'); await p.waitForTimeout(250);
    const doc = JSON.parse(await p.evaluate(() => App.serialize()));
    check(doc.roots.includes('Ra-226') && Math.abs(doc.activities['Ra-226'] / 3.7e10 - 1) < 1e-6, `Ra-226 добавлен в таблицу с A₀ = ${doc.activities['Ra-226']} Бк`);
    check(!(await p.evaluate(() => App.snapshot().locked)), 'ввод разблокирован для пересчёта');

    // ---- телефон ----
    const ph = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
    ph.setDefaultTimeout(10000);
    ph.on('pageerror', (e) => errs.push('phone: ' + e.message));
    await ph.goto(PAGE);
    await ph.evaluate(() => { App.run('mass'); }); await ph.waitForTimeout(200);
    const fit = await ph.evaluate(() => { const d = document.getElementById('dlg').getBoundingClientRect(); return d.left >= 0 && d.right <= window.innerWidth + 0.5 && document.documentElement.scrollWidth <= window.innerWidth; });
    check(fit, 'телефон: окно по ширине экрана');
    if (OUT) await ph.screenshot({ path: path.join(OUT, 'mass-phone.png') });
  } catch (e) { fails++; console.log('  ✗ сценарий прерван: ' + e.message.split('\n')[0]); }
  finally { await b.close(); }
  check(errs.length === 0, 'ошибок JS нет ' + errs.join('; '));
  console.log(fails ? `Итог: не пройдено ${fails}` : 'Итог: все проверки пройдены');
  process.exitCode = fails ? 1 : 0;
})();
