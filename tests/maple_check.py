#!/usr/bin/env python3
"""Проверка кода Maple без Maple: синтаксис и числа.

Читает файл Maple, который выдаёт «Калькулятор полураспада» (вкладка «Формулы» → Maple), или код того же вида,
написанный вручную, и делает то, что сделал бы Maple:
  1. разбирает операторы (restart, Digits, постоянные распада, EQ, IC, dsolve, eval, A_X := t -> …, tk, printf)
     и проверяет синтаксис: «;» или «:» в конце, скобки, кавычки, известные функции и параметры dsolve,
     формат printf, что каждая постоянная определена до использования, у каждого уравнения есть начальное условие;
  2. вычисляет постоянные распада с 40 знаками (sympy), собирает систему dN/dt = M·N;
  3. решает её двумя способами — численно жёстким методом с допусками из dsolve (scipy Radau, как stiff = true
     в Maple) и точно матричной экспонентой (mpmath, 40 знаков);
  4. сравнивает A_X(tk) с числами «# программа: …», которые калькулятор пишет рядом с printf.

Запуск: python3 tests/maple_check.py model.mpl [--json]. Нужны sympy, mpmath, numpy, scipy.
Код возврата 0 — синтаксис в порядке и числа совпали (относительное отличие ≤ 1e-6), 1 — есть ошибки.
"""
import json
import re
import sys

import mpmath as mp
import numpy as np
import sympy as sp
from scipy.integrate import solve_ivp
from sympy.parsing.sympy_parser import convert_xor, parse_expr, standard_transformations

TRANSFORMS = standard_transformations + (convert_xor,)
DSOLVE_OPTS = {'numeric', 'stiff', 'maxfun', 'abserr', 'relerr', 'output', 'method', 'range', 'initstep', 'minstep', 'maxstep', 'optimize'}
FUNCS = {'ln': sp.log, 'log': sp.log, 'exp': sp.exp, 'sqrt': sp.sqrt, 'evalf': lambda x, *a: sp.N(x, 40), 'Pi': sp.pi}


def statements(text):
    """Операторы Maple: (текст, номер строки, завершитель). Комментарии # и строки "…" учитываются."""
    out, cur, line, start, depth, in_str = [], [], 1, 1, 0, False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            cur.append(ch)
            if ch == '\\' and i + 1 < len(text):
                cur.append(text[i + 1]); i += 2; continue
            if ch == '"':
                in_str = False
            if ch == '\n':
                line += 1
            i += 1; continue
        if ch == '#':
            while i < len(text) and text[i] != '\n':
                i += 1
            continue
        if ch == '\n':
            line += 1; cur.append(ch); i += 1; continue
        if not ''.join(cur).strip():
            start = line
        if ch == '"':
            in_str = True
        elif ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if depth <= 0 and (ch == ';' or (ch == ':' and text[i + 1:i + 2] not in ('=', ':'))):
            s = ''.join(cur)
            if s.strip():
                out.append((s, start, ch))
            cur, depth = [], 0
            i += 1; continue
        cur.append(ch); i += 1
    s = ''.join(cur)
    if in_str:
        out.append((s, start, 'unterminated-string'))
    elif s.strip():
        out.append((s, start, None))
    return out


def split_top(s):
    parts, depth, cur = [], 0, []
    for ch in s:
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(cur)); cur = []
        else:
            cur.append(ch)
    parts.append(''.join(cur))
    return [p.strip() for p in parts if p.strip()]


def balanced(s):
    s = re.sub(r'"[^"]*"', '""', s)
    d = 0
    pairs = {')': '(', ']': '[', '}': '{'}
    stack = []
    for ch in s:
        if ch in '([{':
            stack.append(ch)
        elif ch in ')]}':
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack and d == 0


class Model:
    def __init__(self):
        self.errors, self.notes = [], []
        self.consts = {}          # имя -> sympy число (40 знаков)
        self.eqs = {}             # функция N -> (строка правой части, номер строки)
        self.ics = {}             # функция N -> (строка, номер строки)
        self.order = []           # порядок функций N по уравнениям
        self.dsolve = None
        self.nproc = {}           # N_X -> NX
        self.afun = {}            # A_X -> (выражение, переменная)
        self.prints = []          # (имя, A_X, аргумент, единица, строка)
        self.tvar = None


