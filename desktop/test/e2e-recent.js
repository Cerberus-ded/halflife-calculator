/* Сценарий «Черновик и недавние расчёты» (Playwright): несохранённый расчёт возвращается после перезагрузки
 * (вместе с результатом), «Начать заново», «Не сохранять», испорченный черновик; список недавних: запись при
 * сохранении и открытии, открытие одним щелчком, удаление, очистка; телефон.
 * Запуск: node desktop/test/e2e-recent.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const doc = (roots, acts, hold) => JSON.stringify({ format: 'halflife-calc', version: 3, roots, activities: acts, hold, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: черновик и недавние расчёты');
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
    const hook = () => p.evaluate(() => { window.__saved = []; window.HLSaveHook = async (blob, name) => { window.__saved.push({ name, text: await blob.text() }); return true; }; });
    const snap = () => p.evaluate(() => App.snapshot());
    const draft = () => p.evaluate(() => localStorage.getItem('halflife.draft'));
    const recent = () => p.evaluate(() => JSON.parse(localStorage.getItem('halflife.recent') || '[]'));
    const noteShown = () => p.evaluate(() => { const n = document.getElementById('draftNote'); return !!n && !n.hidden; });
    const dlgOpen = () => p.evaluate(() => document.getElementById('dlg').open);
    const dlgPress = (v) => p.click(`#dlg button[value="${v}"]`);

    // 1. чистая страница — черновика нет
    check(await draft() === null && !(await noteShown()), 'при первом запуске черновика и сообщения нет');

    // 2. правка → черновик → перезагрузка → расчёт вернулся
    await p.fill('#rootInput', 'Cs-137'); await p.click('#addRootBtn');
    const csRow = await p.$('#inputTable tr:has-text("Cs-137") input');
    await csRow.fill('5000');
    await p.fill('#hold', '45');
    await p.waitForTimeout(700);
    const d1 = await draft();
    check(d1 && JSON.parse(d1).text.includes('"Cs-137"'), 'изменения записаны в черновик');
    const before = await snap();
    await p.reload(); await p.waitForTimeout(150);
    let s = await snap();
    check(s.roots.join() === before.roots.join() && s.dirty === true, 'после перезагрузки изотопы вернулись, документ помечен несохранённым: ' + s.roots.join(', '));
    check(await p.inputValue('#hold') === '45', 'выдержка вернулась');
    check(await p.$eval('#inputTable tr:has-text("Cs-137") input', (e) => e.value) === '5000', 'активность вернулась');
    check(await noteShown() && /Восстановлен несохранённый расчёт \(сегодня, \d\d:\d\d\)/.test(await p.textContent('#draftNote')), 'сообщение: ' + (await p.textContent('#draftNote')).trim().slice(0, 70));
    check(s.result === null, 'расчёта ещё не было — и после возврата его нет');
    if (OUT) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, 'draft-note.png') }); }

    // 3. посчитали → перезагрузка → результат на месте
    await p.click('#calcBtn'); await p.waitForTimeout(700);
    const t1 = JSON.parse(await draft());
    check(t1.calc === true, 'черновик знает, что расчёт выполнен');
    await p.reload(); await p.waitForTimeout(600);
    s = await snap();
    check(s.result && s.result.length > 0 && s.locked, 'после перезагрузки результат посчитан заново');
    check(JSON.parse(await draft()).time === t1.time, 'время черновика — время правки, а не повторного расчёта');
    await p.reload(); await p.waitForTimeout(100);
    check((await draft()) !== null && (await snap()).roots.includes('Cs-137'), 'вторая перезагрузка без правок — черновик не потерян');
    // скрыть сообщение
    await p.click('#draftNote [data-draft="hide"]');
    const hid = !(await noteShown()), kept = (await draft()) !== null;
    check(hid && kept, '«×» скрывает сообщение, черновик остаётся' + (hid && kept ? '' : ` (скрыто: ${hid}, черновик: ${kept})`));

    // 4. «Начать заново»
    await p.reload(); await p.waitForTimeout(150);
    await p.click('#draftNote [data-draft="reset"]');
    await p.waitForSelector('#dlg[open] button[value="cancel"]');
    check(/Вернуть его будет нельзя/.test(await p.textContent('#dlgBody')), '«Начать заново» переспрашивает');
    await dlgPress('cancel'); await p.waitForTimeout(100);
    s = await snap();
    check(s.dirty && s.roots.includes('Cs-137') && (await draft()) !== null && await noteShown(), '«Отмена» — расчёт и сообщение на месте');
    await p.click('#draftNote [data-draft="reset"]');
    await p.waitForSelector('#dlg[open] button[value="ok"]');
    await dlgPress('ok'); await p.waitForTimeout(100);
    s = await snap();
    check(!s.dirty && !s.roots.includes('Cs-137') && (await draft()) === null && !(await noteShown()), '«Начать заново»: новый расчёт, черновик удалён');
    await p.reload(); await p.waitForTimeout(100);
    check(!(await noteShown()) && !(await snap()).dirty, 'после перезагрузки — снова чистый лист');

    // 5. сохранение снимает черновик и пишет в недавние
    await hook();
    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), doc(['Ac-225'], { 'Ac-225': 1e6 }, 10));
    await p.fill('#hold', '12'); await p.waitForTimeout(600);
    check((await draft()) !== null, 'правка открытого файла — черновик');
    await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
    let rec = await recent();
    check((await draft()) === null && !(await snap()).dirty, 'после сохранения черновика нет');
    check(rec.length === 1 && rec[0].name === 'ac.hlc' && rec[0].sum === 'Ac-225 · 12 сут' && /"hold": 12/.test(rec[0].text), 'в недавних: ' + (rec[0] && rec[0].name + ' — ' + rec[0].sum));

    // 6. открытие файла (через выбор файла) — тоже в недавние, наверх
    await p.setInputFiles('#fileInput', { name: 'cs.hlc', mimeType: 'application/json', buffer: Buffer.from(doc(['Cs-137'], { 'Cs-137': 2000 }, 365)) });
    await p.waitForTimeout(300);
    rec = await recent();
    check((await snap()).name === 'cs.hlc' && rec.map((r) => r.name).join() === 'cs.hlc,ac.hlc', 'открытый файл наверху списка: ' + rec.map((r) => r.name).join(', '));
    // повторное сохранение того же расчёта не плодит записи
    await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
    rec = await recent();
    check(rec.length === 2 && rec[0].name === 'cs.hlc', 'то же имя и изотопы — одна запись');

    // 7. окно «Недавние расчёты»: открыть одним щелчком
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-list');
    const items = await p.$$eval('#dlg .recent-open', (a) => a.map((x) => x.querySelector('.recent-name').textContent + '|' + x.querySelector('.recent-sub').textContent));
    check(items.join(';') === 'cs.hlc|Cs-137 · 365 сут;ac.hlc|Ac-225 · 12 сут', 'список: ' + items.join('; '));
    check(/сегодня/.test(await p.textContent('#dlg .recent-time')), 'время: ' + await p.textContent('#dlg .recent-time'));
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'recent-dialog.png') });
    await p.click('#dlg .recent-open[data-open="1"]'); await p.waitForTimeout(300);
    s = await snap();
    check(!(await dlgOpen()) && s.name === 'ac.hlc' && s.roots.join() === 'Ac-225' && await p.inputValue('#hold') === '12' && !s.dirty, 'открыт ac.hlc из списка');
    rec = await recent();
    check(rec[0].name === 'ac.hlc', 'открытый из списка поднялся наверх');

    // 8. несохранённые изменения → открыть из списка спрашивает; «Не сохранять» удаляет черновик
    await p.fill('#hold', '20'); await p.waitForTimeout(600);
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-list');
    await p.click('#dlg .recent-open[data-open="1"]');
    await p.waitForSelector('#dlg[open] button[value="discard"]');
    check(/Несохранённые изменения/.test(await p.textContent('#dlgTitle')), 'перед открытием спрашивает про несохранённое');
    await dlgPress('discard'); await p.waitForTimeout(300);
    s = await snap();
    check(s.name === 'cs.hlc' && (await draft()) === null, '«Не сохранять»: открыт cs.hlc, черновик удалён');

    // 9. удаление из списка и очистка
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-list');
    await p.click('#dlg .recent-del[data-del="1"]'); await p.waitForTimeout(100);
    check((await p.$$('#dlg .recent-open')).length === 1 && (await recent()).length === 1, '«×» убирает запись из списка');
    await dlgPress('clear');
    await p.waitForSelector('#dlg[open] button[value="ok"]');
    check(/все расчёты \(1\)/.test(await p.textContent('#dlgBody')) && /файлы не удаляются/.test(await p.textContent('#dlgBody')), 'очистка спрашивает подтверждение');
    await dlgPress('ok'); await p.waitForTimeout(100);
    check((await recent()).length === 0, 'список очищен');
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-empty');
    check(await p.$eval('#dlg button[value="clear"]', (e) => e.disabled), 'пустой список: подсказка, «Очистить» недоступна');
    await dlgPress('cancel');

    // 10. испорченные данные в хранилище не ломают запуск
    await p.evaluate(() => { localStorage.setItem('halflife.draft', '{oops'); localStorage.setItem('halflife.recent', '"x"'); });
    await p.reload(); await p.waitForTimeout(150);
    check(!(await noteShown()) && (await draft()) === null && !(await snap()).dirty, 'испорченный черновик молча убран');
    await p.evaluate(() => localStorage.setItem('halflife.draft', JSON.stringify({ v: 1, text: '{"format":"other"}', name: 'x', time: Date.now() })));
    await p.reload(); await p.waitForTimeout(150);
    check(!(await noteShown()) && (await draft()) === null, 'черновик чужого формата убран');
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-empty');
    check(true, 'испорченный список — пустой список');
    await dlgPress('cancel');

    // 11. телефон: сообщение и окно в экране
    await p.fill('#hold', '7'); await p.waitForTimeout(600);
    await p.setViewportSize({ width: 390, height: 800 });
    await p.reload(); await p.waitForTimeout(200);
    const ov = await p.evaluate(() => { const r = document.getElementById('draftNote').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, vw: innerWidth, r: r.right, l: r.left }; });
    check(await noteShown() && ov.sw <= ov.vw && ov.r <= ov.vw && ov.l >= 0, `на телефоне сообщение в экране (${Math.round(ov.l)}–${Math.round(ov.r)} из ${ov.vw})`);
    if (OUT) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: path.join(OUT, 'draft-phone.png') }); }
    await hook();
    await p.keyboard.press('Control+s'); await p.waitForTimeout(300);
    p.evaluate(() => { App.run('recent'); });
    await p.waitForSelector('#dlg[open] .recent-list');
    const dr = await p.evaluate(() => { const r = document.querySelector('#dlg .recent-list li').getBoundingClientRect(); return { r: r.right, vw: innerWidth }; });
    check(dr.r <= dr.vw, `на телефоне список в экране (${Math.round(dr.r)} из ${dr.vw})`);
    if (OUT) await (await p.$('#dlg')).screenshot({ path: path.join(OUT, 'recent-phone.png') });
    await dlgPress('cancel');

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Черновик и недавние: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
