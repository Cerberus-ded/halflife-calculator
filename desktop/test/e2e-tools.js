/* Сценарии пунктов 4–8 (Playwright): чистота и предел примеси, погрешность, подбор выдержки,
 * протокол Word и печать, обновление данных IAEA из файла.
 * Запуск: node desktop/test/e2e-tools.js [папка для скриншотов]. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
const D = 86400;
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Ac-225', 'Ac-227'], activities: { 'Ac-225': 1e6, 'Ac-227': 100 }, hold: 10, holdUnit: 'd' });
const CSV = 'z,n,symbol,radius,unc_r,abundance,unc_a,energy_shift,energy,unc_e,ripl_shift,jp,half_life,operator_hl,unc_hl,unit_hl,half_life_sec,unc_hls,decay_1,decay_1_%,unc_1\n' +
  '89,136,Ac,,,,,,0,,,3/2-,9.95,,0.03,d,859680,,A,100,\n' +
  '89,138,Ac,,,,,,0,,,3/2-,21.772,,0.003,y,6.87E8,,B-,98.62,\n' +
  '90,139,Th,,,,,,0,,,"5/2+",7880,,120,y,2.48E11,,A,100,\n';

(async () => {
  console.log('Сценарии: чистота, погрешность, подбор, протокол, обновление IAEA');
  const b = await chromium.launch();
  try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  ctx.setDefaultTimeout(10000);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(PAGE);
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* нет хранилища */ } });
  await p.reload();
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); // блоки «Дополнительно» раскрыты
  await p.evaluate(() => {
    window.__saved = [];
    window.HLSaveHook = async (blob, name) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); window.__saved.push({ name, b64: btoa(s) }); return true; };
  });
  const lastSaved = async () => { const s = await p.evaluate(() => window.__saved.pop()); return s ? { name: s.name, buf: Buffer.from(s.b64, 'base64') } : null; };
  const dlgClick = async (value) => { await p.click(`#dlg button[value="${value}"]`); await p.waitForTimeout(150); };
  // ввод изотопа в поле с подсказками: напечатать и уйти из поля (как Tab)
  const pickIso = async (pg, sel, text) => { await pg.fill(sel, text); await pg.$eval(sel, (e) => e.blur()); await pg.waitForTimeout(200); };
  const sugNames = (sel) => p.$eval(sel, (e) => { const l = document.getElementById(e.getAttribute('aria-controls')); return l && !l.hidden ? [...l.querySelectorAll('.iso-opt')].map((o) => o.dataset.name) : []; });

  await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
  await p.click('#calcBtn'); await p.waitForTimeout(200);

  // ---- чистота и предел ----
  check(await p.isVisible('#purityBar'), 'строка чистоты видна после расчёта');
  await p.click('#targetSel'); await p.waitForTimeout(50);
  const allTargets = await sugNames('#targetSel');
  check(allTargets.length >= 2 && allTargets.includes('Ac-225') && allTargets.includes('Ac-227'), 'щелчок по полю «Нужный изотоп» — список изотопов расчёта: ' + allTargets.length);
  await p.fill('#targetSel', 'акт'); await p.waitForTimeout(50);
  const sAct = await sugNames('#targetSel');
  check(sAct.length >= 2 && sAct.every((x) => x.startsWith('Ac-')), '«акт» → подсказки актиния: ' + sAct.join(', '));
  await pickIso(p, '#targetSel', 'Ra-226');
  check(await p.$eval('#purityOut', (e) => e.classList.contains('bad')) && /Ra-226 нет в этом расчёте/.test(await p.textContent('#purityOut')) &&
    await p.getAttribute('#targetSel', 'aria-invalid') === 'true', 'чужой изотоп в «Нужный изотоп» — понятная ошибка: ' + await p.textContent('#purityOut'));
  await pickIso(p, '#targetSel', 'актиний-225');
  check(await p.inputValue('#targetSel') === 'Ac-225' && await p.getAttribute('#targetSel', 'aria-invalid') !== 'true', '«актиний-225» в «Нужный изотоп» → Ac-225');
  const pur = await p.textContent('#purityOut');
  check(/Радионуклидная чистота Ac-225 через 10 сут: 99,9/.test(pur), 'чистота: ' + pur);
  const heads = await p.$$eval('#resultTable thead th', (a) => a.map((x) => x.textContent));
  check(heads.includes('Примесь, %'), 'столбец «Примесь, %»');
  await p.fill('#limitInp', '0,001'); await p.waitForTimeout(100);
  check(await p.$eval('#purityOut', (e) => e.classList.contains('bad')) && (await p.textContent('#purityOut')).includes('Ac-227'), 'Ac-227 выше предела 0,001 %');
  const overRows = await p.$$eval('#resultTable tr.over td.iso', (a) => a.map((x) => x.textContent));
  check(overRows.includes('Ac-227'), 'строка Ac-227 подсвечена: ' + overRows.join(', '));
  check(await p.$eval('#calcBtn', (e) => e.hidden), 'смена цели не снимает блокировку ввода');
  const rowsPurity = await p.$$eval('#resultTable tr.purity-row td', (a) => a.map((x) => x.textContent));
  check(rowsPurity[0] === 'Чистота Ac-225, %' && /^99,9/.test(rowsPurity[2]), 'строка чистоты в таблице: ' + rowsPurity.slice(0, 3).join(' | '));

  // ---- погрешность ----
  await p.evaluate(() => { App.run('uncertainty'); }); await p.waitForTimeout(150);
  await p.fill('#uA', '5');
  await dlgClick('ok');
  const heads2 = await p.$$eval('#resultTable thead th', (a) => a.map((x) => x.textContent));
  check(heads2.includes('±, %'), 'столбец «±, %»');
  const acRow = await p.$$eval('#resultTable tbody tr', (rows) => { const r = rows.find((x) => x.querySelector('.iso') && x.querySelector('.iso').textContent === 'Ac-225'); return Array.from(r.querySelectorAll('td')).map((td) => td.textContent); });
  const pm = Number(acRow[3].replace(',', '.'));
  check(Math.abs(pm - 9.8) < 0.7, `±A(Ac-225) при ±5 % A₀: ${acRow[3]} % (≈9,8)`);
  check(await p.isVisible('#uncNote') && /Монте-Карло/.test(await p.textContent('#uncNote')), 'пояснение к погрешности');
  check(/95 %:/.test(await p.textContent('#purityOut')), 'у чистоты есть интервал 95 %');
  if (OUT) await p.screenshot({ path: path.join(OUT, 'tools-desk-result.png') });

  // ---- Excel и протокол ----
  await p.click('#exportBtn'); await p.waitForTimeout(300);
  const xl = await lastSaved();
  check(xl && xl.buf.includes(Buffer.from('Примесь, %')) && xl.buf.includes(Buffer.from('±95 %')), 'Excel: столбцы примеси и погрешности');
  await p.evaluate(() => App.run('protocol')); await p.waitForTimeout(400);
  const dx = await lastSaved();
  check(dx && dx.name.endsWith('-протокол.docx') && dx.buf.includes(Buffer.from('Протокол расчёта радиоактивного распада')) && dx.buf.includes(Buffer.from('Радионуклидная чистота Ac-225')), 'протокол Word: ' + (dx && dx.name));
  if (dx) { const f = path.join(os.tmpdir(), 'hl-e2e-protocol.docx'); fs.writeFileSync(f, dx.buf); if (OUT) fs.copyFileSync(f, path.join(OUT, 'protocol.docx')); }
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed = document.getElementById('printArea').textContent.length; }; });
  await p.evaluate(() => { App.run('print'); }); await p.waitForTimeout(150);
  check((await p.evaluate(() => window.__printed)) > 500 && await p.evaluate(() => document.body.classList.contains('has-print')), 'печать: протокол собран');
  if (OUT) { await p.emulateMedia({ media: 'print' }); await p.screenshot({ path: path.join(OUT, 'tools-print.png'), fullPage: true }); await p.emulateMedia({ media: 'screen' }); }

  // ---- подбор выдержки ----
  await p.evaluate(() => { App.run('findHold'); }); await p.waitForTimeout(150);
  await p.fill('#findName', 'ак'); await p.waitForTimeout(50);
  check((await sugNames('#findName')).length > 0, 'подбор выдержки: подсказки под полем изотопа');
  await p.press('#findName', 'Escape'); await p.waitForTimeout(50);
  check(await p.$eval('#dlg', (d) => d.open) && (await sugNames('#findName')).length === 0, 'Esc закрывает список подсказок, а не окно');
  await p.fill('#findName', 'Ra-226');
  await p.click('#dlg button[value="find"]'); await p.waitForTimeout(150);
  check(/Ra-226 нет в этом расчёте/.test(await p.textContent('#findOut')), 'подбор выдержки: чужой изотоп — ошибка: ' + await p.textContent('#findOut'));
  await p.fill('#findName', 'актиний-225'); await p.waitForTimeout(50);
  await p.press('#findName', 'Enter'); await p.waitForTimeout(100);
  check(await p.$eval('#dlg', (d) => d.open) && await p.inputValue('#findName') === 'Ac-225', 'Enter в подсказках выбирает изотоп и не закрывает окно: «актиний-225» → Ac-225');
  await p.click('#findLe'); await p.fill('#findLe', '1000');
  check(await p.$eval('#dlg button[value="apply"]', (e) => e.disabled), '«Применить» недоступна до поиска');
  await p.click('#dlg button[value="find"]'); await p.waitForTimeout(150);
  const fo = await p.textContent('#findOut');
  const tExp = 9.92 * Math.log2(1000);
  check(new RegExp('опустится до 1000 Бк через ' + String(tExp.toPrecision(4)).replace('.', ',') + ' сут').test(fo), 'спад Ac-225 до 1000 Бк: ' + fo);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'tools-find.png') });
  await p.check('#dlgBody input[name="findType"][value="max"]');
  await pickIso(p, '#findName', 'Ra-223');
  await p.click('#dlg button[value="find"]'); await p.waitForTimeout(150);
  check(/Максимум активности Ra-223/.test(await p.textContent('#findOut')), 'максимум Ra-223: ' + (await p.textContent('#findOut')));
  await pickIso(p, '#findName', 'Ac-225');
  await p.check('#dlgBody input[name="findType"][value="le"]');
  await p.click('#dlg button[value="find"]'); await p.waitForTimeout(150);
  await dlgClick('apply'); await p.waitForTimeout(250);
  const hv = Number((await p.inputValue('#hold')).replace(',', '.'));
  check(Math.abs(hv / tExp - 1) < 1e-4 && (await p.textContent('#resultTitle')).startsWith('Результат через 98,8'), `применено: выдержка ${hv} сут, ${await p.textContent('#resultTitle')}`);

  // ---- файл хранит настройки ----
  const saved = JSON.parse(await p.evaluate(() => App.serialize()));
  check(saved.purity && saved.purity.target === 'Ac-225' && saved.purity.limitPercent === 0.001 && saved.uncertainty && saved.uncertainty.uA === 5, 'в файле цель, предел и погрешность');

  // ---- обновление данных IAEA ----
  await p.click('#editBtn');
  // в тесте сети нет: загрузка с сайта IAEA сразу отказывает
  await p.evaluate(() => { window.fetch = () => Promise.reject(new TypeError('Failed to fetch')); });
  await p.evaluate(() => { App.run('updateData'); }); await p.waitForTimeout(150);
  await dlgClick('fetch'); await p.waitForTimeout(300);
  check(await p.isVisible('#dlg .iaea-link'), 'без доступа к IAEA предлагается файл и ссылка');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#dlg button[value="file"]')]);
  const csvPath = path.join(os.tmpdir(), 'hl-e2e-iaea.csv'); fs.writeFileSync(csvPath, CSV);
  await chooser.setFiles(csvPath); await p.waitForTimeout(300);
  const sum = await p.textContent('#dlgBody');
  check(/Отличаются: 1/.test(sum) && /Ac-225/.test(sum), 'сводка обновления: ' + sum.slice(0, 120));
  if (OUT) await p.screenshot({ path: path.join(OUT, 'tools-iaea.png') });
  await dlgClick('ok'); await p.waitForTimeout(150);
  await dlgClick('ok');
  const T = await p.evaluate(() => window.NUCDB['Ac-225'][0]);
  check(Math.abs(T / (9.95 * D) - 1) < 1e-12, 'T½(Ac-225) = 9,95 сут после обновления');
  await p.reload(); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); // блоки «Дополнительно» раскрыты
  const T2 = await p.evaluate(() => window.NUCDB['Ac-225'][0]);
  check(Math.abs(T2 / (9.95 * D) - 1) < 1e-12, 'обновление сохраняется после перезапуска');
  await p.evaluate(() => { App.run('uncertainty'); }); await p.waitForTimeout(150);
  check(await p.isEnabled('#uIaea') && /3 изотопа/.test(await p.textContent('#dlgBody')), 'погрешности T½ из IAEA доступны');
  await dlgClick('cancel');
  await p.evaluate(() => { App.run('updateData'); }); await p.waitForTimeout(150);
  await dlgClick('reset'); await dlgClick('ok');
  const T3 = await p.evaluate(() => window.NUCDB['Ac-225'][0]);
  check(Math.abs(T3 / (9.92 * D) - 1) < 1e-12, 'встроенная база возвращена');

  // ---- телефон, тёмная тема ----
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  ph.setDefaultTimeout(10000);
  ph.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await ph.goto(PAGE);
  await ph.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); // блоки «Дополнительно» раскрыты
  await ph.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
  await ph.click('#calcBtn'); await ph.waitForTimeout(200);
  await pickIso(ph, '#targetSel', 'Ac-225');
  const ov = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!ov, 'телефон: нет горизонтальной прокрутки');
  if (OUT) {
    await ph.evaluate(() => document.getElementById('resultPanel').scrollIntoView());
    await ph.screenshot({ path: path.join(OUT, 'tools-phone-result.png') });
    await ph.click('#editBtn');
    await ph.evaluate(() => { App.run('findHold'); }); await ph.waitForTimeout(150);
    await ph.screenshot({ path: path.join(OUT, 'tools-phone-find.png') });
  }
  check(errs.length === 0, 'ошибок JS нет ' + errs.join('; '));
  } catch (e) { fails++; console.log('  ✗ сценарий прерван: ' + e.message.split('\n')[0]); }
  finally { await b.close(); }
  console.log(fails ? `Итог: не пройдено ${fails}` : 'Итог: все проверки пройдены');
  process.exitCode = fails ? 1 : 0;
})();
