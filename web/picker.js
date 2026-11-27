/* Выбор изотопа в полях ввода: русские названия и подсказки.
 * window.HLPicker = { resolve, suggest, field, label, nameFromWords, isotopesOf, unknownText, elementRu }.
 *  - resolve('торий-229' | 'th229' | '229 тория' | 'радий', {allowed}) → {name} | {empty:true} | {error};
 *  - suggest('рад' | 'ra2' | 'радий 22' | '225' | '99м', names) → подходящие имена, лучшие первыми;
 *  - field(input, {names, onPick, multi}) — свой список подсказок под полем (не datalist: он скрывает варианты
 *    при заполненном поле и ненадёжен в Android WebView).
 * Зависит от HLCore (normalizeName, fmtHalfLife), NUCDB и HLElements.
 */
(function (g) {
  'use strict';
  const C = g.HLCore;
  const DB = () => g.NUCDB || {};
  const EL = () => g.HLElements || null;
  const LIST_LIMIT = 60; // короткий список показываем целиком по щелчку
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
  const radioactive = (n) => !!DB()[n] && DB()[n][0] != null;
  const symOf = (n) => n.slice(0, n.indexOf('-'));
  const massOf = (n) => n.slice(n.indexOf('-') + 1); // «99m»

  // ---------- распознавание ----------
  /** «цезий-137», «137 цезия», «технеций-99м», «237 нептуния» → Cs-137, Tc-99m, Np-237 (или null). */
  function nameFromWords(p) {
    const el = EL(); if (!el) return null;
    const s = String(p || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
    let r = el.parse(s);
    // «237 нептуния», «99 молибдена»: начальная «н»/«м» названия не метка изомера
    if (!(r && r.a)) {
      const m = s.match(/^(\d{1,3})[\s-]+([A-Za-zА-Яа-яЁё]+)$/);
      const sym = m && el.symbolOf(m[2]);
      if (sym) r = { sym, a: Number(m[1]), meta: '' };
    }
    return r && r.a ? C.normalizeName(r.sym + '-' + r.a + (r.meta || '')) : null;
  }
  /** Радиоактивные изотопы элемента из базы, по массовому числу. */
  function isotopesOf(sym) {
    const key = (n) => { const m = n.match(/^[A-Za-z]+-(\d+)(\w*)$/); return m ? +m[1] + (m[2] ? 0.5 : 0) : 0; };
    return Object.keys(DB()).filter((n) => radioactive(n) && symOf(n) === sym).sort((a, b) => key(a) - key(b));
  }
  function elementRu(sym) { const e = EL() && EL().bySym[sym]; return e ? e.ru : sym; }
  /** Понятное сообщение, если изотоп не распознан. */
  function unknownText(p) {
    const r = EL() && EL().parse(p);
    if (!r) return `«${p}» нет в базе нуклидов.`;
    const iso = isotopesOf(r.sym);
    const ru = elementRu(r.sym);
    if (!iso.length) return `У элемента ${ru} (${r.sym}) в базе нет радиоактивных изотопов.`;
    const longest = iso.slice().sort((a, b) => DB()[b][0] - DB()[a][0]).slice(0, 3);
    if (!r.a) return `${ru}: какой изотоп? Укажите массовое число, например ${longest.join(', ')}. Все изотопы — кнопка «Таблица Менделеева».`;
    return `Изотопа ${r.sym}-${r.a}${r.meta} нет в базе. Есть, например: ${longest.join(', ')}.`;
  }
  /** Каноническое имя из любой записи или null. */
  function nameOf(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const n = C.normalizeName(t) || nameFromWords(t);
    return n && DB()[n] ? n : null;
  }
  const listText = (names) => (names.length > 8 ? names.slice(0, 8).join(', ') + ` и ещё ${names.length - 8}` : names.join(', '));

  /**
   * Разбор ввода в поле изотопа.
   * opts.allowed — допустимые имена (например, изотопы расчёта); без него годится любой изотоп базы.
   */
  function resolve(text, opts) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { empty: true };
    const allowed = opts && Array.isArray(opts.allowed) ? opts.allowed : null;
    const name = nameOf(t);
    if (name) {
      if (allowed && !allowed.includes(name)) {
        return { error: `${name} нет в этом расчёте.` + (allowed.length ? ` В расчёте: ${listText(allowed)}.` : '') };
      }
      return { name };
    }
    // только элемент: «радий», «Ra», «радия»
    const r = EL() && EL().parse(t);
    if (r && !r.a && allowed) {
      const own = allowed.filter((n) => symOf(n) === r.sym);
      if (own.length === 1) return { name: own[0] };
      const ru = elementRu(r.sym);
      if (own.length > 1) return { error: `${ru}: какой изотоп? В расчёте: ${own.join(', ')}.` };
      return { error: `${ru} (${r.sym}) нет в этом расчёте.` + (allowed.length ? ` В расчёте: ${listText(allowed)}.` : '') };
    }
    return { error: unknownText(t) };
  }

  // ---------- подсказки ----------
  /** Варианты прочтения запроса: [{word, num, meta}] («99мо» — и «99m + о», и «99 + мо»). */
  function readQuery(q) {
    const s = norm(q).trim().replace(/[–—_]/g, '-').replace(/[\s-]+/g, ' ');
    const out = [];
    let m = s.match(/^([a-zа-я]+) ?(\d*)([mм]?)$/);
    if (m) out.push({ word: m[1], num: m[2], meta: m[3] ? 'm' : '' });
    m = s.match(/^(\d+)([mм]?) ?([a-zа-я]*)$/);
    if (m) {
      out.push({ word: m[3], num: m[1], meta: m[2] ? 'm' : '' });
      if (m[2] && m[3]) out.push({ word: m[2] + m[3], num: m[1], meta: '' });
    }
    if (!out.length && s) out.push({ word: s.replace(/[^a-zа-я]/g, ''), num: (s.match(/\d+/) || [''])[0], meta: '' });
    return out;
  }
  const ruForms = new Map(); // символ -> [название, родительный падеж]
  function formsOf(sym) {
    if (ruForms.has(sym)) return ruForms.get(sym);
    const el = EL(); const e = el && el.bySym[sym];
    const f = [];
    if (e) {
      // название и родительный падеж — по тем же правилам, что HLElements.symbolOf («радия», «свинца», «ртути»)
      const n = norm(e.ru);
      f.push(n, /ий$/.test(n) ? n.slice(0, -2) + 'ия' : /ец$/.test(n) ? n.slice(0, -2) + 'ца'
        : /[оа]$/.test(n) ? n.slice(0, -1) + (n.endsWith('о') ? 'а' : 'ы') : /ь$/.test(n) ? n.slice(0, -1) + 'и' : n + 'а');
      if (sym === 'I') f.push('йод', 'йода');
      if (sym === 'H') f.push('тритий');
    }
    ruForms.set(sym, f);
    return f;
  }
  function wordScore(word, sym) {
    if (!word) return 1;
    const s = sym.toLowerCase();
    if (word === s) return 4;
    const f = formsOf(sym);
    if (f.includes(word)) return 3.5;
    if (f.some((x) => x.startsWith(word))) return word.length >= 2 ? 3 : 2;
    if (word.length <= 2 && s.startsWith(word)) return 2.5;
    return 0;
  }
  /** Подходящие имена из names (по умолчанию — все радиоактивные), лучшие первыми. */
  function suggest(query, names, limit) {
    const pool = names || allRadioactive();
    const q = String(query || '').trim();
    if (!q) return pool.slice(0, limit || pool.length);
    const exact = nameOf(q);
    const variants = readQuery(q);
    const zOf = (sym) => { const e = EL() && EL().bySym[sym]; return e ? e.z : 999; };
    const scored = [];
    for (const n of pool) {
      const sym = symOf(n), mass = massOf(n), a = mass.replace(/\D+$/, ''), meta = /m$/.test(mass) ? 'm' : '';
      let best = 0;
      if (n === exact) best = 10;
      for (const v of variants) {
        const w = wordScore(v.word, sym);
        if (!w) continue;
        if (v.num && !a.startsWith(v.num)) continue;
        if (v.meta && meta !== v.meta) continue;
        let s = w + (v.num && a === v.num ? 1 : 0) + (v.num && a === v.num && (v.meta || '') === meta ? 0.5 : 0);
        if (!v.word && !v.num) s = 0;
        if (s > best) best = s;
      }
      if (best > 0) scored.push({ n, s: best, z: zOf(sym), a: +a || 0, meta });
    }
    scored.sort((x, y) => y.s - x.s || x.z - y.z || x.a - y.a || (x.meta < y.meta ? -1 : x.meta > y.meta ? 1 : 0));
    const out = scored.map((x) => x.n);
    return limit ? out.slice(0, limit) : out;
  }
  let allCache = null;
  function allRadioactive() {
    if (allCache && allCache.db === DB()) return allCache.list;
    const zOf = (n) => { const e = EL() && EL().bySym[symOf(n)]; return e ? e.z : 999; };
    const list = Object.keys(DB()).filter(radioactive).sort((a, b) =>
      zOf(a) - zOf(b) || parseInt(massOf(a), 10) - parseInt(massOf(b), 10) || (massOf(a) < massOf(b) ? -1 : 1));
    allCache = { db: DB(), list };
    return list;
  }
  /** Подпись в списке: «Актиний-225 · 9,92 сут». */
  function label(n) {
    const rec = DB()[n];
    const ru = elementRu(symOf(n));
    return (ru !== symOf(n) ? ru + '-' + massOf(n) : n) + (rec ? ' · ' + C.fmtHalfLife(rec[0] == null ? Infinity : rec[0]) : '');
  }

  // ---------- поле с подсказками ----------
  let seq = 0;
  /**
   * Подключает список подсказок к полю.
   * opts.names — массив имён или функция, их возвращающая (по умолчанию все радиоактивные изотопы базы);
   * opts.onPick(name) — после выбора из списка; opts.multi — в поле несколько изотопов через «,»/«;»
   * (подсказки по последнему); opts.limit — сколько подсказок показывать.
   * Возвращает {open, close, refresh, isOpen, destroy}.
   */
  function field(input, opts) {
    opts = opts || {};
    const id = 'isoSug' + (++seq);
    const list = document.createElement('ul');
    list.className = 'iso-sug'; list.id = id; list.setAttribute('role', 'listbox'); list.hidden = true;
    list.setAttribute('aria-label', 'Подходящие изотопы');
    input.insertAdjacentElement('afterend', list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id);
    input.setAttribute('autocomplete', 'off');
    input.spellcheck = false;
    const limit = opts.limit || LIST_LIMIT;
    let items = [], active = -1, quiet = false;

    const names = () => { const v = typeof opts.names === 'function' ? opts.names() : opts.names; return Array.isArray(v) ? v : allRadioactive(); };
    const syncNames = () => { input.isoNames = names().slice(); };
    syncNames();
    const segment = () => {
      if (!opts.multi) return { pre: '', q: input.value };
      const v = input.value, i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'));
      return { pre: i >= 0 ? v.slice(0, i + 1) + ' ' : '', q: v.slice(i + 1) };
    };
    // список виден (hidden снят): ставим под полем (или над ним, если внизу тесно) и сдвигаем влево, чтобы не вылезал за экран
    function place() {
      const r = input.getBoundingClientRect(), vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
      const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
      const up = below < 160 && above > below;
      list.style.position = 'fixed';
      list.style.minWidth = Math.min(r.width, vw - 8) + 'px';
      list.style.maxWidth = Math.min(420, vw - 8) + 'px';
      list.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
      list.style.top = up ? '' : r.bottom + 2 + 'px';
      list.style.bottom = up ? window.innerHeight - r.top + 2 + 'px' : '';
      list.style.left = '4px'; // сначала у левого края: ширина списка не зажата правым краем экрана
      list.style.left = Math.max(4, Math.min(r.left, vw - 4 - list.offsetWidth)) + 'px';
    }
    function render() {
      list.innerHTML = items.map((n, i) => `<li class="iso-opt${i === active ? ' active' : ''}" role="option" id="${id}-${i}" data-name="${esc(n)}" aria-selected="${i === active}">` +
        `<b>${esc(n)}</b><span>${esc(label(n))}</span></li>`).join('');
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', `${id}-${active}`);
        const li = list.children[active]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function open(all) {
      if (input.disabled || input.readOnly) return close();
      const pool = names();
      const q = segment().q.trim();
      // поле содержит уже выбранное имя — показываем весь (короткий) список, а не одно совпадение
      const showAll = all || !q || (!opts.multi && nameOf(q) && pool.includes(nameOf(q)));
      if (showAll && pool.length > limit && !q) return close();
      items = showAll && pool.length <= limit ? pool.slice() : suggest(q, pool, limit);
      if (!items.length) return close();
      const cur = nameOf(q);
      active = cur && showAll ? items.indexOf(cur) : -1;
      render();
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      place();
    }
    function close() {
      list.hidden = true; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    const isOpen = () => !list.hidden;
    function pick(n) {
      const seg = segment();
      input.value = opts.multi ? seg.pre + n : n;
      close();
      quiet = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      quiet = false;
      if (opts.onPick) opts.onPick(n);
    }
    function move(d) {
      if (!isOpen()) { open(true); if (!isOpen()) return; }
      const n = items.length;
      active = active < 0 ? (d > 0 ? 0 : n - 1) : (active + d + n) % n;
      render();
    }
    const onInput = () => { if (!quiet) open(false); };
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (!isOpen()) return;
      if (e.key === 'Enter') {
        // выбранная стрелками строка, точное совпадение или единственная подсказка — выбрать её;
        // иначе («цезий» без массы) список закрывается, а Enter делает обычное действие поля и покажет пояснение
        const exact = nameOf(segment().q);
        const n = active >= 0 ? items[active] : exact && items.includes(exact) ? exact : items.length === 1 ? items[0] : null;
        if (n) { e.preventDefault(); e.stopPropagation(); pick(n); } else close();
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); close();
      } else if (e.key === 'Tab') close();
    };
    const onFocusClick = (e) => { if (e.type === 'click' || !isOpen()) { if (!isOpen()) open(true); } };
    const onBlur = () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120);
    const onChange = () => {
      if (quiet || opts.multi) return;
      const n = nameOf(input.value);
      if (n && n !== input.value.trim()) input.value = n; // «радий-225» → «Ra-225»
    };
    const onDown = (e) => { if (e.target.closest('.iso-opt')) e.preventDefault(); }; // фокус остаётся в поле
    const onPickClick = (e) => { const li = e.target.closest('.iso-opt'); if (li) { pick(li.dataset.name); input.focus(); } };
    const onScroll = (e) => { if (isOpen() && !list.contains(e.target)) place(); };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('click', onFocusClick);
    input.addEventListener('blur', onBlur);
    input.addEventListener('change', onChange);
    list.addEventListener('mousedown', onDown);
    list.addEventListener('click', onPickClick);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    const api = {
      open: () => open(true), close, isOpen,
      /** Набор изменился: обновить isoNames (для таблицы Менделеева) и открытый список. */
      refresh: () => { syncNames(); if (isOpen()) open(false); },
      destroy: () => {
        close(); list.remove();
        input.removeEventListener('input', onInput); input.removeEventListener('keydown', onKey);
        input.removeEventListener('click', onFocusClick); input.removeEventListener('blur', onBlur);
        input.removeEventListener('change', onChange);
        window.removeEventListener('resize', onScroll); document.removeEventListener('scroll', onScroll, true);
      },
    };
    input.isoPicker = api;
    return api;
  }

  /** База нуклидов изменилась — пересобрать общий список. */
  function invalidate() { allCache = null; ruForms.clear(); }

  g.HLPicker = { resolve, suggest, field, label, nameOf, nameFromWords, isotopesOf, unknownText, elementRu, allRadioactive, invalidate };
})(typeof window !== 'undefined' ? window : globalThis);
