#!/usr/bin/env python3
"""Независимое эталонное решение для тестов: матричная экспонента в mpmath с 50 значащими цифрами.

Вход (stdin, JSON): {"cases": [{"id": ..., "nuclides": [{"name", "lambda", "daughters": [[имя, доля], ...]}],
                                "A0": {имя: Бк}, "t": секунды}]}
Выход (stdout, JSON): {"id": {имя: значение}} — A(t) в Бк для радиоактивных, N(t) атомов для стабильных.
Решается dN/dt = M·N, N(t) = expm(M·t)·N(0) — без формул Бейтмана, которыми считает программа.
Требуется: pip install mpmath
"""
import json
import sys

import mpmath as mp

mp.mp.dps = 50


def solve(case):
    nucl = case["nuclides"]
    n = len(nucl)
    idx = {x["name"]: i for i, x in enumerate(nucl)}
    lam = [mp.mpf(repr(x["lambda"])) for x in nucl]
    M = mp.zeros(n, n)
    for i, x in enumerate(nucl):
        M[i, i] = -lam[i]
        for name, br in x["daughters"]:
            if name in idx:
                M[idx[name], i] += mp.mpf(repr(br)) * lam[i]
    N0 = mp.matrix([mp.mpf(repr(case["A0"].get(x["name"], 0.0))) / lam[i] if lam[i] > 0 else mp.mpf(0)
                    for i, x in enumerate(nucl)])
    N = mp.expm(M * mp.mpf(repr(case["t"]))) * N0
    return {x["name"]: float(lam[i] * N[i] if lam[i] > 0 else N[i]) for i, x in enumerate(nucl)}


def main():
    data = json.load(sys.stdin)
    out = {c["id"]: solve(c) for c in data["cases"]}
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
