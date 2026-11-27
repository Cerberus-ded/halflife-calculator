/* Таблица Менделеева: выбор изотопа щелчком (window.HLPtable).
 *
 * Два режима:
 *  - 'multi' — шаг 1 и «Данные → Таблица Менделеева». Изотоп добавляется в расчёт, повторное нажатие по
 *    добавленному убирает его. Окно — общий #dlg (app.js: cmdPtable → html() + mount()).
 *  - 'single' — один изотоп для поля span.iso-field (Подбор выдержки, Пересчёт от измерения, Масса, чистота).
 *    Своё окно #ptDlg поверх открытого #dlg. Первое нажатие выбирает, повторное снимает выбор; «Готово» пишет
 *    в поле каноническое имя (пусто, если выбор снят) и шлёт input и change; «Отмена» ничего не меняет.
 *
 * Кнопки button.iso-pt[data-pt-for="id поля"] модуль находит сам (и в окнах, которые появляются позже):
 * рисует значок, показывает кнопку и по щелчку открывает таблицу. Разрешённые изотопы поля:
 * input.isoNames (массив) → data-pt-scope="all" (вся база) → варианты select/datalist → вся база.
 *
 * API: html(opts), mount(root, opts) → {value(), destroy()}, pick(opts) → Promise<имя | '' | undefined>,
 * namesFor(field), allowedBySymbol(names), isotopesOf(sym, names), canon(text).
 */
