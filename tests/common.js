/* Общие помощники тестов: загрузка модулей web/ в Node так же, как в браузере (через globalThis). */
'use strict';
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
require(path.join(WEB, 'nucdb.js'));
const C = require(path.join(WEB, 'core.js'));
globalThis.HLCore = C;
const F = require(path.join(WEB, 'formulas.js'));
const P = require(path.join(WEB, 'presets.js'));
const H = require(path.join(WEB, 'help.js'));
const DB = globalThis.NUCDB;
const UNITS = { s: 1, min: 60, h: 3600, d: 86400, y: C.units.Y };
const UNIT_RU = { s: 'с', min: 'мин', h: 'ч', d: 'сут', y: 'лет' };

let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  ✗ ' + msg); } return cond; }
let warnings = [];
/** Замечание, не считающееся ошибкой (печатается сводкой в конце). */
function warn(msg) { warnings.push(msg); }
function done(title) {
  if (warnings.length) {
    console.log(`  ! замечаний ${warnings.length}: ` + warnings.slice(0, 8).join('; ') + (warnings.length > 8 ? '; …' : ''));
  }
  console.log(`${failures ? '✗' : '✓'} ${title}: проверок ${checks}, ошибок ${failures}, замечаний ${warnings.length}`);
  return failures;
}
/** Модель для HLFormulas из пресета. */
function modelFromPreset(p, withResult = true, points = 10) {
  const set = C.buildSet(p.roots, p.overrides);
  const tSec = p.hold * UNITS[p.holdUnit];
  const m = { set, A0: p.activities, tSec, holdText: `${p.hold} ${UNIT_RU[p.holdUnit]}` };
  if (withResult) m.result = C.calculate(set, p.activities, tSec, points);
  return m;
}
const rel = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)));

module.exports = { WEB, C, F, P, H, DB, UNITS, UNIT_RU, ok, warn, done, modelFromPreset, rel };
