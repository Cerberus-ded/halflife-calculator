/* Проверка настольной версии (Electron) через Playwright.
 * Запуск (Linux, без экрана): xvfb-run -a node desktop/test/e2e-electron.js <путь к собранному исполняемому файлу> [папка вывода]
 * Системные диалоги «Открыть/Сохранить» подменяются в главном процессе, чтобы тест шёл без участия человека.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require('playwright');

const EXE = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'hlc-e2e-electron'));
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0;
const check = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };

async function launch(extra) {
  const app = await electron.launch({ executablePath: EXE, args: ['--no-sandbox', ...(extra || [])], env: { ...process.env, LANG: 'ru_RU.UTF-8' } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.App && window.hostBridge);
  return { app, win };
}
const clickMenu = (app, top, label) => app.evaluate(({ Menu }, [top, label]) => {
  const m = Menu.getApplicationMenu().items.find((i) => i.label.replace('&', '') === top);
  const it = m.submenu.items.find((i) => i.label === label);
  if (!it) throw new Error('нет пункта ' + label);
  it.click();
  return it.enabled;
}, [top, label]);
const menuEnabled = (app, top, label) => app.evaluate(({ Menu }, [top, label]) =>
  Menu.getApplicationMenu().items.find((i) => i.label.replace('&', '') === top).submenu.items.find((i) => i.label === label).enabled, [top, label]);
const mockSave = (app, file) => app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file);
const mockOpen = (app, file) => app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
const waitFile = async (f) => { for (let i = 0; i < 50 && !fs.existsSync(f); i++) await new Promise((r) => setTimeout(r, 100)); return fs.existsSync(f); };

(async () => {
  console.log('1. Запуск');
  let { app, win } = await launch();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  check((await win.title()).includes('Калькулятор полураспада'), 'заголовок окна: ' + await win.title());
  check(await win.evaluate(() => document.body.classList.contains('electron')), 'body.electron');
  check(await win.locator('#menubar').isHidden(), 'HTML-меню скрыто, вместо него нативное');
  const tops = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label.replace('&', '')));
  check(tops.join(',') === 'Файл,Правка,Расчёт,Данные,Примеры,Вид,Справка', 'нативное меню: ' + tops.join(', '));
  const presets = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label.includes('меры')).submenu.items.length);
  check(presets >= 5, `примеры в нативном меню: ${presets}`);
  check(!(await menuEnabled(app, 'Файл', 'Экспорт в Excel (.xlsx)…')), 'экспорт неактивен до расчёта');
  const fileItems = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map((i) => i.label).filter(Boolean));
  check(fileItems.includes('Экспорт формул…') && await menuEnabled(app, 'Файл', 'Экспорт формул…'), 'Файл → Экспорт формул… — как в веб-версии');

  console.log('2. Расчёт');
  await win.fill('#inputTable input[data-name="Th-229"]', '1e6');
  await win.fill('#inputTable input[data-name="Th-228"]', '1000');
  await clickMenu(app, 'Расчёт', 'Рассчитать');
  await win.waitForSelector('#resultTable tbody tr');
  check(await win.locator('#inputTable input[data-name="Th-229"]').isDisabled(), 'расчёт из меню, ввод заблокирован');
  await win.waitForTimeout(200);
  check(await menuEnabled(app, 'Файл', 'Экспорт в Excel (.xlsx)…'), 'экспорт стал активен в меню');
  await win.screenshot({ path: path.join(OUT, 'electron-result.png') });

  console.log('3. Сохранение, экспорт, открытие (системные диалоги)');
  const hlc = path.join(OUT, 'проверка.hlc');
  fs.rmSync(hlc, { force: true });
  await mockSave(app, hlc);
  await clickMenu(app, 'Файл', 'Сохранить');
  check(await waitFile(hlc), 'файл .hlc записан');
  const data = JSON.parse(fs.readFileSync(hlc, 'utf8'));
  check(data.activities['Th-229'] === 1e6 && data.roots.length === 2, 'в файле родоначальники и активности');
  await win.waitForTimeout(100);
  check((await win.locator('#docName').innerText()) === 'проверка.hlc', 'имя документа в окне: ' + await win.locator('#docName').innerText());
  check((await win.title()).startsWith('проверка.hlc'), 'заголовок окна с именем файла');
  const xlsx = path.join(OUT, 'проверка.xlsx');
  fs.rmSync(xlsx, { force: true });
  await mockSave(app, xlsx);
  await clickMenu(app, 'Файл', 'Экспорт в Excel (.xlsx)…');
  check(await waitFile(xlsx) && fs.statSync(xlsx).size > 2000, 'экспорт .xlsx записан: ' + (fs.existsSync(xlsx) ? fs.statSync(xlsx).size : 0) + ' байт');
  fs.writeFileSync(path.join(OUT, 'last.xlsx.path'), xlsx);
  await clickMenu(app, 'Файл', 'Новый');
  await win.waitForTimeout(100);
  check((await win.locator('#inputTable input[data-name="Th-229"]').inputValue()) === '0', '«Новый» из меню');
  await mockOpen(app, hlc);
  await clickMenu(app, 'Файл', 'Открыть…');
  await win.waitForFunction(() => document.querySelector('#inputTable input[data-name="Th-229"]').value !== '0');
  check((await win.locator('#inputTable input[data-name="Th-229"]').inputValue()) === '1000000', '«Открыть…» загрузил файл');

  console.log('4. Закрытие с несохранёнными изменениями');
  await win.fill('#inputTable input[data-name="Th-228"]', '7');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await win.waitForSelector('#dlg[open]');
  check(true, 'при закрытии окна спрошено о сохранении');
  await win.click('#dlg button[value="cancel"] >> nth=-1');
  await win.waitForTimeout(200);
  check(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1, '«Отмена» оставила окно открытым');
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await win.waitForSelector('#dlg[open]');
  await win.click('#dlg button[value="discard"]');
  await closed;
  check(true, '«Не сохранять» закрыло программу');
  check(errors.length === 0, 'ошибок на странице нет' + (errors.length ? ': ' + errors.join(' | ') : ''));

  console.log('5. Запуск с файлом в командной строке (как «Открыть с помощью»)');
  ({ app, win } = await launch([hlc]));
  await win.waitForFunction(() => document.querySelector('#inputTable input[data-name="Th-229"]').value !== '0', null, { timeout: 5000 }).catch(() => {});
  check((await win.locator('#docName').innerText()) === 'проверка.hlc', 'файл из аргумента открыт');
  await app.close();

  console.log(`\nИтог: ${passes} проверок пройдено, ${failures} не пройдено.`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
