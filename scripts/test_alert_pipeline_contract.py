#!/usr/bin/env python3
"""알림 파이프라인 계약 — '만들었다 ≠ 동작한다' 재발방지.

2026-09-10~11 에 같은 뿌리로 **네 번** 무동작이 났다. 전부 계산 로직은 멀쩡했다:
  ① 시크릿이 없어 무동작(유튜브 Data API 폴백)
  ② 필요한 컬럼을 select 하지 않아 무동작(체크 13, created_at)
  ③ 감시 창이 사고 시각을 비켜가 무동작(체크 13, 어제만 봄)
  ④ 전달 게이트(ONLY_ON_FAILURE)에 막혀 무동작(체크 1~14 전부)

알림은 **체인**이고 각 칸이 AND 조건이다:
    계산 로직 → 입력 데이터 → 실행 시점 → 전달 게이트 → 실제 도착
단위 테스트는 첫 칸만 본다. 그래서 나머지 칸을 여기서 계약으로 못 박는다.
"""
from __future__ import annotations

import io
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
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


def test_integrity_checks_are_not_trapped_behind_the_send_gate():
    """🚨 `notify_status` 는 수집 정상일에 early-return 한다 → 그 뒤 코드는 안 돈다.

    2026-09-11 까지 정합성 체크 1~14 가 통째로 여기 묻혀 **한 번도 사용자에게 안 갔다**.
    그래서 매일 도착하는 증분 리포트에도 붙였다. **이 경로가 끊기면 다시 영구 무음이 된다.**
    """
    inc = _src("notify_increments.py")
    assert "_integrity_lines" in inc, (
        "증분 리포트가 정합성 체크를 붙이지 않는다 — notify_status 의 ONLY_ON_FAILURE 게이트에 "
        "막혀 수집 정상일엔 사용자에게 아무것도 안 간다(2026-09-11 사고)"
    )


def test_send_gate_has_a_warning_comment():
    """게이트 뒤에 새 체크를 추가하면 또 묻힌다 — 그 자리에 경고가 남아 있어야 한다."""
    src = _src("notify_status.py")
    i = src.index("ONLY_ON_FAILURE")
    assert "⚠️" in src[max(0, i - 900):i + 400], (
        "ONLY_ON_FAILURE 게이트 주변에 '이 뒤 코드는 정상일에 안 돈다'는 경고가 없다"
    )
