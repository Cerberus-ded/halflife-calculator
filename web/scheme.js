/* Схема распада: раскладка цепочки по уровням и картинка SVG (без DOM, проверяется в Node).
 * Уровень изотопа — самый длинный путь от родоначальника; внутри уровня изотопы упорядочены по среднему
 * положению родителей, чтобы стрелки меньше пересекались. Каждая связная цепочка — своя колонка
 * (если цепочки двух родоначальников сливаются, они рисуются вместе). Стрелка через уровень обходит
 * промежуточные рамки сбоку.
 * API: window.HLScheme = {layout(set, roots), svg(set, roots, opts), BOX}.
 */
(function (global) {
  'use strict';
  const BOX = { w: 136, h: 62, gx: 30, gy: 50, pad: 16, title: 26, lane: 26 };

  /** Связные компоненты набора (по связям родитель–дочерний): массив списков индексов в порядке набора. */
  function components(set) {
    const up = set.map((x, i) => i);
    const find = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
    set.forEach((x, i) => { for (const p of x.parents || []) if (p.j != null && p.j >= 0 && p.j < set.length) up[find(i)] = find(p.j); });
    const by = new Map();
    set.forEach((x, i) => { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(i); });
    return [...by.values()];
  }

  const MODE = { 'β-': 'β⁻', 'β+': 'β⁺', 'β+ & EC': 'β⁺/EC' };
  const modeRu = (m) => (m && MODE[m]) || m || '';
  /** Подпись стрелки: тип распада и доля ветви (если меньше 100 %). */
  const edgeLabel = (e) => (modeRu(e.mode) + (e.br < 0.9995 ? ' ' + pct(e.br) : '')).trim();
  /** Примерная ширина подписи шрифтом 11px. */
  const textW = (s) => Math.ceil(String(s).length * 6.4);
  /** Слишком длинную строку в рамке сжимаем до ширины рамки (cw — примерная ширина символа). */
  const fit = (s, cw) => (String(s).length * cw > BOX.w - 10 ? ` textLength="${BOX.w - 10}" lengthAdjust="spacingAndGlyphs"` : '');

  /**
   * Раскладка: {pos:[{x,y,depth}], edges:[{from,to,br,mode,skip}], groups:[{roots,x,w}], width, height}.
   * set — в топологическом порядке (родители раньше дочерних), как его строит HLCore.buildSet.
   */
  function layout(set, roots) {
    const pos = new Array(set.length);
    const groups = [];
    const sides = {};
    const rootIdx = (roots || []).map((r) => set.findIndex((x) => x.name === r));
    const comps = components(set).map((g) => {
      const rs = rootIdx.filter((i) => i >= 0 && g.includes(i)).map((i) => set[i].name);
      const first = rootIdx.findIndex((i) => g.includes(i));
      return { g, roots: rs.length ? rs : [set[g[0]].name], order: first < 0 ? 1e9 + g[0] : first };
    }).sort((a, b) => a.order - b.order);
    let x0 = BOX.pad, height = 0;
    for (const comp of comps) {
      const g = comp.g;
      const inG = new Set(g);
      const depth = {};
      for (const i of g) {
        let d = 0;
        for (const p of set[i].parents) if (inG.has(p.j) && depth[p.j] != null) d = Math.max(d, depth[p.j] + 1);
        depth[i] = d;
      }
      const rows = [];
      for (const i of g) (rows[depth[i]] = rows[depth[i]] || []).push(i);
      const col = {};
      const bary = (i) => {
        const ps = set[i].parents.filter((p) => inG.has(p.j) && col[p.j] != null);
        return ps.length ? ps.reduce((s, p) => s + col[p.j], 0) / ps.length : 0;
      };
      rows.forEach((row) => {
        row.sort((a, b) => bary(a) - bary(b) || a - b);
        row.forEach((i, k) => { col[i] = k - (row.length - 1) / 2; });
      });
      const maxCols = Math.max(...rows.map((r) => r.length));
      const minCol = Math.min(...g.map((i) => col[i]));
      const maxCol = Math.max(...g.map((i) => col[i]));
      // обходные стрелки (через уровень): у левого края — слева, у правого — справа; посередине — справа,
      // а если там уже есть стрелка на тех же уровнях — слева, чтобы не пересекались.
      // Место под дорожку — сама дорожка плюс подпись у неё.
      let laneL = 0, laneR = 0;
      const spans = { L: [], R: [] };
      for (const i of g) for (const p of set[i].parents) {
        if (!inG.has(p.j) || depth[i] - depth[p.j] < 2) continue;
        const a = depth[p.j], b = depth[i], m = (col[p.j] + col[i]) / 2;
        const busy = (sd) => spans[sd].some(([x, y]) => a < y && x < b);
        const side = m < 0 ? 'L' : m > 0 ? 'R' : busy('R') && !busy('L') ? 'L' : 'R';
        spans[side].push([a, b]);
        sides[p.j + '>' + i] = side;
        const need = BOX.lane + 8 + textW(edgeLabel(p));
        if (side === 'L') laneL = Math.max(laneL, need); else laneR = Math.max(laneR, need);
      }
      const gw = (maxCol - minCol + 1) * BOX.w + (maxCol - minCol) * BOX.gx;
      const span = Math.max(gw, maxCols * BOX.w + (maxCols - 1) * BOX.gx);
      const cx = x0 + laneL + span / 2;
      for (const i of g) pos[i] = { x: cx + col[i] * (BOX.w + BOX.gx) - BOX.w / 2, y: BOX.pad + BOX.title + depth[i] * (BOX.h + BOX.gy), depth: depth[i], col: col[i], g: groups.length };
      height = Math.max(height, BOX.pad + BOX.title + rows.length * (BOX.h + BOX.gy) - BOX.gy + BOX.pad);
      const w = laneL + span + laneR;
      groups.push({ roots: comp.roots, root: comp.roots[0], x: x0, w });
      x0 += w + BOX.gx * 2;
    }
    const edges = [];
    set.forEach((x, i) => {
      if (!pos[i]) return;
      for (const p of x.parents) {
        if (!pos[p.j]) continue;
        const skip = pos[i].depth - pos[p.j].depth >= 2;
        edges.push({ from: p.j, to: i, br: p.br, mode: p.mode, skip, side: skip ? sides[p.j + '>' + i] || 'R' : '' });
      }
    });
    return { pos, edges, groups, width: Math.max(x0 - BOX.gx * 2 + BOX.pad, 2 * BOX.pad + BOX.w), height: Math.max(height, 2 * BOX.pad + BOX.title + BOX.h) };
  }

  const xesc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r1 = (v) => Math.round(v * 10) / 10;
  function pct(br) {
    const v = br * 100;
    if (v > 0 && v < 0.01) {
      const [m, e] = v.toExponential(1).split('e');
      return m.replace('.', ',').replace(/,0$/, '') + '·10' + supNum(e) + ' %';
    }
    const s = v >= 99.95 ? '100' : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
    return s.replace('.', ',').replace(/,0+$/, '').replace(/(,\d*?)0+$/, '$1') + ' %';
  }
  const SUP = { '-': '⁻', '+': '', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const supNum = (e) => String(Number(e)).split('').map((c) => SUP[c] != null ? SUP[c] : c).join('');
  /** «4,46800E9 лет» → «4,468·10⁹ лет» (для подписей в рамках). */
  const prettyE = (s) => String(s).replace(/(\d+(?:,\d+)?)E([+-]?\d+)/g, (m, a, e) => a.replace(/(,\d*?)0+$/, '$1').replace(/,$/, '') + '·10' + supNum(e));

  // Цвета для отдельного файла .svg (на странице цвета берутся из темы через классы)
  const FILE_STYLE = '.sch-title{font:600 13px sans-serif;fill:#4e5864}.sch-edge{fill:none;stroke:#8d96a3;stroke-width:1.4}' +
    '.sch-head{fill:#8d96a3}.sch-lbl{font:11px sans-serif;fill:#4e5864}.sch-box{fill:#fff;stroke:#b4bcc6;stroke-width:1.2}' +
    '.sch-node.has-a .sch-box{fill:#edf1fd;stroke:#bccaf4}.sch-node.stable .sch-box{fill:#f4f6f9;stroke:#b4bcc6;stroke-dasharray:4 3}' +
    '.sch-node.target .sch-box{stroke:#2a4fd7;stroke-width:2.4}.sch-name{font:600 14px sans-serif;fill:#1c2127}' +
    '.sch-sub{font:11.5px sans-serif;fill:#4e5864}.sch-act{font:600 11.5px sans-serif;fill:#2443b6}';

  /**
   * SVG-картинка схемы. opts: {fmtT(T)→строка T½, values: [строка активности или ''] по индексам набора,
   * target: имя целевого изотопа, standalone: true — встроить цвета для отдельного файла}.
   * Возвращает {svg, width, height, layout}.
   */
  function svg(set, roots, opts) {
    const o = opts || {};
    const L = layout(set, roots);
    const W = Math.ceil(L.width), H = Math.ceil(L.height);
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="scheme" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Схема распада: ${xesc((roots || []).join(', '))}">`);
    if (o.standalone) out.push(`<style>${FILE_STYLE}</style><rect width="100%" height="100%" fill="#ffffff"/>`);
    out.push('<defs><marker id="schArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sch-head" d="M0,0L10,5L0,10z"/></marker></defs>');
    for (const g of L.groups) {
      const t = (g.roots.length > 1 ? 'Цепочки ' : 'Цепочка ') + g.roots.join(', ');
      out.push(`<text class="sch-title" x="${r1(g.x + g.w / 2)}" y="${BOX.pad + 13}" text-anchor="middle">${xesc(t)}</text>`);
    }
    // обычные стрелки — из середины низа родителя в середину верха дочернего;
    // через уровень — из бока родителя в бок дочернего по обходной дорожке
    const down = L.edges.filter((e) => !e.skip);
    const outCount = {}, outSeen = {};
    for (const e of down) outCount[e.from] = (outCount[e.from] || 0) + 1;
    // подписи стрелок: место ищем вдоль кривой так, чтобы подпись не наезжала на другие подписи и рамки
    const taken = L.pos.filter(Boolean).map((p) => [p.x - 2, p.x + BOX.w + 2, p.y - 2, p.y + BOX.h + 2]);
    const hit = (r) => taken.some((q) => r[0] < q[1] && q[0] < r[1] && r[2] < q[3] && q[2] < r[3]);
    const bez = (c, t) => {
      const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [k[0] * c[0] + k[1] * c[2] + k[2] * c[4] + k[3] * c[6], k[0] * c[1] + k[1] * c[3] + k[2] * c[5] + k[3] * c[7]];
    };
    /** c — опорные точки кривой [x1,y1, cx1,cy1, cx2,cy2, x2,y2]; side — сторона подписи по умолчанию (1 — справа). */
    const label = (e, c, side, ts) => {
      const s = edgeLabel(e); if (!s) return;
      const w = textW(s);
      let best = null;
      search: for (const t of ts) {
        for (const sd of [side, -side]) {
          const [px, py] = bez(c, t);
          const x = px + sd * 6, y = py + 4;
          const r = sd > 0 ? [x, x + w, y - 10, y + 3] : [x - w, x, y - 10, y + 3];
          const cand = { x, y, sd, r };
          if (!best) best = cand;
          if (!hit(r)) { best = cand; break search; }
        }
      }
      taken.push(best.r);
      out.push(`<text class="sch-lbl" x="${r1(best.x)}" y="${r1(best.y)}" text-anchor="${best.sd > 0 ? 'start' : 'end'}">${xesc(s)}</text>`);
    };
    const skipLabels = [];
    for (const e of L.edges) {
      const a = L.pos[e.from], b = L.pos[e.to];
      if (e.skip) {
        const left = e.side === 'L';
        const x1 = left ? a.x : a.x + BOX.w, y1 = a.y + BOX.h / 2;
        const x2 = left ? b.x - 1 : b.x + BOX.w + 1, y2 = b.y + BOX.h / 2;
        // крайняя рамка на пути: обходим её
        let edge = left ? Math.min(x1, x2) : Math.max(x1, x2);
        L.pos.forEach((p) => { if (p && p.g === a.g && p.depth > a.depth && p.depth < b.depth) edge = left ? Math.min(edge, p.x) : Math.max(edge, p.x + BOX.w); });
        const lane = edge + (left ? -1 : 1) * (BOX.lane - 6);
        // кубическая кривая с опорными точками на одной вертикали доходит до 3/4 расстояния до неё
        const cxp = x1 + (lane - x1) / 0.75;
        out.push(`<path class="sch-edge" d="M${r1(x1)},${r1(y1)} C${r1(cxp)},${r1(y1)} ${r1(cxp)},${r1(y2)} ${r1(x2)},${r1(y2)}" marker-end="url(#schArrow)"/>`);
        skipLabels.push([e, [x1, y1, cxp, y1, cxp, y2, x2, y2], left ? -1 : 1]);
        continue;
      }
      const k = outSeen[e.from] = (outSeen[e.from] || 0) + 1;
      const n = outCount[e.from];
      const x1 = a.x + BOX.w / 2 + (n > 1 ? (k - (n + 1) / 2) * 18 : 0), y1 = a.y + BOX.h;
      const x2 = b.x + BOX.w / 2, y2 = b.y - 1;
      const dy = (y2 - y1) / 2;
      out.push(`<path class="sch-edge" d="M${r1(x1)},${r1(y1)} C${r1(x1)},${r1(y1 + dy)} ${r1(x2)},${r1(y2 - dy)} ${r1(x2)},${r1(y2)}" marker-end="url(#schArrow)"/>`);
      label(e, [x1, y1, x1, y1 + dy, x2, y2 - dy, x2, y2], x2 < x1 - 1 ? -1 : 1, [0.5, 0.35, 0.65, 0.22, 0.8]);
    }
    // у обходных стрелок подпись — у самой дальней точки дуги
    for (const [e, c, sd] of skipLabels) label(e, c, sd, [0.5, 0.4, 0.6, 0.3, 0.7]);
    set.forEach((x, i) => {
      const p = L.pos[i]; if (!p) return;
      const stable = !(x.lambda > 0);
      const val = o.values && o.values[i] ? prettyE(o.values[i]) : '';
      const cls = ['sch-node', stable ? 'stable' : '', val ? 'has-a' : '', o.target && o.target === x.name ? 'target' : ''].filter(Boolean).join(' ');
      const cx = r1(p.x + BOX.w / 2);
      const T = stable ? 'стабильный' : prettyE(o.fmtT ? o.fmtT(x.T) : String(x.T));
      // ветви, которых нет на схеме: спонтанное деление и дочерние, которых нет в базе
      const lost = stable ? [] : (x.daughters || []).filter((d) => !set.some((y) => y.name === d.name));
      const sf = lost.find((d) => d.name === 'SF');
      const sub = T + (sf && sf.br >= 1e-4 ? ' · SF ' + pct(sf.br) : '');
      const tip = x.name + (stable ? ', стабильный' : ', T½ = ' + T) +
        lost.map((d) => (d.name === 'SF' ? '; спонтанное деление ' : '; ' + modeRu(d.mode) + ' → ' + d.name + ' (нет в базе) ') + pct(d.br)).join('') +
        (val ? '; ' + val : '');
      out.push(`<g class="${cls}"><title>${xesc(tip)}</title>` +
        `<rect class="sch-box" x="${r1(p.x)}" y="${r1(p.y)}" width="${BOX.w}" height="${BOX.h}" rx="9"/>` +
        `<text class="sch-name" x="${cx}" y="${r1(p.y + 21)}" text-anchor="middle">${xesc(x.name)}</text>` +
        `<text class="sch-sub" x="${cx}" y="${r1(p.y + 37)}" text-anchor="middle"${fit(sub, 6.1)}>${xesc(sub)}</text>` +
        (val ? `<text class="sch-act" x="${cx}" y="${r1(p.y + 53)}" text-anchor="middle"${fit(val, 6.6)}>${xesc(val)}</text>` : '') + '</g>');
    });
    out.push('</svg>');
    return { svg: out.join(''), width: W, height: H, layout: L };
  }

  const api = { layout, svg, components, pct, prettyE, modeRu, edgeLabel, BOX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.HLScheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
