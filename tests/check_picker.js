/* Проверка web/picker.js: изотоп по-русски и любой записью (resolve) и подсказки в полях (suggest).
 * Запуск: node tests/check_picker.js */
'use strict';
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'nucdb.js'));
require(path.join(WEB, 'elements.js'));
globalThis.HLCore = require(path.join(WEB, 'core.js'));
require(path.join(WEB, 'picker.js'));
const P = globalThis.HLPicker;
const DB = globalThis.NUCDB;
let fails = 0, n = 0;
const check = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };
const name = (t, o) => P.resolve(t, o).name;

console.log('Выбор изотопа (picker.js)');
// любые записи одного изотопа
for (const [t, want] of [
  ['Th-229', 'Th-229'], ['th229', 'Th-229'], ['229Th', 'Th-229'], ['Th 229', 'Th-229'], ['торий-229', 'Th-229'], ['Торий 229', 'Th-229'],
  ['229 тория', 'Th-229'], ['тория-229', 'Th-229'], ['актиний-225', 'Ac-225'], ['225 актиния', 'Ac-225'], ['технеций-99м', 'Tc-99m'],
  ['Tc-99m', 'Tc-99m'], ['99mTc', 'Tc-99m'], ['цезий-137', 'Cs-137'], ['йод-131', 'I-131'], ['иод-131', 'I-131'], ['тритий', 'H-3'],
  ['237 нептуния', 'Np-237'], ['99 молибдена', 'Mo-99'], ['радон 222', 'Rn-222'], ['свинец-212', 'Pb-212'], ['212 свинца', 'Pb-212'],
  ['  уран-238 ', 'U-238'], ['протактиний-234м', 'Pa-234m'],
]) check(name(t) === want, `«${t}» → ${want}, получено ${JSON.stringify(P.resolve(t))}`);
check(P.resolve('').empty && P.resolve('   ').empty, 'пустое поле — «не выбран»');
check(/нет в базе/.test(P.resolve('Xx-999').error || ''), 'неизвестная запись — ошибка');
check(/какой изотоп/.test(P.resolve('радий').error || ''), 'только элемент без набора — просит массовое число');
check(name('Pb-208') === 'Pb-208', 'стабильный изотоп распознаётся (решает поле)');

// с набором расчёта
const allowed = ['Th-229', 'Ra-225', 'Ac-225', 'Fr-221', 'At-217', 'Bi-213', 'Po-213', 'Tl-209', 'Pb-209', 'Th-228', 'Ra-224', 'Rn-220'];
check(name('актиний', { allowed }) === 'Ac-225', '«актиний» при одном Ac в наборе → Ac-225');
check(name('Ac', { allowed }) === 'Ac-225' && name('актиния', { allowed }) === 'Ac-225', '«Ac», «актиния» → Ac-225');
const ra = P.resolve('радий', { allowed });
check(!ra.name && /Радий: какой изотоп\? В расчёте: Ra-225, Ra-224/.test(ra.error || ''), '«радий» при двух Ra — уточнить: ' + ra.error);
const ra226 = P.resolve('Ra-226', { allowed });
check(!ra226.name && /Ra-226 нет в этом расчёте/.test(ra226.error || ''), 'чужой изотоп — ошибка: ' + ra226.error);
check(/Цезий \(Cs\) нет в этом расчёте/.test(P.resolve('цезий', { allowed }).error || ''), 'элемент не из набора — ошибка');
check(name('радий-224', { allowed }) === 'Ra-224', '«радий-224» из набора');

// подсказки
const all = P.allRadioactive();
check(all.length > 1000 && all.every((x) => DB[x][0] != null), `все радиоактивные: ${all.length}`);
check(all.indexOf('H-3') < all.indexOf('C-14') && all.indexOf('C-14') < all.indexOf('Cs-137'), 'порядок по Z');
const s = (q, names) => P.suggest(q, names || all, 60);
check(s('рад').every((x) => /^(Ra|Rn)-/.test(x)) && s('рад').some((x) => x.startsWith('Ra-')) && s('рад').some((x) => x.startsWith('Rn-')), '«рад» → радий и радон');
check(s('ra2').length > 0 && s('ra2').every((x) => /^Ra-2/.test(x)), '«ra2» → Ra-2xx');
check(s('радий 22').length > 0 && s('радий 22').every((x) => /^Ra-22/.test(x)), '«радий 22» → Ra-22x');
check(s('радия 22').every((x) => /^Ra-22/.test(x)), 'родительный падеж: «радия 22»');
check(s('225').includes('Ac-225') && s('225').includes('Ra-225') && s('225').every((x) => /-225/.test(x)), '«225» → все с A = 225');
check(s('99м').includes('Tc-99m') && s('99м').every((x) => /-99m$/.test(x)) && s('99m').join() === s('99м').join(), '«99м» → изомеры с A = 99, среди них Tc-99m');
check(s('c')[0] === 'C-14' || s('c')[0].startsWith('C-'), '«c» — сначала углерод: ' + s('c').slice(0, 3));
check(s('Cs-137')[0] === 'Cs-137' && s('цезий-137')[0] === 'Cs-137', 'точная запись первой');
check(s('актиний 22', allowed).join() === 'Ac-225', 'подсказки только из набора');
check(s('йод 13').every((x) => /^I-13/.test(x)) && s('йод 13').length > 0, '«йод 13» → I-13x');
check(s('zzz').length === 0, 'нет совпадений — пустой список');
check(s('').length === 60 && P.suggest('', allowed).length === allowed.length, 'пустой запрос — весь (короткий) список');
check(/^Актиний-225 · /.test(P.label('Ac-225')) && /^Технеций-99m · /.test(P.label('Tc-99m')), 'подпись: ' + P.label('Ac-225'));

// перенесённые из app.js помощники
check(P.nameFromWords('цезий-137') === 'Cs-137' && P.nameFromWords('Cs') === null, 'nameFromWords');
check(P.isotopesOf('Ra').includes('Ra-226') && P.isotopesOf('Ra').every((x) => x.startsWith('Ra-')), 'isotopesOf');
check(/Радий: какой изотоп/.test(P.unknownText('радий')) && /нет в базе/.test(P.unknownText('qq')), 'unknownText');

console.log(`${fails ? '✗' : '✓'} выбор изотопа: проверок ${n}, ошибок ${fails}`);
process.exitCode = fails ? 1 : 0;
