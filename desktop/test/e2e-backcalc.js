/* Сценарий «Пересчёт от измерения» (Playwright): кнопка над таблицей и пункт меню, родоначальник и дочерний
 * изотоп, единицы, ошибки, подстановка с расчётом для проверки, заблокированный ввод, телефон.
 * Запуск: node desktop/test/e2e-backcalc.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const num = (s) => parseFloat(String(s).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Ac-225'], activities: { 'Ac-225': 1e6 }, hold: 10, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: пересчёт от измерения');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    ctx.setDefaultTimeout(10000);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
    const a0 = async (n) => p.$eval(`#inputTable input[data-name="${n}"]`, (e) => e.value);
    const out = async () => p.textContent('#bcOut');
    const applyDisabled = async () => p.$eval('#dlg button[value="apply"]', (e) => e.disabled);

    check(await p.isVisible('#backCalcBtn'), 'ссылка «Пересчитать от измерения» под таблицей');
    await p.click('#backCalcBtn'); await p.waitForTimeout(150);
    check(await p.isVisible('#dlg #bcA'), 'диалог открыт');
    check(await p.$eval('#bcName', (e) => e.value) === 'Ac-225' && await p.$eval('#bcFrom', (e) => e.value) === 'root:Ac-225', 'по умолчанию: измерили Ac-225, вначале только Ac-225');
    check(await p.$eval('#bcT', (e) => e.value) === '10' && await p.$eval('#bcTU', (e) => e.value) === 'd', 'время по умолчанию — выдержка 10 сут');
    check(await applyDisabled(), 'без активности кнопка «Подставить» недоступна');

    // родоначальник: поправка на распад
    await p.fill('#bcA', '497210'); await p.waitForTimeout(80);
    const o1 = await out();
    check(/^Начальная активность Ac-225 — 1[\s  ]000[\s  ]0\d\d Бк\. Поправка на распад: ×2,01/.test(o1), 'Ac-225 через 10 сут: ' + o1);
    check(!(await applyDisabled()), 'кнопка «Подставить» доступна');

    // ошибки
    await p.fill('#bcA', '-5'); await p.waitForTimeout(50);
    check(/больше нуля/.test(await out()) && await applyDisabled(), 'отрицательная активность: ' + await out());
    await p.fill('#bcA', '1000'); await p.fill('#bcName', 'Ra-226'); await p.waitForTimeout(50);
    check(/Ra-226 нет в этом расчёте/.test(await out()) && await applyDisabled(), 'изотоп не из расчёта: ' + await out());
    await p.fill('#bcName', 'висмут-213'); await p.fill('#bcA', '1000'); await p.fill('#bcT', '0'); await p.waitForTimeout(50);
    check(/ещё не образовался/.test(await out()) && await applyDisabled(), 'дочерний в момент 0: ' + await out());

    // дочерний изотоп и другие единицы: Bi-213 = 1 мКи через 2 сут
    await p.fill('#bcT', '2'); await p.selectOption('#bcAU', 'mCi'); await p.fill('#bcA', '1'); await p.waitForTimeout(80);
    check(/^Начальная активность Ac-225 — /.test(await out()), 'по Bi-213: ' + await out());
    await p.check('#bcHold');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'backcalc.png') });
    await p.click('#dlg button[value="apply"]'); await p.waitForTimeout(300);
    check(!(await p.isVisible('#dlg')), 'диалог закрыт');
    check(await p.$eval('#hold', (e) => e.value) === '2' && await p.$eval('#holdUnit', (e) => e.value) === 'd', 'выдержка поставлена 2 сут');
    const bi = await p.$$eval('#resultTable tbody tr', (rows) => { const r = rows.find((x) => x.querySelector('td.iso') && x.querySelector('td.iso').textContent === 'Bi-213'); return r ? r.querySelectorAll('td')[2].getAttribute('title') : ''; });
    check(rel(num(bi), 3.7e7) < 1e-4, 'расчёт для проверки: A(Bi-213, 2 сут) = ' + bi);
    check(!(await p.isVisible('#backCalcBtn')), 'после расчёта ссылка скрыта (ввод заблокирован)');

    // из меню при заблокированном вводе, соотношение из таблицы
    await p.evaluate(() => App.loadText(JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Th-229', 'Th-228'], activities: { 'Th-229': 1e6, 'Th-228': 1e3 }, hold: 7, holdUnit: 'd' }), 'th.hlc'));
    await p.click('#calcBtn'); await p.waitForTimeout(250);
    await p.evaluate(() => { App.run('backCalc'); }); await p.waitForTimeout(150);
    check(await p.$eval('#bcFrom', (e) => e.value) === 'table', 'два родоначальника в таблице — по умолчанию их соотношение');
    await p.fill('#bcName', 'радий-225'); await p.fill('#bcA', '2E5'); await p.waitForTimeout(80);
    check(/^Начальные активности: Th-229 — .*; Th-228 — /.test(await out()), 'обе активности: ' + await out());
    await p.click('#dlg button[value="apply"]'); await p.waitForTimeout(200);
    const th9 = num(await a0('Th-229')), th8 = num(await a0('Th-228'));
    check(!(await p.$eval('#hold', (e) => e.disabled)) && rel(th9 / th8, 1000) < 1e-5, `ввод разблокирован, A₀ подставлены в том же соотношении (${await a0('Th-229')} / ${await a0('Th-228')})`);
    check(await p.$eval('#hold', (e) => e.value) === '7', 'без флажка выдержка не меняется');
    await p.click('#calcBtn'); await p.waitForTimeout(250);
    const ra = await p.$$eval('#resultTable tbody tr', (rows) => { const r = rows.find((x) => x.querySelector('td.iso') && x.querySelector('td.iso').textContent === 'Ra-225'); return r ? r.querySelectorAll('td')[2].getAttribute('title') : ''; });
    check(rel(num(ra), 2e5) < 1e-4, 'проверка: A(Ra-225, 7 сут) = ' + ra);

    // телефон
    await p.evaluate(() => { App.run('edit'); });
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(100);
    const page = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth, btn: (() => { const r = document.querySelector('#backCalcBtn').getBoundingClientRect(); return [r.left, r.right]; })() }));
    check(page.sw <= page.vw && page.btn[0] >= 0 && page.btn[1] <= page.vw, `на телефоне ссылка в экране, без прокрутки вбок (${Math.round(page.btn[0])}…${Math.round(page.btn[1])} из ${page.vw})`);
    await p.click('#backCalcBtn'); await p.waitForTimeout(150);
    const d = await p.evaluate(() => { const r = document.querySelector('#dlg').getBoundingClientRect(); return [r.left, r.right, innerWidth, document.querySelector('#dlg form').scrollWidth <= document.querySelector('#dlg form').clientWidth + 1]; });
    check(d[0] >= 0 && d[1] <= d[2] && d[3], 'на телефоне диалог помещается по ширине');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'backcalc-phone.png') });
    await p.keyboard.press('Escape');

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Пересчёт от измерения (интерфейс): ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
