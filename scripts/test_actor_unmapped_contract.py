#!/usr/bin/env python3
"""계약: 액터 결과를 매칭하는 모든 루프는 **키 추출 실패를 세어 경고**해야 한다.

🚨 2026-09-08 유튜브 268건 사고의 무음 지점: `if not key: continue` 로 조용히 버려서
조회수가 정상으로 들어오는데도 전량 유실됐고, 로그엔 '미반환'으로만 찍혀 스크래퍼 장애로
오진했다. 같은 형태가 틱톡·스레드·페북·트위터·인스타에도 그대로 있었다(전수 점검).
새 플랫폼을 추가할 때도 이 계약을 지키게 강제한다.
"""
from __future__ import annotations

import ast
import io
import pathlib

SRC = pathlib.Path(__file__).resolve().parent / "run_monitoring.py"

# 계약에서 제외하는 함수와 그 이유(추가하려면 반드시 이유를 적을 것).
EXEMPT = {
    # 계정 단위 스캔 — 게시물 키 매칭이 아니라 계정 핸들로 집계한다(버려지는 게시물 개념 없음).
    "collect_instagram_account_posts",
}


def _functions_with_dataset_loop(tree, src):
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        body = ast.get_source_segment(src, node) or ""
        if "iterate_items()" in body:
            yield node.name, body


def test_every_actor_mapping_loop_counts_dropped_items():
    src = io.open(SRC, encoding="utf-8").read()
    tree = ast.parse(src)
    seen, offenders = [], []
    for name, body in _functions_with_dataset_loop(tree, src):
        seen.append(name)
        if name in EXEMPT:
            continue
        if "_warn_unmapped(" not in body:
            offenders.append(name)
    assert seen, "iterate_items() 루프를 하나도 못 찾음 — 계약 테스트가 무력화됐는지 확인"
    assert not offenders, (
        "액터 결과 매칭 루프는 키 추출 실패를 세어 _warn_unmapped() 로 알려야 합니다: "
        + ", ".join(offenders)
    )


def test_warn_unmapped_is_silent_when_nothing_dropped(capsys):
    import run_monitoring as rm
    rm._warn_unmapped("유튜브", 0, 275)
    assert capsys.readouterr().out == ""


def test_warn_unmapped_reports_counts_and_points_at_schema(capsys):
    import run_monitoring as rm
    rm._warn_unmapped("유튜브", 268, 275)
    out = capsys.readouterr().out
    assert "268/275건" in out and "스키마 변경 의심" in out
