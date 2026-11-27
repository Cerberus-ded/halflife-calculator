/* Проверка кода Maple без Maple (tests/maple_check.py):
 *  - код Maple каждого примера разбирается без ошибок, численное решение (как dsolve stiff = true) совпадает
 *    с точным (матричная экспонента, 40 знаков), числа «# программа: …» — с точным решением;
 *  - испорченный код ловится: нет «;», лишняя скобка, неизвестный параметр dsolve, нет начального условия,
 *    не определена постоянная распада, изменённый коэффициент (числа программы уже не сходятся).
 * Нужны python3 с sympy, mpmath, numpy, scipy — без них набор пропускается.
 * Запуск: node tests/check_maple.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { F, P, ok, warn, done, modelFromPreset } = require('./common');

console.log('Код Maple: синтаксис и числа (без Maple)');
const CHECKER = path.join(__dirname, 'maple_check.py');
const havePy = spawnSync('python3', ['-c', 'import sympy, mpmath, numpy, scipy'], { encoding: 'utf8' }).status === 0;
if (!havePy) {
  warn('python3 с sympy/mpmath/numpy/scipy не найден — проверка Maple пропущена');
  process.exitCode = done('Код Maple') ? 1 : 0;
  return;
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-maple-'));
function check(name, text) {
  const file = path.join(dir, name + '.mpl');
  fs.writeFileSync(file, text);
  const r = spawnSync('python3', [CHECKER, file, '--json'], { encoding: 'utf8', timeout: 120000 });
  try { return JSON.parse(r.stdout); } catch (e) { return { ok: false, errors: ['проверка не запустилась: ' + (r.stderr || r.error || '').toString().split('\n').slice(-2).join(' ')] }; }
}

// 1. Все примеры: код в порядке, числа совпадают
let base = null;
for (const p of P) {
  const m = modelFromPreset(p, true);
  const text = F.maple(m);
  const r = check(p.id, text);
  ok(r.ok, `${p.id}: ${r.ok ? 'в порядке' : (r.errors || []).join('; ') || 'числа: ' + JSON.stringify(r.worst)}`);
  ok(r.has_program, `${p.id}: в файле есть числа программы для сравнения`);
  ok(r.rows && r.rows.length === m.set.length, `${p.id}: напечатаны все изотопы (${r.rows ? r.rows.length : 0} из ${m.set.length})`);
  if (r.worst) ok(r.worst.numeric < 1e-8 && r.worst.program < 1e-8, `${p.id}: отличие dsolve ${r.worst.numeric.toExponential(1)}, программы ${r.worst.program.toExponential(1)}`);
  if (!base && /Bi212|Bi213/.test(text)) base = { p, text };
}

// 2. Испорченный код — ошибка замечена
const t = base.text;
const firstEq = t.match(/^ *diff\(N(\w+)\(t\), t\) = [^\n]*$/m);
const lam = t.match(/^(l\w+) := ([^\n]+);/m);
const broken = [
  ['нет «;» после постоянной', t.replace(lam[0], lam[0].slice(0, -1)), /без «;» или «:»|непонятный оператор|не разбирается/],
  ['лишняя скобка', t.replace(lam[0], `${lam[1]} := (${lam[2]};`), /скобк/],
  ['неизвестный параметр dsolve', t.replace('stiff = true', 'stif = true'), /неизвестный параметр dsolve: stif/],
  ['нет начального условия', t.replace(new RegExp(`,?\\s*N${firstEq[1]}\\(0\\) = [^,:;]+`), ''), new RegExp(`нет начального условия для N${firstEq[1]}`)],
  ['не определена постоянная', t.replace(new RegExp(`^${lam[1]} := [^\n]*\n`, 'm'), ''), new RegExp(`не определены: ${lam[1]}|неизвестные имена: ${lam[1]}`)],
];
for (const [tag, text, re] of broken) {
  if (!ok(text !== t, `${tag}: код изменён`)) continue;
  const r = check('broken', text);
  ok(!r.ok && (r.errors || []).some((e) => re.test(e)), `${tag}: ${(r.errors || []).join('; ') || 'ошибка не замечена'}`);
}
// изменённый коэффициент ветвления: синтаксис в порядке, а числа программы — нет
const br = t.match(/\+ (0\.\d+)\*l\w+\*N\w+\(t\)/);
if (ok(!!br, 'в примере есть коэффициент ветвления')) {
  const r = check('coef', t.replace(br[0], br[0].replace(br[1], (Number(br[1]) * 0.9).toFixed(6))));
  ok(!r.ok && !(r.errors || []).length && r.worst.program > 1e-6, `изменённый коэффициент: числа не совпали (${r.worst ? r.worst.program.toExponential(1) : '—'})`);
}

fs.rmSync(dir, { recursive: true, force: true });
process.exitCode = done('Код Maple') ? 1 : 0;
