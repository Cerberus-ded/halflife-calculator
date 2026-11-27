/* Проверка web/scheme.js: раскладка схемы распада (рамки не перекрываются, стрелки идут вниз,
 * подписи не выходят за картинку) и содержимое SVG. Запуск: node tests/check_scheme.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { WEB, C, P, ok, done } = require('./common');
const S = require(path.join(WEB, 'scheme.js'));
require(path.join(WEB, 'xlsx.js'));
const T = require(path.join(WEB, 'tools.js'));

console.log('Схема распада (scheme.js)');
const B = S.BOX;
const overlap = (a, b) => a.x < b.x + B.w && b.x < a.x + B.w && a.y < b.y + B.h && b.y < a.y + B.h;

// ---- форматирование ----
ok(S.pct(1) === '100 %', 'доля 1 → 100 %');
ok(S.pct(0.0214) === '2,14 %', `доля 0,0214 → ${S.pct(0.0214)}`);
ok(S.pct(0.9786) === '97,9 %', `доля 0,9786 → ${S.pct(0.9786)}`);
ok(S.pct(0.00012) === '0,012 %', `доля 1,2E-4 → ${S.pct(0.00012)}`);
ok(S.pct(3.7e-5) === '3,7·10⁻³ %', `доля 3,7E-5 → ${S.pct(3.7e-5)}`);
ok(S.prettyE('4,46800E9 лет') === '4,468·10⁹ лет', `T½ U-238 в рамке: ${S.prettyE('4,46800E9 лет')}`);
ok(S.prettyE('A = 1,23E-12 Бк') === 'A = 1,23·10⁻¹² Бк', 'отрицательная степень');
ok(S.prettyE('30,08 лет') === '30,08 лет', 'обычное число не меняется');
ok(S.modeRu('β-') === 'β⁻' && S.modeRu('β+ & EC') === 'β⁺/EC' && S.modeRu('α') === 'α', 'обозначения типов распада');

// ---- раскладка на многих цепочках ----
const cases = [['U-238'], ['Th-232'], ['U-235'], ['Np-237'], ['Cf-252'], ['Mo-99'], ['Ac-225'], ['Tc-99m', 'Mo-99'], ['Ac-225', 'Cs-137'], ['Ra-226', 'Th-228', 'Sr-90']];
for (const p of P) cases.push(p.roots);
let bad = [];
for (const roots of cases) {
  const set = C.buildSet(roots, {});
  const L = S.layout(set, roots);
  const tag = roots.join('+');
  if (!set.every((x, i) => L.pos[i])) bad.push(tag + ': не у всех изотопов есть место');
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) if (overlap(L.pos[i], L.pos[j])) bad.push(`${tag}: ${set[i].name} и ${set[j].name} перекрываются`);
  const nPar = set.reduce((s, x) => s + x.parents.length, 0);
  if (L.edges.length !== nPar) bad.push(`${tag}: стрелок ${L.edges.length}, связей ${nPar}`);
  for (const e of L.edges) {
    if (!(L.pos[e.to].depth > L.pos[e.from].depth)) bad.push(`${tag}: стрелка ${set[e.from].name}→${set[e.to].name} не вниз`);
    if (e.skip !== (L.pos[e.to].depth - L.pos[e.from].depth >= 2) || (e.skip && !/^[LR]$/.test(e.side))) bad.push(`${tag}: обход ${set[e.from].name}→${set[e.to].name}`);
  }
  for (const p of L.pos) if (p.x < 0 || p.y < 0 || p.x + B.w > L.width + 0.01 || p.y + B.h > L.height + 0.01) bad.push(`${tag}: рамка за краем`);
  // каждая связная цепочка — своя колонка, колонки не пересекаются
  for (let a = 0; a < L.groups.length; a++) for (let b = a + 1; b < L.groups.length; b++) {
    const g = L.groups[a], h = L.groups[b];
    if (g.x < h.x + h.w && h.x < g.x + g.w) bad.push(`${tag}: колонки ${a} и ${b} пересекаются`);
  }
  // SVG: рамки, стрелки, подписи в пределах картинки
  const pic = S.svg(set, roots, { fmtT: C.fmtHalfLife, values: set.map(() => 'A = 1,000E6 Бк') });
  if ((pic.svg.match(/<g class="sch-node/g) || []).length !== set.length) bad.push(tag + ': число рамок в SVG');
  if ((pic.svg.match(/<path class="sch-edge"/g) || []).length !== L.edges.length) bad.push(tag + ': число стрелок в SVG');
  const lbls = [...pic.svg.matchAll(/<text class="sch-lbl" x="([\d.-]+)" y="([\d.-]+)" text-anchor="(start|end)">([^<]*)<\/text>/g)];
  for (const m of lbls) {
    const x = Number(m[1]), w = m[4].length * 6.4;
    const x0 = m[3] === 'start' ? x : x - w, x1 = m[3] === 'start' ? x + w : x;
    if (x0 < -1 || x1 > pic.width + 1) bad.push(`${tag}: подпись «${m[4]}» за краем (${Math.round(x0)}…${Math.round(x1)} из ${pic.width})`);
  }
  if (/NaN|undefined/.test(pic.svg)) bad.push(tag + ': NaN/undefined в SVG');
}
ok(!bad.length, `раскладка ${cases.length} наборов: ` + (bad.slice(0, 6).join('; ') || 'всё в порядке'));

// ---- конкретные схемы ----
{
  const set = C.buildSet(['Ac-225'], {});
  const pic = S.svg(set, ['Ac-225'], { fmtT: C.fmtHalfLife, target: 'Bi-213' });
  ok(pic.svg.includes('>α 2,14 %<') && pic.svg.includes('>β⁻ 97,9 %<'), 'ветвление Bi-213: α 2,14 % и β⁻ 97,9 %');
  ok(pic.svg.includes('>β⁻ 0,012 %<'), 'редкая ветвь At-217 → Rn-217 подписана');
  ok(/<g class="sch-node target"><title>Bi-213/.test(pic.svg), 'целевой изотоп выделен');
  ok(/<g class="sch-node stable"><title>Bi-209, стабильный/.test(pic.svg), 'стабильный конец цепочки');
  ok(!pic.svg.includes('<style>'), 'на странице цвета берутся из темы (без встроенного стиля)');
  const file = S.svg(set, ['Ac-225'], { fmtT: C.fmtHalfLife, standalone: true }).svg;
  ok(file.includes('<style>') && file.includes('<rect width="100%" height="100%" fill="#ffffff"/>'), 'отдельный файл SVG — со своими цветами и белым фоном');
  ok(file.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'файл SVG с пространством имён');
}
{
  const set = C.buildSet(['Mo-99'], {});
  const L = S.layout(set, ['Mo-99']);
  const sk = L.edges.filter((e) => e.skip);
  ok(sk.length === 2 && new Set(sk.map((e) => e.side)).size === 2, 'Mo-99: две обходные стрелки по разные стороны');
  const pic = S.svg(set, ['Mo-99'], { fmtT: C.fmtHalfLife, values: ['A = 1E9 Бк', '', '', ''] });
  ok(pic.svg.includes('>β⁻ 12,3 %<') && pic.svg.includes('>β⁻ 87,7 %<'), 'Mo-99: ветви на Tc-99m и Tc-99');
  ok(pic.svg.includes('>A = 1·10⁹ Бк<'), 'активность в рамке, степень записана верхним индексом');
  ok((pic.svg.match(/class="sch-node has-a/g) || []).length === 1, 'с активностью выделена одна рамка');
}
{
  const set = C.buildSet(['Tc-99m', 'Mo-99'], {});
  const L = S.layout(set, ['Tc-99m', 'Mo-99']);
  ok(L.groups.length === 1 && L.groups[0].roots.join() === 'Tc-99m,Mo-99', 'слившиеся цепочки рисуются вместе');
  ok(S.svg(set, ['Tc-99m', 'Mo-99'], {}).svg.includes('>Цепочки Tc-99m, Mo-99<'), 'заголовок общей колонки');
  const two = C.buildSet(['Ac-225', 'Cs-137'], {});
  ok(S.layout(two, ['Ac-225', 'Cs-137']).groups.map((g) => g.root).join() === 'Ac-225,Cs-137', 'несвязанные цепочки — отдельные колонки по порядку');
}
{
  const set = C.buildSet(['Cf-252'], {});
  const pic = S.svg(set, ['Cf-252'], { fmtT: C.fmtHalfLife });
  ok(pic.svg.includes('2,647 лет · SF 3,1 %'), 'спонтанное деление Cf-252 указано в рамке');
  ok(/<title>U-238|<title>Cm-248, T½ = [^<]*спонтанное деление/.test(pic.svg), 'и во всплывающей подсказке');
  const esc = S.svg(set, ['Cf-252'], { values: set.map(() => 'A < 1 & "x"') }).svg;
  ok(esc.includes('A &lt; 1 &amp; &quot;x&quot;') && !esc.includes('A < 1'), 'текст в SVG экранируется');
}
{
  const empty = S.svg([], [], {});
  ok(empty.width > 0 && empty.height > 0 && empty.svg.endsWith('</svg>'), 'пустой набор не ломает картинку');
}

// ---- рисунок в протоколе .docx ----
(async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const blob = T.docx([{ h1: 'Протокол' }, { h2: 'Схема распада' }, { image: new Uint8Array(png), width: 400, height: 3000, alt: 'Схема <U-238>' }, { p: 'после' }], { title: 'Тест' });
  const file = path.join(os.tmpdir(), 'hl-test-scheme.docx');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const py = spawnSync('python3', ['-c', `import zipfile,sys,re,xml.dom.minidom as m
z=zipfile.ZipFile(sys.argv[1]); n=z.namelist()
for k in n:
  if k.endswith('.xml') or k.endswith('.rels'): m.parseString(z.read(k))
d=z.read('word/document.xml').decode(); r=z.read('word/_rels/document.xml.rels').decode(); t=z.read('[Content_Types].xml').decode()
cx,cy=map(int,re.search(r'<wp:extent cx="(\\d+)" cy="(\\d+)"',d).groups())
ok='word/media/image1.png' in n and z.read('word/media/image1.png')[:4]==b'\\x89PNG' and 'r:embed="rIdImg1"' in d and 'Target="media/image1.png"' in r and 'Extension="png"' in t and 'Схема &lt;U-238&gt;' in d
print('OK' if ok else 'BAD', cx, cy)`, file], { encoding: 'utf8' });
  const [st, cx, cy] = (py.stdout || '').trim().split(' ');
  ok(st === 'OK', '.docx с рисунком: ZIP, XML, связь и тип PNG ' + (py.stderr || '').trim().slice(0, 300));
  const maxH = (16838 - 2 * 1134) * 635 * 0.85;
  ok(Number(cy) <= maxH + 1 && Math.abs(Number(cx) / Number(cy) - 400 / 3000) < 1e-3, `высокая схема уменьшена под страницу с сохранением пропорций (${cx}×${cy} EMU)`);
  const plain = T.docx([{ p: 'x' }], {});
  const buf = Buffer.from(await plain.arrayBuffer()).toString('latin1');
  ok(!buf.includes('image/png') && !buf.includes('media/'), 'без рисунков протокол прежний (нет лишних частей)');
  process.exit(done('Схема распада') ? 1 : 0);
})();
