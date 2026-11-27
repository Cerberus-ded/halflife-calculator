/* Номер версии один и тот же везде: desktop/package.json, web/app.js (APP_VERSION), web/help.js (VERSION),
 * android/AndroidManifest.xml (versionName; versionCode — целое больше нуля), раздел в CHANGELOG.md.
 * По номеру из package.json GitHub Actions (.github/workflows/release.yml) создаёт тег vX.Y и релиз.
 * Запуск: node tests/check_version.js */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0;
const check = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

console.log('Номер версии');
const full = JSON.parse(read('desktop/package.json')).version;
check(/^\d+\.\d+\.\d+$/.test(full), `desktop/package.json: ${full} (вида 1.1.0)`);
const short = full.replace(/\.0$/, '');
const app = (read('web/app.js').match(/const APP_VERSION = '([^']+)'/) || [])[1];
check(app === short || app === full, `web/app.js APP_VERSION = ${app}, нужно ${short}`);
const help = (read('web/help.js').match(/const VERSION = '([^']+)'/) || [])[1];
check(help === short, `web/help.js VERSION = ${help}, нужно ${short}`);
const man = read('android/AndroidManifest.xml');
const vName = (man.match(/android:versionName="([^"]+)"/) || [])[1];
const vCode = Number((man.match(/android:versionCode="(\d+)"/) || [])[1]);
check(vName === short, `AndroidManifest versionName = ${vName}, нужно ${short}`);
check(vCode >= 1, `AndroidManifest versionCode = ${vCode}`);
const log = read('CHANGELOG.md');
const head = log.match(/^## (\d+\.\d+(?:\.\d+)?)\b/m);
check(!!head && head[1] === short, `CHANGELOG.md: первый раздел «## ${head ? head[1] : '?'}», нужно «## ${short}»`);
// versionCode растёт вместе с версией: у каждого раздела CHANGELOG свой номер сборки Android (1.0 → 1, 1.1 → 2, …)
const versions = (log.match(/^## \d+\.\d+(?:\.\d+)?\b/gm) || []).length;
check(vCode === versions, `versionCode ${vCode} = числу версий в CHANGELOG.md (${versions}) — иначе обновление на телефоне не встанет`);

console.log(`${fails ? '✗' : '✓'} Версия ${short}: ошибок ${fails}`);
process.exit(fails ? 1 : 0);
