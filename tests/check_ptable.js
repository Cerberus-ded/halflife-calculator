/* Проверка web/ptable.js без браузера: разрешённые изотопы поля (isoNames, data-pt-scope="all", select, datalist),
 * доступность элементов, порядок изотопов, разбор названий и разметка окна в двух режимах.
 * Окно и щелчки проверяет desktop/test/e2e-ptable.js. Запуск: node tests/check_ptable.js */
'use strict';
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'nucdb.js'));
globalThis.HLCore = require(path.join(WEB, 'core.js'));
require(path.join(WEB, 'elements.js'));
require(path.join(WEB, 'ptable.js'));
const T = globalThis.HLPtable;
const DB = globalThis.NUCDB;
let fails = 0, n = 0;
const check = (c, m) => { n++; if (!c) { fails++; console.log('  ✗ ' + m); } };

console.log('Таблица Менделеева: выбор изотопа (ptable.js)');
check(T && ['html', 'mount', 'pick', 'namesFor', 'allowedBySymbol', 'isotopesOf', 'canon', 'enhance'].every((k) => typeof T[k] === 'function'), 'API модуля');

// разрешённые изотопы поля
const radio = Object.keys(DB).filter((k) => DB[k][0] != null);
const all = T.namesFor(null);
check(all.length === radio.length && all.every((k) => DB[k][0] != null), `без поля — все радиоактивные (${all.length})`);
check(T.namesFor({ isoNames: ['Ac-225', 'Bi-209', 'Fr-221'], dataset: {} }).join() === 'Ac-225,Fr-221', 'isoNames: стабильный Bi-209 отброшен, порядок сохранён');
check(T.namesFor({ isoNames: [], dataset: { ptScope: 'all' } }).length === radio.length, 'data-pt-scope="all" — вся база');
const sel = { tagName: 'SELECT', dataset: {}, options: [{ value: '' }, { value: 'Th-229' }, { value: 'Ra-225' }] };
check(T.namesFor(sel).join() === 'Th-229,Ra-225', 'select: варианты без пустого');
const withList = { tagName: 'INPUT', dataset: {}, list: { options: [{ value: 'Cs-137' }, { value: 'Ba-137m' }] } };
check(T.namesFor(withList).join() === 'Cs-137,Ba-137m', 'input с datalist: варианты списка');
check(T.namesFor({ tagName: 'INPUT', dataset: {} }).length === radio.length, 'просто поле — вся база');

// элементы и изотопы
const av = T.allowedBySymbol(['Th-229', 'Th-228', 'Ra-225', 'Ac-225']);
check(av.Th === 2 && av.Ra === 1 && av.Ac === 1 && !av.U, 'число изотопов по элементам');
const am = T.isotopesOf('Am', all);
check(am.indexOf('Am-241') < am.indexOf('Am-242m') && am.indexOf('Am-242m') < am.indexOf('Am-243') && am.every((k) => k.startsWith('Am-')), 'изотопы америция по массе: ' + am.slice(0, 6).join(', '));

// разбор названий
const cases = { 'Cs-137': 'Cs-137', 'cs137': 'Cs-137', '137Cs': 'Cs-137', 'цезий-137': 'Cs-137', '137 цезия': 'Cs-137', 'технеций-99м': 'Tc-99m', 'кобальт-60': 'Co-60', 'цезий': null, 'абв': null, '': null };
for (const [q, want] of Object.entries(cases)) check(T.canon(q) === want, `«${q}» → ${T.canon(q)}, нужно ${want}`);

// разметка окна
const multi = T.html({ mode: 'multi' });
check((multi.match(/class="pt-el/g) || []).length === 118 && /id="ptSearch"/.test(multi) && /id="ptIso"/.test(multi) && /id="ptStatus"/.test(multi), 'шаг 1: 118 клеток, поиск, изотопы, состояние');
check(/ещё раз, чтобы убрать/.test(multi) && /data-mode="multi"/.test(multi), 'шаг 1: подсказка о повторном нажатии');
const one = T.html({ mode: 'single', names: ['Th-229', 'Ra-225', 'Ac-225'] });
const enabled = (one.match(/<button type="button" class="pt-el"[^>]*data-sym="(\w+)"/g) || []).map((s) => s.match(/data-sym="(\w+)"/)[1]);
check(enabled.join() === 'Ra,Ac,Th', 'поле с набором: доступны только Ra, Ac, Th — ' + enabled.join());
check(/ещё раз, чтобы снять выбор/.test(one) && /data-mode="single"/.test(one), 'поле: подсказка о снятии выбора');
check(/Здесь не выбрать/.test(one), 'недоступные элементы объяснены в подсказке');

console.log(`${fails ? '✗' : '✓'} Таблица Менделеева: проверок ${n}, ошибок ${fails}, замечаний 0`);
process.exitCode = fails ? 1 : 0;
