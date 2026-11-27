import json, math
db = json.load(open('nucdb.json'))
out = {}
srcmap = {'IAEA': 'I', 'ICRP-107': 'C', 'стабильный': 'S'}
for k, v in db.items():
    T = v['T']; fin = T is not None and math.isfinite(T)
    out[k] = [float(f'{T:.10g}') if fin else None, srcmap[v['src']] if fin else 'S', v['d']]
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
hdr = ("/* База нуклидов. Периоды полураспада (с): IAEA LiveChart of Nuclides (ENSDF), выгрузка 2026-11-27\n"
       " * (1 год = 365,2422 сут, как в IAEA); для изомеров и отсутствующих в выгрузке — ICRP-107.\n"
       " * Схемы распада и доли ветвлений: ICRP-107; для Z>=81 доли уточнены по IAEA, где набор дочерних совпадает;\n"
       " * ветви, потерянные в ICRP-107 при наличии дочернего в базе, восполнены по IAEA (изомеры: IT в основное состояние).\n"
       " * Формат: имя: [T½ в секундах | null = стабильный, источник I=IAEA C=ICRP-107 S=стабильный, [[дочерний, доля, тип распада], ...]] */\n")
open('/mnt/project-files/halflife-app/web/nucdb.js', 'w').write(hdr + '(typeof window!=="undefined"?window:globalThis).NUCDB=' + s + ';\nif(typeof module!=="undefined")module.exports=globalThis.NUCDB;\n')
