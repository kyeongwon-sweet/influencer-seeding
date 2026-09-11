#!/usr/bin/env python3
"""알림 파이프라인 계약 — '만들었다 ≠ 동작한다' 재발방지.

2026-09-10~11 에 같은 뿌리로 세 번 무동작이 났다. 전부 계산 로직은 멀쩡했다:
  ① 시크릿이 없어 무동작(유튜브 Data API 폴백)
  ② 필요한 컬럼을 select 하지 않아 무동작(체크 13, created_at)
  ③ 감시 창이 사고 시각을 비켜가 무동작(체크 13, 어제만 봄)

반면 체크 1~14 는 기존 daily-increment-report 워크플로의 notify_status 스텝이
리포트 스레드로 정상 전달하고 있었다. 이 경로를 모르고 본문에도 같은 검사를 붙이면
무음이 아니라 중복 알림이 된다. 전달 경로의 존재와 단일성도 계약으로 고정한다.

알림은 **체인**이고 각 칸이 AND 조건이다:
    계산 로직 → 입력 데이터 → 실행 시점 → 전달 게이트 → 실제 도착
단위 테스트는 첫 칸만 본다. 그래서 나머지 칸을 여기서 계약으로 못 박는다.
"""
from __future__ import annotations

import io
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
WORKFLOW = HERE.parent / ".github" / "workflows" / "daily-increment-report.yml"
# 감시 결과를 실제로 사람에게 보내는 스크립트들
SENDERS = ("notify_status.py", "notify_increments.py", "run_monitoring.py", "daily_collect_report.py")


def _src(name: str) -> str:
    return io.open(HERE / name, encoding="utf-8").read()


def test_every_guard_module_is_wired_to_a_sender():
    """🚨 가드 모듈을 만들어놓고 아무 데서도 import 하지 않으면 영원히 안 돈다(죽은 가드).

    테스트만 붙어 있으면 '테스트는 통과하는데 사람에겐 아무것도 안 가는' 상태가 된다.
    """
    senders = "\n".join(_src(n) for n in SENDERS if (HERE / n).exists())
    orphans = []
    for path in sorted(HERE.glob("*_guard*.py")):
        mod = path.stem
        if mod.startswith("test_"):
            continue
        if f"from {mod} import" not in senders and f"import {mod}" not in senders:
            orphans.append(mod)
    assert not orphans, f"발송 스크립트 어디에도 연결되지 않은 가드: {orphans} — 만들어도 안 돈다"


def test_integrity_checks_use_the_existing_report_thread_carrier_once():
    """리포트가 발행되면 notify_status 가 같은 스레드에 정확히 한 번 붙어야 한다."""
    workflow = io.open(WORKFLOW, encoding="utf-8").read()
    inc = _src("notify_increments.py")
    marker = "- name: 상태 알럿을 리포트 댓글로 (여믄봇)"
    assert workflow.count(marker) == 1, "리포트 스레드 상태 댓글 스텝은 정확히 1개여야 한다"
    status_step = workflow[workflow.index(marker):]
    assert "SLACK_THREAD_TS: ${{ steps.report.outputs.ts }}" in status_step
    assert "python notify_status.py" in status_step
    assert "ONLY_ON_FAILURE" not in status_step, (
        "리포트 스레드 운반 경로에 ONLY_ON_FAILURE 를 걸면 정상 수집일 정합성 체크가 다시 무음이 된다"
    )
    assert "from notify_status import _integrity_lines" not in inc
    assert "_integrity_lines(db," not in inc, (
        "notify_increments 가 정합성 체크를 중복 계산한다 — 기존 notify_status 댓글과 두 번 발송된다"
    )


def test_send_gate_has_a_warning_comment():
    """게이트 뒤에 새 체크를 추가하면 또 묻힌다 — 그 자리에 경고가 남아 있어야 한다."""
    src = _src("notify_status.py")
    i = src.index("ONLY_ON_FAILURE")
    assert "⚠️" in src[max(0, i - 900):i + 400], (
        "ONLY_ON_FAILURE 게이트 주변에 '이 뒤 코드는 정상일에 안 돈다'는 경고가 없다"
    )
