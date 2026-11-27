# Дизайн интерфейса: что нужно знать ветке «Код»

Файлы дизайна: `web/index.html`, `web/style.css`, `web/icon.svg`, `web/icon-192.png`, `web/icon-512.png`,
`web/manifest.webmanifest`. Все id/классы/data-атрибуты из «Контракта DOM» в SPEC.md есть в разметке.
Скриншоты (с настоящим app.js): `design/screens/`.

## Как устроено
- Компьютер (≥ 900 px): окно не листается; слева панель «Исходные данные», справа вкладки. Таблицы, формулы и график
  прокручиваются внутри панелей. Внизу левой панели всегда видна строка «Выдержка / Расчёт».
- Телефон (< 900 px): панели одна под другой, страница листается; строка «Выдержка / Расчёт» прилипает к низу экрана,
  пока видна панель ввода; первая колонка таблиц закреплена при горизонтальной прокрутке. Меню раскрываются на всю ширину.
- Electron (`body.electron`): вся HTML-шапка скрыта (имя файла показывает заголовок окна через `document.title`).

## Какие состояния ставит app.js
| Что | Как | Примечание |
|---|---|---|
| Открытое меню | `.menu.open` (+ `aria-expanded="true"` у `.menu-btn`) | закрывать по клику вне меню и Esc |
| Активная вкладка | `.tab.active` и `aria-selected="true"`; неактивные панели — атрибут `hidden` | CSS понимает оба варианта |
| Выбранный формат | `.fmt.active` и `aria-pressed="true"` | |
| Блокировка ввода | `#inputPanel.locked` **или** просто `disabled` у `#hold` | штриховка таблицы, значок «Ввод заблокирован», крестики у чипов скрываются, поля выглядят «напечатанными» |
| Пустые состояния | `#emptyState`, `#resultEmpty` можно не трогать | CSS сам прячет их, когда в `tbody` есть строки, и прячет пустые таблицы (`:has`). Атрибут `hidden` тоже работает |
| Ошибка в поле | `input.invalid` или `aria-invalid="true"` | красная рамка; текст — в `#error` / `#rootError` (убрать `hidden`) |
| Скопировано | `button.done` на 1–2 с | текст кнопки можно сменить на «Скопировано» |
| Несохранённые изменения | `#dirty` без `hidden` | янтарная точка у имени файла |
| До расчёта | `[data-needs-result]` (пункт меню «Экспорт» и кнопка `#exportBtn`) в разметке уже `disabled` | после расчёта снять `disabled`, после «Изменить данные»/«Новый» — вернуть |

## Рекомендуемая разметка строк
```html
<!-- таблица ввода -->
<tr class="chain"><td colspan="3">Цепочка Th-229<small>11 изотопов</small></td></tr>
<tr><td class="iso">Th-229</td>
    <td class="t12" tabindex="0" title="Изменить T½">7 880 лет <span class="src">IAEA</span></td>
    <td class="num"><input type="text" inputmode="decimal" value="0" aria-label="A₀ Th-229, Бк"></td></tr>
<!-- правка T½: класс overridden и метка «польз.» в .src -->
<td class="t12 overridden">14,9 сут <span class="src">польз.</span></td>
<!-- стабильный -->
<tr class="stable"><td class="iso">Bi-209</td><td class="t12">—</td><td class="num"><span class="stable-note">стабильный</span></td></tr>
<!-- правка T½ прямо в ячейке (если так удобнее, чем диалог) -->
<td class="t12"><input type="text" value="7880"> лет</td>

<!-- таблица результата -->
<tr class="chain"><td colspan="4">Цепочка Th-229</td></tr>
<tr><td class="iso">Th-229</td><td class="num">1 000 000</td><td class="num">999 999</td><td class="num">3,588E17</td></tr>
<tr class="stable"><td class="iso">Bi-209</td><td class="num">—</td><td class="num">—</td><td class="num">1,219E10</td></tr>
<tr class="total"><td>Сумма</td><td class="num">…</td><td class="num">…</td><td></td></tr>
```
Подпись итога лучше короткая («Сумма»): на телефоне 360 px длинная подпись расширяет первую колонку.

Чип: `<span class="chip">Th-229 <button type="button" class="chip-x" data-remove="Th-229" aria-label="Убрать Th-229">×</button></span>`.

Пример в меню «Примеры»: `<button type="button" role="menuitem" data-preset="id" title="полное описание"><b>Название</b><small>Описание</small></button>`
(описание обрезается до двух строк).

Легенда графика: `<label><input type="checkbox" checked><i class="swatch" style="color:…"></i>Th-229</label>`
(`.swatch` рисуется `currentColor`, можно задать и `background`).

## Цвета для canvas
Брать из CSS в момент рисования (тема может смениться):
```js
const cs = getComputedStyle(document.documentElement);
const v = (n) => cs.getPropertyValue(n).trim();
v('--chart-grid'); v('--chart-axis'); v('--chart-text'); v('--font-ui');
v('--series-' + (k % 8 + 1));   // k — порядковый номер кривой, цвет закреплён за изотопом
```
Палитра из 8 цветов проверена на различимость при дальтонизме в обеих темах. Линии 2 px. Перерисовывать при
`matchMedia('(prefers-color-scheme: dark)').change` и `resize`. Холст лежит в `.chart-box` и занимает его целиком
(`clientWidth/clientHeight`), размер холста на разметку не влияет. Пока в `#resultTable` нет строк, поверх холста CSS
показывает «График появится после расчёта».

## Диалог `#dlg`
Шапка с заголовком и крестиком (`value="cancel"`), прокручиваемое тело `#dlgBody` (получает фокус при открытии),
подвал с OK (`value="ok"`). Для подтверждений можно добавить в `.dlg-foot` вторую кнопку перед OK. Внутри тела
работают `h3, p, ul, ol, code, kbd, table.grid` (в `.table-wrap`), `table.help-table`, `.note`.

## Что ещё стилизовано под app.js (по сообщению ветки «Код»)
`body.locked`, `tr.total.grand` («Всего» — двойная линия сверху), `button.legend-btn` («Все»/«Ничего»),
`#dlg.wide` (до 1080 px), `.field-row > label + input#t12Value + select#t12Unit`, `p.msg.error`, `button.failed`,
кнопки подвала диалога переносятся на телефоне (3 кнопки «Сохранить / Не сохранять / Отмена» помещаются на 360 px).
T½ кликабельна по `td.t12[role="button"]` (и в таблице ввода, и в «Ядерных данных»).

Проверено 27.11 с настоящим app.js: пример Th-229+Th-228 → ошибка ввода → расчёт → график → формулы Maple →
копирование → «Ядерные данные» → правка T½ → справка → подтверждение несохранённых изменений → U-238;
1280, 390 и 360 px, светлая и тёмная темы, без ошибок в консоли и без горизонтальной прокрутки страницы.
Скриншоты: `design/screens/1-start.png` … `9-phone-dark-chart.png`.

## Горячие клавиши в меню
В пунктах показаны Ctrl+N/O/S, Ctrl+Shift+S, Ctrl+E и F1 (Как пользоваться). F1 — сверх ТЗ, если не нужен, просто
не обрабатывать.