def value(expr, consts, line, m):
    try:
        v = parse_expr(expr.replace('\n', ' '), local_dict={**FUNCS, **{k: sp.Float(v, 40) for k, v in consts.items()}}, transformations=TRANSFORMS)
        v = sp.N(v, 40)
        if not v.is_number:
            m.errors.append(f'строка {line}: не число: {expr.strip()[:60]} (неизвестные имена: {", ".join(sorted(map(str, v.free_symbols)))})')
            return None
        return v
    except Exception as e:  # noqa: BLE001
        m.errors.append(f'строка {line}: не разбирается выражение «{expr.strip()[:60]}»: {e}')
        return None


def parse(text):
    m = Model()
    for st, line, term in statements(text):
        s = st.strip()
        if term == 'unterminated-string':
            m.errors.append(f'строка {line}: не закрыта кавычка'); continue
        if term is None:
            m.errors.append(f'строка {line}: оператор без «;» или «:» в конце: {s[:50]}')
        if not balanced(s):
            m.errors.append(f'строка {line}: несбалансированные скобки: {s[:60]}'); continue
        if s == 'restart':
            continue
        if re.fullmatch(r'Digits\s*:=\s*\d+', s):
            continue
        a = re.fullmatch(r'([A-Za-z_]\w*)\s*:=\s*(.+)', s, re.S)
        if a:
            name, rhs = a.group(1), a.group(2).strip()
            if rhs.startswith('dsolve('):
                inner = rhs[len('dsolve('):-1] if rhs.endswith(')') else None
                if inner is None:
                    m.errors.append(f'строка {line}: dsolve(…) записан с ошибкой'); continue
                args = split_top(inner)
                if not args or not re.fullmatch(r'\{\s*\w+\s*,\s*\w+\s*\}', args[0]):
                    m.errors.append(f'строка {line}: первый аргумент dsolve должен быть {{EQ, IC}}')
                opts = {}
                for o in args[1:]:
                    k, _, v = o.partition('=')
                    k = k.strip()
                    if k not in DSOLVE_OPTS:
                        m.errors.append(f'строка {line}: неизвестный параметр dsolve: {k}')
                    opts[k] = v.strip()
                if 'numeric' not in opts:
                    m.errors.append(f'строка {line}: dsolve без numeric')
                if opts.get('output') != 'listprocedure':
                    m.errors.append(f'строка {line}: для eval(N(t), sol) нужен output = listprocedure')
                m.dsolve = opts
                continue
            e = re.fullmatch(r'eval\(\s*(\w+)\(t\)\s*,\s*(\w+)\s*\)', rhs)
            if e:
                m.nproc[name] = e.group(1); continue
            f = re.fullmatch(r't\s*->\s*(.+)', rhs, re.S)
            if f:
                m.afun[name] = f.group(1); continue
            if 'diff(' in rhs or re.search(r'\w\(0\)\s*=', rhs):
                for part in split_top(rhs):
                    d = re.fullmatch(r'diff\(\s*(\w+)\(t\)\s*,\s*t\s*\)\s*=\s*(.+)', part, re.S)
                    c = re.fullmatch(r'(\w+)\(0\)\s*=\s*(.+)', part, re.S)
                    if d:
                        if d.group(1) in m.eqs:
                            m.errors.append(f'строка {line}: второе уравнение для {d.group(1)}')
                        m.eqs[d.group(1)] = (d.group(2), line); m.order.append(d.group(1))
                    elif c:
                        m.ics[c.group(1)] = (c.group(2), line)
                    else:
                        m.errors.append(f'строка {line}: непонятная часть системы: {part[:60]}')
                continue
            v = value(rhs, m.consts, line, m)
            if v is not None:
                m.consts[name] = v
            continue
        p = re.fullmatch(r'printf\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"([^"]*)"\s*,\s*(\w+)\(\s*(\w+)\s*\)\s*\)', s)
        if p:
            fmt = p.group(1)
            specs = re.findall(r'%[-+ 0#]*\d*(?:\.\d+)?[a-zA-Z]', fmt)
            if specs != ['%-8s', '%16.6e'] and len(specs) != 2:
                m.errors.append(f'строка {line}: формат printf не на два значения: {fmt}')
            for sp_ in specs:
                if sp_[-1] not in 'sedfgaq':
                    m.errors.append(f'строка {line}: неизвестный формат {sp_}')
            unit = fmt.split()[-1].replace('\\n', '') if fmt.split() else ''
            m.prints.append((p.group(2), p.group(3), p.group(4), unit, line))
            continue
        m.errors.append(f'строка {line}: непонятный оператор: {s[:60]}')
    return m


