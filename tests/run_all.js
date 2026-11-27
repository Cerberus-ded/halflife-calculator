/* Все тесты по порядку. Запуск из папки halflife-app: node tests/run_all.js
 * Нужны: Node.js 18+, python3 с mpmath (эталон), numpy и scipy (проверка Python-вывода); pdflatex — по желанию. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const scripts = ['validate_db.js', 'check_presets.js', 'compare_reference.js', 'check_formulas.js', 'check_tools.js', 'check_generator.js', 'check_mass.js', 'check_scheme.js', 'check_backcalc.js'];
let failed = 0;
// Сценарии интерфейса ветки «Код» (Playwright) — если файл и сам Playwright доступны.
const e2e = path.join(__dirname, '..', 'desktop', 'test', 'e2e-web.js');
if (fs.existsSync(e2e)) {
  let pw = true;
  try { require.resolve('playwright'); } catch (e) { pw = false; }
  if (pw) { scripts.push(e2e); for (const f of ['e2e-features.js', 'e2e-tools.js', 'e2e-generator.js', 'e2e-mass.js', 'e2e-scheme.js', 'e2e-backcalc.js', 'e2e-chart.js', 'e2e-recent.js']) { const x = path.join(path.dirname(e2e), f); if (fs.existsSync(x)) scripts.push(x); } } else console.log('! Playwright не найден — сценарии интерфейса (desktop/test/e2e-web.js) пропущены\n');
}
for (const s of scripts) {
  const r = spawnSync(process.execPath, [path.isAbsolute(s) ? s : path.join(__dirname, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
  console.log('');
}
console.log(failed ? `ИТОГ: не прошло наборов тестов: ${failed} из ${scripts.length}` : `ИТОГ: все наборы тестов прошли (${scripts.length})`);
process.exitCode = failed ? 1 : 0;
