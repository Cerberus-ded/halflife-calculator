/* Проверка web/elements.js: 118 элементов, у каждого своё место в таблице, все элементы базы нуклидов названы,
 * разбор русских названий («цезий-137», «137 цезий», «технеций-99м», родительный падеж) даёт изотопы из базы.
 * Запуск: node tests/check_elements.js */
'use strict';
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'nucdb.js'));
require(path.join(WEB, 'elements.js'));
const C = require(path.join(WEB, 'core.js'));
const E = globalThis.HLElements;
const DB = globalThis.NUCDB;
let fails = 0, n = 0;
const check = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };

console.log('Элементы и русские названия (elements.js)');
check(E.list.length === 118 && E.list.every((e, i) => e.z === i + 1), '118 элементов по порядку');
check(new Set(E.list.map((e) => e.sym)).size === 118 && new Set(E.list.map((e) => e.ru)).size === 118, 'символы и названия не повторяются');
const cells = new Set();
for (const e of E.list) {
  const p = E.pos(e.z);
  const ok = p.row >= 1 && p.row <= 10 && p.row !== 8 && p.col >= 1 && p.col <= 18;
  check(ok, `место ${e.sym}: ${p.row}:${p.col}`);
  const k = p.row + ':' + p.col; check(!cells.has(k), `место занято дважды: ${k} (${e.sym})`); cells.add(k);
}
// опорные места длинной формы
const want = { H: '1:1', He: '1:18', Li: '2:1', B: '2:13', Ne: '2:18', Na: '3:1', Al: '3:13', K: '4:1', Sc: '4:3', Zn: '4:12', Kr: '4:18',
  Cs: '6:1', Ba: '6:2', La: '9:3', Lu: '9:17', Hf: '6:4', Rn: '6:18', Fr: '7:1', Ac: '10:3', Lr: '10:17', Rf: '7:4', Og: '7:18' };
for (const [s, w] of Object.entries(want)) { const p = E.pos(E.bySym[s].z); check(p.row + ':' + p.col === w, `${s}: ${p.row}:${p.col}, нужно ${w}`); }
// столбцы групп (каждая колонка 1–18 в периодах 4–7 занята ровно одним элементом)
for (const row of [4, 5, 6, 7]) for (let col = 1; col <= 18; col++) if (!(row >= 6 && col === 3)) check(cells.has(row + ':' + col), `пустая клетка ${row}:${col}`);

// все элементы базы названы
const dbSyms = new Set(Object.keys(DB).map((k) => k.slice(0, k.indexOf('-'))));
for (const s of dbSyms) check(!!E.bySym[s], `в базе есть ${s}, а в таблице нет`);

// разбор
const cases = {
  'цезий-137': 'Cs-137', 'Цезий 137': 'Cs-137', 'ЦЕЗИЙ137': 'Cs-137', '137 цезий': 'Cs-137', '137-цезий': 'Cs-137', 'цезия-137': 'Cs-137',
  'технеций-99м': 'Tc-99m', 'Технеций 99m': 'Tc-99m', '99м технеций': 'Tc-99m', 'йод-131': 'I-131', 'иод 131': 'I-131', 'Йода-125': 'I-125',
  'радон-222': 'Rn-222', 'радия-226': 'Ra-226', 'свинец 210': 'Pb-210', 'свинца-210': 'Pb-210', 'серы-35': 'S-35', 'фосфор-32': 'P-32',
  'железо 59': 'Fe-59', 'железа-55': 'Fe-55', 'меди-64': 'Cu-64', 'ртуть-203': 'Hg-203', 'золото-198': 'Au-198', 'стронций — 90': 'Sr-90',
  'углерод-14': 'C-14', 'водород-3': 'H-3', 'тритий': 'H-3', 'Трития': 'H-3', 'америций-241': 'Am-241', 'америция-242м': 'Am-242m', 'уран-238': 'U-238',
  'плутоний 239': 'Pu-239', 'торий-229': 'Th-229', 'актиний-225': 'Ac-225', 'калифорний-252': 'Cf-252', 'Cs-137': 'Cs-137', 'u235': 'U-235',
};
for (const [t, w] of Object.entries(cases)) {
  const r = E.parse(t);
  const got = r && r.a ? C.normalizeName(r.sym + '-' + r.a + r.meta) : null;
  check(got === w, `«${t}» → ${got}, нужно ${w}`);
}
const only = { 'цезий': 'Cs', 'Цезия': 'Cs', 'Cs': 'Cs', 'cs': 'Cs', 'йод': 'I', 'ртуть': 'Hg', 'платина': 'Pt', 'ёж': null, 'abc': null, '': null, 'Xx-999': null };
for (const [t, w] of Object.entries(only)) {
  const r = E.parse(t);
  check(w === null ? r === null : r && r.sym === w && r.a === undefined, `«${t}» → ${JSON.stringify(r)}, нужно ${w}`);
}
// родительный падеж не путает элементы
const words = new Map();
for (const e of E.list) for (const f of [e.ru.toLowerCase().replace(/ё/g, 'е')]) words.set(f, e.sym);
for (const [w, s] of words) check(E.symbolOf(w) === s, `«${w}» → ${E.symbolOf(w)}, нужно ${s}`);

console.log(`${fails ? '✗' : '✓'} Элементы: проверок ${n}, ошибок ${fails}`);
process.exit(fails ? 1 : 0);
