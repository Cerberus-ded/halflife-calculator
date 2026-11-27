/* Сборка настольной версии и архивов для раздачи.
 *
 *   cd desktop && npm install && node build.mjs            # Windows x64 + архив веб-версии
 *   node build.mjs --platform linux --arch x64             # другая платформа
 *   node build.mjs --out ../dist --zip-dir <папка с electron-v*.zip>
 *
 * Результат в ../dist:
 *   halflife-calc-win-x64.zip — папка halflife-calc-win-x64 с halflife-calc.exe (портативная, установка не нужна);
 *   halflife-calc-web.zip     — папка halflife-calc-web с index.html (открыть двойным щелчком или выложить на сайт).
 * На Linux/macOS для Windows-сборки Wine не нужен: иконка и сведения о файле пишутся через resedit.
 * Архивы собираются утилитой zip (Linux/macOS) или Compress-Archive (Windows).
 */
import { packager } from '@electron/packager';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const platform = args.platform || 'win32';
const arch = args.arch || 'x64';
const OUT = path.resolve(args.out || path.join(HERE, '..', 'dist'));
const WORK = path.resolve(args.work || path.join(os.tmpdir(), 'halflife-calc-build'));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const electronVersion = (args.electron || pkg.devDependencies.electron).replace(/^[^\d]*/, '');
const PRODUCT = pkg.productName;

const WEB_FILES = fs.readdirSync(WEB).filter((f) => !f.startsWith('.') && fs.statSync(path.join(WEB, f)).isFile());
for (const need of ['index.html', 'app.js', 'core.js', 'nucdb.js']) if (!WEB_FILES.includes(need)) throw new Error('В web/ нет ' + need);

function copy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
function zipDir(parent, folder, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.rmSync(zipPath, { force: true });
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.join(parent, folder)}' -DestinationPath '${zipPath}'`], { stdio: 'inherit' })
    : spawnSync('zip', ['-r', '-9', '-X', '-q', zipPath, folder], { cwd: parent, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Не удалось создать архив ' + zipPath);
  console.log('  архив:', zipPath, (fs.statSync(zipPath).size / 1048576).toFixed(1), 'МБ');
}
const README = (kind) => [
  PRODUCT + ' ' + pkg.version,
  '',
  kind === 'win'
    ? 'Запуск: распакуйте архив в любую папку и запустите halflife-calc.exe. Установка и интернет не нужны.\r\n' +
      'Файлы расчёта (.hlc) можно открывать через меню «Файл → Открыть» или перетащить на halflife-calc.exe.\r\n' +
      'Требуется Windows 10 или 11 (64-бит). Для старых систем используйте веб-версию в браузере.'
    : 'Запуск: распакуйте архив и откройте index.html двойным щелчком (Chrome, Edge, Firefox, Яндекс Браузер).\r\n' +
      'Интернет не нужен. Чтобы установить на телефон как приложение, выложите папку на любой https-хостинг,\r\n' +
      'откройте адрес в браузере телефона и выберите «Добавить на главный экран» / «Установить приложение».',
  '',
  'Сохранение: «Файл → Сохранить» записывает введённые данные (изотопы, активности, выдержку, правки T½) в файл .hlc.',
  'Экспорт в Excel: «Файл → Экспорт в Excel» после расчёта.',
].join('\r\n') + '\r\n';

async function buildDesktop() {
  const stage = path.join(WORK, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const f of ['main.js', 'preload.js', 'icon.png']) copy(path.join(HERE, f), path.join(stage, f));
  for (const f of WEB_FILES) copy(path.join(WEB, f), path.join(stage, 'web', f));
  const appPkg = { name: pkg.name, productName: PRODUCT, version: pkg.version, description: pkg.description, main: 'main.js', author: pkg.author, license: pkg.license };
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(appPkg, null, 2));

  const outDir = path.join(WORK, 'out');
  console.log(`Electron ${electronVersion}, ${platform}-${arch}`);
  const [appPath] = await packager({
    dir: stage, out: outDir, overwrite: true, platform, arch, electronVersion,
    name: 'halflife-calc', executableName: 'halflife-calc',
    appVersion: pkg.version, buildVersion: pkg.version,
    appCopyright: '© 2026 ' + pkg.author,
    icon: path.join(HERE, platform === 'win32' ? 'icon.ico' : 'icon.png'),
    asar: true, prune: false, quiet: true,
    ...(args['zip-dir'] ? { electronZipDir: path.resolve(args['zip-dir']) } : {}),
    win32metadata: { CompanyName: pkg.author, FileDescription: PRODUCT, ProductName: PRODUCT, InternalName: 'halflife-calc', OriginalFilename: 'halflife-calc.exe' },
  });
  // ненужное в портативной версии: лицензии оставляем, лишние локали Chromium убираем (кроме ru и en-US)
  const loc = path.join(appPath, 'locales');
  if (fs.existsSync(loc)) for (const f of fs.readdirSync(loc)) if (!/^(ru|en-US)\.pak$/.test(f)) fs.rmSync(path.join(loc, f));
  const folder = `halflife-calc-${platform === 'win32' ? 'win' : platform}-${arch}`;
  const final = path.join(WORK, 'pkg', folder);
  fs.rmSync(path.join(WORK, 'pkg'), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(final), { recursive: true });
  fs.renameSync(appPath, final);
  fs.writeFileSync(path.join(final, 'README.txt'), '﻿' + README('win'));
  zipDir(path.join(WORK, 'pkg'), folder, path.join(OUT, `halflife-calc-${platform === 'win32' ? 'win' : platform}-${arch}.zip`));
  return final;
}

function buildWeb() {
  const folder = 'halflife-calc-web';
  const dir = path.join(WORK, 'web', folder);
  fs.rmSync(path.join(WORK, 'web'), { recursive: true, force: true });
  for (const f of WEB_FILES) copy(path.join(WEB, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'README.txt'), '﻿' + README('web'));
  zipDir(path.join(WORK, 'web'), folder, path.join(OUT, 'halflife-calc-web.zip'));
}

const only = args.only || 'all';
if (only === 'all' || only === 'web') buildWeb();
if (only === 'all' || only === 'desktop') {
  const dir = await buildDesktop();
  console.log('  папка программы:', dir);
}
