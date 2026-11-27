/* Сценарий «Изотоп по названию и таблица Менделеева» (Playwright): ввод «цезий-137», «137 цезий», «технеций-99м»,
 * подсказка для одного названия элемента; окно «Таблица Менделеева»: поиск, выбор элемента, добавление изотопов,
 * повтор и изотоп из цепочки, стрелки, закреплённые данные, телефон.
 * Запуск: node desktop/test/e2e-ptable.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
  console.log('Сценарий: изотоп по названию и таблица Менделеева');
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
    const roots = async () => (await p.evaluate(() => App.snapshot())).roots.join(', ');
    const rootErr = () => p.evaluate(() => { const e = document.getElementById('rootError'); return e.hidden ? '' : e.textContent; });
    const type = async (t) => { await p.fill('#rootInput', t); await p.press('#rootInput', 'Enter'); await p.waitForTimeout(80); };

    // 1. русские названия в поле ввода
    await type('цезий-137');
    check((await roots()).endsWith('Cs-137') && await p.inputValue('#rootInput') === '', '«цезий-137» → Cs-137: ' + await roots());
    await type('226 радий');
    check((await roots()).endsWith('Ra-226'), '«226 радий» → Ra-226');
    await type('технеций-99м');
    check((await roots()).endsWith('Tc-99m'), '«технеций-99м» → Tc-99m');
    await type('Йод 131; стронция-90');
    check(/I-131, Sr-90$/.test(await roots()), 'несколько через «;», родительный падеж: ' + await roots());
    await type('цезий');
    const e1 = await rootErr();
    check(/^Цезий: какой изотоп\? Укажите массовое число, например Cs-135, Cs-137, Cs-134\./.test(e1) && /Таблица Менделеева/.test(e1), 'одно название элемента — подсказка: ' + e1);
    await type('цезий-200');
    check(/^Изотопа Cs-200 нет в базе\. Есть, например: Cs-135/.test(await rootErr()), 'нет такого изотопа: ' + await rootErr());
    await type('абв-12');
    check(await rootErr() === '«абв-12» нет в базе нуклидов.', 'неизвестное слово: ' + await rootErr());
    await p.fill('#rootInput', 'цезий 13');
    const label = await p.$eval('.iso-sug:not([hidden]) .iso-opt[data-name="Cs-137"] span', (o) => o.textContent);
    check(/^Цезий-137 · 30,0\d лет$/.test(label), 'подсказка списка: ' + label);
    await p.fill('#rootInput', 'актиний-22'); await p.waitForTimeout(50);
    await p.click('.iso-sug:not([hidden]) .iso-opt[data-name="Ac-227"]'); await p.waitForTimeout(80);
    check((await roots()).endsWith('Ac-227') && await p.inputValue('#rootInput') === '', 'щелчок по подсказке «Ac-227» добавляет цепочку: ' + await roots());
    await p.fill('#rootInput', 'тор'); await p.press('#rootInput', 'ArrowDown'); await p.press('#rootInput', 'Enter'); await p.waitForTimeout(80);
    check(/Th-\d+$/.test(await roots()), 'стрелка вниз и Enter выбирают первую подсказку: ' + await roots());

    // 2. окно «Таблица Менделеева»: из поля «цезий» — сразу цезий
    await p.fill('#rootInput', 'стронций');
    await p.click('#ptableBtn');
    await p.waitForSelector('#dlg[open] .pt-grid');
    check(await p.$$eval('.pt-el', (a) => a.length) === 118, '118 элементов');
    check(await p.$eval('.pt-el.sel', (e) => e.dataset.sym) === 'Sr' && await p.inputValue('#ptSearch') === 'стронций', 'начато с элемента из поля ввода');
    check(await p.$eval('.pt-el[data-sym="Cs"]', (e) => e.classList.contains('used')) && !(await p.$eval('.pt-el[data-sym="Ba"]', (e) => e.classList.contains('used'))), 'элементы в расчёте отмечены');
    check(await p.$eval('.pt-el[data-sym="Md"]', (e) => e.disabled) && !(await p.$eval('.pt-el[data-sym="Fm"]', (e) => e.disabled)), 'элементов без данных не выбрать (Md), Fm — можно');
    // место в таблице
    const at = (s) => p.$eval(`.pt-el[data-sym="${s}"]`, (e) => e.dataset.row + ':' + e.dataset.col);
    check([await at('H'), await at('He'), await at('Fe'), await at('La'), await at('Lu'), await at('Hf'), await at('U'), await at('Og')].join() === '1:1,1:18,4:8,9:3,9:17,6:4,10:6,7:18', 'места: H, He, Fe, La, Lu, Hf, U, Og');
    // поиск
    await p.fill('#ptSearch', 'то');
    check(await p.$eval('.pt-el.sel', (e) => e.dataset.sym) === 'Th', '«то» → торий');
    await p.fill('#ptSearch', '88');
    check(await p.$eval('.pt-el.sel', (e) => e.dataset.sym) === 'Ra', '«88» → радий');
    await p.fill('#ptSearch', 'qq');
    check(/Не найдено/.test(await p.textContent('#ptStatus')), 'ничего не найдено — подсказка');
    // щелчок по элементу и изотопу
    await p.click('.pt-el[data-sym="Am"]');
    const isos = await p.$$eval('.pt-iso-btn b', (a) => a.map((x) => x.textContent));
    check(isos.includes('Am-241') && isos.indexOf('Am-241') < isos.indexOf('Am-242m') && isos.indexOf('Am-242m') < isos.indexOf('Am-243'), 'изотопы америция по массе: ' + isos.slice(0, 6).join(', ') + '…');
    check(/Америций\s*Am · Z = 95/.test(await p.textContent('#ptIso h3')), 'заголовок: ' + await p.textContent('#ptIso h3'));
    await p.click('[data-add="Am-241"]'); await p.waitForTimeout(80);
    check((await roots()).endsWith('Am-241') && /Am-241 добавлен/.test(await p.textContent('#ptStatus')), 'Am-241 добавлен, окно открыто');
    check(await p.$eval('[data-add="Am-241"]', (e) => e.classList.contains('added') && /добавлен/.test(e.textContent)), 'кнопка изотопа — «добавлен»');
    check(await p.$eval('.pt-el[data-sym="Am"]', (e) => e.classList.contains('used')), 'элемент отмечен');
    await p.click('[data-add="Am-241"]');
    check(/уже добавлен/.test(await p.textContent('#ptStatus')), 'повторно — «уже добавлен»');
    // изотоп, который уже есть в цепочке (Np-237 — дочерний Am-241)
    await p.click('.pt-el[data-sym="Np"]');
    check(/уже в цепочке/.test(await p.textContent('[data-add="Np-237"]')), 'дочерний из цепочки помечен');
    await p.click('[data-add="Np-237"]');
    check(/уже входит в цепочку Am-241/.test(await p.textContent('#ptStatus')) && await p.$eval('#ptStatus', (e) => e.classList.contains('error')), 'добавить дочерний нельзя — объяснение');
    // Enter в поиске добавляет изотоп по названию
    await p.fill('#ptSearch', 'кобальт-60'); await p.press('#ptSearch', 'Enter'); await p.waitForTimeout(80);
    check((await roots()).endsWith('Co-60') && await p.$eval('#dlg', (d) => d.open), 'Enter в поиске: «кобальт-60» добавлен, окно открыто');
    // стрелки
    await p.click('.pt-el[data-sym="Fe"]');
    await p.press('.pt-el[data-sym="Fe"]', 'ArrowRight');
    check(await p.evaluate(() => document.activeElement.dataset.sym) === 'Co', 'стрелка вправо: Fe → Co');
    await p.keyboard.press('ArrowDown');
    check(await p.evaluate(() => document.activeElement.dataset.sym) === 'Rh', 'стрелка вниз: Co → Rh');
    await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
    check(await p.evaluate(() => document.activeElement.dataset.sym) === 'Al', 'вверх дважды: Rh → Co → Al (ближайшая колонка ряда)');
    await p.keyboard.press('Enter');
    check(await p.$eval('.pt-el.sel', (e) => e.dataset.sym) === 'Al', 'Enter на клетке выбирает элемент');
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'ptable.png') });
    await p.click('#dlg button[value="ok"]');
    check(!(await p.$eval('#dlg', (d) => d.open)), '«Готово» закрывает окно');

    // 3. закреплённые данные: кнопка недоступна
    await p.fill('#inputTable tr:has-text("Cs-137") input', '1000');
    await p.click('#calcBtn'); await p.waitForTimeout(200);
    check(await p.$eval('#ptableBtn', (e) => e.disabled), 'после «Рассчитать» кнопка недоступна');
    const fromMenu = async () => {
      await p.click('.menu-btn:has-text("Данные")'); await p.click('.menu-list [data-cmd="ptable"]');
      await p.waitForSelector('#dlg[open]'); await p.waitForTimeout(100);
      const r = await p.evaluate(() => ({ grid: !!document.querySelector('#dlg .pt-grid'), text: document.getElementById('dlgBody').textContent }));
      await p.keyboard.press('Escape'); await p.waitForTimeout(100);
      return r;
    };
    let viaMenu = await fromMenu();
    check(!viaMenu.grid && /закреплены/.test(viaMenu.text), 'меню Данные → Таблица Менделеева при закреплённых данных объясняет, что делать');
    await p.click('#editBtn'); await p.waitForTimeout(100);
    check(!(await p.$eval('#ptableBtn', (e) => e.disabled)), '«Изменить данные» — снова доступна');
    viaMenu = await fromMenu();
    check(viaMenu.grid, 'меню Данные → Таблица Менделеева открывает таблицу');

    // 4. телефон
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(150);
    const btn = await p.evaluate(() => { const r = document.getElementById('ptableBtn').getBoundingClientRect(); return { r: r.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; });
    check(btn.r <= btn.vw && btn.sw <= btn.vw, `на телефоне кнопка в экране (${Math.round(btn.r)} из ${btn.vw})`);
    if (OUT) { await (await p.$('.examples')).screenshot({ path: path.join(OUT, 'ptable-btn-phone.png') }); }
    await p.click('#ptableBtn');
    await p.waitForSelector('#dlg[open] .pt-grid');
    await p.fill('#ptSearch', 'уран');
    const ph = await p.evaluate(() => {
      const d = document.getElementById('dlg').getBoundingClientRect(), w = document.querySelector('.pt-wrap'), s = document.querySelector('.pt-el.sel').getBoundingClientRect(), wr = w.getBoundingClientRect();
      return { dr: d.right, vw: innerWidth, scroll: w.scrollWidth > w.clientWidth, selIn: s.left >= wr.left - 1 && s.right <= wr.right + 1 };
    });
    check(ph.dr <= ph.vw && ph.scroll && ph.selIn, `на телефоне таблица листается внутри окна, уран виден (${Math.round(ph.dr)} из ${ph.vw})`);
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'ptable-phone.png') });
    await p.click('[data-add="U-235"]');
    check((await roots()).endsWith('U-235'), 'на телефоне изотоп добавляется');
    await p.click('#dlg button[value="ok"]');

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Таблица Менделеева: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