(function (g) {
  'use strict';
  const DB = g.NUCDB || {};
  const C = g.HLCore;
  const EL = g.HLElements;
  const doc = g.document;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const symOf = (n) => n.slice(0, n.indexOf('-'));
  const massKey = (n) => { const m = n.match(/^[A-Za-z]+-(\d+)(\w*)$/); return m ? +m[1] + (m[2] ? 0.5 : 0) : 0; };
  const fmtT = (n) => (C && C.fmtHalfLife && DB[n] ? C.fmtHalfLife(DB[n][0]) : '');
  let ALL = null;
  /** Все радиоактивные изотопы базы. */
  function allNames() { if (!ALL) ALL = Object.keys(DB).filter((n) => DB[n] && DB[n][0] != null); return ALL; }

  /** «цезий-137», «Cs137», «137Cs» → «Cs-137» (или null). Сначала общий разбор из picker.js, если он есть. */
  function canon(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const P = g.HLPicker;
    if (P && P.resolve) { try { const r = P.resolve(t); if (r && r.name) return r.name; } catch (e) { /* дальше сами */ } }
    let n = C && C.normalizeName ? C.normalizeName(t) : null;
    if (!n && EL) { const r = EL.parse(t); if (r && r.a && C) n = C.normalizeName(r.sym + '-' + r.a + (r.meta || '')); }
    return n && DB[n] ? n : null;
  }
  /** {символ: число разрешённых изотопов}. */
  function allowedBySymbol(names) {
    const out = {};
    for (const n of names) { const s = symOf(n); out[s] = (out[s] || 0) + 1; }
    return out;
  }
  /** Изотопы элемента из списка, по массовому числу (Am-241, Am-242m, Am-243). */
  function isotopesOf(sym, names) { return names.filter((n) => symOf(n) === sym).sort((a, b) => massKey(a) - massKey(b)); }

  /** Разрешённые изотопы поля (см. шапку файла). */
  function namesFor(f) {
    if (!f) return allNames();
    const ok = (arr) => arr.filter((n) => DB[n] && DB[n][0] != null);
    if (Array.isArray(f.isoNames) && f.isoNames.length) return ok(f.isoNames);
    if (f.dataset && f.dataset.ptScope === 'all') return allNames();
    if (f.tagName === 'SELECT') return ok(Array.from(f.options).map((o) => o.value).filter(Boolean));
    if (f.list && f.list.options && f.list.options.length) return ok(Array.from(f.list.options).map((o) => o.value));
    return allNames();
  }

  const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h3v3h-3zM11.5 3h3v3h-3zM1.5 7h3v3h-3zM5.5 7h3v3h-3zM11.5 7h3v3h-3zM1.5 11h3v3h-3zM5.5 11h3v3h-3zM8.5 11h3v3h-3zM11.5 11h3v3h-3z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  const HELP = {
    multi: 'Выберите элемент, затем изотоп — он добавится в расчёт. Нажмите добавленный изотоп ещё раз, чтобы убрать его.',
    single: 'Выберите элемент, затем изотоп. Нажмите выбранный изотоп ещё раз, чтобы снять выбор.',
  };

  /** Разметка окна: поиск, таблица, список изотопов, строка состояния. Классы и id — общие для обоих режимов. */
  function html(opts) {
    opts = opts || {};
    const mode = opts.mode === 'single' ? 'single' : 'multi';
    const avail = allowedBySymbol(opts.names || allNames());
    const limited = !!opts.names && opts.names.length < allNames().length;
    let cells = '';
    for (const e of EL.list) {
      const p = EL.pos(e.z), n = avail[e.sym] || 0;
      const t = n ? `${e.ru}, Z = ${e.z}. ${limited ? 'Можно выбрать' : 'Радиоактивных изотопов в базе'}: ${n}`
        : `${e.ru}, Z = ${e.z}. ${limited ? 'Здесь не выбрать' : 'Нет в базе'}`;
      cells += `<button type="button" class="pt-el${n ? '' : ' none'}" data-sym="${e.sym}" data-row="${p.row}" data-col="${p.col}"` +
        ` style="grid-row:${p.row};grid-column:${p.col}" title="${esc(t)}" aria-label="${esc(t)}" tabindex="-1"${n ? '' : ' disabled'}>` +
        `<small>${e.z}</small><b>${e.sym}</b></button>`;
    }
    cells += '<span class="pt-ph" style="grid-row:6;grid-column:3" aria-hidden="true">57–71</span><span class="pt-ph" style="grid-row:7;grid-column:3" aria-hidden="true">89–103</span>' +
      '<span class="pt-flabel" style="grid-row:9;grid-column:1 / span 2">лантаноиды</span><span class="pt-flabel" style="grid-row:10;grid-column:1 / span 2">актиноиды</span>';
    return `<div class="pt-top" data-mode="${mode}"><input id="ptSearch" type="search" placeholder="Найти: цезий, Cs или 55" aria-label="Найти элемент или изотоп" autocomplete="off" spellcheck="false">` +
      `<p class="pt-help">${esc(opts.help || HELP[mode])}</p></div>` +
      `<div class="pt-wrap"><div class="pt-grid" role="group" aria-label="Элементы">${cells}</div></div>` +
      '<div id="ptIso" class="pt-iso" aria-live="polite"></div><p id="ptStatus" class="pt-status" role="status"></p>';
  }

  /**
   * Оживляет разметку html() внутри root.
   * opts: {mode, names, start, value, onPick(name|null), onDone(),
   *        roots() → [имена], inChain(name) → родоначальник | null, add(name) → null | текст ошибки, remove(name)}.
   */
  function mount(root, opts) {
    opts = opts || {};
    const single = opts.mode === 'single';
    const names = opts.names || allNames();
    const allowed = new Set(names);
    const avail = allowedBySymbol(names);
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => Array.from(root.querySelectorAll(s));
    const grid = $('.pt-grid'), search = $('#ptSearch'), isoBox = $('#ptIso'), status = $('#ptStatus');
    let sel = null;
    let picked = single ? (canon(opts.value) || null) : null;
    if (picked && !allowed.has(picked)) picked = null;

    const cellOf = (sym) => grid.querySelector(`.pt-el[data-sym="${sym}"]`);
    const setStatus = (text, err) => { status.textContent = text || ''; status.classList.toggle('error', !!err); };
    const roots = () => (opts.roots ? opts.roots() : []);
    function markUsed() {
      const used = new Set(single ? (picked ? [symOf(picked)] : []) : roots().map(symOf));
      $$('.pt-el').forEach((c) => c.classList.toggle('used', used.has(c.dataset.sym)));
    }
    function isoButton(n) {
      if (single) {
        const on = n === picked;
        return `<button type="button" class="pt-iso-btn${on ? ' picked' : ''}" data-add="${esc(n)}" aria-pressed="${on}"` +
          ` title="${on ? 'Нажмите ещё раз, чтобы снять выбор' : 'Выбрать'}"><b>${esc(n)}</b><span>${esc(on ? 'выбран' : fmtT(n))}</span></button>`;
      }
      const rs = roots(), added = rs.includes(n), chain = !added && opts.inChain ? opts.inChain(n) : null;
      const note = added ? 'добавлен' : chain ? 'уже в цепочке' : fmtT(n);
      const title = added ? 'Нажмите ещё раз, чтобы убрать из расчёта' : chain ? `Входит в цепочку ${chain}` : 'Добавить в расчёт';
      return `<button type="button" class="pt-iso-btn${added ? ' added' : ''}${chain ? ' chain' : ''}" data-add="${esc(n)}" aria-pressed="${added}" title="${esc(title)}">` +
        `<b>${esc(n)}</b><span>${esc(note)}</span></button>`;
    }
    /** Обновляет кнопки изотопов на месте (не перерисовывая: фокус и двойной щелчок не теряются). */
    function refreshIso() {
      for (const b of Array.from(isoBox.querySelectorAll('[data-add]'))) {
        const t = doc.createElement('div'); t.innerHTML = isoButton(b.dataset.add);
        const nb = t.firstChild;
        b.className = nb.className; b.title = nb.title;
        b.setAttribute('aria-pressed', nb.getAttribute('aria-pressed'));
        b.querySelector('span').textContent = nb.querySelector('span').textContent;
      }
    }
    function renderIso(focusName) {
      if (!sel) {
        // в узком наборе (изотопы расчёта) сразу показываем все варианты
        if (single && names.length <= 40) {
          // порядок — как у поля (обычно порядок цепочки)
          isoBox.innerHTML = '<h3>Изотопы этого расчёта</h3><div class="pt-iso-list">' + names.map(isoButton).join('') + '</div>';
        } else {
          isoBox.innerHTML = `<p class="pt-hint">${single ? 'Выберите элемент — здесь появятся его изотопы.' : 'Выберите элемент — здесь появятся его радиоактивные изотопы.'}</p>`;
        }
      } else {
        const e = EL.bySym[sel];
        isoBox.innerHTML = `<h3>${esc(e.ru)} <span>${esc(e.sym)} · Z = ${e.z}</span></h3><div class="pt-iso-list">` +
          isotopesOf(sel, names).map(isoButton).join('') + '</div>';
      }
      if (focusName) { const b = isoBox.querySelector(`[data-add="${focusName}"]`); if (b) b.focus(); }
    }
    function select(sym, focusCell) {
      const c = cellOf(sym); if (!c || c.disabled) return;
      $$('.pt-el.sel').forEach((x) => { x.classList.remove('sel'); x.tabIndex = -1; x.removeAttribute('aria-pressed'); });
      c.classList.add('sel'); c.tabIndex = 0; c.setAttribute('aria-pressed', 'true');
      sel = sym; renderIso();
      if (focusCell) c.focus();
      if (c.scrollIntoView) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function unselect() {
      const c = sel && cellOf(sel);
      if (c) { c.classList.remove('sel'); c.removeAttribute('aria-pressed'); }
      sel = null; renderIso();
    }
    // ---- действия с изотопом ----
    function add(n) {
      if (roots().includes(n)) { setStatus(`${n} уже добавлен.`); return; }
      const err = opts.add ? opts.add(n) : null;
      if (!err && roots().includes(n)) setStatus(`${n} добавлен в расчёт. Можно выбрать ещё или нажать «Готово».`);
      else setStatus(err || `${n} не добавлен.`, true);
      markUsed(); refreshIso();
    }
    function remove(n) {
      if (opts.remove) opts.remove(n);
      if (roots().includes(n)) setStatus(`${n} не убран.`, true);
      else setStatus(`${n} убран из расчёта.`);
      markUsed(); refreshIso();
    }
    function pick(n, toggle) {
      if (toggle && picked === n) { picked = null; setStatus('Выбор снят. Нажмите «Готово», чтобы оставить поле пустым, или выберите другой изотоп.'); }
      else { picked = n; setStatus(`Выбран ${n}. Нажмите «Готово».`); }
      if (opts.onPick) opts.onPick(picked);
      markUsed(); refreshIso();
    }
    function press(n) {
      if (single) pick(n, true);
      else if (roots().includes(n)) remove(n);
      else add(n);
    }

    // ---- начальное состояние ----
    markUsed();
    const startSym = picked ? symOf(picked) : single ? (Object.keys(avail).length === 1 ? Object.keys(avail)[0] : null)
      : (roots().length ? symOf(roots()[roots().length - 1]) : null);
    const first = (startSym && cellOf(startSym)) || $$('.pt-el:not(:disabled)')[0];
    if (first) first.tabIndex = 0;
    if (single && startSym) select(startSym); else renderIso();
    if (picked) setStatus(`Сейчас выбран ${picked}. Нажмите его ещё раз, чтобы снять выбор.`);

    // ---- события ----
    const onClick = (ev) => {
      const c = ev.target.closest('.pt-el');
      if (c && grid.contains(c) && !c.disabled) {
        setStatus('');
        if (c.classList.contains('sel')) unselect(); else select(c.dataset.sym);
        return;
      }
      const b = ev.target.closest('[data-add]');
      if (b && isoBox.contains(b)) press(b.dataset.add);
    };
    const onDbl = (ev) => {
      // двойной щелчок в режиме одного изотопа: выбрать и сразу закрыть окно
      const b = single && ev.target.closest('[data-add]');
      if (b && isoBox.contains(b)) { pick(b.dataset.add, false); if (opts.onDone) opts.onDone(); }
    };
    const onGridKey = (ev) => {
      const c = ev.target.closest('.pt-el'); if (!c) return;
      const dir = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[ev.key];
      if (!dir) {
        if (ev.key === 'Home' || ev.key === 'End') {
          ev.preventDefault();
          const all = $$('.pt-el:not(:disabled)'); const t = ev.key === 'Home' ? all[0] : all[all.length - 1];
          c.tabIndex = -1; t.tabIndex = 0; t.focus();
        }
        return;
      }
      ev.preventDefault();
      const r = +c.dataset.row, col = +c.dataset.col;
      const all = $$('.pt-el:not(:disabled)').map((x) => ({ x, r: +x.dataset.row, c: +x.dataset.col }));
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
      $$('.pt-el.hit').forEach((x) => x.classList.remove('hit'));
      if (!q) { setStatus(''); return; }
      const r = EL.parse(q);
      const lq = q.toLowerCase().replace(/ё/g, 'е');
      const hits = r ? [EL.bySym[r.sym]] : EL.list.filter((e) => String(e.z) === q || e.sym.toLowerCase() === lq || e.ru.toLowerCase().replace(/ё/g, 'е').startsWith(lq));
      const ok = hits.filter((e) => e && avail[e.sym]);
      ok.forEach((e) => { const c = cellOf(e.sym); if (c) c.classList.add('hit'); });
      if (ok.length) select(ok[0].sym);
      setStatus(ok.length ? '' : (hits.length && single ? 'Этот элемент здесь не выбрать.' : 'Не найдено. Введите название элемента (цезий), символ (Cs) или номер (55).'), !ok.length);
    };
    const onSearchKey = (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault(); ev.stopPropagation(); // Enter не должен закрывать окно
      const name = canon(search.value);
      if (name && allowed.has(name)) {
        if (symOf(name) !== sel) select(symOf(name));
        // Enter только добавляет и выбирает, но не снимает
        if (single) pick(name, false); else if (roots().includes(name)) setStatus(`${name} уже добавлен.`); else add(name);
        const b = isoBox.querySelector(`[data-add="${name}"]`); if (b) b.focus();
        return;
      }
      if (name && single) { setStatus(`${name} здесь не выбрать.`, true); return; }
      const b = isoBox.querySelector('.pt-iso-btn'); if (b) b.focus();
    };
    root.addEventListener('click', onClick);
    root.addEventListener('dblclick', onDbl);
    grid.addEventListener('keydown', onGridKey);
    search.addEventListener('input', onSearch);
    search.addEventListener('keydown', onSearchKey);
    if (opts.start && EL.symbolOf(opts.start)) { search.value = opts.start; onSearch(); }
    search.focus();
    return {
      value: () => picked,
      destroy() {
        root.removeEventListener('click', onClick);
        root.removeEventListener('dblclick', onDbl);
      },
    };
  }

  // ---------- окно #ptDlg: один изотоп для поля ----------
  function dlgEl() {
    let d = doc.getElementById('ptDlg');
    if (d) return d;
    d = doc.createElement('dialog');
    d.id = 'ptDlg'; d.className = 'pt-dlg'; d.setAttribute('aria-labelledby', 'ptDlgTitle');
    d.innerHTML = '<form method="dialog"><div class="dlg-head"><h2 id="ptDlgTitle">Выберите изотоп</h2>' +
      '<button class="dlg-x" type="submit" value="cancel" aria-label="Закрыть"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>' +
      '<div id="ptDlgBody" class="dlg-body" tabindex="-1"></div>' +
      '<div class="dlg-foot"><button type="submit" value="cancel">Отмена</button><button class="primary" type="submit" value="ok">Готово</button></div></form>';
    doc.body.appendChild(d);
    return d;
  }
  let picking = null;
  /** opts: {value, names, title, help}. Результат: имя, '' (выбор снят) или undefined («Отмена», Esc). */
  function pick(opts) {
    opts = opts || {};
    const d = dlgEl();
    if (!d.showModal || picking) return Promise.resolve(undefined);
    const body = doc.getElementById('ptDlgBody');
    const title = doc.getElementById('ptDlgTitle');
    const names = opts.names && opts.names.length ? opts.names : allNames();
    title.textContent = opts.title || 'Выберите изотоп';
    body.innerHTML = html({ mode: 'single', names, help: opts.help });
    d.returnValue = '';
    d.showModal();
    const ctl = mount(body, { mode: 'single', names, value: opts.value, onDone: () => d.close('ok') });
    // клавиши окна не должны доходить до горячих клавиш страницы (F9, Ctrl+S…)
    const stop = (e) => e.stopPropagation();
    d.addEventListener('keydown', stop);
    picking = new Promise((resolve) => {
      d.addEventListener('close', function onClose() {
        d.removeEventListener('close', onClose);
        d.removeEventListener('keydown', stop);
        ctl.destroy();
        const v = d.returnValue === 'ok' ? (ctl.value() || '') : undefined;
        body.innerHTML = '';
        picking = null;
        resolve(v);
      });
    });
    return picking;
  }

  /** Пишет результат в поле и сообщает о нём как о ручном вводе. */
  function setField(f, v) {
    if (f.tagName === 'SELECT' && !Array.from(f.options).some((o) => o.value === v)) return;
    f.value = v;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function labelOf(f) {
    const l = f.id && doc.querySelector(`label[for="${f.id}"]`);
    return l ? l.textContent.trim().replace(/[:\s]+$/, '') : '';
  }
  async function onFieldButton(btn) {
    const f = doc.getElementById(btn.dataset.ptFor);
    if (!f || f.disabled || btn.disabled) return;
    const names = namesFor(f);
    const lab = labelOf(f);
    const v = await pick({ value: f.value, names, title: lab ? `${lab}: выберите в таблице` : 'Выберите изотоп' });
    if (v === undefined) { f.focus(); return; }
    setField(f, v);
    f.focus();
  }
  /** Готовит кнопки .iso-pt внутри node: значок, подсказка, показ. */
  function enhance(node) {
    if (!node || !node.querySelectorAll) return;
    const list = node.matches && node.matches('.iso-pt') ? [node] : Array.from(node.querySelectorAll('.iso-pt'));
    for (const b of list) {
      if (b.dataset.ptReady) continue;
      b.dataset.ptReady = '1';
      if (!b.innerHTML.trim()) b.innerHTML = ICON;
      b.title = b.title || 'Выбрать в таблице Менделеева';
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Выбрать в таблице Менделеева');
      b.hidden = false;
    }
  }

  g.HLPtable = { html, mount, pick, namesFor, allowedBySymbol, isotopesOf, canon, enhance };

  if (doc && EL) {
    doc.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.iso-pt[data-pt-for]');
      if (b) { e.preventDefault(); onFieldButton(b); }
    });
    const start = () => {
      enhance(doc.body);
      if (g.MutationObserver) {
        new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) enhance(n); })
          .observe(doc.body, { childList: true, subtree: true });
      }
    };
    if (doc.body) start(); else doc.addEventListener('DOMContentLoaded', start);
  }
})(typeof window !== 'undefined' ? window : globalThis);
