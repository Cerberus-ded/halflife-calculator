#!/usr/bin/env python3
"""Собирает страницу для claude.ai Artifact из web/index.html.

Запуск: python3 artifact/build_artifact.py [папка_копии]
- artifact/index.html: тело web/index.html без doctype/html/head/body (их добавляет claude.ai),
  в начале title/description/icon/style.css, перед nucdb.js подключён artifact-host.js
  (сохранение через claude.use('downloads'), печать отключена).
- копирует нужные файлы web/ в artifact/ и, если задана, в папку копии (публикуется из неё с root).
"""
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, 'web')
FILES = ['nucdb.js', 'core.js', 'formulas.js', 'formula-import.js', 'xlsx.js', 'tools.js', 'masses.js', 'amount.js', 'scheme.js', 'presets.js', 'help.js', 'elements.js', 'picker.js', 'app.js', 'style.css', 'icon.svg']

src = open(os.path.join(WEB, 'index.html'), encoding='utf-8').read()
m = re.search(r'<body[^>]*>(.*)</body>', src, re.S)
if not m:
    sys.exit('web/index.html: нет <body>')
body = m.group(1).strip('\n')
if '<script src="nucdb.js"></script>' not in body:
    sys.exit('web/index.html: нет <script src="nucdb.js">')
body = body.replace('<script src="nucdb.js"></script>', '<script src="artifact-host.js"></script>\n<script src="nucdb.js"></script>', 1)
# регистрация service worker в артефакте не нужна (и запрещена)
body = re.sub(r'<script>[^<]*serviceWorker[^<]*</script>\s*', '', body)
head = ('<title>Калькулятор полураспада</title>\n'
        '<meta name="description" content="Калькулятор радиоактивного распада: цепочки распада, уравнения Бейтмана, '
        'активность после выдержки, чистота, подбор выдержки, погрешность, формулы, протокол, экспорт в Excel">\n'
        '<link rel="icon" href="icon.svg" type="image/svg+xml">\n'
        '<link rel="stylesheet" href="style.css">\n')
page = head + body + '\n'

dests = [HERE] + [os.path.abspath(d) for d in sys.argv[1:]]
for d in dests:
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    for name in FILES:
        shutil.copyfile(os.path.join(WEB, name), os.path.join(d, name))
    if d != HERE:
        shutil.copyfile(os.path.join(HERE, 'artifact-host.js'), os.path.join(d, 'artifact-host.js'))
    print('страница:', os.path.join(d, 'index.html'), len(page), 'байт')