def solve(m, text):
    """Сборка системы и решение. Возвращает строки отчёта."""
    funcs = m.order
    if not funcs:
        m.errors.append('нет уравнений diff(N…(t), t) = …'); return []
    for f in funcs:
        if f not in m.ics:
            m.errors.append(f'нет начального условия для {f}(0)')
    for f in m.ics:
        if f not in m.eqs:
            m.errors.append(f'начальное условие {f}(0) без уравнения')
    if m.dsolve is None:
        m.errors.append('нет вызова dsolve')
    # постоянные — числа; уравнения линейны по N
    y = sp.symbols(f'y0:{len(funcs)}')
    fn = {f: sp.Function(f) for f in funcs}
    t = sp.Symbol('t')
    local = {**FUNCS, **{k: sp.Float(v, 40) for k, v in m.consts.items()}, **fn, 't': t}
    M = mp.matrix(len(funcs), len(funcs))
    mp.mp.dps = 40
    for i, f in enumerate(funcs):
        rhs, line = m.eqs[f]
        try:
            e = parse_expr(rhs.replace('\n', ' '), local_dict=local, transformations=TRANSFORMS)
        except Exception as ex:  # noqa: BLE001
            m.errors.append(f'строка {line}: не разбирается правая часть для {f}: {ex}'); continue
        e = e.subs({fn[g](t): y[j] for j, g in enumerate(funcs)})
        free = e.free_symbols - set(y)
        if free:
            m.errors.append(f'строка {line}: в уравнении {f} не определены: {", ".join(sorted(map(str, free)))}'); continue
        poly = sp.Poly(sp.expand(e), *y)
        if poly.total_degree() > 1:
            m.errors.append(f'строка {line}: уравнение {f} нелинейно'); continue
        for j in range(len(funcs)):
            M[i, j] = mp.mpf(str(sp.N(poly.coeff_monomial(y[j]), 40)))
        if float(poly.coeff_monomial(1)) != 0.0:
            m.errors.append(f'строка {line}: в уравнении {f} есть слагаемое без N')
    N0 = mp.matrix(len(funcs), 1)
    for i, f in enumerate(funcs):
        if f in m.ics:
            v = value(m.ics[f][0], m.consts, m.ics[f][1], m)
            N0[i] = mp.mpf(str(v)) if v is not None else 0
    # время: переменная из printf (обычно tk)
    tv = {p[2] for p in m.prints}
    if len(tv) != 1 or next(iter(tv)) not in m.consts:
        m.errors.append('не найдено время выдержки (tk), от которого печатается результат')
        return []
    T = mp.mpf(str(m.consts[next(iter(tv))]))
    if m.errors:
        return []
    # точное решение: матричная экспонента
    Nexact = mp.expm(M * T) * N0
    # численное, как dsolve(numeric, stiff = true): Radau с теми же допусками
    rtol = float(m.dsolve.get('relerr', '1e-6')) if m.dsolve else 1e-6
    atol = float(m.dsolve.get('abserr', '1e-6')) if m.dsolve else 1e-6
    Mf = np.array([[float(M[i, j]) for j in range(len(funcs))] for i in range(len(funcs))])
    sol = solve_ivp(lambda _t, yy: Mf @ yy, (0.0, float(T)), np.array([float(v) for v in N0]), method='Radau',
                    jac=Mf, rtol=max(rtol, 1e-13), atol=atol)
    if not sol.success:
        m.errors.append('численное решение не сошлось: ' + sol.message); return []
    Nnum = sol.y[:, -1]
    # активности по определениям A_X := t -> lX*N_X(t)
    program = {}
    for line_text in text.splitlines():
        pm = re.match(r'\s*printf\(.*?"([^"]+)"\s*,\s*(\w+)\(\w+\)\);\s*#\s*программа:\s*(\S+)', line_text)
        if pm:
            mant = re.sub(r'[eE].*', '', pm.group(3)).replace('-', '').replace('.', '').lstrip('0')
            program[pm.group(1)] = (float(pm.group(3)), max(1, len(mant)))
    rows = []
    for name, afun, _, unit, line in m.prints:
        if afun not in m.afun:
            m.errors.append(f'строка {line}: функция {afun} не определена'); continue
        body = m.afun[afun]
        nm = re.search(r'(\w+)\(t\)', body)
        if not nm or nm.group(1) not in m.nproc:
            m.errors.append(f'{afun}: не найдено N_X := eval(…, sol)'); continue
        f = m.nproc[nm.group(1)]
        i = funcs.index(f)
        coef = body.replace(nm.group(0), '1')
        k = value(coef, m.consts, line, m)
        if k is None:
            continue
        ex = float(k) * float(Nexact[i])
        nu = float(k) * float(Nnum[i])
        pv = program.get(name)
        rows.append({'name': name, 'unit': unit, 'exact': ex, 'numeric': nu, 'program': pv[0] if pv else None, 'program_digits': pv[1] if pv else None})
    return rows


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__); return 2
    text = open(args[0], encoding='utf-8').read()
    # двумерная запись Maple, скопированная как текст: ≔ и →
    text = text.replace('\u2254', ':=').replace('\u2192', '->').replace('\u2212', '-').replace('\u00b7', '*')
    m = parse(text)
    rows = solve(m, text) if not m.errors else []
    scale = max([abs(r['exact']) for r in rows if r['unit'] != 'atoms'] or [1.0])
    worst = {'numeric': 0.0, 'program': 0.0}
    for r in rows:
        if r['unit'] == 'atoms':
            sc = max(abs(x['exact']) for x in rows if x['unit'] == 'atoms') or 1.0
        else:
            sc = scale
        for key in ('numeric', 'program'):
            v = r[key]
            if v is None:
                continue
            if max(abs(v), abs(r['exact'])) < 1e-9 * sc:  # пренебрежимо малые значения
                r[key + '_diff'] = 0.0
                continue
            d = abs(v - r['exact']) / max(abs(v), abs(r['exact']))
            r[key + '_diff'] = d
            # число в комментарии округлено до записанных знаков: часть отличия — само округление
            if key == 'program' and r.get('program_digits'):
                d = max(0.0, d - 0.5 * 10 ** (1 - r['program_digits']))
            worst[key] = max(worst[key], d)
    has_program = any(r['program'] is not None for r in rows)
    ok = bool(not m.errors and rows and worst['numeric'] <= 1e-6 and worst['program'] <= 1e-6)
    if '--json' in sys.argv:
        print(json.dumps({'ok': bool(ok), 'has_program': has_program, 'errors': m.errors, 'rows': rows, 'worst': worst, 'dsolve': m.dsolve}, ensure_ascii=False))
    else:
        for e in m.errors:
            print('ОШИБКА:', e)
        if rows:
            print(f'{"изотоп":8s} {"точно (expm)":>16s} {"как dsolve":>16s} {"программа":>16s}  отличие')
            for r in rows:
                prog = f'{r["program"]:16.6e}' if r['program'] is not None else f'{"—":>16s}'
                print(f'{r["name"]:8s} {r["exact"]:16.6e} {r["numeric"]:16.6e} {prog}  {max(r.get("numeric_diff", 0), r.get("program_diff", 0)):.1e} {r["unit"]}')
        if rows and not has_program:
            print('Чисел калькулятора («# программа: …») в файле нет — проверены синтаксис и совпадение численного решения с точным.')
        print('ИТОГ:', ('код Maple в порядке, числа совпадают' if has_program else 'код Maple в порядке') if ok else 'есть расхождения или ошибки')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
