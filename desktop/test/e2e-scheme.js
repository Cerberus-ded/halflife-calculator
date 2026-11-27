/* Сценарий «Схема распада» (Playwright): вкладка «Схема» в карточке результата, картинка до и после расчёта,
 * выделение цели, скачивание SVG и PNG, тёмная тема, телефон.
 * Запуск: node desktop/test/e2e-scheme.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Ac-225'], activities: { 'Ac-225': 1e6 }, hold: 10, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: схема распада');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    ctx.setDefaultTimeout(10000);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => {
      window.__saved = [];
      window.HLSaveHook = async (blob, name, mime) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); window.__saved.push({ name, mime, b64: btoa(s) }); return true; };
    });
    const lastSaved = async () => { const s = await p.evaluate(() => window.__saved.pop()); return s ? { name: s.name, mime: s.mime, buf: Buffer.from(s.b64, 'base64') } : null; };

    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
    check(await p.isVisible('#tab-scheme'), 'вкладка «Схема» в карточке результата');
    check(!(await p.$('#rootChips button:not(.chip-x)')), 'в шаге 1 у выбранных изотопов нет лишних кнопок');

    // до расчёта: A₀ из таблицы
    await p.click('#tab-scheme'); await p.waitForTimeout(200);
    check(await p.isVisible('#schemeBox svg.scheme') && !(await p.isVisible('#schemeEmpty')), 'вкладка со схемой открыта');
    const nodes = await p.$$eval('#schemeBox .sch-node .sch-name', (a) => a.map((x) => x.textContent));
    check(nodes.length === 9 && nodes[0] === 'Ac-225' && nodes.includes('Bi-209'), 'в схеме 9 изотопов: ' + nodes.join(', '));
    const acts0 = await p.$$eval('#schemeBox .sch-node.has-a .sch-act', (a) => a.map((x) => x.textContent));
    check(acts0.length === 1 && /^A₀ = 1·10⁶ Бк$/.test(acts0[0]), 'до расчёта подписана A₀: ' + acts0.join(' | '));
    const lbls = await p.$$eval('#schemeBox .sch-lbl', (a) => a.map((x) => x.textContent));
    check(lbls.includes('α 2,14 %') && lbls.includes('β⁻ 97,9 %'), 'ветвление Bi-213 подписано');
    // цвета из темы страницы (а не чёрный по умолчанию)
    const fill = await p.$eval('#schemeBox .sch-node.has-a .sch-box', (e) => getComputedStyle(e).fill);
    check(fill !== 'rgb(0, 0, 0)' && fill !== 'none', 'рамки окрашены стилями темы: ' + fill);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'scheme-before.png') });
    await p.click('#schemeSvgBtn'); await p.waitForTimeout(250);
    const svg = await lastSaved();
    check(svg && svg.name === 'ac-схема.svg' && svg.mime === 'image/svg+xml', 'скачано ' + (svg && svg.name));
    const text = svg ? svg.buf.toString('utf8') : '';
    check(text.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && text.includes('<style>') && text.includes('Bi-213'), 'файл SVG самостоятельный (со стилем)');
    await p.click('#schemePngBtn');
    await p.waitForFunction(() => window.__saved.length > 0, null, { timeout: 8000 }).catch(() => null);
    const png = await lastSaved();
    check(png && png.name === 'ac-схема.png' && png.buf.slice(1, 4).toString() === 'PNG' && png.buf.length > 5000, 'скачано PNG: ' + (png && png.name + ', ' + png.buf.length + ' байт'));
    check(!(await p.isVisible('#dlg')), 'скачивание без лишних окон');

    // после расчёта: активность через выдержку, цель выделена; команда «Схема распада» (меню Windows) открывает вкладку
    await p.click('#calcBtn'); await p.waitForTimeout(250);
    check(await p.getAttribute('#tab-scheme', 'aria-selected') === 'true', 'после расчёта остаётся открытой вкладка «Схема»');
    await p.click('#tab-result'); await p.waitForTimeout(100);
    await p.evaluate(() => { const s = document.querySelector('#targetSel'); s.value = 'Bi-213'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(100);
    await p.evaluate(() => { App.run('scheme'); }); await p.waitForTimeout(200);
    check(await p.getAttribute('#tab-scheme', 'aria-selected') === 'true', 'команда «Схема распада» открывает вкладку');
    const note = await p.textContent('#schemeNote');
    check(/Активность через 10 сут/.test(note), 'пояснение: ' + note);
    const acts = await p.$$eval('#schemeBox .sch-node.has-a', (a) => a.map((x) => x.querySelector('.sch-name').textContent + ': ' + x.querySelector('.sch-act').textContent));
    check(acts.length >= 7 && acts.some((s) => /^Bi-213: A = 49\d[\s\u00a0\u202f]\d{3} Бк$/.test(s)), 'после расчёта — A через 10 сут: ' + acts.slice(0, 4).join(' | '));
    const tgt = await p.$$eval('#schemeBox .sch-node.target .sch-name', (a) => a.map((x) => x.textContent));
    check(tgt.join() === 'Bi-213', 'целевой изотоп обведён: ' + tgt.join());
    const stableN = await p.$eval('#schemeBox .sch-node.stable .sch-act', (e) => e.textContent).catch(() => '');
    check(/^N = /.test(stableN), 'у стабильного — накопленные атомы: ' + stableN);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'scheme-after.png') });

    // протокол Word: схема вставлена рисунком
    await p.evaluate(() => { App.run('protocol'); });
    await p.waitForFunction(() => window.__saved.length > 0, null, { timeout: 8000 }).catch(() => null);
    const doc = await lastSaved();
    const zipText = doc ? doc.buf.toString('latin1') : '';
    const docXml = doc ? doc.buf.toString('utf8') : '';
    check(doc && doc.name === 'ac-протокол.docx', 'протокол сохранён: ' + (doc && doc.name));
    check(zipText.includes('word/media/image1.png') && zipText.includes('\x89PNG') && docXml.includes('r:embed="rIdImg1"') && docXml.includes('Схема распада'), 'в протоколе есть рисунок схемы');
    // печать: схема — отдельной картинкой со своими цветами
    await p.evaluate(() => { window.print = () => { window.__printed = document.querySelectorAll('#printArea .print-scheme svg.scheme-file .sch-node').length; }; App.run('print'); });
    await p.waitForTimeout(150);
    check((await p.evaluate(() => window.__printed)) === 9, 'в печати схема из 9 рамок');
    await p.emulateMedia({ media: 'print' });
    const pw = await p.evaluate(() => { const s = document.querySelector('#printArea .print-scheme svg'); const r = s.getBoundingClientRect(); return { w: r.width, h: r.height, box: getComputedStyle(s.querySelector('.sch-box')).fill }; });
    check(pw.w > 100 && pw.h > 100 && pw.box === 'rgb(237, 241, 253)', `в печати схема видна, рамки с заливкой файла (${Math.round(pw.w)}×${Math.round(pw.h)}, ${pw.box})`);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'scheme-print.png'), fullPage: true });
    await p.emulateMedia({ media: 'screen' });

    // тёмная тема: подписи светлые
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.evaluate(() => { App.run('scheme'); }); await p.waitForTimeout(200);
    const nameFill = await p.$eval('#schemeBox .sch-name', (e) => getComputedStyle(e).fill);
    const lum = (nameFill.match(/\d+/g) || [0, 0, 0]).slice(0, 3).reduce((s, v) => s + Number(v), 0) / 3;
    check(lum > 150, 'в тёмной теме названия светлые: ' + nameFill);
    if (OUT) await p.screenshot({ path: path.join(OUT, 'scheme-dark.png') });
    await p.emulateMedia({ colorScheme: 'light' });

    // телефон: схема в пределах экрана и прокручивается внутри рамки
    await p.setViewportSize({ width: 390, height: 800 });
    await p.evaluate(() => { App.run('scheme'); }); await p.waitForTimeout(250);
    const dims = await p.evaluate(() => {
      const w = document.querySelector('#schemeBox'); const d = w.getBoundingClientRect();
      const t = [...document.querySelectorAll('.tabs .tab')].map((x) => x.getBoundingClientRect());
      return { dl: d.left, dr: d.right, vw: innerWidth, sw: w.scrollWidth, cw: w.clientWidth, sh: w.scrollHeight, ch: w.clientHeight, page: document.documentElement.scrollWidth,
        tabs: Math.max(...t.map((r) => r.right)) <= innerWidth && Math.min(...t.map((r) => r.left)) >= 0 };
    });
    check(dims.dl >= 0 && dims.dr <= dims.vw && dims.page <= dims.vw, `на телефоне схема в экране (${Math.round(dims.dl)}…${Math.round(dims.dr)} из ${dims.vw})`);
    check(dims.tabs, 'на телефоне все четыре вкладки помещаются в ширину');
    check(dims.sh > dims.ch, 'длинная схема прокручивается внутри рамки');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'scheme-phone.png') });

    // без изотопов кнопки нет
    await p.setViewportSize({ width: 1280, height: 860 });
    await p.evaluate(() => { App.run('edit'); }); await p.waitForTimeout(150);
    await p.click('.chip-x[data-remove="Ac-225"]'); await p.waitForTimeout(150);
    await p.evaluate(() => { App.run('scheme'); }); await p.waitForTimeout(150);
    check(await p.isVisible('#schemeEmpty') && !(await p.isVisible('#schemeBox')), 'без изотопов вкладка подсказывает, что делать');
    check(await p.$eval('#schemePngBtn', (e) => e.disabled) && await p.$eval('#schemeSvgBtn', (e) => e.disabled), 'без изотопов скачивать нечего — кнопки неактивны');

    check(!errs.length, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));
  } finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Схема распада (интерфейс): ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
