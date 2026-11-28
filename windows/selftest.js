/* Самопроверка компактной версии на настоящей Windows: halflife-calc.exe --selftest out.json (GitHub Actions).
 * Оболочка запускает этот код, когда страница готова; итог уходит в window.hlSelfTest('', json). */
(async () => {
  const out = { version: window.App && App.version, host: window.hostBridge && hostBridge.kind, ua: navigator.userAgent, checks: {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const bar = document.querySelector('.topbar');
    out.checks.pageMenu = !!bar && getComputedStyle(bar).display !== 'none';
    out.checks.noServiceWorker = !(navigator.serviceWorker && navigator.serviceWorker.controller);
    App.loadText(JSON.stringify({ format: 'halflife-calc', version: 4, roots: ['Ac-225'], masses: { 'Ac-225': 1 }, massUnit: 'mg', activities: {}, hold: 9.92, holdUnit: 'd' }), 'selftest.hlc');
    App.run('calc');
    await sleep(500);
    out.answer = ((document.querySelector('#answer') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    out.checks.calc = /0,5 мг из 1 мг/.test(out.answer);
    await sleep(300);
    out.title = document.title;
    const dir = window.__hlSelfDir;
    const r1 = await hostBridge.saveFile({ path: dir + '\\selftest-text.hlc', data: App.serialize() });
    out.checks.saveText = !!(r1 && r1.name === 'selftest-text.hlc');
    const r2 = await hostBridge.saveFile({ path: dir + '\\selftest-bytes.bin', data: new Uint8Array([80, 75, 3, 4, 0, 255]) });
    out.checks.saveBytes = !!(r2 && r2.name === 'selftest-bytes.bin');
    out.checks.fetchDenied = await hostBridge.fetchText('https://example.com/').then(() => false, () => true);
    out.checks.storage = (() => { try { localStorage.setItem('halflife.selftest', '1'); return localStorage.getItem('halflife.selftest') === '1'; } catch (e) { return false; } })();
    // чистое состояние: второй запуск с файлом откроет его без вопроса о сохранении
    App.loadText(JSON.stringify({ format: 'halflife-calc', version: 4, roots: ['Cs-137'], activities: {}, hold: 1, holdUnit: 'd' }), 'clean.hlc');
    out.ok = Object.values(out.checks).every(Boolean);
  } catch (e) {
    out.error = String((e && e.stack) || e);
    out.ok = false;
  }
  window.hlSelfTest('', JSON.stringify(out));
})();
