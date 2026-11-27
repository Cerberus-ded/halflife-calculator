/* Сценарий «Ответ простыми словами» (Playwright): строка «Коротко» над таблицей результата — заголовок, проценты,
 * периоды полураспада, дочерние изотопы, итог по нескольким цепочкам, несколько сроков, единицы, свёрнуто/развёрнуто
 * (запоминается), «Копировать», телефон.
 * Запуск: node desktop/test/e2e-answer.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const doc = (o) => JSON.stringify(Object.assign({ format: 'halflife-calc', version: 3, holdUnit: 'd' }, o));

(async () => {
  console.log('Сценарий: ответ простыми словами');
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
    const run = async (d) => {
      await p.evaluate(() => { if (document.body.classList.contains('locked')) App.run('edit'); });
      await p.evaluate((t) => App.loadText(t, 'x.hlc'), d);
      await p.evaluate(() => App.run('calc')); await p.waitForTimeout(150);
    };
    const nb = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
    const head = async () => nb(await p.$eval('#answer .answer-title', (e) => e.textContent.replace(/^Коротко/, '')));
    const items = async () => (await p.$$eval('#answer li', (a) => a.map((x) => x.textContent))).map(nb);
    const isOpen = () => p.$eval('#answer details', (d) => d.open);

    check(await p.$eval('#answer', (e) => e.hidden), 'до расчёта блока нет');

    // 1. I-131: 80 сут ≈ 10 периодов
    await run(doc({ roots: ['I-131'], activities: { 'I-131': 3.7e9 }, hold: 80 }));
    check(!(await p.$eval('#answer', (e) => e.hidden)), 'после расчёта блок есть');
    check(await head() === 'Через 80 сут: у I-131 осталось 0,0998 %', 'заголовок: ' + await head());
    check(!(await isOpen()), 'на широком экране по умолчанию свёрнут');
    let li = await items();
    check(/^I-131: осталось 0,0998 % — 3,693 млн Бк из 3,7 млрд Бк\. Прошло 9,97 периода полураспада \(T½ = 8,0252 сут\)\.$/.test(li[0]), 'строка: ' + li[0]);
    check(li.length === 2 && /^Дочерние изотопы I-131: больше всего активности у Xe-131m — 755 000 Бк\. Вся цепочка вместе — 4,448 млн Бк, вначале было 3,7 млрд Бк\.$/.test(li[1]), 'дочерний Xe-131m: ' + li[1]);
    if (OUT) await (await p.$('#tp-result')).screenshot({ path: path.join(OUT, 'answer-closed.png') });
    await p.click('#answer summary'); await p.waitForTimeout(100);
    check(await isOpen() && await p.evaluate(() => localStorage.getItem('halflife.answerOpen')) === '1', 'развернули — запомнено');

    // 2. Cs-137 → Ba-137m: долгоживущий родоначальник, накопление дочернего
    await run(doc({ roots: ['Cs-137'], activities: { 'Cs-137': 1e6 }, hold: 1 }));
    check(await isOpen(), 'после нового расчёта остаётся развёрнутым');
    li = await items();
    check(/^Cs-137 почти не распался: осталось 99,99\d* %\. T½ = 30,08 лет, а прошло 1 сут\.$/.test(li[0]), 'долгоживущий: ' + li[0]);
    check(/^Дочерние изотопы Cs-137: больше всего активности у Ba-137m — 943 \d00 Бк\. Вся цепочка вместе — 1,944 млн Бк, больше, чем вначале \(1 млн Бк\): дочерние изотопы накопились\.$/.test(li[1]), 'дочерние: ' + li[1]);
    check(/^Через 1 сут: у Cs-137 осталось 99,99\d* %, вся цепочка — 1,944 млн Бк$/.test(await head()), 'заголовок: ' + await head());
    if (OUT) await (await p.$('#tp-result')).screenshot({ path: path.join(OUT, 'answer-open.png') });

    // 3. две цепочки — итог; несколько сроков — основной
    await run(doc({ roots: ['Ac-225', 'Ac-227'], activities: { 'Ac-225': 1e9, 'Ac-227': 2e6 }, hold: 30, holdExtra: [10, 60] }));
    li = await items();
    check(li.some((t) => /^Ac-225: осталось 12,3 % — 122,9 млн Бк из 1 млрд Бк\. Прошло 3,02 периода/.test(t)), 'Ac-225: 3,02 периода');
    check(/^Всего, все изотопы вместе: 748,9 млн Бк \(вначале было 1,002 млрд Бк\)\.$/.test(li[li.length - 1]), 'итог: ' + li[li.length - 1]);
    check(await head() === 'Через 30 сут: всего 748,9 млн Бк (вначале 1,002 млрд Бк) (основной срок; остальные — в таблице)', 'заголовок с несколькими сроками: ' + await head());
    check(li.some((t) => /вначале было 1 млрд Бк/.test(t)) && li.some((t) => /Ac-225: больше всего активности у Pb-209/.test(t)), 'цепочка Ac-225 уменьшилась — «вначале было»');
    // «Вывод» в протоколе Word и в печати
    await p.evaluate(() => { window.__doc = null; window.HLSaveHook = async (blob, name) => { window.__doc = { name, s: new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer())) }; return true; }; });
    await p.evaluate(() => App.run('protocol'));
    await p.waitForFunction(() => window.__doc, null, { timeout: 8000 }).catch(() => null);
    const dx = await p.evaluate(() => window.__doc && { name: window.__doc.name, out: window.__doc.s.includes('>Вывод<'), tot: window.__doc.s.includes('• Всего, все изотопы вместе: 748,9') });
    check(dx && dx.out && dx.tot, 'протокол Word: раздел «Вывод» с итогом' + (dx ? '' : ' (файл не сохранён)'));
    await p.evaluate(() => { window.print = () => {}; App.run('print'); });
    const pr = await p.$eval('#printArea', (e) => ({ h: [...e.querySelectorAll('h2')].map((x) => x.textContent), li: e.querySelectorAll('ul.summary li').length }));
    const iv = pr.h.indexOf('Вывод');
    check(iv > 0 && pr.h[iv - 1] === 'Результат' && iv < pr.h.indexOf('Модель и формулы') && pr.li === li.length, 'печать: «Вывод» сразу после результата, до формул (' + pr.h.join(', ') + ')');
    await p.evaluate(() => { delete window.HLSaveHook; });

    // 4. ровно целые периоды и единицы МБк
    await run(doc({ roots: ['Ra-224'], activities: { 'Ra-224': 10 }, actUnit: 'MBq', hold: 3.6316 * 2 }));
    li = await items();
    check(/^Ra-224: осталось 25 % — 2,5 МБк из 10 МБк\. Прошло 2 периода полураспада/.test(li[0]), 'ровно 2 периода, МБк: ' + li[0]);

    // 5. копирование текстом
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await p.click('#copyAnswerBtn'); await p.waitForTimeout(150);
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(/^Через 7,2632 сут: у Ra-224 осталось 25 %, вся цепочка — .* МБк\.\n• Ra-224: осталось 25 %/.test(clip), 'скопировано: ' + clip.split('\n')[0]);
    check(await isOpen(), '«Копировать» не сворачивает блок');
    // свернули — запомнено, после перезагрузки свёрнут
    await p.click('#answer summary'); await p.waitForTimeout(100);
    check(await p.evaluate(() => localStorage.getItem('halflife.answerOpen')) === '0', 'свернули — запомнено');

    // 6. «Изменить данные» и правка: ответ исчезает вместе с результатом
    await p.evaluate(() => App.run('edit')); await p.fill('#hold', '9'); await p.waitForTimeout(100);
    check(await p.$eval('#answer', (e) => e.hidden), 'после правки ввода ответа нет');

    // 7. телефон: по умолчанию развёрнут, в экране
    await p.evaluate(() => localStorage.removeItem('halflife.answerOpen'));
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(100);
    await run(doc({ roots: ['Mo-99'], activities: { 'Mo-99': 2e10 }, hold: 1 }));
    check(await isOpen(), 'на телефоне по умолчанию развёрнут');
    const r = await p.evaluate(() => { const a = document.getElementById('answer').getBoundingClientRect(), c = document.getElementById('copyAnswerBtn').getBoundingClientRect(); return { a: a.right, c: c.right, vw: innerWidth, sw: document.documentElement.scrollWidth }; });
    check(r.a <= r.vw && r.c <= r.a && r.sw <= r.vw, `на телефоне в экране (${Math.round(r.a)} из ${r.vw})`);
    if (OUT) { await (await p.$('#answer')).scrollIntoViewIfNeeded(); await (await p.$('#answer')).screenshot({ path: path.join(OUT, 'answer-phone.png') }); }

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Ответ простыми словами: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
