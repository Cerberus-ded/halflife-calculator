/* Дополнительные расчёты калькулятора (без DOM, проверяются в Node):
 *  - радионуклидная чистота целевого изотопа и доли примесей;
 *  - подбор выдержки: спад до уровня, накопление до уровня, максимум активности, чистота не ниже заданной;
 *  - погрешность результата методом Монте-Карло (A₀ и T½ с заданной относительной погрешностью);
 *  - разбор выгрузки IAEA LiveChart (CSV ground_states) и обновление периодов полураспада в базе;
 *  - сборка протокола в формате Word (.docx);
 *  - генератор с многократными отборами (элюирование дочернего элемента через равные промежутки).
 * API: window.HLTools = {evaluator, purityAt, findHold, uncertainty, parseIaeaCsv, applyIaea, docx, generator, elementsOf, elementOf}.
 * Активности — в Бк, время — в секундах, доли — от 0 до 1.
 */
(function (global) {
  'use strict';

  const core = () => global.HLCore || (typeof require === 'function' ? require('./core.js') : null);

  // ---------- активности во времени ----------
  /** Функция t -> [A_i(t)] для набора и начальных активностей A0 {имя: Бк}. */
  function evaluator(set, A0) {
    const N0 = set.map((x) => (x.lambda > 0 ? (Number(A0[x.name]) || 0) / x.lambda : 0));
    const sol = core().solve(set, N0);
    return (t) => sol.N(t).map((n, i) => n * set[i].lambda);
  }

  // ---------- радионуклидная чистота ----------
  /**
   * Чистота = A(цели) / (A(цели) + ΣA(примесей)).
   * Если countProgeny = false, дочерние продукты, накопившиеся из самой цели, примесями не считаются
   * (линейность: из полной активности вычитается вклад цепочки, начатой только целевым изотопом).
   * Возвращает {iT, A, impurity:[Бк по строкам], total, purity, share:[доли примеси от total]}.
   */
  function purityParts(set, all, fromTarget, iT) {
    const impurity = all.map((a, i) => {
      if (i === iT || set[i].lambda === 0) return 0;
      const v = a - (fromTarget ? fromTarget[i] : 0);
      return v > 1e-9 * a ? v : 0;
    });
    const A = all[iT];
    const total = A + impurity.reduce((s, v) => s + v, 0);
    return { iT, A, impurity, total, purity: total > 0 ? A / total : NaN, share: impurity.map((v) => (total > 0 ? v / total : 0)) };
  }
  function targetOnly(A0, target) { const a = {}; a[target] = Number(A0[target]) || 0; return a; }
  function purityAt(set, A0, tSec, target, countProgeny) {
    const iT = set.findIndex((x) => x.name === target);
    if (iT < 0 || !(set[iT].lambda > 0)) return null;
    const all = evaluator(set, A0)(tSec);
    const fromT = countProgeny ? null : evaluator(set, targetOnly(A0, target))(tSec);
    return purityParts(set, all, fromT, iT);
  }

  // ---------- подбор выдержки ----------
  function timeGrid(set) {
    const Ts = set.filter((x) => x.lambda > 0).map((x) => x.T);
    const lo = Math.max(Math.min(...Ts) * 1e-3, 1e-12), hi = Math.max(...Ts) * 60;
    const grid = [0];
    const per = 40, dec = Math.log10(hi / lo);
    const n = Math.ceil(dec * per);
    for (let k = 0; k <= n; k++) grid.push(lo * Math.pow(10, dec * k / n));
    return grid;
  }
  /** Граница выполнения условия между a (не выполнено/выполнено) и b — делением пополам (в логарифмах, если можно). */
  function bisect(ok, a, b, okAtA) {
    for (let k = 0; k < 80; k++) {
      const m = a > 0 ? Math.sqrt(a * b) : (b > 1e-300 ? b / 2 : 0);
      if (m === a || m === b) break;
      if (ok(m) === okAtA) a = m; else b = m;
      if ((b - a) <= 1e-12 * b) break;
    }
    return okAtA ? a : b; // момент последнего «как в a» или первого «как в b»
  }
  /**
   * cond = {type: 'le'|'ge'|'max'|'purity', name, value, countProgeny}
   *  le     — активность name не больше value (Бк) и дальше уже не превышает: момент спада;
   *  ge     — активность name впервые не меньше value (Бк): момент накопления;
   *  max    — максимум активности name;
   *  purity — чистота name впервые не ниже value (доля 0…1).
   * Ответ: {found, t, until?, reason?, value?} — t и until в секундах; until — когда условие перестаёт выполняться.
   */
  function findHold(set, A0, cond) {
    const i = set.findIndex((x) => x.name === cond.name);
    if (i < 0 || !(set[i].lambda > 0)) return { found: false, reason: 'Изотоп не радиоактивен или не входит в цепочки.' };
    const ev = evaluator(set, A0);
    let fn;
    if (cond.type === 'purity') {
      const evT = cond.countProgeny ? null : evaluator(set, targetOnly(A0, cond.name));
      fn = (t) => purityParts(set, ev(t), evT ? evT(t) : null, i).purity;
    } else fn = (t) => ev(t)[i];
    const grid = timeGrid(set);
    const vals = grid.map(fn);
    const tEnd = grid[grid.length - 1];

    if (cond.type === 'max') {
      let k = 0;
      vals.forEach((v, j) => { if (v > vals[k]) k = j; });
      if (k === 0) return { found: false, reason: 'Активность только убывает: максимум — в начальный момент.' };
      if (k === grid.length - 1) return { found: false, reason: 'Активность растёт на всём рассмотренном интервале.' };
      // золотое сечение по ln t между соседними узлами
      let a = Math.log(grid[k - 1] || grid[1] / 10), b = Math.log(grid[k + 1]);
      const g = (Math.sqrt(5) - 1) / 2;
      let c = b - g * (b - a), d = a + g * (b - a), fc = fn(Math.exp(c)), fd = fn(Math.exp(d));
      for (let s = 0; s < 100 && b - a > 1e-12; s++) {
        if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = fn(Math.exp(c)); }
        else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = fn(Math.exp(d)); }
      }
      const t = Math.exp((a + b) / 2);
      return { found: true, t, value: fn(t) };
    }

    const v = Number(cond.value);
    if (!(v >= 0) || !isFinite(v)) return { found: false, reason: 'Не задано значение условия.' };
    const ok = cond.type === 'le' ? (t) => fn(t) <= v : (t) => fn(t) >= v;
    const oks = grid.map((t, j) => (cond.type === 'le' ? vals[j] <= v : vals[j] >= v));
    if (cond.type === 'le') {
      // начало последнего участка, который тянется до конца интервала
      if (!oks[oks.length - 1]) return { found: false, reason: 'Активность не опускается до заданного уровня (долгоживущий предшественник).' };
      let j = oks.length - 1;
      while (j > 0 && oks[j - 1]) j--;
      if (j === 0) return { found: true, t: 0, already: true, value: vals[0] };
      const t = bisect(ok, grid[j - 1], grid[j], false);
      return { found: true, t, value: fn(t) };
    }
    // ge и purity: первое выполнение условия и момент, когда оно перестаёт выполняться
    const j = oks.indexOf(true);
    if (j < 0) return { found: false, reason: cond.type === 'purity' ? 'Чистота не достигает заданного уровня.' : 'Активность не достигает заданного уровня.' };
    const t = j === 0 ? 0 : bisect(ok, grid[j - 1], grid[j], false);
    let until = Infinity;
    const e = oks.indexOf(false, j);
    if (e > 0) until = bisect(ok, grid[e - 1], grid[e], true);
    return { found: true, t, until: until >= tEnd ? Infinity : until, already: j === 0, value: fn(t) };
  }

  // ---------- погрешность (Монте-Карло) ----------
  function rng(seed) {
    let a = seed >>> 0;
    const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let spare = null;
    return () => { // нормальное N(0,1), метод Бокса — Мюллера
      if (spare != null) { const s = spare; spare = null; return s; }
      let x = 0, y = 0; while (x === 0) x = u(); y = u();
      const r = Math.sqrt(-2 * Math.log(x)); spare = r * Math.sin(2 * Math.PI * y); return r * Math.cos(2 * Math.PI * y);
    };
  }
  function quantile(sorted, q) {
    const p = (sorted.length - 1) * q, i = Math.floor(p), f = p - i;
    return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
  }
  /**
   * opts: {uA: отн. погрешность A₀ (1σ), uT: отн. погрешность T½ (1σ), uTby: {имя: отн.}, n: 2000, seed,
   *        target, countProgeny}. Погрешности независимы по изотопам.
   * Ответ: {n, A: [по срокам][по строкам] {lo, hi, rel}, purity: [по срокам] {lo, hi} | null}; интервал 95 %.
   */
  function uncertainty(set, A0, times, opts) {
    const n = Math.max(200, Math.min(20000, opts.n || 2000));
    const norm = rng(opts.seed || 20261127);
    const uA = Math.max(0, opts.uA || 0), uT = Math.max(0, opts.uT || 0), uTby = opts.uTby || {};
    const iT = opts.target ? set.findIndex((x) => x.name === opts.target) : -1;
    const samples = times.map(() => set.map(() => new Float64Array(n)));
    const pur = iT >= 0 ? times.map(() => new Float64Array(n)) : null;
    const base = times.map((t) => evaluator(set, A0)(t));
    const LN2 = Math.LN2;
    for (let s = 0; s < n; s++) {
      const fac = (u) => Math.max(0.01, 1 + u * norm());
      const set2 = set.map((x) => {
        if (!(x.lambda > 0)) return x;
        const u = uTby[x.name] != null ? uTby[x.name] : uT;
        return Object.assign({}, x, { lambda: u > 0 ? LN2 / (x.T * fac(u)) : x.lambda });
      });
      const A0s = {};
      for (const k in A0) A0s[k] = (Number(A0[k]) || 0) * (uA > 0 ? fac(uA) : 1);
      const ev = evaluator(set2, A0s);
      const evT = pur && !opts.countProgeny ? evaluator(set2, targetOnly(A0s, opts.target)) : null;
      times.forEach((t, ti) => {
        const a = ev(t);
        for (let i = 0; i < a.length; i++) samples[ti][i][s] = a[i];
        if (pur) pur[ti][s] = purityParts(set2, a, evT ? evT(t) : null, iT).purity;
      });
    }
    const A = samples.map((rows, ti) => rows.map((arr, i) => {
      const srt = Array.from(arr).sort((x, y) => x - y);
      const lo = quantile(srt, 0.025), hi = quantile(srt, 0.975), nom = base[ti][i];
      return { lo, hi, rel: nom > 0 ? (hi - lo) / 2 / nom : 0 };
    }));
    const purity = pur ? pur.map((arr) => { const srt = Array.from(arr).filter((v) => isFinite(v)).sort((x, y) => x - y); return srt.length ? { lo: quantile(srt, 0.025), hi: quantile(srt, 0.975) } : null; }) : null;
    return { n, A, purity };
  }

  // ---------- выгрузка IAEA LiveChart ----------
  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.length > 1 || r[0] !== '');
  }
  const IAEA_UNITS = { y: 365.2422 * 86400, d: 86400, h: 3600, m: 60, min: 60, s: 1, ms: 1e-3, us: 1e-6, 'µs': 1e-6, 'μs': 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15, as: 1e-18 };
  /** CSV «ground_states» IAEA → {items: [{name, T, u}], total}. T — секунды, u — относительная погрешность (или null). */
  function parseIaeaCsv(text) {
    const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
    if (!rows.length) throw new Error('Файл пустой.');
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (k) => head.indexOf(k);
    const need = ['z', 'n', 'symbol', 'half_life', 'unit_hl'];
    const miss = need.filter((k) => col(k) < 0);
    if (miss.length) throw new Error('Это не выгрузка IAEA LiveChart (нет столбцов ' + miss.join(', ') + ').');
    const iz = col('z'), inn = col('n'), isym = col('symbol'), ihl = col('half_life'), iu = col('unit_hl'), iunc = col('unc_hl'), isec = col('half_life_sec');
    const items = [];
    for (const r of rows.slice(1)) {
      const z = parseInt(r[iz], 10), nn = parseInt(r[inn], 10), sym = String(r[isym] || '').trim();
      if (!sym || !(z >= 0) || !(nn >= 0)) continue;
      const hlRaw = String(r[ihl] || '').trim();
      if (!hlRaw || /stable/i.test(hlRaw)) continue;
      const hl = Number(hlRaw.replace(',', '.'));
      const unit = String(r[iu] || '').trim();
      let T = null;
      if (isFinite(hl) && hl > 0 && IAEA_UNITS[unit]) T = hl * IAEA_UNITS[unit];
      else if (isec >= 0 && Number(r[isec]) > 0) T = Number(r[isec]);
      if (!(T > 0) || !isFinite(T)) continue;
      const unc = iunc >= 0 ? Number(String(r[iunc] || '').replace(',', '.')) : NaN;
      const name = sym[0].toUpperCase() + sym.slice(1).toLowerCase() + '-' + (z + nn);
      items.push({ name, T, u: isFinite(hl) && hl > 0 && unc > 0 && isFinite(unc) ? unc / hl : null });
    }
    if (!items.length) throw new Error('В файле не нашлось периодов полураспада.');
    return { items, total: rows.length - 1 };
  }
  /**
   * Сравнивает выгрузку с базой db (NUCDB). Меняются только радиоактивные нуклиды базы (основные состояния).
   * Возвращает {changes: [{name, old, T, u}], same, unc: {имя: отн.}} — саму базу не трогает.
   */
  function applyIaea(db, parsed) {
    const changes = []; let same = 0; const unc = {};
    for (const it of parsed.items) {
      const rec = db[it.name];
      if (!rec || rec[0] == null) continue;
      if (it.u != null) unc[it.name] = it.u;
      if (Math.abs(rec[0] - it.T) <= 1e-6 * it.T) { same++; continue; }
      changes.push({ name: it.name, old: rec[0], T: it.T, u: it.u });
    }
    return { changes, same, unc };
  }

  // ---------- протокол .docx ----------
  const xesc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function run(text, o) {
    o = o || {};
    const pr = (o.bold ? '<w:b/>' : '') + (o.mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="16"/>' : '') +
      (o.color ? `<w:color w:val="${o.color}"/>` : '') + (o.size ? `<w:sz w:val="${o.size}"/>` : '');
    const parts = String(text).split('\n');
    return parts.map((t, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xesc(t)}</w:t></w:r>`).join('');
  }
  function para(text, o) {
    o = o || {};
    const ppr = (o.style ? `<w:pStyle w:val="${o.style}"/>` : '') + (o.align ? `<w:jc w:val="${o.align}"/>` : '') + (o.after != null ? `<w:spacing w:after="${o.after}"/>` : '');
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${run(text, o)}</w:p>`;
  }
  function table(rows, o) {
    o = o || {};
    const ncol = Math.max(...rows.map((r) => r.length));
    const width = o.width || 9638; // twips, ширина текста A4 при полях 2 см
    const w = o.widths ? o.widths.map((x) => Math.round(x * width / o.widths.reduce((s, v) => s + v, 0))) : new Array(ncol).fill(Math.round(width / ncol));
    const border = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders>';
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${w.map((v) => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>`;
    rows.forEach((r, ri) => {
      const head = o.header && ri === 0;
      const strong = head || (o.boldRows && o.boldRows.includes(ri));
      x += `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (let c = 0; c < ncol; c++) {
        const cell = r[c] == null ? '' : r[c];
        const isObj = typeof cell === 'object';
        const text = isObj ? cell.v : cell;
        const shade = head ? '<w:shd w:val="clear" w:color="auto" w:fill="E8ECF4"/>' : isObj && cell.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.fill}"/>` : '';
        const align = (o.alignRight && o.alignRight.includes(c) && !head) ? 'right' : 'left';
        x += `<w:tc><w:tcPr><w:tcW w:w="${w[c]}" w:type="dxa"/>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="${align}"/></w:pPr>${run(text, { bold: strong || (isObj && cell.bold), size: o.size || 18 })}</w:p></w:tc>`;
      }
      x += '</w:tr>';
    });
    return x + '</w:tbl>' + para('', { after: 60 });
  }
  /**
   * blocks: [{h1|h2|p|small: текст} | {table: rows, header, widths, alignRight, boldRows} | {mono: текст}].
   * landscape — альбомная страница для широких таблиц. Возвращает Blob .docx.
   */
  function docx(blocks, o) {
    o = o || {};
    const land = !!o.landscape;
    const pageW = land ? 16838 : 11906, pageH = land ? 11906 : 16838, margin = 1134;
    const textW = pageW - 2 * margin;
    let body = '';
    for (const b of blocks) {
      if (b.h1 != null) body += para(b.h1, { style: 'Heading1' });
      else if (b.h2 != null) body += para(b.h2, { style: 'Heading2' });
      else if (b.p != null) body += para(b.p, { bold: b.bold, color: b.color });
      else if (b.small != null) body += para(b.small, { size: 16, color: '595959' });
      else if (b.mono != null) body += para(b.mono, { mono: true });
      else if (b.table) body += table(b.table, Object.assign({ width: textW }, b));
    }
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      `<w:sectPr><w:pgSz w:w="${pageW}" w:h="${pageH}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
      '</w:styles>';
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${xesc(o.title || 'Протокол расчёта')}</dc:title><dc:creator>Калькулятор полураспада</dc:creator></cp:coreProperties>` },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles },
    ];
    const zip = (global.HLXlsx && global.HLXlsx.zip) || (typeof require === 'function' ? (require('./xlsx.js'), globalThis.HLXlsx.zip) : null);
    return zip(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  // ---------- генератор с многократными отборами ----------
  /** Химический элемент нуклида: «Ac-225» → «Ac», «Pa-234m» → «Pa». */
  const elementOf = (name) => String(name).split('-')[0];
  /** Элементы набора в порядке появления: [{el, names: [имена нуклидов]}]. */
  function elementsOf(set) {
    const map = new Map();
    for (const x of set) { const e = elementOf(x.name); if (!map.has(e)) map.set(e, []); map.get(e).push(x.name); }
    return Array.from(map, ([el, names]) => ({ el, names }));
  }
  const GEN_MAX = 1000;
  /**
   * Генератор: смесь с начальными активностями A0 распадается; в моменты отбора из неё химически извлекается
   * доля eff[элемент] (0…1) каждого изотопа этого элемента, остальное остаётся и продолжает распадаться.
   * opts: {eff: {Ac: 1}, interval: с, count: число отборов, first: с (первый отбор; по умолчанию = interval),
   *        points: точек графика на интервал (40), series: false — без графика}.
   * Возвращает {times, eluate: [[A_i, Бк]], eluateN: [[N_i]], before: [[A_i генератора перед отбором]],
   *   after: [[A_i после отбора]], final, N (атомы генератора после последнего отбора), series: {t, A}}.
   */
  function generator(set, A0, opts) {
    const o = opts || {};
    const lam = set.map((x) => x.lambda);
    const frac = set.map((x) => {
      const e = Number(o.eff && o.eff[elementOf(x.name)]);
      return isFinite(e) ? Math.min(Math.max(e, 0), 1) : 0;
    });
    const count = o.count == null ? 1 : Math.floor(Number(o.count));
    if (!(count >= 1 && count <= GEN_MAX)) throw new Error(`Число отборов — от 1 до ${GEN_MAX}.`);
    const interval = Number(o.interval) || 0;
    if (count > 1 && !(interval > 0)) throw new Error('Интервал между отборами должен быть больше нуля.');
    const first = o.first != null ? Number(o.first) : interval;
    if (!(first >= 0) || !isFinite(first)) throw new Error('Время первого отбора должно быть не меньше нуля.');
    const PTS = Math.max(2, Math.min(200, Math.floor(o.points || 40)));
    const act = (N) => N.map((v, i) => v * lam[i]);
    let N = set.map((x) => (x.lambda > 0 ? (Number(A0[x.name]) || 0) / x.lambda : 0));
    const res = { times: [], eluate: [], eluateN: [], before: [], after: [], series: o.series === false ? null : { t: [0], A: [act(N)] } };
    let t = 0;
    for (let k = 0; k < count; k++) {
      const tk = first + k * interval, dt = tk - t;
      if (dt > 0) {
        const sol = core().solve(set, N);
        if (res.series) for (let p = 1; p <= PTS; p++) { const tt = dt * p / PTS; res.series.t.push(t + tt); res.series.A.push(act(sol.N(tt))); }
        N = sol.N(dt);
      }
      res.before.push(act(N));
      const out = N.map((v, i) => v * frac[i]);
      N = N.map((v, i) => v - out[i]);
      res.times.push(tk); res.eluateN.push(out); res.eluate.push(act(out));
      const after = act(N);
      res.after.push(after);
      if (res.series) { res.series.t.push(tk); res.series.A.push(after); }
      t = tk;
    }
    res.final = res.after[res.after.length - 1];
    res.N = N;
    return res;
  }

  const api = { evaluator, purityAt, findHold, uncertainty, parseIaeaCsv, applyIaea, docx, parseCsv, generator, elementsOf, elementOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HLTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
