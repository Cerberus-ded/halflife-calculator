/* Проверка вывода формул (web/formulas.js) на всех примерах:
 *  - нет пустых подстановок (undefined, NaN);
 *  - Maple: все λ определены, у каждого уравнения есть начальное условие, скобки сбалансированы;
 *  - Python: сгенерированный скрипт запускается (нужны numpy и scipy) и даёт те же числа, что программа;
 *  - LaTeX: документ компилируется pdflatex (если установлен).
 * Запуск: node tests/check_formulas.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { C, F, P, ok, warn, done, modelFromPreset, rel } = require('./common');

console.log('Формулы: текст, Maple, LaTeX, Python');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-formulas-'));
const has = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
const havePy = has('python3', ['-c', 'import numpy, scipy']);
const haveTex = has('pdflatex', ['--version']);
if (!havePy) warn('python3 с numpy/scipy не найден — запуск Python-вывода пропущен');
if (!haveTex) warn('pdflatex не найден — компиляция LaTeX пропущена');

function balanced(s) {
  let d = 0;
  for (const ch of s.replace(/#.*$/gm, '').replace(/"[^"\n]*"/g, '')) {
    if (ch === '(' || ch === '{' || ch === '[') d++;
    if (ch === ')' || ch === '}' || ch === ']') d--;
    if (d < 0) return false;
  }
  return d === 0;
}

for (const p of P) {
  const tag = p.id;
  for (const withResult of [false, true]) {
    const m = modelFromPreset(p, withResult);
    const out = {};
    for (const fmt of ['text', 'maple', 'latex', 'python']) {
      try { out[fmt] = F[fmt](m); } catch (e) { ok(false, `${tag}: ${fmt}() без ошибок (${e.message})`); out[fmt] = ''; continue; }
      ok(typeof out[fmt] === 'string' && out[fmt].length > 100, `${tag}: ${fmt}() вернул текст`);
      ok(!/undefined|NaN|Infinity|\[object/.test(out[fmt]), `${tag}: ${fmt}() без undefined/NaN`);
    }
    for (const x of m.set) ok(out.text.includes(C.ident(x.name)), `${tag}: в тексте есть ${x.name}`);

    // Maple
    const mp = out.maple;
    ok(balanced(mp), `${tag}: Maple — скобки сбалансированы`);
    const defined = new Set([...mp.matchAll(/^(l\w+) :=/gm)].map((a) => a[1]));
    const used = new Set([...mp.matchAll(/\b(l[A-Z][a-z]?\d+\w*)\b/g)].map((a) => a[1]));
    for (const u of used) ok(defined.has(u), `${tag}: Maple — постоянная ${u} определена`);
    const eqN = [...mp.matchAll(/diff\((N\w+)\(t\), t\)/g)].map((a) => a[1]);
    const icN = [...mp.matchAll(/^\s+(N\w+)\(0\) =/gm)].map((a) => a[1]);
    ok(eqN.length === m.set.length && icN.length === m.set.length, `${tag}: Maple — по уравнению и НУ на каждый изотоп`);
    ok(eqN.every((n) => icN.includes(n)), `${tag}: Maple — у каждого уравнения есть начальное условие`);
    ok(/sol := dsolve\(\{EQ, IC\}, numeric, stiff = true/.test(mp), `${tag}: Maple — dsolve как в расчётах заказчика`);
    ok((mp.match(/^printf\(/gm) || []).length === m.set.length, `${tag}: Maple — вывод результата по каждому изотопу`);
    ok(!/:=[^;:\n]*$/m.test(mp.replace(/#.*$/gm, '').replace(/^\s*$/gm, '').split('\n').filter((l) => /:=/.test(l) && !/^(EQ|IC) :=$/.test(l)).join('\n')),
      `${tag}: Maple — присваивания завершены «;» или «:»`);

    if (!withResult) continue;

    // Python
    if (havePy) {
      const file = path.join(tmp, `${tag}.py`);
      fs.writeFileSync(file, out.python);
      let stdout = '';
      try { stdout = execFileSync('python3', [file], { encoding: 'utf8' }); } catch (e) { ok(false, `${tag}: Python-скрипт запускается (${e.message.split('\n')[0]})`); }
      const vals = Object.fromEntries([...stdout.matchAll(/^(\S+)\s+[AN] = (\S+)/gm)].map((a) => [a[1], Number(a[2])]));
      const rows = m.result.rows;
      const scaleA = Math.max(...rows.map((r) => (r.stable ? 0 : Math.max(r.A, r.A0)))), scaleN = Math.max(...rows.map((r) => r.N));
      for (const r of rows) {
        const mine = r.stable ? r.N : r.A;
        ok(r.name in vals, `${tag}: Python напечатал ${r.name}`);
        if (Math.max(mine, vals[r.name] || 0) < 1e-10 * (r.stable ? scaleN : scaleA)) continue;
        ok(rel(mine, vals[r.name]) < 1e-6, `${tag}: Python ${r.name} = ${vals[r.name]} совпадает с программой ${mine.toExponential(6)}`);
      }
    }
    // LaTeX
    if (haveTex) {
      const dir = fs.mkdtempSync(path.join(tmp, 'tex-'));
      fs.writeFileSync(path.join(dir, 'model.tex'), out.latex);
      const r = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'model.tex'], { cwd: dir, encoding: 'utf8' });
      const err = (r.stdout || '').split('\n').filter((l) => l.startsWith('!')).slice(0, 2).join(' ');
      ok(r.status === 0 && fs.existsSync(path.join(dir, 'model.pdf')), `${tag}: LaTeX компилируется ${err}`);
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exitCode = done('Формулы') ? 1 : 0;
