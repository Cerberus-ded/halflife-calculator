/* Сценарий «Доступность» (Playwright): таблица результата и прокручиваемые окна доступны с клавиатуры,
 * рамка фокуса у тела окна только после Tab, светло-серый текст достаточно контрастный, язык страницы на claude.ai.
 * Запуск: node desktop/test/e2e-a11y.js */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = 'file://' + path.join(ROOT, 'web', 'index.html');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// Контраст по WCAG 2.1 для двух цветов вида rgb(r, g, b).
function contrast(a, b) {
  const lum = (s) => {
    const c = s.match(/\d+/g).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

(async () => {
  console.log('Сценарий: доступность');
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

    // Таблица результата
    const wrap = await p.$eval('.result-wrap', (e) => ({ ti: e.getAttribute('tabindex'), role: e.getAttribute('role'), label: e.getAttribute('aria-label') }));
    check(wrap.ti === '0' && wrap.role === 'region' && !!wrap.label, `таблица результата: tabindex=0, role=region, подпись «${wrap.label}»`);

    // Светло-серый текст: контраст не ниже 4,5 на фонах шапки, цепочки и наведения
    const cols = await p.evaluate(() => {
      const probe = (v) => { const d = document.createElement('i'); d.style.color = `var(${v})`; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      return { ink3: probe('--ink-3'), bars: ['--pane', '--bar', '--chain', '--bar-2'].map((v) => [v, probe(v)]) };
    });
    for (const [v, bg] of cols.bars) {
      const r = contrast(cols.ink3, bg);
      check(r >= 4.5, `--ink-3 на ${v}: контраст ${r.toFixed(2)}`);
    }

    // Справка: длинный текст без кнопок — тело окна доступно по Tab, рамка только после Tab
    p.evaluate(() => { App.run('guide'); });
    await p.waitForSelector('#dlg[open]'); await p.waitForTimeout(150);
    let st = await p.evaluate(() => { const d = document.getElementById('dlgBody'); return { ti: d.tabIndex, active: document.activeElement === d, kbd: d.classList.contains('kbd-focus'), scrolls: d.scrollHeight > d.clientHeight }; });
    check(st.scrolls && st.ti === 0, 'справка прокручивается, тело окна в порядке Tab');
    check(st.active && !st.kbd, 'при открытии фокус на тексте окна, без рамки');
    await p.keyboard.press('Tab');
    await p.keyboard.press('Shift+Tab');
    st = await p.evaluate(() => { const d = document.getElementById('dlgBody'); return { active: document.activeElement === d, kbd: d.classList.contains('kbd-focus'), outline: getComputedStyle(d).outlineStyle }; });
    check(st.active && st.kbd && st.outline === 'solid', 'Shift+Tab обратно к тексту: рамка фокуса видна');
    const top0 = await p.$eval('#dlgBody', (d) => d.scrollTop);
    await p.keyboard.press('PageDown'); await p.waitForTimeout(200);
    const top1 = await p.$eval('#dlgBody', (d) => d.scrollTop);
    check(top1 > top0, `PageDown листает справку (${top0} → ${Math.round(top1)})`);
    await p.mouse.click(5, 5).catch(() => {});
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    if (await p.$('#dlg[open]')) { await p.evaluate(() => document.getElementById('dlg').close('')); await p.waitForTimeout(50); }

    // Короткое окно: тело не попадает в порядок Tab
    p.evaluate(() => { App.run('about'); });
    await p.waitForSelector('#dlg[open]'); await p.waitForTimeout(150);
    st = await p.evaluate(() => { const d = document.getElementById('dlgBody'); return { ti: d.tabIndex, scrolls: d.scrollHeight > d.clientHeight + 1 }; });
    check(st.scrolls || st.ti === -1, `«О программе»: ${st.scrolls ? 'прокручивается, в порядке Tab' : 'не прокручивается, тело вне порядка Tab'}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);

    // Ядерные данные: прокручиваемая таблица без полей получает фокус
    // (после расчёта данные заперты: в таблице нет полей и кнопок; до расчёта ячейки T½ сами в порядке Tab)
    await p.evaluate(() => { App.run('preset', 'ac225-ac227'); }); await p.waitForTimeout(150);
    const tables = () => p.evaluate(() => Array.from(document.querySelectorAll('#dlgBody .table-wrap'), (t) => ({
      ti: t.tabIndex, inner: !!t.querySelector('[tabindex="0"], button, input'), scrolls: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1 })));
    const desc = (st) => st.map((t) => (t.scrolls ? 'прокрутка' : 'без прокрутки') + (t.inner ? ', ячейки в Tab' : '') + ', tabindex ' + t.ti).join('; ');
    for (const [tag, prep] of [['до расчёта', () => {}], ['после расчёта', () => App.run('calc')]]) {
      await p.evaluate(prep); await p.waitForTimeout(200);
      p.evaluate(() => { App.run('data'); });
      await p.waitForSelector('#dlg[open]'); await p.waitForTimeout(150);
      st = await tables();
      check(st.length > 0 && st.every((t) => !t.scrolls || t.inner || t.ti === 0), `«Ядерные данные» ${tag}: таблица доступна с клавиатуры (${desc(st)})`);
      await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    }

    // Повторное открытие справки после окна с полями: tabindex пересчитан
    p.evaluate(() => { App.run('guide'); });
    await p.waitForSelector('#dlg[open]'); await p.waitForTimeout(150);
    check(await p.$eval('#dlgBody', (d) => d.tabIndex === 0), 'справка снова: тело окна в порядке Tab');
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);

    check(errs.length === 0, 'ошибок JS нет' + (errs.length ? ': ' + errs.join('; ') : ''));

    // Страница на claude.ai: обёртка без lang — artifact-host.js ставит русский
    const q = await ctx.newPage();
    await q.setContent('<!doctype html><html><head></head><body><p>текст</p></body></html>');
    await q.addScriptTag({ path: path.join(ROOT, 'artifact', 'artifact-host.js') });
    check(await q.evaluate(() => document.documentElement.lang) === 'ru', 'artifact-host.js: язык страницы ru');
    await q.setContent('<!doctype html><html lang="en"><head></head><body></body></html>');
    await q.addScriptTag({ path: path.join(ROOT, 'artifact', 'artifact-host.js') });
    check(await q.evaluate(() => document.documentElement.lang) === 'en', 'artifact-host.js: заданный язык не меняет');
  } catch (e) {
    check(false, 'сценарий прерван: ' + e.message);
  } finally {
    await b.close();
  }
  console.log(fails ? `✗ Доступность: ошибок ${fails}` : '✓ Доступность: ошибок 0');
  process.exitCode = fails ? 1 : 0;
})();
