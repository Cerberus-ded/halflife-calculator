/* Мост компактной версии для Windows (windows/bridge.js) со страницей: меню и горячие клавиши на странице,
 * системные диалоги «Открыть» и «Сохранить» через оболочку, запуск с файлом, вопрос при закрытии окна, ссылки
 * в браузере. Оболочку (функции window.hl*) здесь заменяют заглушки; сам exe проверяется на Windows
 * в GitHub Actions (.github/workflows/windows-exe.yml). Playwright.
 * Запуск: node desktop/test/e2e-winexe.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'file://' + path.join(ROOT, 'web', 'index.html');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'windows', 'bridge.js'), 'utf8');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const DOC = (root) => JSON.stringify({ format: 'halflife-calc', version: 4, roots: [root], activities: { [root]: 1000 }, hold: 1, holdUnit: 'y' });

// Заглушки оболочки: записывают вызовы, на диалоги отвечают тем, что тест положил в window.__reply
const FAKE = `
  window.__calls = [];
  const rec = (k, ...a) => window.__calls.push([k, ...a]);
  const later = (id, kind) => setTimeout(() => { const r = (window.__reply || {})[kind]; window.__hlDone(id, r ? r.ok !== false : true, r ? r.value : null); }, 10);
  window.hlState = (s) => rec('state', s);
  window.hlReady = () => rec('ready');
  window.hlOpenFile = (id) => { rec('open'); later(id, 'open'); };
  window.hlSaveFile = (id, o) => { rec('save', o); later(id, 'save'); };
  window.hlFetchText = (id, u) => { rec('fetch', u); later(id, 'fetch'); };
  window.hlCloseAck = () => rec('closeAck');
  window.hlCloseNow = () => rec('closeNow');
  window.hlOpenUrl = (u) => rec('url', u);
`;

(async () => {
  console.log('Сценарий: компактная версия для Windows (мост WebView2)');
  const b = await chromium.launch();
  const errs = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
    ctx.setDefaultTimeout(10000);
    await ctx.addInitScript(FAKE);
    await ctx.addInitScript(BRIDGE);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(PAGE);
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* нет хранилища */ } });
    await p.reload();
    await p.waitForFunction(() => window.App);
    const calls = (k) => p.evaluate((k) => window.__calls.filter((c) => c[0] === k), k);
    const reset = () => p.evaluate(() => { window.__calls = []; });

    check(await p.evaluate(() => window.hostBridge.kind === 'webview2' && !document.body.classList.contains('electron')), 'мост на месте, меню страницы не спрятано');
    check(await p.isVisible('.topbar'), 'верхнее меню страницы видно');
    check((await calls('ready')).length === 1, 'страница сообщила оболочке, что готова (hlReady)');
    const st = await calls('state');
    check(st.length > 0 && typeof st[st.length - 1][1].title === 'string', 'оболочка получает заголовок окна: ' + (st.length ? st[st.length - 1][1].title : '—'));

    // F1 — горячие клавиши страницы работают (у Electron их перехватывает нативное меню)
    await p.keyboard.press('F1'); await p.waitForTimeout(150);
    check(await p.evaluate(() => !!(document.querySelector('#dlg') && document.querySelector('#dlg').open)), 'F1 открывает справку');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);

    // «Сохранить» (Ctrl+S): системный диалог оболочки, затем повторное сохранение по тому же пути без диалога
    await p.evaluate((t) => App.loadText(t, 'cs.hlc'), DOC('Cs-137'));
    await p.fill('#inputTable input[data-name="Cs-137"]', '2000'); await p.waitForTimeout(50);
    await reset();
    await p.evaluate(() => { window.__reply = { save: { value: { path: 'C:\\Расчёты\\цезий.hlc', name: 'цезий.hlc' } } }; });
    await p.keyboard.press('Control+s'); await p.waitForTimeout(200);
    let sv = await calls('save');
    check(sv.length === 1 && sv[0][1].isText && /\.hlc$/.test(sv[0][1].suggestedName) && sv[0][1].path === '' && sv[0][1].filters[0].extensions[0] === 'hlc',
      'Ctrl+S: диалог «Сохранить» оболочки, предложено ' + (sv[0] && sv[0][1].suggestedName));
    check(JSON.parse(sv[0][1].text).activities['Cs-137'] === 2000, 'в файл уходит введённая активность');
    let snap = await p.evaluate(() => App.snapshot());
    check(snap.name === 'цезий.hlc' && !snap.dirty, 'после сохранения: имя «цезий.hlc», изменений нет');
    await p.fill('#inputTable input[data-name="Cs-137"]', '3000'); await p.waitForTimeout(50);
    await reset();
    await p.keyboard.press('Control+s'); await p.waitForTimeout(200);
    sv = await calls('save');
    check(sv.length === 1 && sv[0][1].path === 'C:\\Расчёты\\цезий.hlc', 'повторное Ctrl+S пишет в тот же файл: ' + (sv[0] && sv[0][1].path));

    // Excel: байты уходят в base64
    await p.click('#calcBtn'); await p.waitForTimeout(250);
    await reset();
    await p.evaluate(() => { window.__reply = { save: { value: { path: 'C:\\Расчёты\\цезий.xlsx', name: 'цезий.xlsx' } } }; });
    await p.click('#exportBtn'); await p.waitForTimeout(400);
    sv = await calls('save');
    const xb = sv.length ? Buffer.from(sv[0][1].b64, 'base64') : Buffer.alloc(0);
    check(sv.length === 1 && !sv[0][1].isText && xb.slice(0, 2).toString() === 'PK' && /\.xlsx$/.test(sv[0][1].suggestedName), `Excel: ${xb.length} байт (zip) через оболочку`);
    await p.click('#editBtn').catch(() => {});

    // «Открыть»: диалог оболочки, затем расчёт из файла
    await p.evaluate(() => { App.loadText(App.serialize(), 'чистый.hlc'); });
    await reset();
    await p.evaluate((t) => { window.__reply = { open: { value: { path: 'C:\\Расчёты\\стронций.hlc', name: 'стронций.hlc', text: t } } }; }, DOC('Sr-90'));
    await p.evaluate(() => { App.run('open'); }); await p.waitForTimeout(250);
    snap = await p.evaluate(() => App.snapshot());
    check((await calls('open')).length === 1 && snap.roots[0] === 'Sr-90' && snap.name === 'стронций.hlc', 'Ctrl+O: открыт «стронций.hlc» (Sr-90)');

    // запуск с файлом и второй запуск: оболочка передаёт файл через __hlOpen
    await p.evaluate((t) => window.__hlOpen({ path: 'C:\\x\\радий.hlc', name: 'радий.hlc', text: t }), DOC('Ra-226')); await p.waitForTimeout(200);
    snap = await p.evaluate(() => App.snapshot());
    check(snap.roots[0] === 'Ra-226' && snap.name === 'радий.hlc', 'файл с командной строки открылся: ' + snap.roots.join(','));

    // закрытие окна: без изменений — сразу; с изменениями — вопрос, «Не сохранять» закрывает
    await reset();
    await p.evaluate(() => window.__hlClose()); await p.waitForTimeout(150);
    check((await calls('closeAck')).length === 1 && (await calls('closeNow')).length === 1, 'крестик без изменений: окно закрывается сразу');
    await p.fill('#inputTable input[data-name="Ra-226"]', '5'); await p.waitForTimeout(50);
    await reset();
    await p.evaluate(() => window.__hlClose()); await p.waitForTimeout(200);
    check((await calls('closeAck')).length === 1 && (await calls('closeNow')).length === 0 && await p.evaluate(() => document.querySelector('#dlg').open),
      'крестик с изменениями: страница спрашивает «Сохранить изменения?»');
    await p.click('#dlg button[value="discard"]'); await p.waitForTimeout(150);
    check((await calls('closeNow')).length === 1, '«Не сохранять» закрывает окно');

    // ссылки — в системный браузер; загрузка IAEA — через оболочку
    await reset();
    await p.evaluate(() => {
      const a = document.createElement('a'); a.href = 'https://www-nds.iaea.org/relnsd/vcharthtml/VChartHTML.html'; a.target = '_blank'; a.id = 'xlink'; a.textContent = 'IAEA';
      document.body.appendChild(a); a.click(); window.open('https://example.org/');
    });
    const urls = (await calls('url')).map((c) => c[1]);
    check(urls.length === 2 && /iaea\.org/.test(urls[0]) && /example\.org/.test(urls[1]), 'ссылки открываются в браузере: ' + urls.length);
    await p.evaluate(() => { window.__reply = { fetch: { value: 'z,n,half-life' } }; });
    const got = await p.evaluate(() => hostBridge.fetchText('https://www-nds.iaea.org/api'));
    check(got === 'z,n,half-life' && (await calls('fetch')).length === 1, 'fetchText идёт через оболочку');
    await p.evaluate(() => { window.__reply = { fetch: { ok: false, value: 'Адрес не разрешён' } }; });
    const err = await p.evaluate(() => hostBridge.fetchText('https://example.org/').then(() => '', (e) => e.message));
    check(err === 'Адрес не разрешён', 'ошибка оболочки доходит до страницы: ' + err);

    check(errs.length === 0, 'ошибок JS нет ' + errs.join('; '));
  } catch (e) { fails++; console.log('  ✗ сценарий прерван: ' + e.message.split('\n')[0]); }
  finally { await b.close(); }
  console.log(`${fails ? '✗' : '✓'} Компактная версия для Windows: ошибок ${fails}`);
  process.exit(fails ? 1 : 0);
})();
