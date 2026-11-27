/* Калькулятор полураспада — настольная версия (Electron).
 * Окно показывает веб-версию из папки web/ (без сети). Нативное русское меню вызывает команды
 * страницы (window.App.run через preload), файлы открываются и сохраняются системными диалогами.
 */
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');

const WEB = path.join(__dirname, 'web');
const PRODUCT = 'Калькулятор полураспада';
let win = null;
let pageState = { dirty: false, hasResult: false, locked: false };
let presets = [];
let forceClose = false;
let lastDir = null;
let pendingFile = fileFromArgs(process.argv);

app.setAppUserModelId('ru.halflife.calc');
app.setName(PRODUCT);

function fileFromArgs(argv) {
  const f = argv.slice(1).find((a) => /\.(hlc|json)$/i.test(a) && fs.existsSync(a));
  return f ? path.resolve(f) : null;
}
function readProject(p) {
  return { path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8') };
}
function send(cmd, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('cmd', cmd, arg);
}

function buildMenu() {
  const item = (label, cmd, accelerator, extra) => ({ label, accelerator, click: () => send(cmd), ...(extra || {}) });
  const template = [
    { label: '&Файл', submenu: [
      item('Новый', 'new', 'CmdOrCtrl+N'),
      item('Открыть…', 'open', 'CmdOrCtrl+O'),
      item('Недавние расчёты…', 'recent'),
      { type: 'separator' },
      item('Сохранить', 'save', 'CmdOrCtrl+S'),
      item('Сохранить как…', 'saveAs', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      item('Экспорт в Excel (.xlsx)…', 'export', 'CmdOrCtrl+E', { enabled: !!pageState.hasResult }),
      item('Протокол в Word (.docx)…', 'protocol', undefined, { enabled: !!pageState.hasResult }),
      item('Печать протокола / PDF…', 'print', 'CmdOrCtrl+P', { enabled: !!pageState.hasResult }),
      { type: 'separator' },
      { label: 'Выход', accelerator: 'Alt+F4', click: () => { if (win) win.close(); } },
    ] },
    { label: '&Правка', submenu: [
      { label: 'Отменить', role: 'undo' }, { label: 'Повторить', role: 'redo' }, { type: 'separator' },
      { label: 'Вырезать', role: 'cut' }, { label: 'Копировать', role: 'copy' }, { label: 'Вставить', role: 'paste' },
      { label: 'Выделить всё', role: 'selectAll' },
    ] },
    { label: '&Расчёт', submenu: [
      item('Рассчитать', 'calc', 'F9', { enabled: !pageState.locked }),
      item('Изменить данные', 'edit', 'F2', { enabled: !!pageState.locked }),
      { type: 'separator' },
      item('Таблица', 'tab', 'CmdOrCtrl+1', { click: () => send('tab', 'result') }),
      item('График', 'tab', 'CmdOrCtrl+2', { click: () => send('tab', 'chart') }),
      item('Формулы', 'tab', 'CmdOrCtrl+3', { click: () => send('tab', 'formulas') }),
    ] },
    { label: '&Данные', submenu: [
      item('Ядерные данные…', 'data'),
      item('Сбросить правки T½', 'resetOverrides'),
      item('Обновить данные IAEA…', 'updateData'),
      { type: 'separator' },
      item('Подбор выдержки…', 'findHold'),
      item('Генератор: многократные отборы…', 'generator'),
      item('Пересчёт от измерения…', 'backCalc'),
      item('Погрешность результата…', 'uncertainty'),
      item('Масса и активность…', 'mass'),
      item('Схема распада…', 'scheme'),
    ] },
    { label: 'При&меры', submenu: presets.length
      ? presets.map((p) => ({ label: p.title, click: () => send('preset', p.id) }))
      : [{ label: 'Нет примеров', enabled: false }] },
    { label: '&Вид', submenu: [
      { label: 'Крупнее', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
      { label: 'Мельче', role: 'zoomOut' },
      { label: 'Обычный размер', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Во весь экран', role: 'togglefullscreen' },
      { type: 'separator' },
      { label: 'Инструменты разработчика', role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
    ] },
    { label: '&Справка', submenu: [
      item('Как пользоваться', 'guide', 'F1'),
      { type: 'separator' },
      item('О программе', 'about'),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 360, minHeight: 480,
    title: PRODUCT, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c2026' : '#e3e6ea',
    icon: fs.existsSync(path.join(__dirname, 'icon.png')) ? path.join(__dirname, 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // ссылки наружу — в системный браузер; уход со страницы (например, перетаскивание файла) запрещён
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingFile) {
      const f = pendingFile; pendingFile = null;
      try { send('openPath', readProject(f)); } catch (err) { dialog.showErrorBox('Не удалось открыть файл', f + '\n' + err.message); }
    }
  });
  win.on('close', (e) => {
    if (!forceClose && pageState.dirty) { e.preventDefault(); send('closeRequest'); }
  });
  win.webContents.on('render-process-gone', () => { forceClose = true; });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(WEB, 'index.html'));
}

// ---------- мост со страницей ----------
ipcMain.on('state', (e, s) => {
  const relevant = (x) => `${!!x.hasResult}|${!!x.locked}`;
  const rebuild = relevant(s || {}) !== relevant(pageState);
  pageState = s || {};
  if (rebuild) buildMenu();
});
ipcMain.on('presets', (e, list) => { presets = Array.isArray(list) ? list.slice(0, 50) : []; buildMenu(); });
ipcMain.on('close-now', () => { forceClose = true; if (win) win.close(); });

const FILTER_HLC = { name: 'Расчёт полураспада (*.hlc)', extensions: ['hlc'] };
// Загрузка выгрузки IAEA LiveChart: из главного процесса нет ограничений CORS; разрешён только сайт IAEA.
ipcMain.handle('fetch-text', async (e, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://www-nds.iaea.org/')) throw new Error('Адрес не разрешён');
  const r = await net.fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
});

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Открыть расчёт', defaultPath: lastDir || app.getPath('documents'),
    filters: [FILTER_HLC, { name: 'JSON', extensions: ['json'] }, { name: 'Все файлы', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  lastDir = path.dirname(r.filePaths[0]);
  app.addRecentDocument(r.filePaths[0]);
  return readProject(r.filePaths[0]);
});
ipcMain.handle('save-file', async (e, opts) => {
  opts = opts || {};
  let target = opts.path || null;
  if (!target) {
    const filters = Array.isArray(opts.filters) && opts.filters.length ? opts.filters : [];
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить', defaultPath: path.join(lastDir || app.getPath('documents'), String(opts.suggestedName || 'расчёт')),
      filters: [...filters.map((f) => (f.extensions && f.extensions[0] === 'hlc' ? FILTER_HLC : f)), { name: 'Все файлы', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  const data = typeof opts.data === 'string' ? opts.data : Buffer.from(opts.data || []);
  fs.writeFileSync(target, data);
  lastDir = path.dirname(target);
  if (/\.hlc$/i.test(target)) app.addRecentDocument(target);
  return { path: target, name: path.basename(target) };
});

// второй запуск с файлом (двойной щелчок по .hlc при открытом окне) — открываем в этом окне
const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const f = fileFromArgs(argv);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (f) {
      try { send('openPath', readProject(f)); } catch (err) { dialog.showErrorBox('Не удалось открыть файл', f + '\n' + err.message); }
    }
  });
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
