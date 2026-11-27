/* Калькулятор полураспада — логика интерфейса.
 * Ввод родоначальников и активностей, расчёт (HLCore), таблица результата, график A(t), формулы (HLFormulas),
 * файлы проекта .hlc, экспорт в Excel (HLXlsx), примеры (HLPresets), справка (HLHelp).
 * Работает в браузере (file:// и http/https), как PWA, в Electron (window.hostBridge из desktop/preload.js)
 * и в Android WebView (window.AndroidHost).
 */
(function () {
  'use strict';

  const C = window.HLCore;
  const F = window.HLFormulas || null;
  const TL = window.HLTools || null; // чистота, подбор выдержки, погрешность, IAEA, .docx
  const AM = window.HLAmount || null; // массы нуклидов, масса ↔ активность
  const SCH = window.HLScheme || null; // картинка схемы распада (SVG)
  const DB = window.NUCDB || {};
  const host = window.hostBridge || null; // Electron
  const android = window.AndroidHost || null; // Android WebView

  const APP_TITLE = 'Калькулятор полураспада';
  const APP_VERSION = '1.0.0';
  const UNTITLED = 'Без имени';
  const FILE_EXT = '.hlc';
  const FILE_FORMAT = 'halflife-calc';
  const FILE_VERSION = 3; // 3: единица активности, дополнительные сроки, даты выдержки
  const HLC_MIME = 'application/json';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // Новый документ — как в задаче заказчика: цепочки Th-229 и Th-228, все активности 0, выдержка 7 сут.
  const DEFAULT_ROOTS = ['Th-229', 'Th-228'];
  const DEFAULT_HOLD = 7;
  const DEFAULT_UNIT = 'd';
  const CHART_POINTS = 300;

  const UNITS = {
    s: { sec: 1, ru: 'с' },
    min: { sec: C.units.MIN, ru: 'мин' },
    h: { sec: C.units.H, ru: 'ч' },
    d: { sec: C.units.D, ru: 'сут' },
    y: { sec: C.units.Y, ru: 'лет' },
  };
  const UNIT_ORDER = ['s', 'min', 'h', 'd', 'y'];
  // Единицы активности: в выбранной единице вводятся A₀ и показывается результат; сам расчёт всегда в Бк.
  const ACT_UNITS = {
    Bq: { f: 1, ru: 'Бк' }, kBq: { f: 1e3, ru: 'кБк' }, MBq: { f: 1e6, ru: 'МБк' }, GBq: { f: 1e9, ru: 'ГБк' },
    uCi: { f: 3.7e4, ru: 'мкКи' }, mCi: { f: 3.7e7, ru: 'мКи' }, Ci: { f: 3.7e10, ru: 'Ки' },
  };
  const DEFAULT_ACT = 'Bq';
  const MAX_EXTRA = 8; // дополнительных сроков выдержки
  const SRC_LABEL = { user: 'польз.', IAEA: 'IAEA', 'ICRP-107': 'ICRP-107', 'стабильный': '' };
  const FMT = {
    text: { ext: '.txt', mime: 'text/plain', title: 'Текст' },
    maple: { ext: '.mpl', mime: 'text/plain', title: 'Maple' },
    latex: { ext: '.tex', mime: 'text/x-tex', title: 'LaTeX' },
    python: { ext: '.py', mime: 'text/x-python', title: 'Python' },
  };
  // Категориальная палитра (8 оттенков, порядок проверен на различимость при нарушениях цветовосприятия).
  // Девятая и следующие серии получают те же цвета с другим штрихом — цвет никогда не генерируется.
  const PALETTE = {
    light: ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#008a17', '#6a4ce2', '#ec4647'],
    dark: ['#338ced', '#e76624', '#00a888', '#d28e05', '#e24d8b', '#0aac23', '#9887ef', '#eb6263'],
  };
  const DASHES = [[], [7, 4], [2, 3], [9, 3, 2, 3]];

  // ---------- утилиты ----------
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const wrapOf = (elm) => (elm && (elm.closest('.table-wrap') || elm)) || null;
  const show = (elm, on) => { if (elm) elm.hidden = !on; };
  function plural(n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2];
  }
  const fmt = (x, d) => C.fmtNum(x, d || 4);
  const full = (x) => (x === 0 ? '0' : Number(x).toPrecision(10));

  /** Число из поля ввода: «1,5e6», «1 000», «2,5·10^3», «3Е-2» (кириллическая Е). '' -> null. */
  function parseNum(s) {
    s = String(s == null ? '' : s).trim();
    if (s === '') return null;
    s = s.replace(/[\s  ]/g, '').replace(/[Ее]/g, 'e').replace(',', '.')
      .replace(/^([+]?[\d.]+)[*×xх·]10\^?([+\-−]?\d+)$/i, '$1e$2').replace('−', '-');
    if (!/^[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    const v = Number(s);
    return isFinite(v) ? v : NaN;
  }
  /** Число для поля ввода (русская запятая, экспонента для очень больших/малых). */
  function fmtInput(v) {
    if (typeof v !== 'number') return String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    let s = a >= 1e7 || a < 1e-4 ? v.toExponential().replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e', 'E') : String(Number(v.toPrecision(12)));
    return s.replace('.', ',');
  }
  function holdText(v, unit) { return fmtInput(v) + ' ' + UNITS[unit].ru; }

  // ---------- состояние ----------
  const state = {
    roots: [], // родоначальники в порядке добавления
    activities: {}, // имя -> строка из поля ввода
    overrides: {}, // имя -> {T: сек}
    set: [], // набор нуклидов (HLCore.buildSet)
    name: UNTITLED, handle: null, path: null, dirty: false,
    locked: false, result: null,
    dates: null, // {from, to} — выдержка по датам (строки datetime-local)
    target: '', countProgeny: false, // целевой изотоп для радионуклидной чистоты
    unc: { uA: 0, uT: 0, useIaea: false }, // погрешности, % (1σ)
    iaea: null, // обновление данных IAEA {date, changes: {имя: T}, unc: {имя: отн.}}
    findLast: null,
    gen: null, // генератор: {interval, unit, count, first?, eff: {элемент: %}}
    amount: 'N', // последний столбец результата: N — атомы, m — масса, mol — моль
    massLast: null,
    hidden: {}, // скрытые на графике серии
    tab: 'result', fmt: 'text', hover: null,
    chartScale: 'log', // шкала графика по вертикали: 'log' или 'lin' (запоминается в браузере)
  };

  // ---------- набор нуклидов ----------
  function rebuildSet() {
    try {
      state.set = state.roots.length ? C.buildSet(state.roots, state.overrides) : [];
    } catch (e) {
      state.set = [];
      setRootError('Не удалось построить цепочку: ' + e.message);
    }
  }
  /** Группы для отображения: по родоначальнику, в порядке добавления. */
  function groupsOf(list, roots) {
    return roots.map((r) => ({ root: r, items: list.filter((x) => x.root === r) })).filter((g) => g.items.length);
  }

  function setRootError(msg) {
    const e = $('#rootError'); if (!e) return;
    e.textContent = msg || ''; e.hidden = !msg;
  }

  function addRoots(text) {
    if (state.locked) return;
    const parts = String(text || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) { setRootError('Введите изотоп, например Th-229.'); return; }
    const errors = [];
    let added = 0;
    for (const p of parts) {
      const name = C.normalizeName(p) || nameFromWords(p);
      if (!name) { errors.push(unknownText(p)); continue; }
      if (DB[name][0] == null) { errors.push(`${name} стабилен — у него нет распада.`); continue; }
      if (state.roots.includes(name)) { errors.push(`${name} уже добавлен.`); continue; }
      const inSet = state.set.find((x) => x.name === name);
      if (inSet) { errors.push(`${name} уже входит в цепочку ${inSet.root} — задайте его активность там.`); continue; }
      state.roots.push(name);
      rebuildSet();
      added++;
    }
    setRootError(errors.join(' '));
    if (added) {
      $('#rootInput').value = '';
      changed();
      renderInput();
    }
  }
  function removeRoot(name) {
    if (state.locked) return;
    state.roots = state.roots.filter((r) => r !== name);
    rebuildSet();
    setRootError('');
    changed();
    renderInput();
  }

  // ---------- названия элементов и таблица Менделеева ----------
  const EL = window.HLElements || null;
  /** «цезий-137», «137 цезий», «технеций-99м» -> Cs-137, Tc-99m (или null). */
  function nameFromWords(p) {
    const r = EL && EL.parse(p);
    return r && r.a ? C.normalizeName(r.sym + '-' + r.a + r.meta) : null;
  }
  /** Радиоактивные изотопы элемента из базы, по массовому числу. */
  function isotopesOf(sym) {
    const key = (n) => { const m = n.match(/^[A-Za-z]+-(\d+)(\w*)$/); return m ? +m[1] + (m[2] ? 0.5 : 0) : 0; };
    return Object.keys(DB).filter((n) => DB[n][0] != null && n.slice(0, n.indexOf('-')) === sym).sort((a, b) => key(a) - key(b));
  }
  function elementRu(sym) { const e = EL && EL.bySym[sym]; return e ? e.ru : sym; }
  /** Понятное сообщение, если изотоп не распознан. */
  function unknownText(p) {
    const r = EL && EL.parse(p);
    if (!r) return `«${p}» нет в базе нуклидов.`;
    const iso = isotopesOf(r.sym);
    const ru = elementRu(r.sym);
    if (!iso.length) return `У элемента ${ru} (${r.sym}) в базе нет радиоактивных изотопов.`;
    const longest = iso.slice().sort((a, b) => DB[b][0] - DB[a][0]).slice(0, 3);
    if (!r.a) return `${ru}: какой изотоп? Укажите массовое число, например ${longest.join(', ')}. Все изотопы — кнопка «Таблица Менделеева».`;
    return `Изотопа ${r.sym}-${r.a}${r.meta} нет в базе. Есть, например: ${longest.join(', ')}.`;
  }

  async function cmdPtable(start) {
    if (!EL) return;
    if (state.locked) { dialog({ title: 'Таблица Менделеева', html: '<p>Сейчас данные закреплены. Нажмите «Изменить данные», чтобы добавить изотоп.</p>' }); return; }
    const avail = {};
    for (const n of Object.keys(DB)) if (DB[n][0] != null) { const s = n.slice(0, n.indexOf('-')); avail[s] = (avail[s] || 0) + 1; }
    const inUse = new Set(state.roots.map((r) => r.slice(0, r.indexOf('-'))));
    let cells = '';
    for (const e of EL.list) {
      const p = EL.pos(e.z), n = avail[e.sym] || 0;
      const t = n ? `${e.ru}, Z = ${e.z}. Радиоактивных изотопов в базе: ${n}` : `${e.ru}, Z = ${e.z}. Нет в базе`;
      cells += `<button type="button" class="pt-el${n ? '' : ' none'}${inUse.has(e.sym) ? ' used' : ''}" data-sym="${e.sym}" data-row="${p.row}" data-col="${p.col}"` +
        ` style="grid-row:${p.row};grid-column:${p.col}" title="${esc(t)}" aria-label="${esc(t)}" tabindex="-1"${n ? '' : ' disabled'}>` +
        `<small>${e.z}</small><b>${e.sym}</b></button>`;
    }
    cells += '<span class="pt-ph" style="grid-row:6;grid-column:3" aria-hidden="true">57–71</span><span class="pt-ph" style="grid-row:7;grid-column:3" aria-hidden="true">89–103</span>' +
      '<span class="pt-flabel" style="grid-row:9;grid-column:1 / span 2">лантаноиды</span><span class="pt-flabel" style="grid-row:10;grid-column:1 / span 2">актиноиды</span>';
    const p = dialog({
      title: 'Таблица Менделеева', wide: true,
      html: '<div class="pt-top"><input id="ptSearch" type="search" placeholder="Найти: цезий, Cs или 55" aria-label="Найти элемент" autocomplete="off" spellcheck="false">' +
        '<p class="pt-help">Выберите элемент, затем изотоп — он добавится в расчёт. Можно выбрать несколько.</p></div>' +
        `<div class="pt-wrap"><div class="pt-grid" role="group" aria-label="Элементы">${cells}</div></div>` +
        '<div id="ptIso" class="pt-iso" aria-live="polite"></div><p id="ptStatus" class="pt-status" role="status"></p>',
      buttons: [{ label: 'Готово', value: 'ok', primary: true }],
    });
    const body = $('#dlgBody'), grid = $('.pt-grid', body), search = $('#ptSearch'), isoBox = $('#ptIso'), status = $('#ptStatus');
    let sel = null;
    const cellOf = (sym) => $(`.pt-el[data-sym="${sym}"]`, grid);
    const setStatus = (text, err) => { status.textContent = text || ''; status.classList.toggle('error', !!err); };
    function renderIso(focusName) {
      if (!sel) { isoBox.innerHTML = '<p class="pt-hint">Выберите элемент — здесь появятся его радиоактивные изотопы.</p>'; return; }
      const e = EL.bySym[sel], iso = isotopesOf(sel);
      const roots = new Set(state.roots), inSet = new Set(state.set.map((x) => x.name));
      isoBox.innerHTML = `<h3>${esc(e.ru)} <span>${esc(e.sym)} · Z = ${e.z}</span></h3><div class="pt-iso-list">` + iso.map((n) => {
        const added = roots.has(n), chain = !added && inSet.has(n);
        const note = added ? 'добавлен' : chain ? 'уже в цепочке' : C.fmtHalfLife(DB[n][0]);
        return `<button type="button" class="pt-iso-btn${added ? ' added' : ''}${chain ? ' chain' : ''}" data-add="${esc(n)}"${added ? ' aria-pressed="true"' : ''}>` +
          `<b>${esc(n)}</b><span>${esc(note)}</span></button>`;
      }).join('') + '</div>';
      if (focusName) { const b = $(`[data-add="${focusName}"]`, isoBox); if (b) b.focus(); }
    }
    function select(sym, focusCell) {
      const c = cellOf(sym); if (!c || c.disabled) return;
      $$('.pt-el.sel', grid).forEach((x) => { x.classList.remove('sel'); x.tabIndex = -1; x.removeAttribute('aria-pressed'); });
      c.classList.add('sel'); c.tabIndex = 0; c.setAttribute('aria-pressed', 'true');
      sel = sym; renderIso();
      if (focusCell) c.focus();
      c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function add(n) {
      if (state.roots.includes(n)) { setStatus(`${n} уже добавлен.`); return; }
      addRoots(n);
      const ok = state.roots.includes(n);
      if (ok) {
        setStatus(`${n} добавлен в расчёт. Можно выбрать ещё или нажать «Готово».`);
        const c = cellOf(sel); if (c) c.classList.add('used');
      } else setStatus(($('#rootError') || {}).textContent || `${n} не добавлен.`, true);
      renderIso(n);
    }
    // первая клетка в порядке обхода — фокусируемая
    const first = cellOf(state.roots.length ? state.roots[state.roots.length - 1].split('-')[0] : 'H') || cellOf('H');
    if (first) first.tabIndex = 0;
    renderIso();
    const onClick = (ev) => {
      const c = ev.target.closest('.pt-el'); if (c && !c.disabled) { select(c.dataset.sym); setStatus(''); return; }
      const b = ev.target.closest('[data-add]'); if (b) add(b.dataset.add);
    };
    const onGridKey = (ev) => {
      const c = ev.target.closest('.pt-el'); if (!c) return;
      const dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
      if (!dir) { if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); const all = $$('.pt-el:not(:disabled)', grid); const t = ev.key === 'Home' ? all[0] : all[all.length - 1]; t.tabIndex = 0; c.tabIndex = -1; t.focus(); } return; }
      ev.preventDefault();
      const r = +c.dataset.row, col = +c.dataset.col;
      const all = $$('.pt-el:not(:disabled)', grid).map((x) => ({ x, r: +x.dataset.row, c: +x.dataset.col }));
      let cand;
      if (dir[0] === 0) {
        cand = all.filter((o) => o.r === r && (dir[1] > 0 ? o.c > col : o.c < col)).sort((a, b) => (dir[1] > 0 ? a.c - b.c : b.c - a.c))[0];
      } else {
        const rows = [...new Set(all.map((o) => o.r))].filter((x) => (dir[0] > 0 ? x > r : x < r)).sort((a, b) => (dir[0] > 0 ? a - b : b - a));
        for (const rr of rows) { const inRow = all.filter((o) => o.r === rr); if (inRow.length) { cand = inRow.sort((a, b) => Math.abs(a.c - col) - Math.abs(b.c - col))[0]; break; } }
      }
      if (cand) { c.tabIndex = -1; cand.x.tabIndex = 0; cand.x.focus(); }
    };
    const onSearch = () => {
      const q = search.value.trim();
      $$('.pt-el.hit', grid).forEach((x) => x.classList.remove('hit'));
      if (!q) { setStatus(''); return; }
      const r = EL.parse(q);
      const lq = q.toLowerCase().replace(/ё/g, 'е');
      const hits = r ? [EL.bySym[r.sym]] : EL.list.filter((e) => String(e.z) === q || e.sym.toLowerCase() === lq || e.ru.toLowerCase().replace(/ё/g, 'е').startsWith(lq));
      const ok = hits.filter((e) => avail[e.sym]);
      ok.forEach((e) => { const c = cellOf(e.sym); if (c) c.classList.add('hit'); });
      if (ok.length) select(ok[0].sym);
      setStatus(ok.length ? '' : 'Не найдено. Введите название элемента (цезий), символ (Cs) или номер (55).', !ok.length);
    };
    const onSearchKey = (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault(); ev.stopPropagation();
      const name = C.normalizeName(search.value) || nameFromWords(search.value);
      if (name && DB[name][0] != null) { if (name.split('-')[0] !== sel) select(name.split('-')[0]); add(name); return; }
      const b = $('.pt-iso-btn', isoBox); if (b) b.focus();
    };
    body.addEventListener('click', onClick);
    grid.addEventListener('keydown', onGridKey);
    search.addEventListener('input', onSearch);
    search.addEventListener('keydown', onSearchKey);
    if (start && EL.symbolOf(start)) { search.value = start; onSearch(); }
    search.focus();
    await p;
    body.removeEventListener('click', onClick);
  }

  // ---------- панель ввода ----------
  function fillNuclideList() {
    const dl = $('#nuclideList'); if (!dl) return;
    const names = Object.keys(DB).filter((n) => DB[n][0] != null);
    const key = (n) => { const m = n.match(/^([A-Za-z]+)-(\d+)(\w*)$/); return m ? [m[1], +m[2], m[3]] : [n, 0, '']; };
    names.sort((a, b) => { const x = key(a), y = key(b); return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || (x[2] < y[2] ? -1 : 1); });
    const frag = document.createDocumentFragment();
    for (const n of names) {
      const o = document.createElement('option');
      const ru = EL && EL.bySym[n.slice(0, n.indexOf('-'))];
      o.value = n; o.label = (ru ? ru.ru + '-' + n.slice(n.indexOf('-') + 1) + ' · ' : '') + C.fmtHalfLife(DB[n][0]);
      frag.appendChild(o);
    }
    dl.innerHTML = ''; dl.appendChild(frag);
  }

  function renderChips() {
    const box = $('#rootChips'); if (!box) return;
    box.innerHTML = state.roots.map((r) =>
      `<span class="chip">${esc(r)} <button type="button" class="chip-x" data-remove="${esc(r)}" title="Убрать цепочку ${esc(r)}" aria-label="Убрать ${esc(r)}"${state.locked ? ' disabled' : ''}>×</button></span>`).join('') +
      (SCH && state.roots.length ? '<button type="button" class="chip-scheme" id="schemeBtn" data-cmd="scheme" title="Картинка цепочки: кто во что распадается, доли ветвлений, T½ и активности">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="1.5" width="6" height="4" rx="1"/><rect x="1" y="10.5" width="6" height="4" rx="1"/><rect x="9" y="10.5" width="6" height="4" rx="1"/><path d="M8 5.5v2.5M4 10.5V8h8v2.5"/></svg>Схема распада</button>' : '');
  }

  function renderInputTable() {
    const table = $('#inputTable'); if (!table) return;
    const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    const rows = [];
    for (const g of groupsOf(state.set, state.roots)) {
      const n = g.items.length;
      rows.push(`<tr class="chain"><td colspan="3">Цепочка ${esc(g.root)} <small>${n} ${plural(n, ['изотоп', 'изотопа', 'изотопов'])}</small></td></tr>`);
      for (const x of g.items) {
        const stable = x.lambda === 0;
        const over = !!(state.overrides[x.name] && state.overrides[x.name].T != null);
        const base = DB[x.name] ? DB[x.name][0] : null;
        const src = SRC_LABEL[x.src] != null ? SRC_LABEL[x.src] : x.src;
        const title = stable ? 'Стабильный изотоп' : over
          ? `Изменено пользователем. По базе: ${C.fmtHalfLife(base)}. Нажмите, чтобы изменить или вернуть.`
          : `Источник: ${x.src}. Нажмите, чтобы изменить T½.`;
        const t12attrs = stable ? '' : ` tabindex="0" role="button" data-edit="${esc(x.name)}"`;
        const val = state.activities[x.name] != null ? state.activities[x.name] : '0';
        rows.push(`<tr data-name="${esc(x.name)}"${stable ? ' class="stable"' : ''}><td class="iso">${esc(x.name)}</td>` +
          `<td class="t12${over ? ' overridden' : ''}${stable ? ' stable' : ''}"${t12attrs} title="${esc(title)}">${stable ? '—' : esc(C.fmtHalfLife(x.T))}` +
          `${src ? ` <span class="src">${esc(src)}</span>` : ''}</td>` +
          `<td class="num">${stable ? '<span class="stable-note" title="Стабильный изотоп: накапливается, начальная активность не задаётся">стабильный</span>'
            : `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-name="${esc(x.name)}" value="${esc(val)}" aria-label="Начальная активность ${esc(x.name)}, ${esc(ACT_UNITS[actUnit()].ru)}"${state.locked ? ' disabled' : ''}>`}</td></tr>`);
      }
    }
    tb.innerHTML = rows.join('');
    validateInputs(false);
    const has = state.roots.length > 0;
    show($('#emptyState'), !has);
    show(wrapOf(table), has);
  }

  function renderInput() {
    renderChips();
    renderInputTable();
    scheduleFormulas();
  }

  /** Подсвечивает неверные числа; возвращает {A0, bad}. */
  function validateInputs(mark) {
    const A0 = {}; const bad = [];
    for (const inp of $$('#inputTable input[data-name]')) {
      const v = parseNum(inp.value);
      const ok = v === null || (!isNaN(v) && v >= 0);
      inp.classList.toggle('invalid', !ok);
      if (ok) inp.removeAttribute('aria-invalid'); else inp.setAttribute('aria-invalid', 'true');
      if (ok) A0[inp.dataset.name] = v || 0; else bad.push(inp.dataset.name);
    }
    if (mark && bad.length) { const first = $(`#inputTable input[data-name="${CSS.escape(bad[0])}"]`); if (first) first.focus(); }
    return { A0, bad };
  }
  function readHold() {
    const unit = UNITS[$('#holdUnit').value] ? $('#holdUnit').value : DEFAULT_UNIT;
    const raw = $('#hold').value;
    const v = parseNum(raw);
    const ok = v !== null && !isNaN(v) && v >= 0;
    $('#hold').classList.toggle('invalid', !ok);
    return { ok, value: ok ? v : 0, unit, empty: v === null, tSec: ok ? v * UNITS[unit].sec : 0 };
  }
  function setHold(v, unit) {
    const inp = $('#hold');
    inp.value = inp.type === 'number' ? String(v) : fmtInput(v);
    $('#holdUnit').value = UNITS[unit] ? unit : DEFAULT_UNIT;
    inp.classList.remove('invalid');
  }

  function showError(msg) { const e = $('#error'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }

  // ---------- единица активности ----------
  function actUnit() { const sel = $('#actUnit'); return sel && ACT_UNITS[sel.value] ? sel.value : DEFAULT_ACT; }
  function setActUnit(u) { const sel = $('#actUnit'); if (sel) sel.value = ACT_UNITS[u] ? u : DEFAULT_ACT; renderActUnit(); }
  function renderActUnit() {
    const ru = ACT_UNITS[actUnit()].ru;
    const h = $('#a0Head'); if (h) h.textContent = 'A₀, ' + ru;
    for (const inp of $$('#inputTable input[data-name]')) inp.setAttribute('aria-label', `Начальная активность ${inp.dataset.name}, ${ru}`);
  }

  // ---------- дополнительные сроки выдержки ----------
  /** «1; 14; 30», «1 14 30», «1, 14, 30» или «1,14,30» (одна запятая внутри числа — десятичная). */
  function readExtra() {
    const inp = $('#holdExtra'); const raw = inp ? inp.value.trim() : '';
    const res = { ok: true, values: [], raw };
    for (let t of raw ? raw.split(/[;\s]+/) : []) {
      t = t.replace(/^,+|,+$/g, '');
      if (!t) continue;
      for (const x of (t.match(/,/g) || []).length > 1 ? t.split(',') : [t]) {
        const v = parseNum(x);
        if (v === null) continue;
        if (isNaN(v) || v < 0) res.ok = false; else res.values.push(v);
      }
    }
    if (res.values.length > MAX_EXTRA) res.ok = false;
    if (inp) inp.classList.toggle('invalid', !res.ok);
    return res;
  }
  function setLimit(pct) { const inp = $('#limitInp'); if (inp) { inp.value = fmtInput(pct); inp.classList.remove('invalid'); } }
  function setExtra(text) { const inp = $('#holdExtra'); if (inp) { inp.value = text || ''; inp.classList.remove('invalid'); } }

  // ---------- выдержка по датам ----------
  function parseLocal(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return isNaN(d.getTime()) ? null : d;
  }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDate(s) {
    const d = parseLocal(s);
    return d ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function validDates(o) {
    const a = o && parseLocal(o.from), b = o && parseLocal(o.to);
    return a && b && b >= a ? { from: String(o.from).slice(0, 16), to: String(o.to).slice(0, 16) } : null;
  }
  const datesSec = (o) => (parseLocal(o.to) - parseLocal(o.from)) / 1000;
  /** «7 сут 2 ч 30 мин» — длительность для подсказок. */
  function spanText(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.round(sec % 3600 / 60);
    const parts = [];
    if (d) parts.push(d + ' сут'); if (h) parts.push(h + ' ч'); if (m || !parts.length) parts.push(m + ' мин');
    return parts.join(' ');
  }
  function renderDates() {
    const p = $('#holdDates'); if (!p) return;
    const o = state.dates;
    p.hidden = !o;
    p.textContent = o ? `По датам: калибровка ${fmtDate(o.from)} → использование ${fmtDate(o.to)}` : '';
  }
  /** Выдержка по датам в выбранной единице. */
  function holdFromDates(unit) {
    const sec = datesSec(state.dates);
    setHold(Number((sec / UNITS[unit].sec).toPrecision(10)), unit);
  }
  function clearDates() { if (state.dates) { state.dates = null; renderDates(); } }
  async function editDates() {
    if (state.locked) return;
    const h = readHold();
    let from = state.dates && state.dates.from, to = state.dates && state.dates.to;
    if (!from) {
      const now = new Date(); now.setSeconds(0, 0);
      from = toLocalInput(now);
      to = toLocalInput(new Date(now.getTime() + Math.round((h.ok ? h.tSec : 0) / 60) * 60000));
    }
    const body = `<p>Начальные активности в таблице заданы на дату калибровки. Выдержка — время от неё до даты использования.</p>` +
      `<div class="date-grid"><label for="dateFrom">Дата калибровки</label><input id="dateFrom" type="datetime-local" value="${esc(from)}">` +
      `<label for="dateTo">Дата использования</label><input id="dateTo" type="datetime-local" value="${esc(to)}"></div>` +
      `<p class="date-result" id="dateResult"></p><p class="msg error" id="dateError" role="alert" hidden></p>`;
    const buttons = [{ label: 'OK', value: 'ok', primary: true }];
    if (state.dates) buttons.push({ label: 'Убрать даты', value: 'reset' });
    buttons.push({ label: 'Отмена', value: 'cancel' });
    const err = (t) => { const e = $('#dateError'); if (e) { e.textContent = t || ''; e.hidden = !t; } };
    let picked = null;
    const pr = dialog({
      title: 'Выдержка по датам', html: body, buttons, focus: '#dateFrom',
      validate: (val) => {
        if (val !== 'ok') return true;
        const a = parseLocal($('#dateFrom').value), b = parseLocal($('#dateTo').value);
        if (!a || !b) { err('Укажите обе даты и время.'); return false; }
        if (b < a) { err('Дата использования раньше даты калибровки.'); return false; }
        picked = { from: $('#dateFrom').value.slice(0, 16), to: $('#dateTo').value.slice(0, 16) };
        return true;
      },
    });
    const upd = () => {
      const a = parseLocal($('#dateFrom') && $('#dateFrom').value), b = parseLocal($('#dateTo') && $('#dateTo').value);
      const out = $('#dateResult'); if (!out) return;
      err('');
      out.textContent = a && b ? (b < a ? 'Дата использования раньше даты калибровки.' : 'Выдержка: ' + spanText((b - a) / 1000)) : '';
    };
    for (const id of ['#dateFrom', '#dateTo']) { const e = $(id); if (e) { e.addEventListener('input', upd); e.addEventListener('change', upd); } }
    upd();
    const res = await pr;
    if (res === 'ok' && picked) {
      state.dates = picked;
      const sec = datesSec(picked);
      let unit = h.unit;
      if (sec > 0 && sec / UNITS[unit].sec < 1) unit = sec >= C.units.D ? 'd' : sec >= C.units.H ? 'h' : sec >= 60 ? 'min' : 's';
      holdFromDates(unit);
      renderDates(); changed();
    } else if (res === 'reset') { clearDates(); changed(); }
  }

  // ---------- правка T½ ----------
  async function editHalfLife(name, reopenData) {
    if (state.locked) return;
    const rec = DB[name]; if (!rec || rec[0] == null) return;
    const baseT = rec[0];
    const over = state.overrides[name] && state.overrides[name].T != null;
    const curT = over ? state.overrides[name].T : baseT;
    const u = C.halfLifeUnit(curT) || [curT, 's'];
    const unit = UNITS[u[1]] ? u[1] : 's';
    const value = UNITS[u[1]] ? u[0] : curT;
    const body = `<p>По базе: <b>${esc(C.fmtHalfLife(baseT))}</b> (${esc(({ I: 'IAEA LiveChart', C: 'ICRP-107' })[rec[1]] || rec[1])}).` +
      `${over ? ` Сейчас задано пользователем: <b>${esc(C.fmtHalfLife(curT))}</b>.` : ''}</p>` +
      `<div class="field-row"><label for="t12Value">T½</label> <input id="t12Value" type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtInput(value))}"> ` +
      `<select id="t12Unit" aria-label="Единица">${UNIT_ORDER.map((k) => `<option value="${k}"${k === unit ? ' selected' : ''}>${UNITS[k].ru}</option>`).join('')}</select></div>` +
      `<p class="msg error" id="t12Error" role="alert" hidden></p>` +
      `<p class="hint">Правка сохраняется в файле проекта и помечается «польз.». Год = 365,2422 сут.</p>`;
    const buttons = [{ label: 'OK', value: 'ok', primary: true }];
    if (over) buttons.push({ label: 'Вернуть значение из базы', value: 'reset' });
    buttons.push({ label: 'Отмена', value: 'cancel' });
    let newT = null;
    const res = await dialog({
      title: 'Период полураспада ' + name, html: body, buttons,
      focus: '#t12Value',
      validate: (val) => {
        if (val !== 'ok') return true;
        const v = parseNum($('#t12Value').value);
        if (v === null || isNaN(v) || !(v > 0)) { const e = $('#t12Error'); e.textContent = 'Введите положительное число.'; e.hidden = false; return false; }
        newT = v * UNITS[$('#t12Unit').value].sec;
        return true;
      },
    });
    let changedT = false;
    if (res === 'ok' && newT != null) {
      if (Math.abs(newT - baseT) <= 1e-12 * baseT) { if (over) { delete state.overrides[name]; changedT = true; } }
      else if (!over || Math.abs(newT - curT) > 1e-12 * curT) { state.overrides[name] = { T: newT }; changedT = true; }
    } else if (res === 'reset') { delete state.overrides[name]; changedT = true; }
    if (changedT) { rebuildSet(); changed(); renderInput(); }
    if (reopenData) cmdData();
  }

  function cmdResetOverrides() {
    const n = Object.keys(state.overrides).length;
    if (!n) { dialog({ title: 'Сбросить правки', html: '<p>Правок периодов полураспада нет — все значения из базы.</p>' }); return; }
    dialog({ title: 'Сбросить правки', html: `<p>Вернуть значения из базы для ${n} ${plural(n, ['изотопа', 'изотопов', 'изотопов'])}?</p>`,
      buttons: [{ label: 'Сбросить', value: 'ok', primary: true }, { label: 'Отмена', value: 'cancel' }] }).then((r) => {
      if (r !== 'ok') return;
      if (state.locked) setLocked(false);
      state.overrides = {}; rebuildSet(); changed(); renderInput();
    });
  }

  // ---------- расчёт ----------
  function calc() {
    if (state.locked) return;
    showError('');
    if (!state.set.length) { showError('Добавьте хотя бы один изотоп-родоначальник.'); $('#rootInput').focus(); return; }
    const { A0, bad } = validateInputs(true);
    const h = readHold();
    const ex = readExtra();
    const msgs = [];
    if (bad.length) msgs.push('Неверное число активности: ' + bad.join(', ') + '. Пример: 1000, 1,5E6, 2,5·10^3.');
    if (!h.ok) msgs.push(h.empty ? 'Укажите выдержку.' : 'Неверное значение выдержки (нужно число ≥ 0).');
    if (!ex.ok) msgs.push(`Неверные дополнительные сроки: нужны числа ≥ 0 через «;», не больше ${MAX_EXTRA}. Пример: 1; 14; 30.`);
    if (msgs.length) { showError(msgs.join(' ')); if (!h.ok && !bad.length) $('#hold').focus(); else if (!ex.ok && !bad.length) $('#holdExtra').focus(); return; }
    if (!Object.values(A0).some((v) => v > 0)) { showError('Все начальные активности равны нулю — задайте хотя бы одну.'); return; }
    const au = actUnit(), f = ACT_UNITS[au].f;
    const A0bq = {}; for (const k in A0) A0bq[k] = A0[k] * f; // ядро считает в беккерелях
    const sc = UNITS[h.unit].sec;
    const times = [...new Set([h.value, ...ex.values])].sort((a, b) => a - b);
    const chartSec = Math.max(h.tSec, times[times.length - 1] * sc);
    let res, series, at = null;
    try {
      res = C.calculate(state.set, A0bq, h.tSec, CHART_POINTS);
      series = chartSec > h.tSec ? C.calculate(state.set, A0bq, chartSec, CHART_POINTS).series : res.series;
      if (times.length > 1) {
        at = times.map((v) => {
          const tt = v * sc;
          const rr = v === h.value ? res : C.calculate(state.set, A0bq, tt, 2);
          return { value: v, tSec: tt, text: holdText(v, h.unit), main: v === h.value, A: rr.rows.map((x) => x.A), N: rr.rows.map((x) => x.N) };
        });
      }
    } catch (e) { showError('Ошибка расчёта: ' + e.message); return; }
    state.result = Object.assign(res, {
      series, chartSec, times: at, actUnit: au, actF: f, dates: state.dates ? Object.assign({}, state.dates) : null,
      A0: A0bq, hold: h.value, unit: h.unit, tSec: h.tSec, holdText: holdText(h.value, h.unit),
      roots: state.roots.slice(), set: state.set, at: new Date(),
    });
    state.hover = null;
    setLocked(true);
    renderResult();
    selectTab(state.tab);
    scheduleFormulas();
    if (state.dirty) scheduleDraft(false);
  }

  /** Любое изменение ввода: документ «грязный», прежний результат больше не соответствует данным. */
  function changed() {
    markDirty();
    clearPrint();
    if (state.result) { state.result = null; renderResult(); }
    scheduleFormulas();
  }

  function setLocked(on) {
    state.locked = on;
    const panel = $('#inputPanel');
    if (panel) panel.classList.toggle('locked', on);
    document.body.classList.toggle('locked', on);
    $$('#inputTable input, #rootInput, #addRootBtn, #ptableBtn, #hold, #holdUnit, #holdExtra, #holdDatesBtn, #actUnit, #rootChips .chip-x').forEach((e) => { e.disabled = on; });
    $$('#inputTable td.t12[data-edit]').forEach((td) => { td.tabIndex = on ? -1 : 0; td.setAttribute('aria-disabled', on ? 'true' : 'false'); });
    show($('#calcBtn'), !on);
    show($('#editBtn'), on);
    updateNeedsResult();
  }
  function unlock() { setLocked(false); const f = $('#inputTable input'); if (f) f.focus(); }

  function updateNeedsResult() {
    const has = !!state.result;
    $$('[data-needs-result]').forEach((b) => { b.disabled = !has; });
    const eb = $('#exportBtn'); if (eb) eb.disabled = !has;
    notifyHost();
  }

  // ---------- таблица результата ----------
  const sumA = (rows, k) => rows.reduce((s, x) => s + (x.stable ? 0 : x[k]), 0);
  /** Заголовок результата: «через 7 сут», «через 1; 7; 14 сут», плюс дата использования. */
  function resultTitle(r) {
    const when = r.times ? r.times.map((t) => fmtInput(t.value)).join('; ') + ' ' + UNITS[r.unit].ru : r.holdText;
    return `Результат через ${when}` + (r.dates ? ` · на ${fmtDate(r.dates.to)}` : '');
  }
  function renderResult() {
    const r = state.result;
    const table = $('#resultTable');
    show($('#resultEmpty'), !r);
    show(wrapOf(table), !!r);
    const title = $('#resultTitle');
    if (title) title.textContent = r ? resultTitle(r) : 'Результат';
    const au = ACT_UNITS[r ? r.actUnit : actUnit()] || ACT_UNITS[DEFAULT_ACT];
    const f = r ? r.actF : 1, u = au.ru;
    renderChartScale(u);
    if (r) { if (uncActive()) { if (!r.unc || r.unc.key !== uncKey()) computeUnc(r); } else r.unc = null; }
    const pl = r ? purityList(r) : null;
    renderPurityBar(r, pl);
    renderUncNote(r);
    updateNeedsResult();
    buildLegend();
    drawChart();
    if (!table) return;
    const times = r && r.times;
    const mainIdx = times ? Math.max(0, times.findIndex((t) => t.main)) : 0;
    const unc = r && r.unc;
    const pm = pl ? pl[mainIdx] : null;
    const lim = limitFrac();
    const head = ['<th scope="col">Изотоп</th>', `<th scope="col" class="num">A₀, ${esc(u)}</th>`];
    if (times) times.forEach((t) => head.push(`<th scope="col" class="num${t.main ? ' main' : ''}">A(${esc(t.text)}), ${esc(u)}</th>`));
    else head.push(`<th scope="col" class="num">A(t), ${esc(u)}</th>`);
    if (unc) head.push(`<th scope="col" class="num" title="Половина 95-процентного интервала для A(${esc(r ? r.holdText : 't')}), метод Монте-Карло">±, %</th>`);
    if (pm) head.push(`<th scope="col" class="num" title="Доля примеси в общей активности (без самой цели${state.countProgeny ? '' : ' и её дочерних продуктов'})">Примесь, %</th>`);
    const amt = r ? amountColumn(r, times ? r.holdText : 't') : { head: 'N(t), атомов', cells: [] };
    head.push(AM ? `<th scope="col" class="num"><button type="button" id="amountBtn" class="amount-btn" title="Показать число атомов, массу или количество вещества (моль)">${esc(amt.head)}</button></th>`
      : `<th scope="col" class="num">${esc(amt.head)}</th>`);
    if (table.tHead) table.tHead.innerHTML = '<tr>' + head.join('') + '</tr>';
    const amtBtn = $('#amountBtn'); if (amtBtn) amtBtn.addEventListener('click', cycleAmount);
    const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    if (!r) { tb.innerHTML = ''; return; }
    const out = [];
    const cell = (v, unit, cls) => `<td class="num${cls ? ' ' + cls : ''}" title="${full(v)}${unit ? ' ' + unit : ''}">${fmt(v)}</td>`;
    const aCells = (x) => {
      if (!times) return cell(x.A / f, u);
      const i = r.rows.indexOf(x);
      return times.map((t) => cell(t.A[i] / f, u)).join('');
    };
    const nA = times ? times.length : 1;
    const extraCols = (unc ? 1 : 0) + (pm ? 1 : 0);
    const sumCells = (items) => {
      if (!times) return cell(sumA(items, 'A') / f, u);
      return times.map((t) => cell(items.reduce((s, x) => s + (x.stable ? 0 : t.A[r.rows.indexOf(x)]), 0) / f, u)).join('');
    };
    const groups = groupsOf(r.rows, r.roots);
    for (const g of groups) {
      out.push(`<tr class="chain"><td colspan="${3 + nA + extraCols}">Цепочка ${esc(g.root)}</td></tr>`);
      for (const x of g.items) {
        const i = r.rows.indexOf(x);
        const isT = pm && x.name === state.target;
        const share = pm ? pm.share[i] : 0;
        const over = pm && !isT && lim != null && share > lim;
        const cls = [x.stable ? 'stable' : '', isT ? 'target' : '', over ? 'over' : ''].filter(Boolean).join(' ');
        let extra = '';
        if (unc) extra += x.stable ? '<td class="num pm">—</td>' : `<td class="num pm" title="95 %: ${full(unc.A[mainIdx][i].lo / f)} … ${full(unc.A[mainIdx][i].hi / f)} ${esc(u)}">${unc.A[mainIdx][i].rel > 0 ? fmt(unc.A[mainIdx][i].rel * 100, 2) : '0'}</td>`;
        if (pm) extra += isT ? '<td class="num share is-target">цель</td>' : x.stable ? '<td class="num share">—</td>' : `<td class="num share" title="${full(share * 100)} %">${share > 0 ? fmt(share * 100, 3) : '0'}</td>`;
        out.push(`<tr${cls ? ` class="${cls}"` : ''}><td class="iso">${esc(x.name)}</td>` +
          (x.stable ? '<td class="num">—</td>'.repeat(1 + nA) : cell(x.A0 / f, u) + aCells(x)) +
          extra + `<td class="num" title="${esc(amt.cells[i][1])}">${fmt(amt.cells[i][0])}</td>` + '</tr>');
      }
      out.push(`<tr class="total"><td>Сумма</td>${cell(sumA(g.items, 'A0') / f, u)}${sumCells(g.items)}${'<td></td>'.repeat(extraCols)}<td></td></tr>`);
    }
    if (groups.length > 1) out.push(`<tr class="total grand"><td>Всего</td>${cell(sumA(r.rows, 'A0') / f, u)}${sumCells(r.rows)}${'<td></td>'.repeat(extraCols)}<td></td></tr>`);
    if (pl) {
      out.push(`<tr class="purity-row"><td>Чистота ${esc(state.target)}, %</td><td></td>` +
        pl.map((p) => `<td class="num" title="${full(p.purity * 100)} %">${fmtPct(p.purity)}</td>`).join('') + '<td></td>'.repeat(extraCols + 1) + '</tr>');
    }
    tb.innerHTML = out.join('');
  }

  // ---------- чистота и погрешность (обработка готового результата, ввод не блокируют) ----------
  /** Процент для чистоты: у значений около 100 % — столько знаков, чтобы отличие было видно. */
  function fmtPct(frac) {
    if (!isFinite(frac)) return '—';
    const v = frac * 100;
    if (v >= 100) return '100';
    const d = v > 99 ? Math.min(8, Math.max(2, Math.ceil(-Math.log10(100 - v)) + 1)) : 2;
    return v.toFixed(d).replace('.', ',');
  }
  function limitFrac() {
    const inp = $('#limitInp'); if (!inp) return null;
    const v = parseNum(inp.value);
    const ok = v === null || (!isNaN(v) && v >= 0 && v <= 100);
    inp.classList.toggle('invalid', !ok);
    return ok && v !== null ? v / 100 : null;
  }
  function purityList(r) {
    if (!TL || !state.target) return null;
    if (!r.rows.some((x) => x.name === state.target && !x.stable)) return null;
    const times = r.times || [{ tSec: r.tSec, main: true, text: r.holdText }];
    return times.map((t) => Object.assign(TL.purityAt(r.set, r.A0, t.tSec, state.target, state.countProgeny), { time: t }));
  }
  function renderPurityBar(r, pl) {
    const bar = $('#purityBar'); if (!bar) return;
    show(bar, !!r && !!TL);
    if (!r || !TL) return;
    const sel = $('#targetSel');
    const names = r.rows.filter((x) => !x.stable).map((x) => x.name);
    const key = names.join(',');
    if (sel.dataset.key !== key) {
      sel.innerHTML = '<option value="">— не выбран —</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      sel.dataset.key = key;
    }
    sel.value = names.includes(state.target) ? state.target : '';
    const chk = $('#progenyChk'); if (chk) chk.checked = !!state.countProgeny;
    const out = $('#purityOut');
    if (!pl) { show(out, false); return; }
    const mi = Math.max(0, pl.findIndex((p) => p.time.main));
    const p = pl[mi];
    const lim = limitFrac();
    const over = lim == null ? [] : p.share.map((s, i) => (s > lim ? r.rows[i].name : null)).filter(Boolean);
    let txt = `Радионуклидная чистота ${state.target} через ${p.time.text}: ${fmtPct(p.purity)} %`;
    const up = r.unc && r.unc.purity && r.unc.purity[mi];
    if (up) txt += ` (95 %: ${fmtPct(up.lo)} … ${fmtPct(up.hi)} %)`;
    const limTxt = lim != null ? fmtInput(Number((lim * 100).toPrecision(6))) : '';
    if (over.length) txt += `. Выше предела ${limTxt} %: ${over.join(', ')}`;
    else if (lim != null) txt += `. Все примеси не выше ${limTxt} %`;
    out.textContent = txt;
    out.classList.toggle('bad', over.length > 0);
    show(out, true);
  }
  function iaeaUncCount() { return state.iaea && state.iaea.unc ? Object.keys(state.iaea.unc).length : 0; }
  function uncActive() { return !!TL && (state.unc.uA > 0 || state.unc.uT > 0 || (state.unc.useIaea && iaeaUncCount() > 0)); }
  const uncKey = () => JSON.stringify([state.unc, state.target, state.countProgeny, state.iaea && state.iaea.date]);
  function computeUnc(r) {
    r.unc = null;
    if (!uncActive()) return;
    const uTby = {};
    if (state.unc.useIaea && state.iaea && state.iaea.unc) for (const x of r.set) if (x.src !== 'user' && state.iaea.unc[x.name] != null) uTby[x.name] = state.iaea.unc[x.name];
    const target = state.target && r.set.some((x) => x.name === state.target && x.lambda > 0) ? state.target : null;
    const times = r.times ? r.times.map((t) => t.tSec) : [r.tSec];
    try {
      r.unc = Object.assign(TL.uncertainty(r.set, r.A0, times, { uA: state.unc.uA / 100, uT: state.unc.uT / 100, uTby, n: 2000, target, countProgeny: state.countProgeny }),
        { key: uncKey(), nIaea: Object.keys(uTby).length });
    } catch (e) { r.unc = null; }
  }
  function uncText(r) {
    const parts = [];
    if (state.unc.uA > 0) parts.push(`A₀ ±${fmtInput(state.unc.uA)} %`);
    if (state.unc.uT > 0) parts.push(`T½ ±${fmtInput(state.unc.uT)} %`);
    if (r && r.unc && r.unc.nIaea) parts.push(`T½ по IAEA у ${r.unc.nIaea} ${plural(r.unc.nIaea, ['изотопа', 'изотопов', 'изотопов'])}`);
    return parts.join(', ');
  }
  function renderUncNote(r) {
    const p = $('#uncNote'); if (!p) return;
    const on = !!(r && r.unc);
    show(p, on);
    p.textContent = on ? `Погрешность (1σ): ${uncText(r)}. Метод Монте-Карло, ${r.unc.n} повторов; «±, %» — половина 95-процентного интервала.` : '';
  }

  // ---------- вкладки ----------
  function selectTab(name) {
    const tabs = $$('.tabs .tab');
    if (!tabs.some((t) => t.dataset.tab === name)) name = 'result';
    state.tab = name;
    tabs.forEach((t) => { const a = t.dataset.tab === name; t.classList.toggle('active', a); t.setAttribute('aria-selected', String(a)); });
    $$('.tab-panel').forEach((p) => { const a = p.dataset.panel === name; p.hidden = !a; p.classList.toggle('active', a); });
    if (name === 'chart') drawChart();
    if (name === 'formulas') renderFormulas();
  }

  // ---------- график ----------
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  /** Индексы радиоактивных нуклидов результата с ненулевой активностью — в порядке набора. */
  function chartSeries() {
    const r = state.result; if (!r) return [];
    return r.rows.map((x, i) => i).filter((i) => !r.rows[i].stable && r.series.A.some((row) => row[i] > 0));
  }
  /** Цвет и штрих серии k; theme — 'light' для файла (иначе по теме страницы). */
  function seriesStyle(k, theme) {
    const pal = PALETTE[theme || (isDark() ? 'dark' : 'light')];
    const slot = k % pal.length;
    const color = (theme ? '' : getComputedStyle(document.documentElement).getPropertyValue('--series-' + (slot + 1)).trim()) || pal[slot];
    return { color, dash: DASHES[Math.floor(k / pal.length) % DASHES.length] };
  }
  function swatchStyle(st) {
    if (!st.dash.length) return `background:${st.color}`;
    return `background:repeating-linear-gradient(90deg,${st.color} 0 ${st.dash[0]}px,transparent ${st.dash[0]}px ${st.dash[0] + st.dash[1]}px)`;
  }
  function buildLegend() {
    const box = $('#chartLegend'); if (!box) return;
    box.innerHTML = '';
    const r = state.result; if (!r) return;
    const idx = chartSeries();
    if (idx.length > 4) {
      const all = document.createElement('button'); all.type = 'button'; all.className = 'legend-btn'; all.textContent = 'Все';
      all.addEventListener('click', () => { idx.forEach((i) => { delete state.hidden[r.rows[i].name]; }); buildLegend(); drawChart(); });
      const none = document.createElement('button'); none.type = 'button'; none.className = 'legend-btn'; none.textContent = 'Ничего';
      none.addEventListener('click', () => { idx.forEach((i) => { state.hidden[r.rows[i].name] = true; }); buildLegend(); drawChart(); });
      box.append(all, none);
    }
    idx.forEach((i, k) => {
      const name = r.rows[i].name;
      const lab = document.createElement('label');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !state.hidden[name];
      cb.addEventListener('change', () => { if (cb.checked) delete state.hidden[name]; else state.hidden[name] = true; drawChart(); });
      const sw = document.createElement('i'); sw.className = 'swatch'; sw.setAttribute('style', swatchStyle(seriesStyle(k)));
      lab.append(cb, sw, document.createTextNode(' ' + name));
      box.append(lab);
    });
  }

  function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const pow10 = (e) => (e === 0 ? '1' : e === 1 ? '10' : '10' + String(e).split('').map((c) => SUP[c]).join(''));

  const chart = { geo: null };
  function sizeCanvas(cv) {
    if (!cv.dataset.sized) {
      // Если высота холста не задана стилями, она зависит от атрибута height — фиксируем её сами.
      const before = cv.clientHeight; const attr = cv.height;
      cv.height = attr + 50;
      cv.dataset.autoHeight = Math.abs(cv.clientHeight - before) > 1 ? '1' : '';
      cv.height = attr;
      cv.dataset.sized = '1';
    }
    if (cv.dataset.autoHeight) cv.style.height = Math.round(Math.max(220, Math.min(380, cv.clientWidth * 0.55))) + 'px';
  }
  function drawChart() {
    const cv = $('#chart'); if (!cv) return;
    if (!cv.clientWidth) return; // вкладка скрыта
    sizeCanvas(cv);
    const W = cv.clientWidth, H = cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const v = (...names) => { for (const n of names) { const x = css.getPropertyValue(n).trim(); if (x) return x; } return ''; };
    chart.geo = paintChart(g, W, H, {
      ink: v('--ink', '--text') || '#1c2127',
      muted: v('--chart-text', '--ink-2', '--muted') || '#4e5864',
      grid: v('--chart-grid', '--rule', '--line') || '#e7e9ed',
      axis: v('--chart-axis', '--rule-strong') || '#a3abb5',
      panel: v('--chart-bg', '--pane', '--panel') || '#ffffff',
      font: '12px ' + (v('--font-ui') || 'system-ui, "Segoe UI", sans-serif'),
      hover: state.hover,
    });
  }
  const CHART_SCALE_KEY = 'halflife.chartScale';
  function renderChartScale(unitRu) {
    const lin = state.chartScale === 'lin';
    $$('.chart-scale .fmt').forEach((b) => { const a = b.dataset.scale === state.chartScale; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
    const r = state.result;
    const u = unitRu || (ACT_UNITS[r ? r.actUnit : actUnit()] || ACT_UNITS[DEFAULT_ACT]).ru;
    const note = $('#tp-chart .toolbar-note'); if (note) note.textContent = `A(t), ${u}, ${lin ? 'обычная' : 'логарифмическая'} шкала`;
    const btn = $('#chartPngBtn'); if (btn) btn.disabled = !r;
  }
  function setChartScale(v) {
    state.chartScale = v === 'lin' ? 'lin' : 'log';
    storeSet(CHART_SCALE_KEY, state.chartScale === 'lin' ? 'lin' : null);
    renderChartScale();
    drawChart();
  }
  /** График для файла: светлый, с заголовком и подписями серий; 1100×640 при масштабе 2. Возвращает Promise<Blob>. */
  function chartPngBlob() {
    const r = state.result; if (!r) return Promise.resolve(null);
    const W = 1100, H = 640, k = 2;
    const cv = document.createElement('canvas'); cv.width = W * k; cv.height = H * k;
    const g = cv.getContext('2d'); g.scale(k, k);
    g.fillStyle = CHART_FILE.panel; g.fillRect(0, 0, W, H);
    const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'system-ui, "Segoe UI", sans-serif';
    const font = '13px ' + fam, u = (ACT_UNITS[r.actUnit] || ACT_UNITS[DEFAULT_ACT]).ru;
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = CHART_FILE.ink; g.font = '600 16px ' + fam;
    g.fillText('Активность изотопов: ' + r.roots.join(', '), 20, 14);
    g.fillStyle = CHART_FILE.muted; g.font = font;
    g.fillText(`A(t), ${u}, ${state.chartScale === 'lin' ? 'обычная' : 'логарифмическая'} шкала · выдержка ${r.holdText}`, 20, 38);
    // подписи серий: строки по ширине картинки
    const all = chartSeries();
    const items = all.filter((i) => !state.hidden[r.rows[i].name]).map((i) => ({ k: all.indexOf(i), name: r.rows[i].name }));
    const rows = [[]]; let w = 0;
    for (const it of items) {
      it.w = 30 + g.measureText(it.name).width + 18;
      if (w + it.w > W - 40 && rows[rows.length - 1].length) { rows.push([]); w = 0; }
      rows[rows.length - 1].push(it); w += it.w;
    }
    const legH = items.length ? rows.length * 22 + 12 : 0;
    g.save(); g.translate(10, 62);
    paintChart(g, W - 20, H - 62 - legH, Object.assign({ font, hover: null }, CHART_FILE));
    g.restore();
    rows.forEach((row, n) => {
      let x = 20; const y = H - legH + 6 + n * 22;
      for (const it of row) {
        const st = seriesStyle(it.k, 'light');
        g.strokeStyle = st.color; g.lineWidth = 2.5; g.setLineDash(st.dash); g.beginPath(); g.moveTo(x, y + 8); g.lineTo(x + 22, y + 8); g.stroke();
        g.setLineDash([]); g.fillStyle = CHART_FILE.ink; g.textBaseline = 'middle'; g.font = font; g.fillText(it.name, x + 30, y + 8);
        x += it.w;
      }
    });
    return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('не удалось получить PNG'))), 'image/png'));
  }
  async function downloadChartPng() {
    if (!state.result) return;
    try { const b = await chartPngBlob(); if (b) await saveBlob(b, baseName() + '-график.png', 'image/png'); } catch (e) { errorDlg('Ошибка сохранения', e); }
  }
  /** Цвета графика для файла PNG — всегда светлые, на белом фоне. */
  const CHART_FILE = { ink: '#1c2127', muted: '#4e5864', grid: '#e7e9ed', axis: '#a3abb5', panel: '#ffffff', theme: 'light' };
  /**
   * Рисует график результата в области W×H контекста g. o: {ink, muted, grid, axis, panel, font, hover, theme}.
   * Шкала по вертикали — state.chartScale ('log' или 'lin'). Возвращает геометрию осей (для курсора) или null.
   */
  function paintChart(g, W, H, o) {
    const { ink, muted, grid, axis, panel, font } = o;
    const sty = (k) => seriesStyle(k, o.theme);
    const lin = state.chartScale === 'lin';
    g.font = font;
    g.fillStyle = muted;
    const r = state.result;
    const msg = (t) => { g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, W / 2, H / 2); return null; };
    if (!r) return null; // подсказку «График появится после расчёта» показывает вёрстка
    const all = chartSeries();
    const shown = all.filter((i) => !state.hidden[r.rows[i].name]);
    const span = r.chartSec || r.tSec, f = r.actF || 1, u = (ACT_UNITS[r.actUnit] || ACT_UNITS[DEFAULT_ACT]).ru;
    if (span <= 0) return msg('Выдержка равна нулю — график не строится.');
    if (!all.length) return msg('Нет ненулевых активностей.');
    if (!shown.length) return msg('Все серии скрыты — отметьте изотопы в легенде.');

    let vmax = 0, vmin = Infinity;
    for (const i of shown) for (const row of r.series.A) { const v = row[i] / f; if (v > vmax) vmax = v; if (v > 0 && v < vmin) vmin = v; }
    const hi = Math.ceil(Math.log10(vmax) + 1e-9);
    let lo = Math.floor(Math.log10(vmin));
    lo = Math.max(lo, hi - 12); if (hi - lo < 2) lo = hi - 2;
    // обычная шкала: от 0 до «круглого» значения не меньше максимума
    const ystep = lin ? niceStep(vmax / 5) : 0;
    const top = lin ? Math.ceil(vmax / ystep - 1e-9) * ystep : 0;
    // подписи обычной шкалы — в одном виде: 250 000 или 0,25·10⁶ (общая степень для больших и малых чисел)
    const ex = lin && (top >= 1e5 || top < 1e-2) ? Math.floor(Math.log10(top)) : null;
    const ylab = lin ? (v) => (v === 0 ? '0' : ex == null ? fmt(v, 3) : String(Number((v / Math.pow(10, ex)).toPrecision(3))).replace('.', ',') + '·' + pow10(ex)) : null;
    let L = 58;
    if (lin) {
      g.font = font;
      let wmax = 0; for (let k = 0; k * ystep <= top * 1.0001; k++) wmax = Math.max(wmax, g.measureText(ylab(k * ystep)).width);
      L = Math.max(58, Math.ceil(wmax) + 34); // слева ещё подпись оси «A, Бк»
    }
    const R = 14, T = 12, B = 40;
    const pw = W - L - R, ph = H - T - B;
    const sc = UNITS[r.unit].sec, tmax = span / sc;
    const x = (tu) => L + pw * tu / tmax;
    const y = lin ? (v) => T + ph * (1 - Math.max(v, 0) / top)
      : (v) => { const lv = v > 0 ? Math.max(Math.log10(v), lo) : lo; return T + ph * (hi - lv) / (hi - lo); };
    // сетка и оси
    g.lineWidth = 1; g.strokeStyle = grid; g.fillStyle = muted;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    if (lin) {
      for (let k = 0; k * ystep <= top * 1.0001; k++) {
        const yy = Math.round(y(k * ystep)) + 0.5;
        g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
        g.fillText(ylab(k * ystep), L - 6, yy);
      }
    } else {
      const estep = Math.max(1, Math.ceil((hi - lo) / Math.max(2, Math.floor(ph / 28))));
      for (let e = hi; e >= lo; e -= estep) {
        const yy = Math.round(y(Math.pow(10, e))) + 0.5;
        g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
        g.fillText(pow10(e), L - 6, yy);
      }
    }
    const step = niceStep(tmax / Math.max(2, Math.floor(pw / 90)));
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let tu = 0; tu <= tmax * 1.0001; tu += step) {
      const xx = Math.round(x(tu)) + 0.5;
      g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
      g.fillText(fmt(tu, 4), xx, T + ph + 6);
    }
    g.fillText('t, ' + UNITS[r.unit].ru, L + pw / 2, T + ph + 22);
    g.strokeStyle = axis; g.beginPath(); g.moveTo(L + 0.5, T); g.lineTo(L + 0.5, T + ph + 0.5); g.lineTo(W - R, T + ph + 0.5); g.stroke();
    g.save(); g.translate(14, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A, ' + u, 0, 0); g.restore();
    // отметки сроков выдержки
    if (r.times) {
      g.save(); g.strokeStyle = axis; g.lineWidth = 1; g.setLineDash([3, 4]);
      for (const t of r.times) { if (t.tSec <= 0) continue; const xx = Math.round(x(t.tSec / sc)) + 0.5; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke(); }
      g.restore();
    }
    // линии
    g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
    g.save(); g.beginPath(); g.rect(L, T - 2, pw, ph + 4); g.clip();
    for (const i of shown) {
      const st = sty(all.indexOf(i));
      g.strokeStyle = st.color; g.setLineDash(st.dash); g.beginPath();
      r.series.t.forEach((t, p) => { const xx = x(t / sc), yy = y(r.series.A[p][i] / f); if (p) g.lineTo(xx, yy); else g.moveTo(xx, yy); });
      g.stroke();
    }
    g.restore(); g.setLineDash([]);
    const geo = { L, T, pw, ph, x, y, sc, tmax };
    // курсор и подсказка
    const p = o.hover;
    if (p != null && p >= 0 && p < r.series.t.length) {
      const tu = r.series.t[p] / sc, xx = Math.round(x(tu)) + 0.5;
      g.strokeStyle = axis; g.lineWidth = 1; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
      const items = shown.map((i) => ({ i, v: r.series.A[p][i] / f })).filter((it) => it.v > 0).sort((a, b) => b.v - a.v);
      for (const it of items) {
        const st = sty(all.indexOf(it.i));
        g.beginPath(); g.arc(xx, y(it.v), 4, 0, 2 * Math.PI); g.fillStyle = st.color; g.fill();
        g.lineWidth = 2; g.strokeStyle = panel; g.stroke();
      }
      const maxLines = Math.max(1, Math.floor((ph - 30) / 17));
      const lines = items.slice(0, maxLines).map((it) => ({ k: all.indexOf(it.i), text: `${r.rows[it.i].name}  ${fmt(it.v)} ${u}` }));
      if (items.length > maxLines) lines.push({ k: -1, text: `… ещё ${items.length - maxLines}` });
      const head = `t = ${fmt(tu, 4)} ${UNITS[r.unit].ru}`;
      g.font = font;
      const bw = 26 + Math.max(g.measureText(head).width, ...lines.map((l) => g.measureText(l.text).width));
      const bh = 22 + lines.length * 17;
      let bx = xx + 12; if (bx + bw > W - R) bx = xx - 12 - bw; if (bx < 2) bx = 2;
      const by = T + 6;
      g.fillStyle = panel; g.strokeStyle = axis; g.lineWidth = 1;
      roundRect(g, bx, by, bw, bh, 6); g.fill(); g.stroke();
      g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = ink;
      g.fillText(head, bx + 10, by + 6);
      lines.forEach((l, n) => {
        const ly = by + 24 + n * 17;
        if (l.k >= 0) { g.fillStyle = sty(l.k).color; g.fillRect(bx + 10, ly + 4, 8, 8); }
        g.fillStyle = l.k >= 0 ? ink : muted; g.fillText(l.text, bx + (l.k >= 0 ? 22 : 10), ly);
      });
    }
    return geo;
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function chartPointer(e) {
    const r = state.result, geo = chart.geo; if (!r || !geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < geo.L - 10 || px > geo.L + geo.pw + 10) { if (state.hover != null) { state.hover = null; drawChart(); } return; }
    const tu = Math.min(Math.max((px - geo.L) / geo.pw, 0), 1) * geo.tmax;
    const p = Math.round(tu / geo.tmax * (r.series.t.length - 1));
    if (p !== state.hover) { state.hover = p; drawChart(); }
  }

  // ---------- формулы ----------
  let formulaTimer = 0;
  function scheduleFormulas() {
    clearTimeout(formulaTimer);
    formulaTimer = setTimeout(() => { if (state.tab === 'formulas') renderFormulas(); }, 120);
  }
  function formulaModel() {
    const r = state.result;
    if (r) return { set: r.set, A0: r.A0, tSec: r.tSec, holdText: r.holdText, result: r };
    const A0 = {};
    const f = ACT_UNITS[actUnit()].f;
    for (const inp of $$('#inputTable input[data-name]')) { const v = parseNum(inp.value); A0[inp.dataset.name] = v > 0 ? v * f : 0; }
    const h = readHold();
    return { set: state.set, A0, tSec: h.tSec, holdText: holdText(h.value, h.unit), result: null };
  }
  function formulaText(kind) {
    if (!F || typeof F[kind] !== 'function') return 'Модуль формул (formulas.js) не загружен.';
    if (!state.set.length) return 'Добавьте изотоп-родоначальник — здесь появятся уравнения модели.';
    try { return F[kind](formulaModel()); } catch (e) { return 'Не удалось построить формулы: ' + e.message; }
  }
  function renderFormulas() {
    const out = $('#formulaOut'); if (!out) return;
    $$('.fmt-tabs .fmt').forEach((b) => { const a = b.dataset.fmt === state.fmt; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
    out.textContent = formulaText(state.fmt);
  }
  async function copyFormulas() {
    const ok = await copyText(formulaText(state.fmt));
    flash($('#copyFormulaBtn'), ok ? 'Скопировано' : 'Не удалось', ok);
  }
  function downloadFormulas() {
    const f = FMT[state.fmt];
    const blob = new Blob([formulaText(state.fmt)], { type: f.mime + ';charset=utf-8' });
    saveBlob(blob, baseName() + (state.fmt === 'text' ? '-формулы' : '') + f.ext, f.mime);
  }
  function flash(btn, text, ok) {
    if (!btn) return;
    const t = $('span', btn) || btn; // текст кнопки рядом с иконкой
    if (btn.dataset.label == null) btn.dataset.label = t.textContent;
    t.textContent = text; btn.classList.toggle('done', ok !== false); btn.classList.toggle('failed', ok === false);
    clearTimeout(btn._t); btn._t = setTimeout(() => { t.textContent = btn.dataset.label; btn.classList.remove('done', 'failed'); }, 1600);
  }
  async function copyText(text) {
    if (android && android.copyText) { try { android.copyText(text); return true; } catch (e) { /* дальше */ } }
    try { if (navigator.clipboard && window.isSecureContext !== false) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* запасной путь */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  // ---------- документ ----------
  function markDirty() { if (!state.dirty) { state.dirty = true; updateTitle(); } scheduleDraft(); }
  function setClean() { state.dirty = false; updateTitle(); clearDraft(); hideDraftNote(); }
  function updateTitle() {
    const dn = $('#docName'); if (dn) { dn.textContent = state.name; dn.title = state.path || state.name; }
    show($('#dirty'), state.dirty);
    document.title = (state.dirty ? '• ' : '') + state.name + ' — ' + APP_TITLE;
    notifyHost();
  }
  function baseName() { return state.name === UNTITLED ? 'расчёт' : state.name.replace(/\.(hlc|json)$/i, ''); }

  function serialize() {
    const names = new Set(state.set.map((x) => x.name));
    const activities = {};
    for (const x of state.set) {
      if (x.lambda === 0) continue;
      const raw = state.activities[x.name];
      const v = parseNum(raw);
      activities[x.name] = v === null ? 0 : isNaN(v) ? String(raw) : v;
    }
    const overrides = {};
    for (const [n, o] of Object.entries(state.overrides)) if (names.has(n) && o && o.T != null) overrides[n] = { T: o.T };
    const h = readHold();
    const ex = readExtra();
    const extra = {};
    if (actUnit() !== DEFAULT_ACT) extra.actUnit = actUnit();
    if (ex.raw) extra.holdExtra = ex.ok ? ex.values : ex.raw;
    if (state.dates) extra.dates = Object.assign({}, state.dates);
    if (state.target) {
      const lim = limitFrac();
      extra.purity = { target: state.target, limitPercent: lim != null ? Number((lim * 100).toPrecision(10)) : null, countProgeny: !!state.countProgeny };
    }
    if (state.unc.uA || state.unc.uT || state.unc.useIaea) extra.uncertainty = Object.assign({}, state.unc);
    if (state.gen) extra.generator = JSON.parse(JSON.stringify(state.gen));
    return JSON.stringify(Object.assign({
      format: FILE_FORMAT, version: FILE_VERSION, app: APP_TITLE + ' ' + APP_VERSION, saved: new Date().toISOString(),
      roots: state.roots.slice(), activities, activityUnit: ACT_UNITS[actUnit()].ru, hold: h.ok ? h.value : $('#hold').value, holdUnit: h.unit,
    }, extra, { overrides }), null, 2);
  }

  /** Загружает данные проекта (из файла или примера). Бросает ошибку с понятным текстом. */
  function applyData(d) {
    if (!d || typeof d !== 'object' || (d.format && d.format !== FILE_FORMAT)) throw new Error('Это не файл калькулятора полураспада.');
    const warn = [];
    let roots = Array.isArray(d.roots) ? d.roots : d.format ? DEFAULT_ROOTS : null;
    if (!roots) throw new Error('В файле нет списка изотопов.');
    const ok = [];
    for (const r of roots) { const n = C.normalizeName(r); if (n && DB[n][0] != null && !ok.includes(n)) ok.push(n); else warn.push(String(r)); }
    const overrides = {};
    for (const [k, o] of Object.entries(d.overrides || {})) {
      const n = C.normalizeName(k); const T = o && Number(o.T);
      if (n && T > 0 && isFinite(T)) overrides[n] = { T }; else warn.push('правка ' + k);
    }
    const activities = {};
    for (const [k, v] of Object.entries(d.activities || {})) {
      const n = C.normalizeName(k);
      if (n) activities[n] = typeof v === 'number' ? fmtInput(v) : String(v); else warn.push(k);
    }
    state.roots = ok; state.overrides = overrides; state.activities = activities; state.hidden = {};
    setActUnit(ACT_UNITS[d.actUnit] ? d.actUnit : DEFAULT_ACT);
    rebuildSet();
    const unit = UNITS[d.holdUnit] ? d.holdUnit : DEFAULT_UNIT;
    const hv = typeof d.hold === 'number' ? d.hold : parseNum(d.hold);
    setHold(hv != null && !isNaN(hv) ? hv : DEFAULT_HOLD, unit);
    setExtra(Array.isArray(d.holdExtra) ? d.holdExtra.filter((v) => typeof v === 'number' && v >= 0).map(fmtInput).join('; ')
      : typeof d.holdExtra === 'string' ? d.holdExtra : '');
    state.dates = validDates(d.dates);
    renderDates();
    const pu = d.purity && typeof d.purity === 'object' ? d.purity : {};
    state.target = typeof pu.target === 'string' ? C.normalizeName(pu.target) || '' : '';
    state.countProgeny = !!pu.countProgeny;
    setLimit(typeof pu.limitPercent === 'number' && pu.limitPercent >= 0 ? pu.limitPercent : 0.1);
    const un = d.uncertainty && typeof d.uncertainty === 'object' ? d.uncertainty : {};
    const pct = (v) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : 0);
    state.unc = { uA: pct(un.uA), uT: pct(un.uT), useIaea: !!un.useIaea };
    state.gen = validGen(d.generator);
    state.result = null;
    setLocked(false);
    renderInput();
    renderResult();
    showError('');
    setRootError(warn.length ? 'Не найдено в базе и пропущено: ' + warn.join(', ') + '.' : '');
  }

  /** Настройки генератора из файла (или null, если их нет или они испорчены). */
  function validGen(g) {
    if (!g || typeof g !== 'object') return null;
    const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
    if (!num(g.interval, 0, 1e9) || !num(g.count, 1, 1000) || !UNITS[g.unit]) return null;
    const eff = {};
    for (const [el, v] of Object.entries(g.eff || {})) if (/^[A-Z][a-z]?$/.test(el) && num(v, 0, 100) && v > 0) eff[el] = v;
    const out = { interval: g.interval, unit: g.unit, count: Math.floor(g.count), eff };
    if (num(g.first, 0, 1e9)) out.first = g.first;
    return out;
  }

  async function confirmDiscard() {
    if (!state.dirty) return true;
    const r = await dialog({
      title: 'Несохранённые изменения', html: `<p>Сохранить изменения в «${esc(state.name)}»?</p>`,
      buttons: [{ label: 'Сохранить', value: 'save', primary: true }, { label: 'Не сохранять', value: 'discard' }, { label: 'Отмена', value: 'cancel' }],
    });
    if (r === 'save') return await cmdSave(false);
    if (r === 'discard') clearDraft();
    return r === 'discard';
  }

  function resetDoc() {
    state.roots = DEFAULT_ROOTS.filter((n) => DB[n]);
    state.activities = {}; state.overrides = {}; state.hidden = {};
    rebuildSet();
    setHold(DEFAULT_HOLD, DEFAULT_UNIT);
    setActUnit(DEFAULT_ACT); setExtra(''); state.dates = null; renderDates();
    state.target = ''; state.countProgeny = false; setLimit(0.1); state.unc = { uA: 0, uT: 0, useIaea: false }; state.gen = null;
    state.result = null;
    state.name = UNTITLED; state.handle = null; state.path = null;
    setLocked(false);
    renderInput(); renderResult(); showError(''); setRootError('');
    setClean();
  }
  async function cmdNew() { if (await confirmDiscard()) resetDoc(); }

  async function cmdOpen() {
    if (!(await confirmDiscard())) return;
    if (host && host.openFile) {
      try { const f = await host.openFile(); if (f) loadText(f.text, f.name, { path: f.path }); } catch (e) { errorDlg('Не удалось открыть файл', e); }
      return;
    }
    if (window.showOpenFilePicker && !android) {
      try {
        const [h] = await window.showOpenFilePicker({ types: [{ description: 'Расчёт полураспада', accept: { 'application/json': [FILE_EXT, '.json'] } }] });
        const f = await h.getFile();
        loadText(await f.text(), f.name, { handle: h });
      } catch (e) { if (e.name !== 'AbortError') errorDlg('Не удалось открыть файл', e); }
      return;
    }
    const fi = $('#fileInput'); fi.value = ''; fi.click();
  }
  async function openFileObject(f) {
    try { loadText(await f.text(), f.name, {}); } catch (e) { errorDlg('Не удалось открыть файл', e); }
  }
  function loadText(text, name, where) {
    let d;
    try { d = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { errorDlg('Не удалось открыть файл', 'Файл повреждён или имеет неизвестный формат.'); return false; }
    try { applyData(d); } catch (e) { errorDlg('Не удалось открыть файл', e); return false; }
    state.name = name || UNTITLED; state.handle = (where && where.handle) || null; state.path = (where && where.path) || null;
    setClean();
    if (where) addRecent(serialize());
    return true;
  }

  async function cmdSave(as) {
    const data = serialize();
    const suggested = baseName() + FILE_EXT;
    try {
      if (host && host.saveFile) {
        const res = await host.saveFile({ path: as ? null : state.path, suggestedName: suggested, data,
          filters: [{ name: 'Расчёт полураспада', extensions: ['hlc'] }] });
        if (!res) return false;
        state.path = res.path; state.name = res.name; setClean(); addRecent(data); return true;
      }
      if (window.showSaveFilePicker && !android && !window.HLSaveHook) {
        let h = as ? null : state.handle;
        if (!h) h = await window.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'Расчёт полураспада', accept: { 'application/json': [FILE_EXT] } }] });
        const w = await h.createWritable(); await w.write(data); await w.close();
        state.handle = h; state.name = h.name; setClean(); addRecent(data); return true;
      }
      const ok = await saveBlob(new Blob([data], { type: HLC_MIME }), suggested, HLC_MIME);
      if (ok) { state.name = suggested; setClean(); addRecent(data); }
      return ok;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      errorDlg('Ошибка сохранения', e); return false;
    }
  }

  /**
   * Единая точка сохранения файла (формулы, Excel, .hlc в браузере без File System Access API).
   * Electron — нативный диалог; Android — AndroidHost.saveFile; Chrome/Edge — showSaveFilePicker; иначе — скачивание.
   * Возвращает true, если файл сохранён (или отдан на скачивание), false — если пользователь отменил.
   */
  async function saveBlob(blob, name, mime) {
    try {
      // Внешний обработчик сохранения (страница-артефакт на claude.ai: window.HLSaveHook из artifact-host.js)
      if (window.HLSaveHook) return !!(await window.HLSaveHook(blob, name, mime));
      if (host && host.saveFile) {
        const data = new Uint8Array(await blob.arrayBuffer());
        const ext = (name.match(/\.([^.]+)$/) || [])[1];
        const res = await host.saveFile({ suggestedName: name, data, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
        return !!res;
      }
      if (android && android.saveFile) {
        const b64 = await blobToBase64(blob);
        android.saveFile(name, mime || blob.type || 'application/octet-stream', b64);
        return true;
      }
      if (window.showSaveFilePicker) {
        const ext = (name.match(/\.[^.]+$/) || [''])[0];
        const h = await window.showSaveFilePicker({ suggestedName: name, types: ext ? [{ description: ext.slice(1).toUpperCase(), accept: { [(mime || blob.type || 'application/octet-stream').split(';')[0]]: [ext] } }] : undefined });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      if (!(e && e.name === 'SecurityError')) { errorDlg('Ошибка сохранения', e); return false; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return true;
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // ---------- черновик и недавние расчёты ----------
  // Черновик: несохранённый расчёт держится в localStorage и возвращается после перезагрузки страницы,
  // закрытия вкладки или падения программы. Снимается при сохранении, «Новом» и ответе «Не сохранять».
  // Недавние: копии последних сохранённых и открытых расчётов (до RECENT_MAX) — открыть одним щелчком.
  const DRAFT_KEY = 'halflife.draft';
  const RECENT_KEY = 'halflife.recent';
  const RECENT_MAX = 8;
  const RECENT_MAX_TEXT = 300000;
  let draftTimer = 0, draftTime = 0; // draftTime — время последней правки (не расчёта)
  function scheduleDraft(edit) { if (edit !== false) draftTime = Date.now(); clearTimeout(draftTimer); draftTimer = setTimeout(writeDraft, 400); }
  function writeDraft() {
    clearTimeout(draftTimer); draftTimer = 0;
    if (!state.dirty) return;
    let text; try { text = serialize(); } catch (e) { return; }
    storeSet(DRAFT_KEY, JSON.stringify({ v: 1, text, name: state.name, path: state.path || null, calc: !!state.result, time: draftTime || Date.now() }));
  }
  function flushDraft() { if (draftTimer) writeDraft(); }
  function clearDraft() { clearTimeout(draftTimer); draftTimer = 0; storeSet(DRAFT_KEY, null); }

  /** При запуске: вернуть несохранённый расчёт, если он остался. */
  function restoreDraft(raw) {
    if (!raw) return false;
    let d = null; try { d = JSON.parse(raw); } catch (e) { d = null; }
    if (!d || d.v !== 1 || typeof d.text !== 'string') { storeSet(DRAFT_KEY, null); return false; }
    try { applyData(JSON.parse(d.text)); } catch (e) { storeSet(DRAFT_KEY, null); resetDoc(); return false; }
    state.name = typeof d.name === 'string' && d.name ? d.name : UNTITLED;
    state.path = host && typeof d.path === 'string' ? d.path : null; state.handle = null;
    state.dirty = true; updateTitle();
    draftTime = Number(d.time) || Date.now();
    storeSet(DRAFT_KEY, raw); // resetDoc при запуске снял черновик — возвращаем, пока не сохранили
    if (d.calc) calc();
    showDraftNote(d.time);
    return true;
  }
  function showDraftNote(time) {
    let n = $('#draftNote');
    if (!n) {
      n = document.createElement('div'); n.id = 'draftNote'; n.className = 'draft-note'; n.setAttribute('role', 'status');
      const intro = $('.intro'), main = $('main');
      if (intro) intro.after(n); else if (main) main.prepend(n); else return;
      n.addEventListener('click', (e) => {
        const b = e.target.closest('[data-draft]'); if (!b) return;
        if (b.dataset.draft === 'reset') resetDoc();
        hideDraftNote();
      });
    }
    const when = fmtWhen(time);
    n.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8a6.2 6.2 0 1 1-6.2 6.2M1.8 3.2V8h4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      `<p><b>Восстановлен несохранённый расчёт</b>${when ? ' (' + esc(when) + ')' : ''}. Сохраните его, если он нужен, или начните заново.</p>` +
      '<div class="draft-actions"><button type="button" data-draft="reset">Начать заново</button>' +
      '<button type="button" class="draft-x" data-draft="hide" aria-label="Скрыть сообщение" title="Скрыть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>';
    n.hidden = false;
  }
  function hideDraftNote() { const n = $('#draftNote'); if (n) n.hidden = true; }

  function fmtWhen(ms) {
    const d = new Date(ms); if (!ms || isNaN(d.getTime())) return '';
    const now = new Date();
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const day = (x) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    if (day(d) === day(now)) return 'сегодня, ' + time;
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day(d) === day(y)) return 'вчера, ' + time;
    const o = { day: 'numeric', month: 'long' }; if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('ru-RU', o) + ', ' + time;
  }

  function readRecent() {
    let a; try { a = JSON.parse(storeGet(RECENT_KEY) || '[]'); } catch (e) { a = []; }
    return Array.isArray(a) ? a.filter((r) => r && typeof r.text === 'string' && typeof r.name === 'string') : [];
  }
  function writeRecent(list) {
    if (!list.length) { storeSet(RECENT_KEY, null); return; }
    list = list.slice(0, RECENT_MAX);
    // хранилище переполнено — убираем самые старые
    while (list.length && !storeSet(RECENT_KEY, JSON.stringify(list))) list = list.slice(0, -1);
  }
  // в браузере пути нет: разные расчёты под одним именем «расчёт.hlc» различаем по изотопам
  const recentKey = (r) => (r.path ? 'p:' + r.path : 'n:' + r.name + '|' + String(r.sum || '').split(' · ')[0]);
  function addRecent(text) {
    if (typeof text !== 'string' || !text || text.length > RECENT_MAX_TEXT) return;
    const h = readHold();
    const sum = (state.roots.length ? state.roots.join(', ') : 'без изотопов') + (h.ok ? ' · ' + holdText(h.value, h.unit) : '');
    const r = { name: state.name, path: (host && state.path) || null, time: Date.now(), sum, text };
    const k = recentKey(r);
    writeRecent([r, ...readRecent().filter((x) => recentKey(x) !== k)]);
  }
  function recentHtml(list) {
    if (!list.length) return '<p class="recent-empty">Здесь появятся расчёты, которые вы сохраняли или открывали на этом устройстве.</p>';
    return '<ul class="recent-list">' + list.map((r, i) =>
      `<li><button type="button" class="recent-open" data-open="${i}" title="${esc(r.path || r.name)}">` +
      `<span class="recent-name">${esc(r.name)}</span><span class="recent-sub">${esc(r.sum || '')}</span>` +
      `<span class="recent-time">${esc(fmtWhen(r.time))}</span></button>` +
      `<button type="button" class="recent-del" data-del="${i}" aria-label="Убрать «${esc(r.name)}» из списка" title="Убрать из списка">` +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></li>').join('') + '</ul>';
  }
  async function cmdRecent() {
    let list = readRecent();
    const render = () => {
      const box = $('#recentBox'); if (box) box.innerHTML = recentHtml(list);
      const clr = $('#dlg button[value="clear"]'); if (clr) clr.disabled = !list.length;
    };
    const p = dialog({
      title: 'Недавние расчёты',
      html: '<p class="recent-note">Последние расчёты, которые вы сохраняли или открывали. Открывается копия данных на момент сохранения.</p><div id="recentBox"></div>',
      buttons: [{ label: 'Закрыть', value: 'cancel', primary: true }, { label: 'Очистить список', value: 'clear' }],
    });
    render();
    const body = $('#dlgBody');
    const onClick = (e) => {
      const o = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
      if (o) { $('#dlg').close('open:' + o.dataset.open); return; }
      if (del) {
        const i = Number(del.dataset.del); list.splice(i, 1); writeRecent(list); render();
        const next = $(`#recentBox [data-open="${Math.min(i, list.length - 1)}"]`); if (next) next.focus();
      }
    };
    body.addEventListener('click', onClick);
    const r = await p;
    body.removeEventListener('click', onClick);
    if (r === 'clear') {
      const ok = await dialog({ title: 'Очистить список', html: `<p>Убрать из списка все расчёты (${list.length})? Сами файлы не удаляются.</p>`,
        buttons: [{ label: 'Очистить', value: 'ok', primary: true }, { label: 'Отмена', value: 'cancel' }] });
      if (ok === 'ok') writeRecent([]); else cmdRecent();
      return;
    }
    const m = /^open:(\d+)$/.exec(r || ''); if (!m) return;
    const item = list[Number(m[1])]; if (!item) return;
    if (!(await confirmDiscard())) return;
    loadText(item.text, item.name, { path: host ? item.path : null, recent: true });
  }

  // ---------- экспорт в Excel ----------
  function buildWorkbook() {
    const r = state.result;
    const b = (v) => ({ v, bold: true });
    const srcName = (x) => (x.src === 'user' ? 'пользователь' : x.src);
    const f = r.actF || 1, u = (ACT_UNITS[r.actUnit] || ACT_UNITS[DEFAULT_ACT]).ru;
    const extraT = r.times ? r.times.filter((t) => !t.main) : [];
    if (uncActive() && (!r.unc || r.unc.key !== uncKey())) computeUnc(r);
    const pl = purityList(r);
    const mainIdx = r.times ? Math.max(0, r.times.findIndex((t) => t.main)) : 0;
    const pm = pl ? pl[mainIdx] : null, unc = r.unc, lim = limitFrac();
    const res = [
      [b('Калькулятор полураспада — результат расчёта')],
      ['Файл', state.name],
      ['Родоначальники', r.roots.join(', ')],
      ['Выдержка', r.holdText],
      ['Выдержка, с', r.tSec],
    ];
    if (r.dates) res.push(['Дата калибровки', fmtDate(r.dates.from)], ['Дата использования', fmtDate(r.dates.to)]);
    if (extraT.length) res.push(['Ещё сроки', extraT.map((t) => t.text).join('; ')]);
    res.push(['Единица активности', u]);
    if (pm) {
      res.push(['Целевой изотоп', state.target + (state.countProgeny ? '' : ' (дочерние продукты цели примесями не считаются)')]);
      pl.forEach((p) => res.push([`Чистота через ${p.time.text}, %`, p.purity * 100]));
      if (lim != null) res.push(['Предел примеси, %', lim * 100]);
    }
    if (unc) res.push(['Погрешность', `${uncText(r)} (1σ); Монте-Карло, ${unc.n} повторов; «±» — половина интервала 95 %`]);
    if (state.iaea) res.push(['Обновление IAEA', dataSourceText()]);
    res.push(
      ['Дата расчёта', r.at.toLocaleString('ru-RU')],
      ['Данные', 'T½: IAEA LiveChart of Nuclides (ENSDF), ICRP-107; 1 год = 365,2422 сут'],
      ['Модель', 'Уравнения Бейтмана, аналитическое решение; A = λ·N, λ = ln2/T½'],
      [],
      [b('Цепочка'), b('Изотоп'), b('T½'), b('T½, с'), b('λ, 1/с'), b('Источник T½'), b('A₀, ' + u), b('N₀, атомов'),
        b(extraT.length ? `A(${r.holdText}), ${u}` : 'A(t), ' + u), b(extraT.length ? `N(${r.holdText}), атомов` : 'N(t), атомов'),
        ...extraT.map((t) => b(`A(${t.text}), ${u}`)), ...(unc ? [b(`±95 % для A(${r.holdText}), %`)] : []), ...(pm ? [b('Примесь, %')] : []),
        ...(AM ? [b(extraT.length ? `m(${r.holdText}), г` : 'm(t), г')] : [])],
    );
    const groups = groupsOf(r.rows, r.roots);
    for (const g of groups) for (const x of g.items) {
      const i = r.rows.indexOf(x);
      res.push([g.root, x.name, C.fmtHalfLife(x.T), x.stable ? '' : x.T, x.lambda, x.stable ? 'стабильный' : srcName(x),
        x.stable ? '' : x.A0 / f, x.N0, x.stable ? '' : x.A / f, x.N, ...extraT.map((t) => (x.stable ? '' : t.A[i] / f)),
        ...(unc ? [x.stable ? '' : unc.A[mainIdx][i].rel * 100] : []),
        ...(pm ? [x.name === state.target ? 'цель' : x.stable ? '' : pm.share[i] * 100] : []),
        ...(AM ? [AM.gramsFromAtoms(x.N, x.name)] : [])]);
    }
    res.push([]);
    const sumT = (items, t) => items.reduce((s, x) => s + (x.stable ? 0 : t.A[r.rows.indexOf(x)]), 0) / f;
    for (const g of groups) res.push([b('Сумма: цепочка ' + g.root), '', '', '', '', '', sumA(g.items, 'A0') / f, '', sumA(g.items, 'A') / f, '', ...extraT.map((t) => sumT(g.items, t))]);
    if (groups.length > 1) res.push([b('Всего'), '', '', '', '', '', sumA(r.rows, 'A0') / f, '', sumA(r.rows, 'A') / f, '', ...extraT.map((t) => sumT(r.rows, t))]);

    const sc = UNITS[r.unit].sec;
    const idx = r.rows.map((x, i) => i).filter((i) => !r.rows[i].stable);
    const dyn = [[b('t, ' + UNITS[r.unit].ru), b('t, с'), ...idx.map((i) => b(r.rows[i].name + ', ' + u))]];
    r.series.t.forEach((t, p) => dyn.push([t / sc, t, ...idx.map((i) => r.series.A[p][i] / f)]));

    const sheets = [
      { name: 'Результат', rows: res, widths: [22, 11, 16, 13, 13, 14, 13, 13, 13, 13, ...extraT.map(() => 15), ...(unc ? [14] : []), ...(pm ? [12] : []), ...(AM ? [14] : [])] },
      { name: 'Динамика', rows: dyn, widths: [12, 13, ...idx.map(() => 13)] },
    ];
    if (F && F.text) {
      let txt = ''; try { txt = F.text(formulaModel()); } catch (e) { txt = ''; }
      if (txt) sheets.push({ name: 'Формулы', rows: txt.split('\n').map((l) => [l]), widths: [140] });
    }
    return window.HLXlsx.build(sheets);
  }
  async function cmdExport() {
    if (!state.result) { dialog({ title: 'Экспорт в Excel', html: '<p>Сначала выполните расчёт.</p>' }); return; }
    try { await saveBlob(buildWorkbook(), baseName() + '.xlsx', XLSX_MIME); } catch (e) { errorDlg('Ошибка экспорта', e); }
  }

  // ---------- диалоги ----------
  let dlgSeq = 0;
  /**
   * Модальный диалог на #dlg. opts: {title, html, buttons:[{label, value, primary}], validate(value)->bool, focus, wide}.
   * Возвращает Promise со значением нажатой кнопки ('' — закрыт клавишей Esc).
   */
  function dialog(opts) {
    const dlg = $('#dlg');
    if (!dlg || typeof dlg.showModal !== 'function') { alert((opts.title || '') + '\n\n' + String(opts.html || '').replace(/<[^>]+>/g, '')); return Promise.resolve('ok'); }
    if (dlg.open) dlg.close('');
    const seq = ++dlgSeq;
    const form = $('form', dlg);
    if (!dlg._actions) {
      // контейнер кнопок — родитель исходной кнопки OK из вёрстки
      const okBtn = $('button[value="ok"]', form) || Array.from(form.querySelectorAll('button')).find((b) => !b.closest('#dlgBody'));
      dlg._actions = (okBtn && okBtn.parentElement) || form.appendChild(document.createElement('div'));
      dlg._defaultActions = dlg._actions.innerHTML;
    }
    const actions = dlg._actions;
    $('#dlgTitle').textContent = opts.title || '';
    const body = $('#dlgBody');
    body.innerHTML = opts.html || '';
    const buttons = opts.buttons || [{ label: 'OK', value: 'ok', primary: true }];
    actions.innerHTML = buttons.map((b) => `<button type="submit" value="${esc(b.value)}"${b.primary ? ' class="primary"' : ''}>${esc(b.label)}</button>`).join('');
    dlg.classList.toggle('wide', !!opts.wide);
    dlg.returnValue = '';
    return new Promise((resolve) => {
      const onSubmit = (e) => {
        const v = e.submitter ? e.submitter.value : 'ok';
        if (opts.validate && !opts.validate(v)) { e.preventDefault(); }
      };
      const onClose = () => {
        if (seq === dlgSeq && dlg.open) return; // запоздалое событие close от предыдущего диалога
        form.removeEventListener('submit', onSubmit);
        form.removeEventListener('keydown', onKey);
        dlg.removeEventListener('close', onClose);
        if (seq === dlgSeq) { actions.innerHTML = dlg._defaultActions; dlg.classList.remove('wide'); }
        resolve(dlg.returnValue || '');
      };
      const onKey = (e) => {
        // Enter в поле диалога = основная кнопка (в вёрстке первой по порядку стоит «×»)
        if (e.key === 'Enter' && e.target.matches('input, select')) {
          const prim = $('button.primary', actions);
          if (prim) { e.preventDefault(); if (form.requestSubmit) form.requestSubmit(prim); else prim.click(); }
        }
      };
      form.addEventListener('submit', onSubmit);
      form.addEventListener('keydown', onKey);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      const f = opts.focus && $(opts.focus, dlg);
      if (f) { f.focus(); if (f.select) f.select(); }
    });
  }
  function errorDlg(title, e) {
    const msg = e && e.message ? e.message : String(e || '');
    return dialog({ title, html: `<p class="msg error">${esc(msg)}</p>` });
  }

  function help(key) { return window.HLHelp && window.HLHelp[key] ? window.HLHelp[key] : ''; }
  function cmdGuide() {
    dialog({ title: 'Как пользоваться', wide: true, html: help('guide') ||
      '<ol><li>Добавьте изотопы-родоначальники (например Th-229, Th-228) — цепочки распада построятся сами.</li>' +
      '<li>Введите начальные активности примесей в беккерелях (по умолчанию 0).</li>' +
      '<li>Укажите время и нажмите «Рассчитать» (или Enter).</li>' +
      '<li>Результат, график и формулы — на вкладках справа. «Изменить данные» снова открывает ввод.</li>' +
      '<li>Файл → Сохранить сохраняет введённые данные в файл .hlc; Экспорт в Excel — таблицу результата.</li></ol>' });
  }
  function cmdAbout() {
    dialog({ title: 'О программе', html: help('about') ||
      `<p><b>${APP_TITLE}</b>, версия ${APP_VERSION}.</p><p>Расчёт активности радионуклидов и их дочерних продуктов после выдержки ` +
      'по уравнениям Бейтмана (аналитическое решение). Периоды полураспада — IAEA LiveChart of Nuclides и ICRP-107.</p><p>Работает без интернета.</p>' });
  }
  function decayText(x) {
    const parts = (x.daughters || []).map((d) => {
      const pct = d.br < 1 ? ` ${String(Number((d.br * 100).toPrecision(4))).replace('.', ',')} %` : '';
      return `${esc(d.mode || '')}${pct} → ${d.name === 'SF' ? 'деление' : esc(d.name)}`;
    });
    return parts.join('<br>') || '—';
  }
  function cmdData() {
    if (!state.set.length) {
      dialog({ title: 'Ядерные данные', html: '<p>Добавьте изотоп-родоначальник — здесь появятся данные всех изотопов набора.</p>' + help('dataNotes') });
      return;
    }
    let h = '<div class="table-wrap"><table class="grid data-table"><thead><tr><th>Изотоп</th><th>T½</th><th class="num">λ, 1/с</th><th>Распад</th><th>Источник</th></tr></thead><tbody>';
    for (const g of groupsOf(state.set, state.roots)) {
      h += `<tr class="chain"><td colspan="5">Цепочка ${esc(g.root)}</td></tr>`;
      for (const x of g.items) {
        const over = x.src === 'user';
        const editable = x.lambda > 0 && !state.locked;
        h += `<tr><td class="iso">${esc(x.name)}</td>` +
          `<td class="t12${over ? ' overridden' : ''}"${editable ? ` tabindex="0" role="button" data-edit-data="${esc(x.name)}" title="Нажмите, чтобы изменить T½"` : ''}>${esc(C.fmtHalfLife(x.T))}</td>` +
          `<td class="num" title="${x.lambda ? full(x.lambda) : '0'}">${x.lambda ? esc(fmt(x.lambda, 6)) : '0'}</td><td>${decayText(x)}</td>` +
          `<td>${esc(x.lambda === 0 ? 'стабильный' : over ? 'польз.' : x.src)}</td></tr>`;
      }
    }
    h += '</tbody></table></div>';
    if (state.locked) h += '<p class="hint">Чтобы изменить T½, нажмите «Изменить данные».</p>';
    else h += '<p class="hint">Нажмите на T½, чтобы задать своё значение.</p>';
    const notes = help('dataNotes') || '<p class="hint">Периоды полураспада: IAEA LiveChart of Nuclides (ENSDF), для отсутствующих — ICRP-107. ' +
      'Схемы распада и доли ветвлений — ICRP-107. 1 год = 365,2422 сут. Спонтанное деление выводит ядра из цепочки.</p>';
    dialog({ title: 'Ядерные данные', html: h + notes, wide: true });
    const body = $('#dlgBody');
    const open = (name) => { $('#dlg').close('edit'); editHalfLife(name, true); };
    $$('[data-edit-data]', body).forEach((td) => {
      td.addEventListener('click', () => open(td.dataset.editData));
      td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(td.dataset.editData); } });
    });
  }

  // ---------- подбор выдержки ----------
  const HUMAN_UNITS = [[C.units.Y, 'лет'], [C.units.D, 'сут'], [C.units.H, 'ч'], [C.units.MIN, 'мин'], [1, 'с']];
  function humanTime(sec) {
    if (!(sec > 0)) return '0 с';
    const u = HUMAN_UNITS.find((x) => sec >= x[0]) || HUMAN_UNITS[HUMAN_UNITS.length - 1];
    return fmt(sec / u[0], 4) + ' ' + u[1];
  }
  const bestUnit = (sec) => (sec >= C.units.Y ? 'y' : sec >= C.units.D ? 'd' : sec >= C.units.H ? 'h' : sec >= 60 ? 'min' : 's');
  function currentA0Bq() {
    const { A0, bad } = validateInputs(false);
    const f = ACT_UNITS[actUnit()].f;
    const out = {}; for (const k in A0) out[k] = A0[k] * f;
    return { A0: out, bad };
  }
  async function cmdFindHold() {
    const T = 'Подбор выдержки';
    if (!TL) return;
    if (!state.set.length) { dialog({ title: T, html: '<p>Добавьте изотоп-родоначальник и задайте начальные активности.</p>' }); return; }
    const { A0, bad } = currentA0Bq();
    if (bad.length || !Object.values(A0).some((v) => v > 0)) { dialog({ title: T, html: '<p>Сначала задайте начальные активности в таблице: подбор считает по ним.</p>' }); return; }
    const au = actUnit(), f = ACT_UNITS[au].f, u = ACT_UNITS[au].ru;
    const names = state.set.filter((x) => x.lambda > 0).map((x) => x.name);
    const last = state.findLast && names.includes(state.findLast.name) ? state.findLast : null;
    const def = last || { name: names.includes(state.target) ? state.target : names.find((n) => A0[n] > 0) || names[0], type: 'le', le: '', ge: '', pur: '99,9' };
    const radio = (v, label) => `<span class="cond"><input type="radio" name="findType" value="${v}"${def.type === v ? ' checked' : ''}><span>${label}</span></span>`;
    const html = `<p>Считается по начальным активностям из таблицы и текущим T½.</p>` +
      `<div class="find-grid"><label for="findName">Изотоп</label><select id="findName">${names.map((n) => `<option value="${esc(n)}"${n === def.name ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` +
      `<div class="find-conds" role="radiogroup" aria-label="Условие">` +
      `<label>${radio('le', 'спад: активность не больше')} <span class="cond-val"><input type="text" id="findLe" inputmode="decimal" autocomplete="off" value="${esc(def.le || '')}" aria-label="Уровень спада"> ${esc(u)}</span></label>` +
      `<label>${radio('ge', 'накопление: активность не меньше')} <span class="cond-val"><input type="text" id="findGe" inputmode="decimal" autocomplete="off" value="${esc(def.ge || '')}" aria-label="Уровень накопления"> ${esc(u)}</span></label>` +
      `<label>${radio('max', 'максимум активности (накопление дочернего изотопа)')}</label>` +
      `<label>${radio('purity', 'радионуклидная чистота не ниже')} <span class="cond-val"><input type="text" id="findPur" inputmode="decimal" autocomplete="off" value="${esc(def.pur || '99,9')}" aria-label="Чистота, %"> %</span></label>` +
      `</div><p id="findOut" class="find-out" role="status"></p>`;
    let found = null;
    const pr = dialog({
      title: T, html,
      buttons: [{ label: 'Найти', value: 'find', primary: true }, { label: 'Применить и рассчитать', value: 'apply' }, { label: 'Закрыть', value: 'cancel' }],
      focus: '#findName',
      validate: (v) => {
        if (v === 'find') { search(); return false; }
        if (v === 'apply') return !!(found && found.t > 0);
        return true;
      },
    });
    const out = $('#findOut');
    const applyBtn = $('#dlg button[value="apply"]');
    const reset = () => { found = null; if (applyBtn) applyBtn.disabled = true; };
    reset();
    $$('#dlgBody .find-conds input[type="text"]').forEach((inp) => inp.addEventListener('focus', () => { inp.closest('label').querySelector('input[type="radio"]').checked = true; }));
    $('#dlgBody').addEventListener('input', reset);
    $('#dlgBody').addEventListener('change', reset);
    function say(text, bad) { out.textContent = text; out.classList.toggle('bad', !!bad); }
    function search() {
      reset();
      const name = $('#findName').value;
      const type = ($('#dlgBody input[name="findType"]:checked') || {}).value || 'le';
      const raw = { le: $('#findLe').value, ge: $('#findGe').value, pur: $('#findPur').value };
      state.findLast = Object.assign({ name, type }, raw);
      const c = { type, name, countProgeny: state.countProgeny };
      if (type === 'le' || type === 'ge') {
        const v = parseNum(raw[type]);
        if (v === null || isNaN(v) || v < 0) { say(`Введите уровень активности в ${u} (число ≥ 0).`, true); return; }
        c.value = v * f;
      } else if (type === 'purity') {
        const v = parseNum(raw.pur);
        if (v === null || isNaN(v) || v <= 0 || v > 100) { say('Введите чистоту в процентах: больше 0 и не больше 100.', true); return; }
        c.value = v / 100;
      }
      let res;
      try { res = TL.findHold(state.set, A0, c); } catch (e) { say('Не удалось выполнить подбор: ' + e.message, true); return; }
      if (!res.found) { say(res.reason, true); return; }
      found = res;
      const when = (t) => humanTime(t) + (state.dates && t > 0 ? ` (${fmtDate(toLocalInput(new Date(parseLocal(state.dates.from).getTime() + t * 1000)))})` : '');
      const till = res.until != null ? (isFinite(res.until) ? ` Условие выполняется до ${when(res.until)}.` : ' Дальше условие выполняется всё время.') : '';
      let txt;
      if (type === 'max') txt = `Максимум активности ${name}: ${fmt(res.value / f)} ${u} через ${when(res.t)}.`;
      else if (type === 'le') txt = res.already ? `Активность ${name} уже в начале не больше ${raw.le} ${u} и не превышает этот уровень.` : `Активность ${name} опустится до ${raw.le} ${u} через ${when(res.t)} и выше уже не поднимется.`;
      else if (type === 'ge') txt = res.already ? `Активность ${name} уже в начале не меньше ${raw.ge} ${u}.${till}` : `Активность ${name} достигнет ${raw.ge} ${u} через ${when(res.t)}.${till}`;
      else txt = res.already ? `Чистота ${name} не ниже ${raw.pur} % уже в начальный момент.${till}` : `Чистота ${name} достигнет ${raw.pur} % через ${when(res.t)}.${till}`;
      say(txt, false);
      if (applyBtn) applyBtn.disabled = !(res.t > 0);
    }
    const r = await pr;
    if (r === 'apply' && found && found.t > 0) applyHold(found.t);
  }
  // ---------- обратный расчёт: A₀ по измерению ----------
  async function cmdBackCalc() {
    const T = 'Пересчёт от измерения';
    if (!TL) return;
    const names = state.set.filter((x) => x.lambda > 0).map((x) => x.name);
    if (!names.length) { dialog({ title: T, html: '<p>Сначала добавьте изотоп: пересчёт идёт по его цепочке распада.</p>' }); return; }
    const { A0, bad } = currentA0Bq();
    const tableOk = !bad.length && Object.values(A0).some((v) => v > 0);
    const h = readHold();
    const roots = state.roots.filter((r) => names.includes(r));
    const nz = Object.keys(A0).filter((n) => A0[n] > 0);
    // прошлые значения окна — только для того же набора родоначальников
    const key = state.roots.join('|');
    const last = state.backLast && state.backLast.key === key && names.includes(state.backLast.name) ? state.backLast : null;
    const def = last || {
      name: names.includes(state.target) ? state.target : state.roots.find((r) => names.includes(r)) || names[0],
      a: '', au: actUnit(), t: h.ok && h.value > 0 ? fmtInput(h.value) : '1', tu: h.ok && h.value > 0 ? h.unit : 'd',
      from: tableOk && (nz.length > 1 || !roots.includes(nz[0])) ? 'table' : 'root:' + (nz.length === 1 && roots.includes(nz[0]) ? nz[0] : roots[0] || names[0]),
      hold: false,
    };
    const fromOpts = (roots.length ? roots : names.slice(0, 1)).map((r) => [`root:${r}`, `только ${r} (остальных — 0)`]);
    if (tableOk) fromOpts.push(['table', 'все, пропорционально таблице']);
    if (!fromOpts.some(([v]) => v === def.from)) def.from = fromOpts[0][0];
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const actOpts = Object.keys(ACT_UNITS).map((k) => [k, ACT_UNITS[k].ru]);
    const tOpts = UNIT_ORDER.map((k) => [k, UNITS[k].ru]);
    const html = '<p>Измерили активность не вначале, а позже? Укажите, какой изотоп, сколько и через какое время измерили, — ' +
      'программа найдёт, какой была начальная активность, и подставит её в таблицу.</p>' +
      '<div class="find-grid bc-grid">' +
      `<label for="bcName">Измерили</label><select id="bcName">${opt(names.map((n) => [n, n]), def.name)}</select>` +
      `<label for="bcA">Активность</label><span class="inp-unit"><input id="bcA" type="text" inputmode="decimal" autocomplete="off" value="${esc(def.a)}" placeholder="например, 5000"><select id="bcAU" aria-label="Единица активности">${opt(actOpts, def.au)}</select></span>` +
      `<label for="bcT">Через</label><span class="inp-unit"><input id="bcT" type="text" inputmode="decimal" autocomplete="off" value="${esc(def.t)}"><select id="bcTU" aria-label="Единица времени">${opt(tOpts, def.tu)}</select></span>` +
      `<label for="bcFrom">Что было вначале</label><select id="bcFrom">${opt(fromOpts, def.from)}</select>` +
      '</div>' +
      `<label class="check-line"><input type="checkbox" id="bcHold"${def.hold ? ' checked' : ''}> поставить выдержку равной этому времени и сразу рассчитать (для проверки)</label>` +
      '<p id="bcOut" class="find-out" role="status"></p>';
    let res = null;
    const pr = dialog({
      title: T, html, focus: '#bcA',
      buttons: [{ label: 'Подставить в таблицу', value: 'apply', primary: true }, { label: 'Отмена', value: 'cancel' }],
      validate: (v) => (v === 'apply' ? !!(res && res.ok) : true),
    });
    const out = $('#bcOut');
    const applyBtn = $('#dlg button[value="apply"]');
    const read = () => ({
      name: $('#bcName').value, a: $('#bcA').value, au: $('#bcAU').value, t: $('#bcT').value, tu: $('#bcTU').value,
      from: $('#bcFrom').value, hold: $('#bcHold').checked, key,
    });
    function update() {
      const v = read();
      state.backLast = v;
      res = null;
      const a = parseNum(v.a), t = parseNum(v.t);
      let msg = '', badMsg = false;
      if (a === null) msg = 'Введите измеренную активность.';
      else if (isNaN(a) || a <= 0) { msg = 'Активность — число больше нуля, например 5000 или 1,5E6.'; badMsg = true; }
      else if (t === null || isNaN(t) || t < 0) { msg = 'Время — число не меньше нуля.'; badMsg = true; }
      else {
        const base = {};
        if (v.from === 'table') Object.assign(base, A0);
        else base[v.from.slice(5)] = 1;
        res = TL.backCalc(state.set, base, v.name, t * UNITS[v.tu].sec, a * ACT_UNITS[v.au].f);
        if (!res.ok) { msg = res.reason; badMsg = true; } else {
          const f = ACT_UNITS[actUnit()].f, u = ACT_UNITS[actUnit()].ru;
          const list = Object.keys(res.A0).filter((n) => res.A0[n] > 0);
          msg = (list.length === 1 ? 'Начальная активность ' : 'Начальные активности: ') +
            list.slice(0, 6).map((n) => `${n} — ${fmt(res.A0[n] / f)} ${u}`).join('; ') + (list.length > 6 ? `; ещё ${list.length - 6}` : '') + '.';
          if (list.length === 1 && list[0] === v.name) msg += ` Поправка на распад: ×${fmt(res.A0[v.name] / (a * ACT_UNITS[v.au].f), 4)}.`;
        }
      }
      out.textContent = msg; out.classList.toggle('bad', badMsg);
      if (applyBtn) applyBtn.disabled = !(res && res.ok);
    }
    $('#dlgBody').addEventListener('input', update);
    $('#dlgBody').addEventListener('change', update);
    update();
    const r = await pr;
    if (r !== 'apply' || !res || !res.ok) return;
    const v = read();
    if (state.locked) setLocked(false);
    const f = ACT_UNITS[actUnit()].f;
    for (const x of state.set) {
      if (!(x.lambda > 0)) continue;
      const val = res.A0[x.name] > 0 ? res.A0[x.name] / f : 0;
      state.activities[x.name] = fmtInput(Number(val.toPrecision(6)));
    }
    renderInputTable();
    if (v.hold) { clearDates(); setHold(parseNum(v.t), v.tu); }
    changed();
    if (v.hold) calc();
  }

  /** Ставит найденную выдержку (с датами — сдвигает дату использования) и сразу считает. */
  function applyHold(tSec) {
    if (state.locked) setLocked(false);
    const h = readHold();
    let unit = h.unit;
    const v = tSec / UNITS[unit].sec;
    if (v < 1 || v >= 1e5) unit = bestUnit(tSec);
    if (state.dates && tSec >= 60) {
      const from = parseLocal(state.dates.from);
      state.dates = { from: state.dates.from, to: toLocalInput(new Date(from.getTime() + Math.round(tSec / 60) * 60000)) };
      holdFromDates(unit); renderDates();
    } else {
      clearDates();
      setHold(Number((tSec / UNITS[unit].sec).toPrecision(6)), unit);
    }
    changed();
    calc();
  }

  // ---------- погрешность: настройки ----------
  async function cmdUncertainty() {
    const n = iaeaUncCount();
    const html = '<p>Погрешность результата считается методом Монте-Карло: расчёт повторяется 2000 раз со случайными A₀ и T½ ' +
      '(нормальное распределение, задаётся стандартное отклонение 1σ, изотопы независимы). В таблице результата появится столбец «±, %» — ' +
      'половина 95-процентного интервала; для целевого изотопа — интервал чистоты.</p>' +
      `<div class="find-grid"><label for="uA">A₀, ± %</label><input id="uA" type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtInput(state.unc.uA))}">` +
      `<label for="uT">T½, ± %</label><input id="uT" type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtInput(state.unc.uT))}"></div>` +
      `<label class="check-line"><input type="checkbox" id="uIaea"${state.unc.useIaea && n ? ' checked' : ''}${n ? '' : ' disabled'}> ` +
      (n ? `для T½ брать погрешности IAEA, где они известны (${n} ${plural(n, ['изотоп', 'изотопа', 'изотопов'])})` : 'погрешности T½ из IAEA появятся после «Данные → Обновить данные IAEA»') + '</label>' +
      '<p class="msg error" id="uErr" role="alert" hidden></p>';
    let vals = null;
    const on = uncActive();
    const buttons = [{ label: 'OK', value: 'ok', primary: true }];
    if (on) buttons.push({ label: 'Выключить', value: 'off' });
    buttons.push({ label: 'Отмена', value: 'cancel' });
    const r = await dialog({
      title: 'Погрешность результата', html, buttons, focus: '#uA',
      validate: (v) => {
        if (v !== 'ok') return true;
        const a = parseNum($('#uA').value), t = parseNum($('#uT').value);
        const okv = (x) => x === null || (!isNaN(x) && x >= 0 && x <= 100);
        if (!okv(a) || !okv(t)) { const e = $('#uErr'); e.textContent = 'Погрешности — числа от 0 до 100 %.'; e.hidden = false; return false; }
        vals = { uA: a || 0, uT: t || 0, useIaea: !!($('#uIaea') && $('#uIaea').checked) };
        return true;
      },
    });
    if (r === 'ok' && vals) state.unc = vals;
    else if (r === 'off') state.unc = { uA: 0, uT: 0, useIaea: false };
    else return;
    markDirty();
    renderResult();
  }

  // ---------- генератор с многократными отборами ----------
  const GEN_UNITS = ['min', 'h', 'd', 'y'];
  const GEN_COLS = 6; // изотопов элюата в таблице окна (остальные — в «прочие» и в Excel)
  /** Элементы набора с радиоактивными изотопами и значения окна по умолчанию. */
  function genDefaults() {
    const radio = new Set(state.set.filter((x) => x.lambda > 0).map((x) => x.name));
    const els = TL.elementsOf(state.set).map((e) => ({ el: e.el, names: e.names.filter((n) => radio.has(n)) })).filter((e) => e.names.length);
    const g = state.gen || {};
    const eff = {};
    if (g.eff) for (const e of els) if (g.eff[e.el] > 0) eff[e.el] = g.eff[e.el];
    if (!Object.keys(eff).length) {
      // по умолчанию извлекается элемент целевого изотопа, иначе — первого радиоактивного дочернего другого элемента
      let el = state.target && radio.has(state.target) ? TL.elementOf(state.target) : '';
      if (!el) {
        const rootEls = new Set(state.roots.map(TL.elementOf));
        const d = state.set.find((x) => x.lambda > 0 && !rootEls.has(TL.elementOf(x.name)));
        el = d ? TL.elementOf(d.name) : '';
      }
      if (el) eff[el] = 100;
    }
    return {
      els, eff, unit: GEN_UNITS.includes(g.unit) ? g.unit : 'd',
      interval: typeof g.interval === 'number' ? g.interval : 10, first: typeof g.first === 'number' ? g.first : null,
      count: typeof g.count === 'number' ? g.count : 10,
    };
  }
  /** График активностей на генераторе (логарифмическая шкала; зубцы — моменты отборов). */
  function plotGenerator(cv, s, idx, names, sc, unitRu, f, actRu, marks) {
    if (!cv || !cv.clientWidth) return;
    const W = cv.clientWidth, H = cv.clientHeight || 220;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const v = (...n) => { for (const x of n) { const y = css.getPropertyValue(x).trim(); if (y) return y; } return ''; };
    const muted = v('--chart-text', '--ink-2') || '#4e5864', grid = v('--chart-grid', '--rule') || '#e7e9ed', axis = v('--chart-axis', '--rule-strong') || '#a3abb5';
    g.font = '12px ' + (v('--font-ui') || 'system-ui, sans-serif');
    let vmax = 0, vmin = Infinity;
    for (const i of idx) for (const row of s.A) { const a = row[i] / f; if (a > vmax) vmax = a; if (a > 0 && a < vmin) vmin = a; }
    if (!(vmax > 0)) return;
    const hi = Math.ceil(Math.log10(vmax) + 1e-9);
    let lo = Math.max(Math.floor(Math.log10(vmin)), hi - 10); if (hi - lo < 2) lo = hi - 2;
    const L = 58, R = 12, T = 10, B = 38, pw = W - L - R, ph = H - T - B;
    const tmax = s.t[s.t.length - 1] / sc || 1;
    const x = (tu) => L + pw * tu / tmax;
    const y = (a) => T + ph * (hi - (a > 0 ? Math.max(Math.log10(a), lo) : lo)) / (hi - lo);
    g.lineWidth = 1; g.strokeStyle = grid; g.fillStyle = muted; g.textAlign = 'right'; g.textBaseline = 'middle';
    const estep = Math.max(1, Math.ceil((hi - lo) / Math.max(2, Math.floor(ph / 26))));
    for (let e = hi; e >= lo; e -= estep) { const yy = Math.round(y(Math.pow(10, e))) + 0.5; g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke(); g.fillText(pow10(e), L - 6, yy); }
    const step = niceStep(tmax / Math.max(2, Math.floor(pw / 90)));
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let tu = 0; tu <= tmax * 1.0001; tu += step) { const xx = Math.round(x(tu)) + 0.5; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke(); g.fillText(fmt(tu, 4), xx, T + ph + 6); }
    g.fillText('t, ' + unitRu, L + pw / 2, T + ph + 21);
    g.strokeStyle = axis; g.beginPath(); g.moveTo(L + 0.5, T); g.lineTo(L + 0.5, T + ph + 0.5); g.lineTo(W - R, T + ph + 0.5); g.stroke();
    g.save(); g.translate(13, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A, ' + actRu, 0, 0); g.restore();
    if (marks && marks.length <= 40) {
      g.save(); g.setLineDash([3, 4]); g.strokeStyle = axis;
      for (const m of marks) { const xx = Math.round(x(m / sc)) + 0.5; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke(); }
      g.restore();
    }
    g.save(); g.beginPath(); g.rect(L, T - 2, pw, ph + 4); g.clip();
    g.lineWidth = 2; g.lineJoin = 'round';
    idx.forEach((i, k) => {
      const st = seriesStyle(k); g.strokeStyle = st.color; g.setLineDash(st.dash); g.beginPath();
      s.t.forEach((t, p) => { const xx = x(t / sc), yy = y(s.A[p][i] / f); if (p) g.lineTo(xx, yy); else g.moveTo(xx, yy); });
      g.stroke();
    });
    g.restore();
  }
  async function cmdGenerator() {
    const T = 'Генератор: многократные отборы';
    if (!TL || !TL.generator) return;
    if (!state.set.length) { dialog({ title: T, html: '<p>Добавьте изотоп-родоначальник генератора (например, Th-229 или Th-228) и задайте его активность.</p>' }); return; }
    const { A0, bad } = currentA0Bq();
    if (bad.length || !Object.values(A0).some((a) => a > 0)) { dialog({ title: T, html: '<p>Сначала задайте начальные активности в таблице: генератор считается по ним.</p>' }); return; }
    const au = actUnit(), f = ACT_UNITS[au].f, u = ACT_UNITS[au].ru;
    const def = genDefaults();
    const unitOpts = (sel) => GEN_UNITS.map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${UNITS[k].ru}</option>`).join('');
    const html = '<p>Исходная смесь — изотопы и начальные активности из таблицы. В каждый момент отбора из генератора химически ' +
      'извлекается указанная доля изотопов выбранных элементов (элюат); остальное остаётся на генераторе и продолжает распадаться.</p>' +
      '<div class="gen-grid">' +
      `<label for="genInterval">Интервал между отборами</label><span class="inp-unit"><input id="genInterval" type="text" inputmode="decimal" autocomplete="off" value="${esc(fmtInput(def.interval))}"><select id="genUnit" aria-label="Единица времени">${unitOpts(def.unit)}</select></span>` +
      `<label for="genFirst">Первый отбор через</label><span class="inp-unit"><input id="genFirst" type="text" inputmode="decimal" autocomplete="off" placeholder="как интервал" value="${def.first == null ? '' : esc(fmtInput(def.first))}"><span id="genUnitLbl">${UNITS[def.unit].ru}</span></span>` +
      `<label for="genCount">Число отборов</label><input id="genCount" type="text" inputmode="numeric" autocomplete="off" value="${esc(String(def.count))}">` +
      '</div>' +
      '<p class="gen-els-head"><b>Что извлекается при отборе, %</b> <span class="note">(пусто — элемент остаётся на генераторе)</span></p>' +
      '<div class="gen-els">' + def.els.map((e) => `<label class="gen-el" title="${esc(e.names.join(', '))}"><span class="gen-el-name"><b>${esc(e.el)}</b>` +
        `<small>${esc(e.names.length > 2 ? e.names.slice(0, 2).join(', ') + '…' : e.names.join(', '))}</small></span>` +
        `<input class="gen-eff" data-el="${esc(e.el)}" type="text" inputmode="decimal" autocomplete="off" aria-label="Доля ${esc(e.el)}, %" value="${def.eff[e.el] ? esc(fmtInput(def.eff[e.el])) : ''}" placeholder="0"></label>`).join('') +
      '</div>' +
      '<p class="msg error" id="genErr" role="alert" hidden></p><div id="genOut" class="gen-out"></div>';
    let last = null;
    const setBtns = () => { $$('#dlg button[value="xlsx"], #dlg button[value="use"]').forEach((b) => { b.disabled = !last; }); };
    const fail = (m) => { const e = $('#genErr'); e.textContent = m; e.hidden = false; $('#genOut').innerHTML = ''; last = null; setBtns(); };
    function read() {
      const unit = $('#genUnit').value, sc = UNITS[unit].sec;
      const iv = parseNum($('#genInterval').value), fv = parseNum($('#genFirst').value), cv = parseNum($('#genCount').value);
      if (cv === null || isNaN(cv) || cv < 1 || cv > 1000 || Math.floor(cv) !== cv) return 'Число отборов — целое число от 1 до 1000.';
      if (iv === null || isNaN(iv) || iv < 0 || (cv > 1 && !(iv > 0))) return 'Интервал между отборами — положительное число.';
      if (fv !== null && (isNaN(fv) || fv < 0)) return 'Время первого отбора — число не меньше нуля.';
      const eff = {}, effPct = {};
      for (const inp of $$('#dlgBody .gen-eff')) {
        const p = parseNum(inp.value);
        if (p === null) continue;
        if (isNaN(p) || p < 0 || p > 100) return `Доля ${inp.dataset.el} — число от 0 до 100 %.`;
        if (p > 0) { eff[inp.dataset.el] = p / 100; effPct[inp.dataset.el] = p; }
      }
      if (!Object.keys(eff).length) return 'Укажите хотя бы один элемент, который извлекается при отборе (доля больше 0 %).';
      const first = fv === null ? iv : fv;
      if (cv === 1 && !(first > 0) && fv === null) return 'Задайте интервал или время первого отбора.';
      return { unit, sc, interval: iv, first: fv, count: cv, eff, effPct, opts: { eff, interval: iv * sc, count: cv, first: first * sc } };
    }
    function runGen() {
      $('#genErr').hidden = true;
      const p = read();
      if (typeof p === 'string') { fail(p); return; }
      let res;
      try { res = TL.generator(state.set, A0, p.opts); } catch (e) { fail(e.message); return; }
      const gNew = { interval: p.interval, unit: p.unit, count: p.count, eff: p.effPct };
      if (p.first !== null) gNew.first = p.first;
      if (JSON.stringify(gNew) !== JSON.stringify(state.gen)) { state.gen = gNew; markDirty(); }
      // изотопы элюата: по убыванию максимальной активности
      const set = state.set;
      const maxA = set.map((x, i) => Math.max(...res.eluate.map((row) => row[i])));
      const cols = set.map((x, i) => i).filter((i) => set[i].lambda > 0 && maxA[i] > 0).sort((a, b) => maxA[b] - maxA[a]);
      if (!cols.length) { fail('В выбранных элементах нет изотопов с активностью: элюат пуст.'); return; }
      const shown = cols.slice(0, GEN_COLS), rest = cols.slice(GEN_COLS);
      last = { res, p, cols, set };
      const main = cols[0];
      const total = res.eluate.reduce((s2, row) => s2 + row[main], 0);
      const un = UNITS[p.unit].ru;
      const tTxt = (sec) => fmt(sec / p.sc, 4);
      const effTxt = Object.entries(p.effPct).map(([el, v]) => `${el} ${fmtInput(v)} %`).join(', ');
      let sum = `<p class="gen-sum">Отборов: <b>${p.count}</b>` + (p.count > 1 ? `, каждые ${tTxt(p.opts.interval)} ${un}` : '') +
        `, первый через ${tTxt(p.opts.first)} ${un}; извлекается ${esc(effTxt)}. ` +
        `${esc(set[main].name)} в элюате: от ${fmt(Math.min(...res.eluate.map((r) => r[main])) / f)} до ${fmt(Math.max(...res.eluate.map((r) => r[main])) / f)} ${u}` +
        (p.count > 1 ? `, всего за ${p.count} ${plural(p.count, ['отбор', 'отбора', 'отборов'])} ${fmt(total / f)} ${u}` : '') + ' (активности на момент отбора).</p>';
      // на графике: родоначальники, прямые предшественники извлекаемых изотопов и сами извлекаемые
      const keep = new Set(shown);
      for (const i of shown) for (const pa of set[i].parents) if (set[pa.j].lambda > 0) keep.add(pa.j);
      set.forEach((x, i) => { if (x.lambda > 0 && state.roots.includes(x.name)) keep.add(i); });
      const plotIdx = Array.from(keep).sort((a2, b2) => a2 - b2).slice(0, 10);
      sum += '<canvas id="genChart" class="gen-chart" aria-label="Активность на генераторе во времени"></canvas>' +
        `<p class="gen-legend">${plotIdx.map((i, k) => `<span><i class="swatch" style="${swatchStyle(seriesStyle(k))}"></i> ${esc(set[i].name)}</span>`).join('')}<span class="note">на генераторе; зубцы — отборы</span></p>`;
      const head = `<tr><th class="num">№</th><th class="num">Отбор через, ${un}</th>` + shown.map((i) => `<th class="num">${esc(set[i].name)}, ${u}</th>`).join('') +
        (rest.length ? `<th class="num">прочие (${rest.length}), ${u}</th>` : '') + (cols.length > 1 ? `<th class="num">Всего, ${u}</th>` : '') + '</tr>';
      const MAXROWS = 200;
      const body = res.times.slice(0, MAXROWS).map((t, k) => {
        const row = res.eluate[k];
        const other = rest.reduce((s2, i) => s2 + row[i], 0), all = cols.reduce((s2, i) => s2 + row[i], 0);
        return `<tr><td class="num">${k + 1}</td><td class="num">${tTxt(t)}</td>` + shown.map((i) => `<td class="num">${fmt(row[i] / f)}</td>`).join('') +
          (rest.length ? `<td class="num">${fmt(other / f)}</td>` : '') + (cols.length > 1 ? `<td class="num">${fmt(all / f)}</td>` : '') + '</tr>';
      }).join('');
      const more = res.times.length > MAXROWS ? `<p class="note">Показаны первые ${MAXROWS} отборов из ${res.times.length}; все — в Excel.</p>` : '';
      const pick = `<div class="gen-use"><label for="genPick">Элюат отбора №</label><select id="genPick">${res.times.map((t, k) => `<option value="${k}"${k === res.times.length - 1 ? ' selected' : ''}>${k + 1} (${tTxt(t)} ${un})</option>`).join('')}</select>` +
        '<span class="note">«Элюат в расчёт» откроет его как новый расчёт: выдержка, чистота, протокол.</span></div>';
      $('#genOut').innerHTML = sum + `<div class="table-wrap"><table class="grid gen-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>` + more + pick;
      plotGenerator($('#genChart'), res.series, plotIdx, null, p.sc, un, f, u, p.count > 1 ? res.times : null);
      setBtns();
      const so = $('#genOut .gen-sum'); if (so && so.scrollIntoView) so.scrollIntoView({ block: 'nearest' });
    }
    function genWorkbook() {
      const { res, p, cols, set } = last;
      const un = UNITS[p.unit].ru;
      const radio = set.map((x, i) => i).filter((i) => set[i].lambda > 0);
      const info = [
        [{ v: 'Генератор: многократные отборы', bold: true }],
        ['Исходная смесь', Object.entries(A0).filter(([, a]) => a > 0).map(([n, a]) => `${n} ${fmt(a / f)} ${u}`).join('; ')],
        ['Интервал, ' + un, p.interval], ['Первый отбор через, ' + un, p.opts.first / p.sc], ['Число отборов', p.count],
        ['Извлекается', Object.entries(p.effPct).map(([el, v]) => `${el} ${fmtInput(v)} %`).join('; ')],
        ['Активности', `${u}, на момент отбора`], [],
      ];
      const h1 = ['№', 'Отбор через, ' + un].concat(cols.map((i) => `${set[i].name}, ${u}`), ['Всего, ' + u]).map((v) => ({ v, bold: true }));
      const rows1 = res.times.map((t, k) => [k + 1, t / p.sc].concat(cols.map((i) => res.eluate[k][i] / f), [cols.reduce((s2, i) => s2 + res.eluate[k][i], 0) / f]));
      const h2 = ['№', 'Отбор через, ' + un].concat(radio.map((i) => `${set[i].name}, ${u}`)).map((v) => ({ v, bold: true }));
      const rows2 = res.times.map((t, k) => [k + 1, t / p.sc].concat(radio.map((i) => res.before[k][i] / f)));
      return window.HLXlsx.build([
        { name: 'Элюат', rows: info.concat([h1], rows1), widths: [22, 16].concat(cols.map(() => 14), [14]) },
        { name: 'Генератор перед отбором', rows: [[{ v: 'Активности на генераторе непосредственно перед каждым отбором', bold: true }], []].concat([h2], rows2), widths: [8, 16].concat(radio.map(() => 13)) },
      ]);
    }
    const pr = dialog({
      title: T, html, wide: true, focus: '#genInterval',
      buttons: [{ label: 'Рассчитать', value: 'run', primary: true }, { label: 'Excel', value: 'xlsx' }, { label: 'Элюат в расчёт', value: 'use' }, { label: 'Закрыть', value: 'cancel' }],
      validate: (v) => {
        if (v === 'run') { runGen(); return false; }
        if (v === 'xlsx') { if (last) saveBlob(genWorkbook(), baseName() + '-генератор.xlsx', XLSX_MIME).catch((e) => errorDlg('Ошибка экспорта', e)); return false; }
        if (v === 'use') return !!last;
        return true;
      },
    });
    setBtns();
    $('#genUnit').addEventListener('change', () => { $('#genUnitLbl').textContent = UNITS[$('#genUnit').value].ru; });
    if (state.gen) runGen();
    const r = await pr;
    if (r !== 'use' || !last) return;
    const k = Number(($('#genPick') || {}).value) || 0;
    await useEluate(last, Math.min(Math.max(k, 0), last.res.times.length - 1));
  }
  /** Открывает элюат отбора k как новый расчёт (активности на момент отбора). */
  async function useEluate(g, k) {
    if (!(await confirmDiscard())) return;
    const { res, cols, set } = g;
    const au = actUnit(), f = ACT_UNITS[au].f;
    const names = cols.map((i) => set[i].name);
    const order = set.map((x) => x.name).filter((n) => names.includes(n));
    const activities = {};
    for (const n of order) activities[n] = Number((res.eluate[k][set.findIndex((x) => x.name === n)] / f).toPrecision(10));
    const main = set[cols[0]].name;
    const h = readHold();
    const lim = limitFrac();
    const overrides = {};
    for (const [n, o] of Object.entries(state.overrides)) if (o && o.T != null) overrides[n] = { T: o.T };
    try {
      applyData({
        format: FILE_FORMAT, roots: order, activities, actUnit: au, hold: h.ok ? h.value : DEFAULT_HOLD, holdUnit: h.ok ? h.unit : DEFAULT_UNIT,
        purity: { target: order.includes(state.target) ? state.target : main, limitPercent: lim != null ? lim * 100 : 0.1, countProgeny: state.countProgeny },
        overrides,
      });
    } catch (e) { errorDlg('Элюат не открыт', e); return; }
    state.gen = null;
    state.name = `элюат ${k + 1}`; state.handle = null; state.path = null;
    markDirty(); updateTitle();
    calc();
  }

  // ---------- масса и удельная активность ----------
  const AMOUNT_KEY = 'halflife.amount';
  const AMOUNT_MODES = ['N', 'm', 'mol'];
  function amountModeGet() { try { const v = localStorage.getItem(AMOUNT_KEY); return AMOUNT_MODES.includes(v) && AM ? v : 'N'; } catch (e) { return 'N'; } }
  function cycleAmount() {
    const next = AMOUNT_MODES[(AMOUNT_MODES.indexOf(state.amount) + 1) % AMOUNT_MODES.length];
    state.amount = next;
    try { localStorage.setItem(AMOUNT_KEY, next); } catch (e) { /* без хранилища режим живёт до перезагрузки */ }
    renderResult();
    const b = $('#amountBtn'); if (b) b.focus();
  }
  /** Последний столбец результата: число атомов, масса или количество вещества. */
  function amountColumn(r, tLabel) {
    const mode = AM ? state.amount : 'N';
    if (mode === 'm') {
      const g = r.rows.map((x) => AM.gramsFromAtoms(x.N, x.name));
      const mu = AM.massUnit(Math.max(...g));
      return { head: `m(${tLabel}), ${mu.ru}`, cells: g.map((v) => [v / mu.f, `${full(v)} г`]) };
    }
    if (mode === 'mol') return { head: `n(${tLabel}), моль`, cells: r.rows.map((x) => [x.N / AM.NA, `${full(x.N / AM.NA)} моль`]) };
    return { head: `N(${tLabel}), атомов`, cells: r.rows.map((x) => [x.N, `${full(x.N)} атомов`]) };
  }
  const MASS_INPUT_UNITS = ['g', 'mg', 'ug', 'ng', 'pg'];
  async function cmdMass() {
    const T = 'Масса и активность';
    if (!AM) return;
    const radio = Object.keys(DB).filter((n) => DB[n][0] != null).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const inSet = state.set.filter((x) => x.lambda > 0).map((x) => x.name);
    const def = (state.massLast && DB[state.massLast.name]) ? state.massLast : { name: state.target || inSet[0] || 'Th-229', from: 'G', A: '', AU: actUnit(), G: '1', GU: 'mg' };
    const mu = (k) => AM.MASS_UNITS.find((u) => u.key === k) || AM.MASS_UNITS[1];
    const html = '<p>Пересчёт активности чистого нуклида в массу и обратно: A = λ·N, N = m·N<sub>A</sub>/M. ' +
      'Атомные массы — AME 2020.</p>' +
      `<div class="mass-grid"><label for="massName">Изотоп</label><input id="massName" type="text" list="massNames" autocomplete="off" spellcheck="false" value="${esc(def.name)}">` +
      `<datalist id="massNames">${inSet.concat(radio.filter((n) => !inSet.includes(n))).map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>` +
      `<label for="massA">Активность</label><span class="inp-unit"><input id="massA" type="text" inputmode="decimal" autocomplete="off" value="${esc(def.A)}">` +
      `<select id="massAU" aria-label="Единица активности">${Object.entries(ACT_UNITS).map(([k, v]) => `<option value="${k}"${k === def.AU ? ' selected' : ''}>${v.ru}</option>`).join('')}</select></span>` +
      `<label for="massG">Масса</label><span class="inp-unit"><input id="massG" type="text" inputmode="decimal" autocomplete="off" value="${esc(def.G)}">` +
      `<select id="massGU" aria-label="Единица массы">${MASS_INPUT_UNITS.map((k) => `<option value="${k}"${k === def.GU ? ' selected' : ''}>${mu(k).ru}</option>`).join('')}</select></span>` +
      '</div><div id="massOut" class="mass-out" role="status"></div><p class="msg error" id="massErr" role="alert" hidden></p>';
    let from = def.from === 'G' ? 'G' : 'A';
    let cur = null; // {name, A (Бк)}
    function update() {
      const err = $('#massErr'); err.hidden = true;
      const out = $('#massOut');
      cur = null;
      const name = C.normalizeName($('#massName').value);
      if (!name) { out.innerHTML = ''; err.textContent = 'Такого изотопа нет в базе. Пример: Th-229, ra226, 225Ac.'; err.hidden = !$('#massName').value.trim(); return; }
      const T12 = DB[name][0];
      if (T12 == null) { out.innerHTML = `<p>${esc(name)} стабилен: у него нет активности.</p>`; return; }
      const lambda = Math.LN2 / ((state.overrides[name] && state.overrides[name].T) || T12);
      const mm = AM.molarMass(name);
      const sa = AM.specificActivity(name, lambda);
      const aF = ACT_UNITS[$('#massAU').value].f, gF = mu($('#massGU').value).f;
      let A = null, g = null;
      if (from === 'A') {
        const v = parseNum($('#massA').value);
        if (v !== null && !isNaN(v) && v >= 0) { A = v * aF; g = A / sa; $('#massG').value = fmtInput(Number((g / gF).toPrecision(6))); }
        else if (v !== null) { err.textContent = 'Активность — неотрицательное число.'; err.hidden = false; }
      } else {
        const v = parseNum($('#massG').value);
        if (v !== null && !isNaN(v) && v >= 0) { g = v * gF; A = g * sa; $('#massA').value = fmtInput(Number((A / aF).toPrecision(6))); }
        else if (v !== null) { err.textContent = 'Масса — неотрицательное число.'; err.hidden = false; }
      }
      let h = `<p><b>${esc(name)}</b>: T½ = ${esc(C.fmtHalfLife(Math.LN2 / lambda))}${state.overrides[name] ? ' (ваше значение)' : ''}; ` +
        `M = ${fmt(mm.M, 9)} г/моль${mm.exact ? '' : ' (массовое число)'}.<br>Удельная активность: <b>${fmt(sa)} Бк/г</b> = ${fmt(sa / 3.7e10)} Ки/г.</p>`;
      if (A != null) {
        const N = g * AM.NA / mm.M;
        h += `<p>${fmt(A)} Бк = ${fmt(A / 3.7e10)} Ки; масса ${fmt(g)} г; ${fmt(N)} атомов; ${fmt(N / AM.NA)} моль.</p>`;
        cur = { name, A };
      }
      out.innerHTML = h;
      state.massLast = { name, from, A: $('#massA').value, AU: $('#massAU').value, G: $('#massG').value, GU: $('#massGU').value };
    }
    const pr = dialog({
      title: T, html, focus: from === 'A' ? '#massA' : '#massG',
      buttons: [{ label: 'Задать A₀ в таблице', value: 'use', primary: true }, { label: 'Закрыть', value: 'cancel' }],
      validate: (v) => {
        if (v !== 'use') return true;
        update();
        if (!cur) { const e = $('#massErr'); e.textContent = 'Укажите изотоп и активность или массу.'; e.hidden = false; return false; }
        return true;
      },
    });
    $('#massA').addEventListener('input', () => { from = 'A'; update(); });
    $('#massG').addEventListener('input', () => { from = 'G'; update(); });
    // смена единицы пересчитывает число в этом поле из другого поля, физическая величина не меняется
    $('#massAU').addEventListener('change', () => { from = 'G'; update(); });
    $('#massGU').addEventListener('change', () => { from = 'A'; update(); });
    $('#massName').addEventListener('input', update);
    update();
    const r = await pr;
    if (r !== 'use' || !cur) return;
    putActivity(cur.name, cur.A);
  }
  /** Записывает A₀ (Бк) изотопу в таблице; если его нет в наборе, добавляет как родоначальника. */
  function putActivity(name, Abq) {
    if (state.locked) setLocked(false);
    if (!state.set.some((x) => x.name === name)) {
      addRoots(name);
      if (!state.set.some((x) => x.name === name)) return;
    }
    state.activities[name] = fmtInput(Number((Abq / ACT_UNITS[actUnit()].f).toPrecision(10)));
    changed();
    renderInput();
    const inp = $$('#inputTable input[data-name]').find((i) => i.dataset.name === name);
    if (inp) { inp.focus(); if (inp.select) inp.select(); }
  }

  // ---------- схема распада ----------
  /** Данные для картинки: набор, цепочки и подписи активностей (результат на основной срок или A₀ из таблицы). */
  function schemeData() {
    const r = state.result;
    if (r && r.set && r.rows) {
      const times = r.times;
      const mainIdx = times ? Math.max(0, times.findIndex((t) => t.main)) : 0;
      const f = r.actF || 1, u = (ACT_UNITS[r.actUnit] || ACT_UNITS[DEFAULT_ACT]).ru;
      const values = r.rows.map((x, i) => {
        if (x.stable) return x.N > 0 ? 'N = ' + fmt(times ? times[mainIdx].N[i] : x.N, 3) : '';
        const A = times ? times[mainIdx].A[i] : x.A;
        return A > 0 ? 'A = ' + fmt(A / f, 3) + ' ' + u : '';
      });
      return { set: r.set, roots: r.roots, values, note: `Активность через ${r.holdText}${times && times.length > 1 ? ' (основной срок)' : ''}.` };
    }
    const u = ACT_UNITS[actUnit()].ru;
    let any = false;
    const values = state.set.map((x) => {
      if (!(x.lambda > 0)) return '';
      const v = parseNum(state.activities[x.name]);
      if (v === null || isNaN(v) || !(v > 0)) return '';
      any = true; return 'A₀ = ' + fmt(v, 3) + ' ' + u;
    });
    return { set: state.set, roots: state.roots, values, note: any ? 'Начальная активность из таблицы; после расчёта здесь будет активность через выдержку.' : '' };
  }
  function schemeSvg(d, standalone) {
    return SCH.svg(d.set, d.roots, { fmtT: C.fmtHalfLife, values: d.values, target: state.target || '', standalone }).svg;
  }
  /** PNG из SVG (для вставки в Word и презентации), масштаб 2×. */
  function svgToPng(svgText, w, h) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
      img.onload = () => {
        try {
          const k = 2, cv = document.createElement('canvas');
          cv.width = Math.ceil(w * k); cv.height = Math.ceil(h * k);
          const g = cv.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          cv.toBlob((b) => (b ? resolve(b) : reject(new Error('не удалось получить PNG'))), 'image/png');
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось нарисовать схему')); };
      img.src = url;
    });
  }
  /** PNG схемы для протокола Word: {bytes, width, height} (размер в CSS-пикселях). */
  async function schemePng() {
    if (!SCH || !state.roots.length || typeof document === 'undefined') return null;
    const d = schemeData();
    const pic = SCH.svg(d.set, d.roots, { fmtT: C.fmtHalfLife, values: d.values, target: state.target || '', standalone: true });
    const blob = await svgToPng(pic.svg, pic.width, pic.height);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: pic.width, height: pic.height };
  }
  async function cmdScheme() {
    if (!SCH) return;
    if (!state.roots.length) { await dialog({ title: 'Схема распада', html: '<p>Сначала добавьте изотоп: схема рисуется для выбранных цепочек.</p>' }); return; }
    const d = schemeData();
    const pic = SCH.svg(d.set, d.roots, { fmtT: C.fmtHalfLife, values: d.values, target: state.target || '' });
    const n = d.set.length, nb = pic.layout.edges.filter((e) => e.br < 0.9995).length;
    const html = `<p class="scheme-note">${esc(n + ' ' + plural(n, ['изотоп', 'изотопа', 'изотопов']))}` +
      (nb ? `, ${esc(nb + ' ' + plural(nb, ['ветвь', 'ветви', 'ветвей']))} с долей меньше 100 %` : '') + '. ' +
      `Подпись у стрелки — тип распада и доля ветвления. ${esc(d.note)}</p>` +
      `<div class="scheme-wrap" tabindex="0" aria-label="Схема распада, прокручивается">${pic.svg}</div>`;
    const base = baseName() + '-схема';
    await dialog({
      title: 'Схема распада', html, wide: true,
      buttons: [{ label: 'Закрыть', value: 'ok', primary: true }, { label: 'Скачать SVG', value: 'svg' }, { label: 'Скачать PNG', value: 'png' }],
      validate: (v) => {
        if (v === 'svg') {
          saveBlob(new Blob([schemeSvg(d, true)], { type: 'image/svg+xml' }), base + '.svg', 'image/svg+xml').catch((e) => errorDlg('Ошибка сохранения', e));
          return false;
        }
        if (v === 'png') {
          svgToPng(schemeSvg(d, true), pic.width, pic.height)
            .then((b) => saveBlob(b, base + '.png', 'image/png'))
            .catch((e) => errorDlg('Ошибка сохранения', e));
          return false;
        }
        return true;
      },
    });
  }

  // ---------- обновление данных IAEA ----------
  const IAEA_URL = 'https://www-nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all';
  const IAEA_KEY = 'halflife.iaeaUpdate';
  const DB_DATE = '27.11.2026';
  const ORIG = {}; // записи встроенной базы, заменённые обновлением (для отката)
  function storeGet(k) { try { return window.localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } }
  function storeSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function applyIaeaToDb(upd) {
    for (const n of Object.keys(ORIG)) { DB[n][0] = ORIG[n][0]; DB[n][1] = ORIG[n][1]; delete ORIG[n]; }
    if (!upd || !upd.changes) return;
    for (const [n, T] of Object.entries(upd.changes)) {
      if (!DB[n] || DB[n][0] == null || !(T > 0) || !isFinite(T)) continue;
      ORIG[n] = [DB[n][0], DB[n][1]];
      DB[n][0] = T; DB[n][1] = 'I';
    }
  }
  function loadIaeaUpdate() {
    const raw = storeGet(IAEA_KEY); if (!raw) return;
    try { const u = JSON.parse(raw); if (u && u.changes && typeof u.changes === 'object') { state.iaea = u; applyIaeaToDb(u); } } catch (e) { /* повреждённая запись — работаем на встроенной базе */ }
  }
  function dataSourceText() {
    let s = 'IAEA LiveChart of Nuclides (ENSDF), для отсутствующих — ICRP-107; 1 год = 365,2422 сут';
    if (state.iaea) s += `; обновлено из IAEA ${new Date(state.iaea.date).toLocaleDateString('ru-RU')} (изменено ${Object.keys(state.iaea.changes).length})`;
    return s;
  }
  const fetchWait = {}; let fetchSeq = 0;
  window.__hlFetchDone = (id, ok, text) => {
    const w = fetchWait[id]; if (!w) return;
    delete fetchWait[id];
    if (ok) w.resolve(text); else w.reject(new Error(text || 'нет связи'));
  };
  function fetchText(url) {
    if (host && host.fetchText) return host.fetchText(url);
    if (android && android.fetchText) {
      return new Promise((resolve, reject) => {
        const id = 'f' + (++fetchSeq);
        fetchWait[id] = { resolve, reject };
        try { android.fetchText(url, id); } catch (e) { delete fetchWait[id]; reject(e); }
      });
    }
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 30000) : 0;
    return fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .finally(() => clearTimeout(timer));
  }
  function pickTextFile() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.txt,text/csv,text/plain'; inp.hidden = true; inp.id = 'iaeaFile';
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0]; inp.remove();
        if (!f) { resolve(null); return; }
        f.text().then(resolve, () => resolve(null));
      });
      inp.addEventListener('cancel', () => { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function afterDbChange() { rebuildSet(); fillNuclideList(); changed(); renderInput(); }
  async function cmdUpdateData() {
    const T = 'Обновить данные IAEA';
    if (!TL) return;
    const cur = state.iaea
      ? `<p>Сейчас действует обновление от ${esc(new Date(state.iaea.date).toLocaleDateString('ru-RU'))}: изменены T½ у ${Object.keys(state.iaea.changes).length} изотопов.</p>`
      : `<p>Сейчас используется встроенная база (выгрузка IAEA от ${DB_DATE}).</p>`;
    const html = cur + '<p>Обновление берёт периоды полураспада основных состояний из IAEA LiveChart of Nuclides и заменяет ими значения базы. ' +
      'Схемы распада и ветвления не меняются, ваши правки T½ сохраняются. Обновление хранится на этом устройстве.</p>';
    const buttons = [{ label: 'Скачать из IAEA', value: 'fetch', primary: true }, { label: 'Выбрать файл…', value: 'file' }];
    if (state.iaea) buttons.push({ label: 'Вернуть встроенную базу', value: 'reset' });
    buttons.push({ label: 'Отмена', value: 'cancel' });
    const v = await dialog({ title: T, html, buttons });
    if (v === 'reset') {
      applyIaeaToDb(null); state.iaea = null; storeSet(IAEA_KEY, null); afterDbChange();
      dialog({ title: T, html: '<p>Возвращена встроенная база ядерных данных.</p>' });
      return;
    }
    let text = null;
    if (v === 'fetch') {
      try { text = await fetchText(IAEA_URL); } catch (e) {
        const r2 = await dialog({
          title: T,
          html: `<p>Скачать напрямую не получилось${e && e.message ? ` (${esc(e.message)})` : ''}. Браузер обычно не даёт странице обращаться к сайту IAEA; ` +
            'в программе для компьютера и в приложении для телефона загрузка идёт напрямую.</p>' +
            `<p>Откройте ссылку, сохраните файл и выберите его здесь:</p><p><a class="iaea-link" href="${esc(IAEA_URL)}" target="_blank" rel="noopener">${esc(IAEA_URL)}</a></p>`,
          buttons: [{ label: 'Выбрать файл…', value: 'file', primary: true }, { label: 'Отмена', value: 'cancel' }],
        });
        if (r2 !== 'file') return;
        text = await pickTextFile();
      }
    } else if (v === 'file') text = await pickTextFile();
    else return;
    if (text == null) return;
    let parsed, cmp;
    applyIaeaToDb(null); // сравниваем со встроенной базой
    try { parsed = TL.parseIaeaCsv(text); cmp = TL.applyIaea(DB, parsed); } catch (e) { applyIaeaToDb(state.iaea); errorDlg(T, e); return; }
    applyIaeaToDb(state.iaea);
    const nUnc = Object.keys(cmp.unc).length;
    const rows = cmp.changes.slice(0, 300).map((c) => `<tr><td class="iso">${esc(c.name)}</td><td>${esc(C.fmtHalfLife(c.old))}</td><td>${esc(C.fmtHalfLife(c.T))}</td></tr>`).join('');
    const html2 = `<p>В выгрузке ${parsed.items.length} ${plural(parsed.items.length, ['радиоактивный изотоп', 'радиоактивных изотопа', 'радиоактивных изотопов'])}. Совпадают со встроенной базой: ${cmp.same}. Отличаются: <b>${cmp.changes.length}</b>` +
      (nUnc ? `; погрешность T½ указана у ${nUnc} ${plural(nUnc, ['изотопа', 'изотопов', 'изотопов'])} из базы` : '') + '.</p>' +
      (cmp.changes.length ? `<div class="change-list table-wrap"><table class="grid"><thead><tr><th>Изотоп</th><th>Было</th><th>Стало</th></tr></thead><tbody>${rows}</tbody></table></div>` : '');
    const r3 = await dialog({ title: T, html: html2, buttons: [{ label: 'Применить', value: 'ok', primary: true }, { label: 'Отмена', value: 'cancel' }] });
    if (r3 !== 'ok') return;
    const upd = { date: new Date().toISOString(), changes: {}, unc: cmp.unc };
    for (const c of cmp.changes) upd.changes[c.name] = c.T;
    state.iaea = upd;
    applyIaeaToDb(upd);
    const saved = storeSet(IAEA_KEY, JSON.stringify(upd));
    afterDbChange();
    dialog({ title: T, html: `<p>Данные обновлены: изменены T½ у ${cmp.changes.length} изотопов.` +
      (saved ? '' : ' Сохранить обновление на устройстве не удалось — после перезапуска будет встроенная база.') + ' Нажмите «Рассчитать», чтобы пересчитать.</p>' });
  }

  // ---------- протокол расчёта ----------
  function protocolData() {
    const r = state.result;
    const f = r.actF || 1, u = (ACT_UNITS[r.actUnit] || ACT_UNITS[DEFAULT_ACT]).ru;
    const pl = purityList(r);
    const times = r.times;
    const mainIdx = times ? Math.max(0, times.findIndex((t) => t.main)) : 0;
    const unc = r.unc, pm = pl ? pl[mainIdx] : null, lim = limitFrac();
    const info = [['Файл', state.name], ['Родоначальники', r.roots.join(', ')],
      ['Выдержка', r.holdText + (r.dates ? ` (калибровка ${fmtDate(r.dates.from)} → использование ${fmtDate(r.dates.to)})` : '')]];
    if (times) info.push(['Сроки выдержки', times.map((t) => t.text).join('; ')]);
    info.push(['Единица активности', u], ['Ядерные данные', dataSourceText()]);
    const ov = Object.keys(state.overrides).filter((n) => r.set.some((x) => x.name === n));
    if (ov.length) info.push(['Правки T½ пользователя', ov.map((n) => `${n}: ${C.fmtHalfLife(state.overrides[n].T)}`).join('; ')]);
    if (unc) info.push(['Погрешность', `${uncText(r)} (1σ); Монте-Карло, ${unc.n} повторов, интервал 95 %`]);
    if (pm) info.push(['Целевой изотоп', state.target + (state.countProgeny ? '' : ' (его дочерние продукты примесями не считаются)')]);
    if (pm && lim != null) info.push(['Предел примеси', fmtInput(Number((lim * 100).toPrecision(6))) + ' %']);
    info.push(['Модель', 'Уравнения Бейтмана, аналитическое решение; A = λ·N, λ = ln2/T½']);
    const inputs = [['Изотоп', 'T½', 'Источник T½', `A₀, ${u}`]];
    for (const x of r.rows) if (!x.stable && x.A0 > 0) inputs.push([x.name, C.fmtHalfLife(x.T), x.src === 'user' ? 'пользователь' : x.src, fmt(x.A0 / f, 6)]);
    const head = ['Изотоп', `A₀, ${u}`];
    if (times) times.forEach((t) => head.push(`A(${t.text}), ${u}`)); else head.push(`A(${r.holdText}), ${u}`);
    if (unc) head.push('±, %');
    if (pm) head.push('Примесь, %');
    head.push(`N(${r.holdText}), атомов`);
    const rows = [head], over = [], bold = [];
    for (const g of groupsOf(r.rows, r.roots)) {
      bold.push(rows.length); rows.push(['Цепочка ' + g.root]);
      for (const x of g.items) {
        const i = r.rows.indexOf(x);
        const row = [x.name, x.stable ? '—' : fmt(x.A0 / f, 5)];
        if (times) times.forEach((t) => row.push(x.stable ? '—' : fmt(t.A[i] / f, 5))); else row.push(x.stable ? '—' : fmt(x.A / f, 5));
        if (unc) row.push(x.stable ? '—' : fmt(unc.A[mainIdx][i].rel * 100, 2));
        if (pm) {
          const isT = x.name === state.target;
          row.push(isT ? 'цель' : x.stable ? '—' : fmt(pm.share[i] * 100, 3));
          if (!isT && lim != null && pm.share[i] > lim) over.push(rows.length);
        }
        row.push(fmt(x.N, 5));
        rows.push(row);
      }
      const sum = ['Сумма', fmt(sumA(g.items, 'A0') / f, 5)];
      if (times) times.forEach((t) => sum.push(fmt(g.items.reduce((s, x) => s + (x.stable ? 0 : t.A[r.rows.indexOf(x)]), 0) / f, 5))); else sum.push(fmt(sumA(g.items, 'A') / f, 5));
      bold.push(rows.length); rows.push(sum);
    }
    let purityLine = '';
    if (pm) {
      purityLine = `Радионуклидная чистота ${state.target}: ` + pl.map((p) => `через ${p.time.text} — ${fmtPct(p.purity)} %`).join('; ') + '.';
      const up = unc && unc.purity && unc.purity[mainIdx];
      if (up) purityLine += ` Интервал 95 % через ${r.holdText}: ${fmtPct(up.lo)} … ${fmtPct(up.hi)} %.`;
      if (lim != null) {
        const names = pm.share.map((s, i) => (s > lim ? r.rows[i].name : null)).filter(Boolean);
        purityLine += names.length ? ` Выше предела: ${names.join(', ')}.` : ' Все примеси не выше предела.';
      }
    }
    let formulas = '';
    if (F && F.text) { try { formulas = F.text(formulaModel()); } catch (e) { formulas = ''; } }
    return { title: 'Протокол расчёта радиоактивного распада', when: new Date().toLocaleString('ru-RU'), info, inputs, rows, bold, over, purityLine, formulas, wide: head.length > 6 };
  }
  async function cmdProtocol() {
    if (!state.result) { dialog({ title: 'Протокол расчёта', html: '<p>Сначала выполните расчёт.</p>' }); return; }
    if (!TL) return;
    const d = protocolData();
    const blocks = [{ h1: d.title }, { small: `${APP_TITLE} ${APP_VERSION} · сформирован ${d.when}` },
      { h2: 'Исходные данные' }, { table: d.info, widths: [1, 3] },
      { p: 'Начальные активности (остальные изотопы — 0):', bold: true },
      { table: d.inputs, header: true, alignRight: [3], widths: [1.2, 1.2, 1.2, 1.4] },
      { h2: 'Результат' },
      { table: d.rows.map((row, i) => (d.over.includes(i) ? row.map((v) => ({ v, fill: 'FBE3E1' })) : row)), header: true, boldRows: d.bold,
        alignRight: d.rows[0].map((_, i) => i).filter((i) => i > 0) }];
    if (d.purityLine) blocks.push({ p: d.purityLine, bold: true });
    const pic = await schemePng().catch(() => null); // картинка необязательна: без canvas протокол выйдет без неё
    if (pic) blocks.push({ h2: 'Схема распада' }, { image: pic.bytes, width: pic.width, height: pic.height, alt: 'Схема распада ' + state.result.roots.join(', ') });
    blocks.push({ h2: 'Модель и формулы' });
    if (d.formulas) blocks.push({ mono: d.formulas });
    blocks.push({ p: '' }, { p: 'Расчёт выполнил: ______________________    Дата: ____________' }, { p: 'Проверил: ______________________    Дата: ____________' });
    try { await saveBlob(TL.docx(blocks, { landscape: d.wide, title: d.title }), baseName() + '-протокол.docx', DOCX_MIME); }
    catch (e) { errorDlg('Протокол расчёта', e); }
  }
  function clearPrint() { const a = $('#printArea'); if (a && a.firstChild) a.innerHTML = ''; document.body.classList.remove('has-print'); }
  function cmdPrint() {
    if (!state.result) { dialog({ title: 'Печать протокола', html: '<p>Сначала выполните расчёт.</p>' }); return; }
    if (window.HLNoPrint) {
      dialog({ title: 'Печать протокола', html: '<p>Здесь печать недоступна. Сохраните протокол в Word — его можно напечатать или сохранить в PDF из Word.</p>',
        buttons: [{ label: 'Протокол в Word', value: 'docx', primary: true }, { label: 'Закрыть', value: 'cancel' }] }).then((v) => { if (v === 'docx') cmdProtocol(); });
      return;
    }
    const d = protocolData();
    const tbl = (rows, o) => '<table>' + rows.map((row, i) => {
      const th = o && o.header && i === 0;
      const cls = [(o && o.bold && o.bold.includes(i)) ? 'b' : '', (o && o.over && o.over.includes(i)) ? 'over' : ''].filter(Boolean).join(' ');
      return `<tr${cls ? ` class="${cls}"` : ''}>` + row.map((v, c) => (th ? `<th>${esc(v)}</th>` : `<td${o && o.num && c >= o.num ? ' class="n"' : ''}${row.length === 1 ? ` colspan="${rows[0].length}"` : ''}>${esc(v)}</td>`)).join('') + '</tr>';
    }).join('') + '</table>';
    const html = `<h1>${esc(d.title)}</h1><p class="meta">${esc(APP_TITLE)} ${APP_VERSION} · сформирован ${esc(d.when)}</p>` +
      `<h2>Исходные данные</h2>${tbl(d.info)}<p><b>Начальные активности</b> (остальные изотопы — 0):</p>${tbl(d.inputs, { header: true, num: 3 })}` +
      `<h2>Результат</h2>${tbl(d.rows, { header: true, bold: d.bold, over: d.over, num: 1 })}` +
      (d.purityLine ? `<p><b>${esc(d.purityLine)}</b></p>` : '') +
      (SCH ? `<h2>Схема распада</h2><div class="print-scheme">${schemeSvg(schemeData(), true).replace('class="scheme"', 'class="scheme-file"')}</div>` : '') +
      (d.formulas ? `<h2>Модель и формулы</h2><pre>${esc(d.formulas)}</pre>` : '') +
      '<div class="sign"><div>Расчёт выполнил: ______________________ Дата: ____________</div><div>Проверил: ______________________ Дата: ____________</div></div>';
    $('#printArea').innerHTML = html;
    document.body.classList.add('has-print');
    if (android && android.print) { try { android.print(d.title); return; } catch (e) { /* дальше — обычная печать */ } }
    window.print();
  }

  // ---------- примеры ----------
  const FALLBACK_PRESETS = [{
    id: 'th229-th228', title: 'Th-229 + Th-228', description: 'Цепочки Th-229 и Th-228, выдержка 7 сут',
    roots: ['Th-229', 'Th-228'], activities: { 'Th-229': 1e6, 'Th-228': 1e3 }, hold: 7, holdUnit: 'd',
  }];
  const presets = () => (Array.isArray(window.HLPresets) && window.HLPresets.length ? window.HLPresets : FALLBACK_PRESETS);
  function fillPresetMenu() {
    const box = $('#presetMenu'); if (!box) return;
    box.innerHTML = presets().map((p) =>
      `<button type="button" data-preset="${esc(p.id)}" title="${esc(p.description || '')}">${esc(p.title)}</button>`).join('');
  }
  async function loadPreset(id) {
    const p = presets().find((x) => x.id === id); if (!p) return;
    if (!(await confirmDiscard())) return;
    try {
      applyData({ format: FILE_FORMAT, roots: p.roots, activities: p.activities || {}, hold: p.hold, holdUnit: p.holdUnit, overrides: p.overrides || {} });
    } catch (e) { errorDlg('Пример не загружен', e); return; }
    state.name = p.title; state.handle = null; state.path = null;
    setClean();
  }

  // ---------- меню и команды ----------
  async function closeRequest() { if (await confirmDiscard()) { state.dirty = false; if (host && host.closeNow) host.closeNow(); } }
  const COMMANDS = {
    new: cmdNew, open: cmdOpen, save: () => cmdSave(false), saveAs: () => cmdSave(true), export: cmdExport,
    data: cmdData, resetOverrides: cmdResetOverrides, guide: cmdGuide, about: cmdAbout, recent: cmdRecent, ptable: cmdPtable,
    calc, edit: unlock, preset: loadPreset, closeRequest,
    openPath: (f) => { if (f) confirmDiscard().then((ok) => { if (ok) loadText(f.text, f.name, { path: f.path }); }); },
    tab: selectTab,
    protocol: cmdProtocol, print: cmdPrint, findHold: cmdFindHold, uncertainty: cmdUncertainty, updateData: cmdUpdateData,
    generator: cmdGenerator,
    mass: cmdMass,
    scheme: cmdScheme,
    backCalc: cmdBackCalc,
  };
  function run(cmd, arg) {
    const f = COMMANDS[cmd];
    if (!f) return undefined;
    closeMenus();
    return f(arg);
  }

  function closeMenus() { $$('.menu.open').forEach((m) => { m.classList.remove('open'); const b = $('.menu-btn', m); if (b) b.setAttribute('aria-expanded', 'false'); }); }
  function openMenu(m) {
    closeMenus(); m.classList.add('open');
    const b = $('.menu-btn', m); if (b) b.setAttribute('aria-expanded', 'true');
  }
  function bindMenus() {
    $$('.menu').forEach((m) => {
      const btn = $('.menu-btn', m); if (!btn) return;
      btn.addEventListener('click', (e) => { e.stopPropagation(); if (m.classList.contains('open')) closeMenus(); else openMenu(m); });
      btn.addEventListener('mouseenter', () => { if ($('.menu.open') && !m.classList.contains('open')) openMenu(m); });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(m); const first = $('.menu-list button:not(:disabled)', m); if (first) first.focus(); }
      });
      const list = $('.menu-list', m);
      if (list) list.addEventListener('keydown', (e) => {
        const items = $$('button:not(:disabled)', list);
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); const n = items.length; if (!n) return;
          items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus();
        } else if (e.key === 'Escape') { closeMenus(); btn.focus(); }
      });
    });
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[data-cmd], [data-preset]');
      if (item && !item.disabled && !item.closest('#dlg')) {
        closeMenus();
        if (item.dataset.preset) loadPreset(item.dataset.preset); else run(item.dataset.cmd);
        return;
      }
      if (!e.target.closest('.menu')) closeMenus();
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenus();
      if (host) return; // в Electron горячие клавиши обрабатывает нативное меню
      if ($('#dlg') && $('#dlg').open) return;
      if (e.key === 'F1') { e.preventDefault(); run('guide'); return; }
      if (e.key === 'F9') { e.preventDefault(); run(state.locked ? 'edit' : 'calc'); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // e.code не зависит от раскладки (работает и в русской)
      const map = { KeyN: 'new', KeyO: 'open', KeyS: e.shiftKey ? 'saveAs' : 'save', KeyE: 'export', KeyP: 'print' };
      const cmd = map[e.code];
      if (cmd) { e.preventDefault(); run(cmd); }
    });
  }

  function bindUI() {
    const rootInput = $('#rootInput');
    if (rootInput) rootInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRoots(rootInput.value); } });
    if (rootInput) rootInput.addEventListener('input', () => setRootError(''));
    const addBtn = $('#addRootBtn'); if (addBtn) addBtn.addEventListener('click', () => addRoots(rootInput.value));
    const ptBtn = $('#ptableBtn');
    if (ptBtn) { if (!EL) ptBtn.hidden = true; else ptBtn.addEventListener('click', () => { const v = rootInput.value.trim(); cmdPtable(v && EL.parse(v) && !EL.parse(v).a ? v : ''); }); }
    const chips = $('#rootChips');
    if (chips) chips.addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b && !b.disabled) removeRoot(b.dataset.remove); });

    const table = $('#inputTable');
    table.addEventListener('input', (e) => {
      const inp = e.target.closest('input[data-name]'); if (!inp) return;
      state.activities[inp.dataset.name] = inp.value;
      const v = parseNum(inp.value);
      const ok = v === null || (!isNaN(v) && v >= 0);
      inp.classList.toggle('invalid', !ok);
      if (ok) inp.removeAttribute('aria-invalid'); else inp.setAttribute('aria-invalid', 'true');
      changed();
    });
    table.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-name]')) { e.preventDefault(); calc(); return; }
      const td = e.target.closest('td.t12[data-edit]');
      if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editHalfLife(td.dataset.edit); }
    });
    table.addEventListener('focusin', (e) => { if (e.target.matches('input[data-name]')) setTimeout(() => e.target.select(), 0); });
    table.addEventListener('click', (e) => { const td = e.target.closest('td.t12[data-edit]'); if (td && !state.locked) editHalfLife(td.dataset.edit); });

    const hold = $('#hold');
    hold.addEventListener('input', () => { clearDates(); readHold(); changed(); });
    hold.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calc(); } });
    // смена единицы при выдержке по датам пересчитывает число, а не меняет срок
    $('#holdUnit').addEventListener('change', () => { if (state.dates) holdFromDates($('#holdUnit').value); changed(); });
    const extra = $('#holdExtra');
    if (extra) {
      extra.addEventListener('input', () => { readExtra(); changed(); });
      extra.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); calc(); } });
    }
    const dbtn = $('#holdDatesBtn'); if (dbtn) dbtn.addEventListener('click', editDates);
    const au = $('#actUnit'); if (au) au.addEventListener('change', () => { renderActUnit(); changed(); });
    const fh = $('#findHoldBtn'); if (fh) fh.addEventListener('click', cmdFindHold);
    // чистота: меняет только вид результата, ввод не разблокирует
    const ts = $('#targetSel'); if (ts) ts.addEventListener('change', () => { state.target = ts.value; markDirty(); clearPrint(); renderResult(); });
    const li = $('#limitInp'); if (li) li.addEventListener('input', () => { markDirty(); clearPrint(); renderResult(); });
    const pc = $('#progenyChk'); if (pc) pc.addEventListener('change', () => { state.countProgeny = pc.checked; markDirty(); clearPrint(); renderResult(); });
    $('#calcBtn').addEventListener('click', calc);
    $('#editBtn').addEventListener('click', unlock);
    const eb = $('#exportBtn'); if (eb && !eb.dataset.cmd) eb.addEventListener('click', cmdExport);

    $$('.tabs .tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
    $$('.fmt-tabs .fmt').forEach((b) => b.addEventListener('click', () => { state.fmt = b.dataset.fmt; renderFormulas(); }));
    $$('.chart-scale .fmt').forEach((b) => b.addEventListener('click', () => setChartScale(b.dataset.scale)));
    const cpng = $('#chartPngBtn'); if (cpng) cpng.addEventListener('click', downloadChartPng);
    const cb = $('#copyFormulaBtn'); if (cb) cb.addEventListener('click', copyFormulas);
    const db = $('#downloadFormulaBtn'); if (db) db.addEventListener('click', downloadFormulas);

    const cv = $('#chart');
    if (cv) {
      cv.addEventListener('pointermove', chartPointer);
      cv.addEventListener('pointerdown', chartPointer);
      cv.addEventListener('pointerleave', () => { if (state.hover != null) { state.hover = null; drawChart(); } });
    }
    let rz = 0;
    window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(drawChart); });
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const redraw = () => { buildLegend(); drawChart(); };
      if (mq.addEventListener) mq.addEventListener('change', redraw); else if (mq.addListener) mq.addListener(redraw);
    }
    new MutationObserver(() => { buildLegend(); drawChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    $('#fileInput').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) openFileObject(f); });

    // перетаскивание файла .hlc в окно
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', async (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      if (!/\.(hlc|json)$/i.test(f.name)) { dialog({ title: 'Открытие файла', html: '<p>Перетащите файл расчёта с расширением .hlc.</p>' }); return; }
      if (await confirmDiscard()) openFileObject(f);
    });

    window.addEventListener('beforeunload', (e) => { flushDraft(); if (state.dirty && !host) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', flushDraft);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });
  }

  // ---------- связь с оболочкой (Electron) ----------
  let lastHostState = '';
  function notifyHost() {
    if (!host || !host.state) return;
    const s = { dirty: state.dirty, hasResult: !!state.result, locked: state.locked, title: document.title, name: state.name };
    const key = JSON.stringify(s);
    if (key !== lastHostState) { lastHostState = key; host.state(s); }
  }

  // ---------- запуск ----------
  function init() {
    if (host) document.body.classList.add('electron');
    if (android) document.body.classList.add('android');
    if (window.HLNoPrint) { const pi = $('#printItem'); if (pi) pi.hidden = true; }
    loadIaeaUpdate();
    state.amount = amountModeGet();
    if (storeGet(CHART_SCALE_KEY) === 'lin') state.chartScale = 'lin';
    fillNuclideList();
    fillPresetMenu();
    bindMenus();
    bindKeys();
    bindUI();
    const draft = storeGet(DRAFT_KEY); // читаем до resetDoc: он снимает черновик
    resetDoc();
    restoreDraft(draft);
    selectTab('result');
    if (host) {
      if (host.onCommand) host.onCommand((cmd, arg) => run(cmd, arg));
      if (host.setPresets) host.setPresets(presets().map((p) => ({ id: p.id, title: p.title })));
      if (host.ready) host.ready();
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !host) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  window.App = {
    version: APP_VERSION,
    run, isDirty: () => state.dirty, loadText, saveBlob, parseNum,
    /** Для тестов и отладки: снимок состояния. */
    snapshot: () => ({ roots: state.roots.slice(), name: state.name, dirty: state.dirty, locked: state.locked,
      set: state.set.map((x) => x.name), result: state.result && state.result.rows.map((x) => ({ name: x.name, A0: x.A0, A: x.A, N: x.N })) }),
    serialize,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
