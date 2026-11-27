#!/usr/bin/env python3
"""Собирает web/masses.js — атомные массы нуклидов базы (а. е. м.), AME 2020.

Источник: таблица изотопов пакета periodictable (public domain), файл periodictable/mass.py,
данные AME 2020 (Wang et al., Chinese Phys. C 45, 030003). Строки вида «90-Th-229,229.03176140(260),...».
Для изомеров (Pa-234m, Tc-99m, Bi-212n …) берётся масса основного состояния: энергия возбуждения
меняет массу меньше чем на 10⁻⁵ относительных.

Запуск: python3 data-build/build_masses.py <путь к periodictable/mass.py>
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

if len(sys.argv) < 2:
    sys.exit(__doc__)
text = open(sys.argv[1], encoding='iso-8859-15').read()
mass = {}
for m in re.finditer(r'^\d+-([A-Z][a-z]?)-(\d+),([0-9.]+)', text, re.M):
    mass[f'{m.group(1)}-{m.group(2)}'] = float(m.group(3))

db = open(os.path.join(ROOT, 'web', 'nucdb.js'), encoding='utf-8').read()
names = sorted(set(re.findall(r'"([A-Z][a-z]?-\d+[mn]?\d*)"\s*:', db)))
out, missing = {}, []
for n in names:
    base = re.sub(r'[mn]\d*$', '', n)
    if base in mass:
        out[n] = mass[base]
    else:
        missing.append(n)

body = '{\n' + ',\n'.join(f'    {json.dumps(k)}: {v!r}' for k, v in out.items()) + '\n  }'
js = ('/* Атомные массы нуклидов базы, а. е. м. (AME 2020; для изомеров — масса основного состояния).\n'
      ' * Собрано data-build/build_masses.py из таблицы пакета periodictable (public domain). */\n'
      '(function (g) {\n  \'use strict\';\n  const M = ' + body + ';\n'
      '  if (typeof module !== \'undefined\' && module.exports) module.exports = M;\n'
      '  g.NUCMASS = M;\n'
      '})(typeof window !== \'undefined\' ? window : globalThis);\n')
open(os.path.join(ROOT, 'web', 'masses.js'), 'w', encoding='utf-8').write(js)
print(f'нуклидов в базе: {len(names)}, с массой: {len(out)}, без массы: {len(missing)}', missing[:20])
