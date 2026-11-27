import radioactivedecay as rd, json, re, math
ds = rd.DEFAULTDATA
nd = ds.nuclide_dict
unit = {'s':1,'m':60,'h':3600,'d':86400,'y':365.25*86400,'ms':1e-3,'us':1e-6,'μs':1e-6,'ns':1e-9,'ps':1e-12}
def hl_s(n):
    v,u,_ = ds.hldata[nd[n]]
    return float(v)*unit[u]
iaea = {}
for line in open('iaea_sel.txt').read().strip().split('\n'):
    p = line.split(',')
    modes = []
    if len(p) > 2:
        for m in p[2].split(';'):
            k, v = m.split(':')
            modes.append((k, float(v) if v else None))
    iaea[p[0]] = (float(p[1]), modes)
SYMS = ['n','H','He','Li','Be','B','C','N','O','F','Ne','Na','Mg','Al','Si','P','S','Cl','Ar','K','Ca','Sc','Ti','V','Cr','Mn','Fe','Co','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr','Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe','Cs','Ba','La','Ce','Pr','Nd','Pm','Sm','Eu','Gd','Tb','Dy','Ho','Er','Tm','Yb','Lu','Hf','Ta','W','Re','Os','Ir','Pt','Au','Hg','Tl','Pb','Bi','Po','At','Rn','Fr','Ra','Ac','Th','Pa','U','Np','Pu','Am','Cm','Bk','Cf','Es','Fm']
def parse(n):
    m = re.match(r'([A-Za-z]+)-(\d+)([mn]?)$', n); return m.group(1), int(m.group(2)), m.group(3)
def daughter(sym, A, mode):
    Z = SYMS.index(sym)
    d = {'A':(-2,-4),'B-':(1,0),'EC':(-1,0),'EC+B+':(-1,0),'B+':(-1,0),'B-N':(1,-1)}.get(mode)
    if d is None: return None
    return f'{SYMS[Z+d[0]]}-{A+d[1]}'
UNITS=[365.2422*86400,86400,3600,60,1,1e-3,1e-6,1e-9]
def snap(T):
    # выгрузка округлена до 6 значащих цифр; восстанавливаем исходное «круглое» значение IAEA
    best=None
    for i,u in enumerate(UNITS):
        v=T/u
        if v<1 and u!=1e-9: continue
        for d in range(1,7):
            r=float(f'{v:.{d}g}')
            if abs(r-v)<=5.01e-6*abs(v):
                sc=d+1.01*i
                if best is None or sc<best[0]: best=(sc,r*u)
                break
    return best[1] if best else T
db = {}
stats = {'hl_iaea':0,'br_iaea':0}
for n in ds.nuclides:
    n = str(n); i = nd[n]
    sym, A, meta = parse(n)
    T = hl_s(n); src = 'ICRP-107'
    prog = [[str(p), float(b), str(m)] for p, b, m in zip(ds.progeny[i], ds.bfs[i], ds.modes[i])]
    key = sym + str(A)
    if not meta and key in iaea and math.isfinite(T):
        T = snap(iaea[key][0]); src = 'IAEA'; stats['hl_iaea'] += 1
        modes = iaea[key][1]
        if modes and all(not parse(p[0])[2] for p in prog if p[0] != 'SF'):
            # переносим ветвления IAEA, если набор дочерних совпадает с ICRP
            tot = {}; ok = True
            for k, v in modes:
                if v is None: ok = False; break
                if k == 'SF' or re.match(r'(\d+|\{)', k) or k in ('24NE','34SI','Mg','14C','B-SF'):
                    continue  # деление/кластерный распад: продукт вне цепочки
                if k == 'B-A': continue  # подмножество B-
                d = daughter(sym, A, k)
                if d is None: ok = False; break
                tot[d] = tot.get(d, 0) + v / 100
            icrp_set = {p[0] for p in prog if p[0] != 'SF'}
            if ok and set(tot) == icrp_set:
                s = sum(v for k, v in modes if v)/100
                newprog = []
                for p in prog:
                    if p[0] == 'SF':
                        sf = sum(v for k, v in modes if k == 'SF' and v)/100
                        newprog.append(['SF', sf / s if s > 1 else sf, 'SF']) if sf > 0 else None
                    else:
                        newprog.append([p[0], tot[p[0]] / s if s > 1 else tot[p[0]], p[2]])
                if [round(x[1],6) for x in newprog] != [round(x[1],6) for x in prog]: stats['br_iaea'] += 1
                prog = newprog
    # заполняем потерянные ветви: сумма долей < 1, а дочерний по данным IAEA есть в базе
    tot_b = sum(b for _, b, _ in prog)
    if math.isfinite(T) and tot_b < 1 - 1e-6:
        miss = 1 - tot_b
        cand = []
        if not meta and key in iaea:
            have = {p for p, _, _ in prog}
            for k, v in iaea[key][1]:
                d = daughter(sym, A, k)
                if d and d in nd and d not in have and v:
                    cand.append((d, v, {'A': 'α', 'B-': 'β-', 'EC': 'EC', 'EC+B+': 'β+', 'B+': 'β+'}.get(k, k)))
        elif meta:
            g = f'{sym}-{A}'
            if g in nd and g not in {p for p, _, _ in prog}: cand.append((g, 1.0, 'IT'))
        if cand:
            sv = sum(v for _, v, _ in cand)
            for d, v, mode in cand: prog.append([d, miss * v / sv, mode])
            stats.setdefault('filled', []).append(n)
    tot_b = sum(b for _, b, _ in prog)
    if tot_b > 1:  # нормируем суммы долей, превышающие 1 из-за округлений в исходных данных
        prog = [[p, b / tot_b, m] for p, b, m in prog]
        stats['normalized'] = stats.get('normalized', 0) + 1
    db[n] = {'T': T, 'src': src, 'd': [[p, round(b, 10), m] for p, b, m in prog]}
# стабильные продукты
for n in list(db):
    for p, b, m in db[n]['d']:
        if p != 'SF' and p not in db:
            db[p] = {'T': None, 'src': 'стабильный', 'd': []}
print(len(db), stats)
for k,v in db.items():
    if v['T'] and math.isfinite(v['T']) and v['d'] and sum(b for _,b,_ in v['d'])<1-1e-6:
        print('  sum<1:', k, v['d'])
for k in ['Th-229','Fr-221','Bi-213','Bi-212','Po-212','Th-234','U-238','Pa-234m','Cs-137','Bi-209','Pb-208','Ac-227','At-217']:
    print(k, db.get(k))
json.dump(db, open('nucdb.json','w'), ensure_ascii=False, separators=(',',':'))
