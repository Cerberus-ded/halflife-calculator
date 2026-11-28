/* Сценарий «сколько было вначале — в граммах» (версия 1.2): единица массы в шаге 2, масса в результате, ответе,
 * графике, Excel и файле; файл с массой открывается и прежними версиями (activities в Бк). Playwright.
 * Запуск: node desktop/test/e2e-massinput.js [папка для скриншотов]. */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const OUT = process.argv[2] || '';
const PAGE = 'file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const num = (s) => Number((String(s).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').match(/^[-+]?[\d.]+(?:[eE][-+]?\d+)?/) || ['NaN'])[0]);
const rel = (a, b) => Math.abs(a / b - 1);
const NA = 6.02214076e23;
const DOC = JSON.stringify({ format: 'halflife-calc', version: 3, roots: ['Ac-225'], activities: {}, hold: 9.92, holdUnit: 'd' });

(async () => {
  console.log('Сценарий: начальное количество в граммах');
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
    await p.evaluate((t) => App.loadText(t, 'ac.hlc'), DOC);
    const units = await p.$$eval('#actUnit optgroup', (a) => a.map((g) => g.label + ':' + [...g.children].map((o) => o.value).join(',')));
    check(units.length === 2 && /^Масса:g,mg,ug,ng,pg$/.test(units[1]), 'в «Единица» есть масса: ' + units.join(' | '));

    // 1 мг Ac-225: A₀ = λ·m·N_A/M; через один период полураспада остаётся 0,5 мг
    await p.selectOption('#actUnit', 'mg');
    check(await p.textContent('#a0Head') === 'm₀, мг', 'заголовок столбца ввода «m₀, мг»');
    check(/Начальная масса Ac-225, мг/.test(await p.getAttribute('#inputTable input[data-name="Ac-225"]', 'aria-label')), 'подпись поля для чтения с экрана — масса');
    await p.fill('#inputTable input[data-name="Ac-225"]', '1');
    await p.click('#calcBtn'); await p.waitForTimeout(250);
    const heads = await p.$$eval('#resultTable thead th', (a) => a.map((x) => x.textContent));
    check(heads[1] === 'm₀, мг' && heads[2] === 'm(t), мг', 'столбцы результата в мг: ' + heads.slice(1, 3).join(', '));
    const row = (n) => p.$$eval('#resultTable tbody tr', (rows, n) => { const r = rows.find((x) => x.querySelector('td.iso') && x.querySelector('td.iso').textContent === n); return r ? [...r.querySelectorAll('td')].map((td) => td.getAttribute('title') || td.textContent) : null; }, n);
    const ac = await row('Ac-225');
    check(rel(num(ac[1]), 1) < 1e-9 && rel(num(ac[2]), 0.5) < 1e-3, `Ac-225: ${ac[1]} → ${ac[2]}`);
    const bi = await row('Bi-209');
    check(bi && bi[1] === '—' && num(bi[2]) > 0.4 && num(bi[2]) < 0.5, 'стабильный Bi-209 накопился в массе: ' + (bi && bi[2]));
    const sum = await p.$$eval('#resultTable tr.total td', (a) => a.map((x) => x.getAttribute('title') || x.textContent));
    check(rel(num(sum[1]), 1) < 1e-9 && num(sum[2]) < 1 && num(sum[2]) > 0.95, `сумма массы цепочки: ${sum[1]} → ${sum[2]} (α-частицы уносят массу)`);
    // активность, в которую пересчитана масса
    const M = await p.evaluate(() => HLAmount.molarMass('Ac-225').M);
    const T = await p.evaluate(() => NUCDB['Ac-225'][0]);
    const Aexp = Math.LN2 / T * 1e-3 * NA / M;
    const doc = JSON.parse(await p.evaluate(() => App.serialize()));
    check(doc.massUnit === 'mg' && doc.masses['Ac-225'] === 1 && rel(doc.activities['Ac-225'], Aexp) < 1e-9 && doc.activityUnit === 'Бк',
      `в файле масса (masses, massUnit) и активность в Бк для прежних версий: ${doc.activities['Ac-225']} Бк`);
    check(/0,5 мг из 1 мг/.test(await p.textContent('#answer')), 'ответ «Коротко» в мг: ' + (await p.textContent('#answer')).replace(/\s+/g, ' ').slice(0, 90));
    await p.click('#tab-chart'); await p.waitForTimeout(150);
    check(/^m\(t\), мг/.test(await p.textContent('#tp-chart .toolbar-note')), 'график масс: ' + await p.textContent('#tp-chart .toolbar-note'));
    check(await p.evaluate(() => document.querySelectorAll('#chartLegend input').length) >= 9, 'в легенде и стабильный Bi-209');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'mass-input-chart.png') });
    await p.click('#tab-result'); await p.waitForTimeout(100);
    // столбец «атомы / масса / моль»: при вводе массой вместо массы — активность
    await p.check('#showAtoms');
    for (let k = 0; k < 3 && !/^A\(/.test(await p.textContent('#amountBtn')); k++) { await p.click('#amountBtn'); await p.waitForTimeout(60); }
    check(/^A\(t\), Бк$/.test(await p.textContent('#amountBtn')), 'дополнительный столбец показывает активность: ' + await p.textContent('#amountBtn'));
    if (OUT) await p.screenshot({ path: path.join(OUT, 'mass-input-table.png') });

    // Excel
    await p.click('#exportBtn'); await p.waitForTimeout(300);
    const xl = await p.evaluate(() => window.__saved.pop());
    check(xl && Buffer.from(xl.b64, 'base64').includes(Buffer.from('m₀, г')), 'Excel: столбец m₀, г');

    // файл открывается обратно в мг
    await p.click('#editBtn');
    await p.evaluate((t) => App.loadText(t, 'm.hlc'), JSON.stringify(doc));
    check(await p.inputValue('#actUnit') === 'mg' && await p.inputValue('#inputTable input[data-name="Ac-225"]') === '1', 'файл открывается снова в мг');
    // прежняя версия видит только activities в Бк — та же активность
    const old = Object.assign({}, doc); delete old.masses; delete old.massUnit;
    await p.evaluate((t) => App.loadText(t, 'old.hlc'), JSON.stringify(old));
    check(await p.inputValue('#actUnit') === 'Bq' && rel(num(await p.inputValue('#inputTable input[data-name="Ac-225"]')), Aexp) < 1e-9, 'без масс файл читается в Бк (как в версии 1.1)');

    // инструменты в режиме массы работают в Бк, «Подставить» пишет массу
    await p.evaluate((t) => App.loadText(t, 'm.hlc'), JSON.stringify(doc));
    await p.evaluate(() => { App.run('backCalc'); }); await p.waitForTimeout(150);
    await p.fill('#bcA', String(Aexp / 2)); await p.selectOption('#bcAU', 'Bq'); await p.fill('#bcT', '9.92'); await p.selectOption('#bcTU', 'd'); await p.waitForTimeout(80);
    await p.click('#dlg button[value="apply"]'); await p.waitForTimeout(200);
    check(rel(num(await p.inputValue('#inputTable input[data-name="Ac-225"]')), 1) < 1e-3, 'пересчёт от измерения подставил массу: ' + await p.inputValue('#inputTable input[data-name="Ac-225"]') + ' мг');

    // телефон
    await p.setViewportSize({ width: 360, height: 800 }); await p.waitForTimeout(100);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'телефон 360 px: без прокрутки вбок');
    check(errs.length === 0, 'ошибок JS нет ' + errs.join('; '));
  } catch (e) { fails++; console.log('  ✗ сценарий прерван: ' + e.message.split('\n')[0]); }
  finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Масса вначале: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})();
