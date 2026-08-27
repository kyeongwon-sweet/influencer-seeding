#!/usr/bin/env python3
"""Supabase offset pagination must end with a unique id ordering.

Offset/range pagination without a unique order silently duplicates or drops rows at
page boundaries. This source contract covers every operational Python script so the
same data-integrity regression cannot return in another report or repair path.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SELF = Path(__file__).name


def has_id_order(expr: ast.AST) -> bool:
    node = expr
    while isinstance(node, ast.Call):
        func = node.func
        if isinstance(func, ast.Attribute):
            if func.attr == "order" and node.args:
                first = node.args[0]
                if isinstance(first, ast.Constant) and first.value == "id":
                    return True
            node = func.value
            continue
        break
    return False


def main() -> int:
    failures: list[str] = []
    checked = 0
    for path in sorted(ROOT.glob("*.py")):
        if path.name == SELF or path.name.startswith("test_"):
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr != "range":
                continue
            checked += 1
            if not has_id_order(node.func.value):
                failures.append(f"{path.name}:{node.lineno} .range() 앞에 .order('id') 없음")

        for lineno, line in enumerate(source.splitlines(), start=1):
            if "/rest/v1/" in line and "offset=" in line:
                checked += 1
                if "order=id." not in line:
                    failures.append(f"{path.name}:{lineno} REST offset 앞에 order=id 없음")

    if failures:
        print("[FAIL] Python 페이지네이션 유일 정렬키 계약 위반")
        for failure in failures:
            print("  - " + failure)
        return 1
    print(f"[OK] Python 페이지네이션 {checked}곳 모두 id 유일 정렬 확인")
    return 0


if __name__ == "__main__":
    sys.exit(main())
