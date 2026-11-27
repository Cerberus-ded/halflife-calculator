// Скриншоты дизайна с настоящим app.js: пример → ошибка → расчёт → вкладки → диалоги → U-238.
// Запуск: node design/screenshots.js [d-light|d-dark|m-light|m-dark|s-light]; DSF=2 — для людей, FULL=1 — вся страница.
// Картинки — в папку OUTDIR (по умолчанию os.tmpdir()/hlc-design-shots), строка H-OVERFLOW = горизонтальная прокрутка.
const { chromium } = require('playwright');
process.on('unhandledRejection', (e) => console.log('unhandled', e.message));
const fs = require('fs'), path = require('path');
const os = require('os');
const DIR = path.join(os.tmpdir(), 'hlc-design-shots'), SITE = path.join(DIR, 'site'), OUT = process.env.OUTDIR || DIR;
const SRC = process.env.SRC || path.join(__dirname, '..', 'web') + path.sep;
fs.rmSync(SITE, { recursive: true, force: true }); fs.mkdirSync(SITE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(SRC)) if (fs.statSync(SRC + f).isFile()) fs.copyFileSync(SRC + f, path.join(SITE, f));
const DSF = Number(process.env.DSF || 1);

async function run(browser, tag, w, h, theme) {
  const mobile = w < 500;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: DSF, colorScheme: theme, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|manifest/i.test(m.text())) errs.push(m.text()); });
  const shot = async (name, opts = {}) => {
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`), fullPage: !!process.env.FULL, ...opts });
    console.log(tag, name, ov > 0 ? 'H-OVERFLOW ' + ov : 'ok');
  };
  await page.goto('file://' + path.join(SITE, 'index.html'));
  await page.waitForTimeout(300);
  await shot('01-start');
  // меню «Примеры»
  await page.click('.examples-menu .menu-btn');
  await page.waitForTimeout(100);
  await shot('02-presets');
  await page.click('[data-preset="customer-th229-th228"]');
  await page.waitForTimeout(300);
  await shot('03-input');
  // ошибка ввода
  const firstInput = page.locator('#inputTable td.num input').nth(1);
  await firstInput.fill('2,5ж3');
  await page.click('#calcBtn');
  await page.waitForTimeout(200);
  await shot('04-error');
  await firstInput.fill('2500');
  await page.click('#calcBtn');
  await page.waitForTimeout(400);
  await shot('05-result');
  if (mobile) { await page.evaluate(() => document.querySelector('#resultPanel').scrollIntoView()); await page.waitForTimeout(150); await shot('05b-result-scrolled'); }
  await page.click('.tab[data-tab="chart"]');
  await page.waitForTimeout(300);
  await shot('06-chart');
  await page.click('.tab[data-tab="formulas"]');
  await page.click('.fmt[data-fmt="maple"]');
  await page.waitForTimeout(200);
  await shot('07-formulas');
  await page.click('#copyFormulaBtn').catch(() => {});
  await page.waitForTimeout(150);
  await shot('07b-copied');
  // диалог «Ядерные данные»
  await page.click('.menubar .menu:nth-child(2) .menu-btn');
  await page.click('[data-cmd="data"]');
  await page.waitForTimeout(250);
  await shot('08-data');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // разблокировать и править T½
  await page.click('#editBtn');
  await page.waitForTimeout(150);
  if (mobile) await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#inputTable td.t12[role="button"] >> nth=1');
  await page.waitForTimeout(250);
  await shot('09-edit-t12');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // справка
  await page.click('.menubar .menu:nth-child(3) .menu-btn');
  await page.click('[data-cmd="guide"]');
  await page.waitForTimeout(250);
  await shot('10-guide');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // большая цепочка U-238
  await page.click('.examples-menu .menu-btn');
  await page.click('[data-preset="u238-secular"]');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => document.querySelector('#dlg').open)) {
    await shot('10b-confirm');
    console.log(tag, 'confirm buttons:', await page.evaluate(() => [...document.querySelectorAll('#dlg .dlg-foot button')].map((b) => b.value + '=' + b.textContent).join(', ')));
    await page.click('#dlg .dlg-foot button[value="discard"]');
    await page.waitForTimeout(300);
  }
  await page.click('#calcBtn', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.click('.tab[data-tab="result"]');
  await page.waitForTimeout(200);
  await shot('11a-u238-result');
  await page.click('.tab[data-tab="chart"]');
  await page.waitForTimeout(300);
  if (mobile) await page.evaluate(() => document.querySelector('#resultPanel').scrollIntoView());
  await shot('11-u238-chart');
  console.log(tag, 'errors:', errs.length ? errs.join(' | ') : 'none');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for (const [tag, w, h, theme] of [['d-light', 1280, 800, 'light'], ['d-dark', 1280, 800, 'dark'], ['m-light', 390, 844, 'light'], ['m-dark', 390, 844, 'dark'], ['s-light', 360, 740, 'light']]) {
    if (only && !tag.startsWith(only)) continue;
    try { await run(browser, tag, w, h, theme); } catch (e) { console.log(tag, 'FAILED', e.message.split('\n')[0]); }
  }
  await browser.close();
})();
