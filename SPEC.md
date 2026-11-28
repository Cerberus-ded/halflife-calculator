# Калькулятор полураспада — как устроена программа

Справка для разработчиков и агентов: что делает программа, из чего состоит и как её проверять.
Правила доработок, очередь и идеи — в [ROADMAP.md](ROADMAP.md), дизайн — в [design/DESIGN.md](design/DESIGN.md),
инструкция для пользователя — в [README.md](README.md). Состояние на 27.11.2026 (после PR #11–#13).

Язык интерфейса — русский. Пользователь — радиохимик, но интерфейс рассчитан на человека, который видит программу впервые.
Всё работает офлайн. Одна кодовая база `web/` и четыре обёртки:

- **веб** — `web/index.html` открывается двойным щелчком (file://) или с любого статического хостинга; на телефоне — PWA
  (`manifest.webmanifest` и `sw.js`);
- **Windows, компактная** — `windows/` (с версии 1.3): один exe около 8 МБ на Go и WebView2, веб-версия зашита внутрь
  и отдаётся окну с 127.0.0.1:47811; меню остаётся на странице, диалоги «Открыть» и «Сохранить» — системные;
- **Windows, Electron** — `desktop/` (нативное меню, системные диалоги, открытие `.hlc` двойным щелчком), прежняя большая сборка;
- **Android** — WebView в `android/` (страница из `file:///android_asset/www/`).

Прежний «инженерный» вид хранится в ветке `classic` и не развивается.

## Основной путь: четыре шага

1. **Изотоп.** Поле `#rootInput` понимает «Th-229», «th229», «цезий-137»; готовые примеры (`#presetMenu`) и таблица
   Менделеева (`#ptableBtn`). Цепочки со всеми дочерними, ветвлениями и стабильными концами строятся из базы сами.
2. **Сколько было.** Таблица «Было вначале» `#inputTable`: активность каждого радиоактивного изотопа (по умолчанию 0),
   единица `#actUnit` — активность или масса (г … пг, с версии 1.2: пересчёт A = λ·m·N_A/M, результат и график в массе;
   в файле `masses` и `massUnit`, а `activities` в Бк для прежних версий), T½ можно поправить щелчком (правка помечается «польз.»). Под таблицей — ссылка
   «Знаете активность только на другую дату? Пересчитать от измерения».
3. **Сколько времени пройдёт?** `#hold` и `#holdUnit` (с, мин, ч, сут, лет); в свёрнутом «Дополнительно» `#holdMore` —
   несколько сроков, расчёт по датам, подбор выдержки.
4. **Результат.** «Рассчитать» (`#calcBtn`) фиксирует ввод, «Изменить данные» (`#editBtn`) возвращает его. Ответ
   «Коротко» (`#answer`), проверка чистоты (`#purityMore`), вкладки **Таблица / График / Схема / Формулы**. Флажок
   «Атомы и масса» (`#showAtoms`) добавляет в таблицу число атомов, массу и моли.

## Меню (полный каталог команд)

Пункты — `button[data-cmd]`, команды выполняет `App.run(cmd)`. Пункты с `data-needs-result` неактивны до расчёта.

| Меню | Команды |
|---|---|
| Файл | `new`, `open` (расчёт `.hlc` или формулы: Maple, LaTeX, Python, текст, CSV, Excel), `recent`, `save`, `saveAs`, `export` (Excel), `exportFormulas`, `protocol` (Word), `print` |
| Данные | `data` (ядерные данные набора), `ptable`, `resetOverrides`, `updateData` (обновить данные IAEA) |
| Инструменты | `findHold`, `backCalc`, `uncertainty` (Монте-Карло), `mass`, `generator` |
| Справка | `guide` (F1), `about` |

В Windows то же самое плюс нативные «Правка», «Расчёт» (Рассчитать, Изменить данные, вкладки Ctrl+1–4), «Примеры»
и «Вид». «Инструменты разработчика» есть только в отладочном запуске. Тест `desktop/test/e2e-electron.js` проверяет,
что пункты «Данные» и «Инструменты» совпадают с веб-меню.

Горячие клавиши: Ctrl+N/O/S, Ctrl+Shift+S, Ctrl+E, Ctrl+P, Enter или F9 — расчёт, F1 — справка.

## Модули `web/`

Подключаются в конце `index.html` в таком порядке. Логика каждой функции — в своём модуле, `app.js` только связывает.

| Файл | Глобал | Что |
|---|---|---|
| `nucdb.js` | `NUCDB` | база ~1250 радионуклидов: `имя: [T½ с или null, 'I'/'C'/'S', [[дочерний, доля, тип], …]]`; IAEA LiveChart (ENSDF) и ICRP-107 |
| `core.js` | `HLCore` | `normalizeName`, `buildSet(roots, overrides)`, `calculate(set, A0, tSec, points)` (решение Бейтмана), форматирование; год = 365,2422 сут |
| `formulas.js` | `HLFormulas` | формулы расчёта: `text`, `maple` (в стиле заказчика), `latex`, `python` |
| `formula-import.js` | `HLImport` | обратная загрузка формул и таблиц (Maple, LaTeX, Python, текст, CSV/TSV, .xlsx) в расчёт |
| `xlsx.js` | `HLXlsx` | запись .xlsx без библиотек |
| `tools.js` | `HLTools` | несколько сроков и даты, чистота, подбор выдержки, погрешность, протокол .docx, обновление IAEA |
| `masses.js` | `NUCMASS` | атомные массы (AME 2020) |
| `amount.js` | `HLAmount` | масса, моли и активность |
| `scheme.js` | `HLScheme` | схема распада в SVG |
| `presets.js` | `HLPresets` | готовые примеры, в том числе «Th-229 + Th-228 (как в расчётах заказчика)» |
| `help.js` | `HLHelp` | тексты «Как пользоваться», «О программе», «О данных» |
| `elements.js` | `HLElements` | названия элементов по-русски, таблица Менделеева |
| `picker.js` | `HLPicker` | выбор изотопа в полях: `resolve` («торий-229», «229 тория», «радий» при одном Ra в расчёте), `suggest` и `field` — свой список подсказок под полем (`.iso-sug`); разметка поля `span.iso-field > input + button.iso-pt` |
| `ptable.js` | `HLPtable` | окно «Таблица Менделеева»: несколько изотопов для шага 1 (повторное нажатие убирает) и один изотоп для поля `.iso-field` (окно `#ptDlg` поверх окна инструмента, повторное нажатие снимает выбор) |
| `app.js` | `App` | интерфейс: шаги, меню, вкладки, файлы, черновик и недавние расчёты, генератор, пересчёт от измерения |
| `sw.js` | — | офлайн-кэш: список `FILES` и версия `CACHE` (поднимать при каждом изменении файлов) |

Новый модуль подключается везде: `index.html`, `sw.js` (`FILES` и `CACHE`), `artifact/build_artifact.py` (`FILES`),
`tests/run_all.js`, справка `help.js` и `README.md`.

Файл расчёта `.hlc` — JSON только с вводом пользователя: родоначальники, активности, выдержка, правки T½ и ветвлений.
В `localStorage` хранятся черновик, недавние расчёты, настройки графика и обновление данных IAEA.

## Связь с обёртками

- **Windows**: `desktop/preload.js` даёт странице `window.hostBridge`: `state`, `setPresets`, `onCommand`, `openFile`,
  `saveFile`, `fetchText` (только сайт IAEA), `closeNow`. В Electron HTML-меню скрыто (`body.electron`).
- **Windows, компактная**: `windows/bridge.js` даёт тот же `window.hostBridge` с `kind: 'webview2'` и `nativeMenu: false`
  (меню и горячие клавиши на странице, плюс F2 и Ctrl+1–4), `openFile`, `saveFile`, `fetchText`, `closeNow`, `state`, `ready`.
  Оболочка вызывает `__hlOpen(файл)` (запуск с файлом, второй запуск) и `__hlClose()` (крестик окна).
- **Android**: `MainActivity.java` даёт `window.AndroidHost`: `saveFile(имя, mime, base64)` (системный «Сохранить как»),
  `copyText`, `fetchText`, `print`, `isAndroid`. Скачивания `<a download>` и `navigator.clipboard` в WebView не работают.
- **claude.ai**: `artifact/build_artifact.py` собирает страницу с `artifact/artifact-host.js` (сохранение через
  разрешение downloads, печать заменяется протоколом Word).

## Проверка

```
LANG=C.UTF-8 node tests/run_all.js
```

Запускает все наборы: сверку ядра с независимым решением в 60 знаков (mpmath, scipy), формулы, импорт, Maple-код, базу,
примеры и сквозные проверки интерфейса в Chromium (`desktop/test/e2e-*.js`, Playwright). Нужны Python-пакеты
mpmath, numpy, scipy, sympy. Если менялся `desktop/`, дополнительно собрать Linux-версию и прогнать
`xvfb-run -a node desktop/test/e2e-electron.js <сборка>/halflife-calc` (см. `desktop/README.md`).

## Сборка

- Windows и веб-архив: `cd desktop && npm install && node build.mjs` → `dist/halflife-calc-win-x64.zip`,
  `dist/halflife-calc-web.zip`.
- Компактная версия для Windows: `bash windows/build.sh <папка>` → `<папка>/halflife-calc.exe` (нужны Go 1.22+ и windres
  из MinGW). Проверка на настоящей Windows — `.github/workflows/windows-exe.yml` (самопроверка `--selftest`).
- Android: `android/build.sh <рабочая папка>` → `dist/halflife-calc.apk` (нужны aapt, dx, zipalign, apksigner).
  Подписанный APK кладут в ветку `android-builds` (`apk/halflife-calc-X.Y.apk`): оттуда он попадает в релиз.
- GitHub Pages: `.github/workflows/pages.yml` публикует `web/` после тестов, когда Pages включены в настройках репозитория.
- Версии: номер в `desktop/package.json`, `web/app.js`, `web/help.js`, `android/AndroidManifest.xml` и `CHANGELOG.md`
  (проверяет `tests/check_version.js`). Новый номер в `main` → `.github/workflows/release.yml` создаёт тег `vX.Y` и релиз
  с exe для Windows, APK (из ветки `android-builds`), веб-архивом и сборкой Electron. Правила — раздел «Версии» в ROADMAP.md.

## Общая папка проекта

`/mnt/project-files` — сетевая папка: путь с завершающим `/`, без поиска по всей папке, перечитывать файл перед правкой.
Код живёт в git. `/mnt/project-files/halflife-app/` — копия `main` для чтения и готовые сборки `dist/`; их обновляют
после каждого слияния в `main`, правки туда не вносят. Исходные материалы заказчика
(фото расчётов `photo_*.jpg`, расшифровка `transcript.txt`) — в корне общей папки.
