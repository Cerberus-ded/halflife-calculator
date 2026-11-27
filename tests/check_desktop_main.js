/* Главный процесс Windows-версии (desktop/main.js) без Electron: модуль загружается с поддельным electron
 * так же, как при запуске программы, в том числе с файлом в командной строке (двойной щелчок по .hlc,
 * перетаскивание файла на значок). Ловит ошибки порядка объявлений (ReferenceError при запуске с аргументом),
 * проверяет, какие файлы открываются из командной строки, и что пункты меню «Файл» совпадают с веб-версией.
 * Запуск: node tests/check_desktop_main.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { ok, done } = require('./common');

console.log('Windows-версия: главный процесс (desktop/main.js) с поддельным Electron');
const MAIN = path.join(__dirname, '..', 'desktop', 'main.js');

/** Поддельный electron: любое свойство — функция, возвращающая такой же объект; whenReady() не выполняется. */
function fakeElectron(log) {
  const make = (name) => new Proxy(function () {}, {
    get(t, k) {
      if (k === 'then') return undefined; // не «обещание»: await/then не ждут
      if (k === 'whenReady') return () => ({ then() {} });
      if (k === 'getPath') return () => os.tmpdir();
      if (k === 'requestSingleInstanceLock') return () => true;
      if (k === 'buildFromTemplate') return (tpl) => { log.menu = tpl; return make('menu'); };
      if (k === 'handle' || k === 'on') return (ch, fn) => { log.ipc[ch] = fn; };
      return make(name + '.' + String(k));
    },
    apply() { return make(name + '()'); },
    construct() { return make('new ' + name); },
  });
  return { app: make('app'), BrowserWindow: make('BrowserWindow'), Menu: make('Menu'), dialog: make('dialog'), ipcMain: make('ipcMain'),
    shell: make('shell'), nativeTheme: make('nativeTheme'), net: make('net') };
}
function load(argv) {
  const log = { ipc: {}, menu: null };
  const orig = Module._load;
  const savedArgv = process.argv;
  Module._load = function (req, parent, isMain) { return req === 'electron' ? fakeElectron(log) : orig.apply(this, arguments); };
  process.argv = argv;
  delete require.cache[require.resolve(MAIN)];
  try { require(MAIN); return { log }; } catch (e) { return { log, error: e }; } finally { Module._load = orig; process.argv = savedArgv; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-desktop-'));
const file = (n) => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };

// 1. Запуск без файла и с файлом каждого вида
const plain = load(['electron.exe']);
ok(!plain.error, 'запуск без аргументов' + (plain.error ? ': ' + plain.error.message : ''));
for (const n of ['расчёт.hlc', 'old.json', 'model.mpl', 'model.tex', 'model.py', 'формулы.txt', 'a.csv', 'b.tsv', 'книга.xlsx', 'лист.mw', 'картинка.png']) {
  const r = load(['electron.exe', file(n)]);
  ok(!r.error, `запуск с файлом «${n}»` + (r.error ? `: ${r.error.name}: ${r.error.message}` : ''));
}
// при запуске из исходников: electron.exe . файл
const src = load(['electron.exe', '.', file('расчёт2.hlc')]);
ok(!src.error, 'запуск «electron . файл.hlc»' + (src.error ? ': ' + src.error.message : ''));

// 2. Какие файлы открываются из командной строки (fileFromArgs виден через текст модуля)
const text = fs.readFileSync(MAIN, 'utf8');
const ext = (text.match(/const FORMULA_EXT = \[([^\]]*)\]/) || [])[1];
const list = ext ? ext.split(',').map((s) => s.trim().replace(/'/g, '')) : [];
ok(list.includes('mpl') && list.includes('xlsx') && !list.includes('mw'), `формулы из командной строки: ${list.join(', ')} (.mw — нет)`);
const decl = text.indexOf('const OPEN_RE'), use = text.indexOf('fileFromArgs(process.argv)');
ok(decl > 0 && use > decl, 'OPEN_RE объявлен до первого вызова fileFromArgs');

// 3. Меню «Файл» совпадает с веб-версией (index.html)
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const fileMenu = html.slice(html.indexOf('>Файл</button>'), html.indexOf('>Данные</button>'));
const webCmds = [...fileMenu.matchAll(/data-cmd="(\w+)"/g)].map((m) => m[1]);
const deskCmds = [...text.slice(text.indexOf("label: '&Файл'"), text.indexOf("label: '&Правка'")).matchAll(/item\('[^']+', '(\w+)'/g)].map((m) => m[1]);
ok(JSON.stringify(webCmds) === JSON.stringify(deskCmds), `меню «Файл»: веб ${webCmds.join(',')} / Windows ${deskCmds.join(',')}`);

fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = done('Windows-версия: главный процесс') ? 1 : 0;
