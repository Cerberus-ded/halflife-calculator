# Настольная версия (Electron) и сборка архивов

Окно программы показывает ту же веб-версию из `../web` без сети. Меню — нативное, русское; файлы
открываются и сохраняются системными диалогами Windows.

| файл | что делает |
|---|---|
| `main.js` | окно, нативное меню (Файл, Правка, Расчёт, Данные, Инструменты, Примеры, Вид, Справка), диалоги «Открыть/Сохранить», вопрос о несохранённых изменениях при закрытии, открытие `.hlc` из командной строки и повторного запуска |
| `preload.js` | мост `window.hostBridge` для `web/app.js` |
| `build.mjs` | сборка `dist/halflife-calc-win-x64.zip` и `dist/halflife-calc-web.zip` |
| `icon.ico`, `icon.png` | иконка программы (из `web/icon-512.png`) |
| `test/e2e-web.js` | сквозная проверка веб-версии в Chromium (Playwright) |
| `test/e2e-electron.js` | проверка собранной программы (Playwright + Electron) |

## Сборка

```
cd desktop
npm install
node build.mjs                      # Windows x64 + веб-архив в ../dist
node build.mjs --platform linux     # Linux x64 (для проверки)
```

На Linux/macOS Windows-сборка не требует Wine (иконка и сведения о файле пишутся через resedit).
Electron 44.11.6, нужна Windows 10/11 x64. Для Windows 7/8 используйте веб-версию в браузере.

## Проверка

```
node test/e2e-web.js ../web                                   # веб-версия в Chromium
xvfb-run -a node test/e2e-electron.js <папка сборки>/halflife-calc  # собранная программа (Linux-сборка)
```
