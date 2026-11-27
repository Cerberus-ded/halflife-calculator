/* Сценарий «График» (Playwright): переключение логарифмической и обычной шкалы, запоминание выбора,
 * курсор на обычной шкале, картинка PNG (размер, светлый фон и в тёмной теме), телефон.
 * Запуск: node desktop/test/e2e-chart.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Ac-225'], activities: { 'Ac-225': 1e6 }, hold: 30, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: график');
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
    const hook = () => p.evaluate(() => {
      window.__saved = [];
      // сохраняем имя, размер картинки и цвет угла (фон)
      window.HLSaveHook = async (blob, name) => {
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
        const px = Array.from(g.getImageData(4, 4, 1, 1).data);
        const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
        window.__saved.push({ name, w: bmp.width, h: bmp.height, px, sig: String.fromCharCode(...head.slice(1, 4)) });
        return true;
      };
    });
    await hook();
    const pressed = () => p.$$eval('.chart-scale .fmt', (a) => a.filter((x) => x.getAttribute('aria-pressed') === 'true').map((x) => x.dataset.scale).join());
    const note = () => p.textContent('#tp-chart .toolbar-note');
    const snap = () => p.$eval('#chart', (c) => c.toDataURL());

    check(await p.$eval('#chartPngBtn', (e) => e.disabled), 'до расчёта «Скачать PNG» недоступна');
    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
    await p.click('#calcBtn'); await p.waitForTimeout(200);
    await p.click('#tab-chart'); await p.waitForTimeout(200);
    check(await pressed() === 'log' && /логарифмическая шкала/.test(await note()), 'по умолчанию — логарифмическая шкала: ' + await note());
    check(!(await p.$eval('#chartPngBtn', (e) => e.disabled)), 'после расчёта «Скачать PNG» доступна');
    const logImg = await snap();
    await p.click('.chart-scale [data-scale="lin"]'); await p.waitForTimeout(150);
    check(await pressed() === 'lin' && /^A\(t\), Бк, обычная шкала$/.test(await note()), 'переключено на обычную: ' + await note());
    const linImg = await snap();
    check(linImg !== logImg, 'график перерисован');
    check(await p.evaluate(() => localStorage.getItem('halflife.chartScale')) === 'lin', 'выбор запомнен');
    // курсор на обычной шкале: подсказка рисуется, ошибок нет
    const box = await (await p.$('#chart')).boundingBox();
    await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await p.waitForTimeout(100);
    check((await snap()) !== linImg, 'курсор и подсказка на обычной шкале');
    if (OUT) await (await p.$('#tp-chart')).screenshot({ path: path.join(OUT, 'chart-lin.png') });
    await p.mouse.move(5, 5);

    // картинка PNG
    await p.click('#chartPngBtn');
    await p.waitForFunction(() => window.__saved.length > 0, null, { timeout: 8000 }).catch(() => null);
    let s = await p.evaluate(() => window.__saved.pop());
    check(s && s.name === 'ac-график.png' && s.sig === 'PNG' && s.w === 2200 && s.h === 1280, 'PNG: ' + (s && `${s.name}, ${s.w}×${s.h}`));
    check(s && s.px.slice(0, 3).every((v) => v === 255), 'фон картинки белый');
    // тёмная тема: на странице тёмный график, а картинка всё равно светлая
    await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(150);
    await p.click('#chartPngBtn');
    await p.waitForFunction(() => window.__saved.length > 0, null, { timeout: 8000 }).catch(() => null);
    s = await p.evaluate(() => window.__saved.pop());
    check(s && s.px.slice(0, 3).every((v) => v === 255), 'в тёмной теме картинка тоже на белом фоне');
    await p.emulateMedia({ colorScheme: 'light' });

    // после перезагрузки шкала та же
    await p.reload(); await hook();
    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
    await p.click('#calcBtn'); await p.waitForTimeout(200);
    await p.click('#tab-chart'); await p.waitForTimeout(150);
    check(await pressed() === 'lin', 'после перезагрузки — обычная шкала');
    await p.click('.chart-scale [data-scale="log"]'); await p.waitForTimeout(100);
    check(await p.evaluate(() => localStorage.getItem('halflife.chartScale')) === null && /логарифмическая/.test(await note()), 'вернули логарифмическую — запись убрана');

    // телефон
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(150);
    const ov = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, tb: (() => { const r = document.querySelector('#tp-chart .toolbar').getBoundingClientRect(); return r.right; })() }));
    check(ov.sw <= ov.vw && ov.tb <= ov.vw, `на телефоне панель графика в экране (${Math.round(ov.tb)} из ${ov.vw})`);
    if (OUT) await (await p.$('#tp-chart')).screenshot({ path: path.join(OUT, 'chart-phone.png') });

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} График (интерфейс): ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
