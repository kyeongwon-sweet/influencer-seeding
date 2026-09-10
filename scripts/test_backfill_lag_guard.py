#!/usr/bin/env python3
"""소급 기록 감시 회귀 테스트 (2026-09-10 슈기 사고).

사고 형태: 09-08 값 261건이 09-09 16:00 재시도로 채워졌고, 그중 슈기는 **첫 측정**이라
463,731 전액이 09-08 하루치로 잡혔다 → 09-09 증분이 121,304 대신 70,573 으로 깎였다.
아무 알림이 없어 사용자가 눈으로 발견했다.
"""
from __future__ import annotations

from backfill_lag_guard import late_backfill_line, late_backfills

TGT = "2026-09-08"
NAMES = {"p1": "슈기", "p2": "오하루(유튜브/미러링)", "p3": "정상글"}
ON_TIME = "2026-09-08T19:14:41+00:00"      # D+1 04:14 KST — 자정수집
LATE = "2026-09-09T07:00:41+00:00"         # D+1 16:00 KST — 재시도(리포트 이후)


def _row(pid, v, created, field="play_count"):
    r = {"post_id": pid, "created_at": created, "play_count": None, "reach_count": None}
    r[field] = v
    return r


def test_on_time_rows_are_silent():
    """정상 자정수집만 있는 날은 조용해야 한다 — 매일 울리면 신호가 죽는다."""
    rows = [_row("p3", 1000, ON_TIME), _row("p1", 2000, ON_TIME)]
    agg = late_backfills(rows, TGT, {"p1": TGT, "p3": "2026-09-01"})
    assert agg["late"] == [] and agg["first"] == []
    assert late_backfill_line(agg, TGT, NAMES) is None


def test_late_backfill_is_detected_and_first_measurement_is_singled_out():
    """🚨 슈기 사고 재현: 소급 2건 중 '첫 측정' 1건을 따로 짚어야 한다."""
    rows = [_row("p1", 463731, LATE), _row("p2", 102427, LATE), _row("p3", 500, ON_TIME)]
    agg = late_backfills(rows, TGT, {"p1": TGT, "p2": "2026-08-20", "p3": "2026-09-01"})
    assert [i["post_id"] for i in agg["late"]] == ["p1", "p2"]     # 값 큰 순
    assert [i["post_id"] for i in agg["first"]] == ["p1"]          # 첫 측정은 슈기뿐
    line = late_backfill_line(agg, TGT, NAMES)
    assert "소급 기록 2건" in line and "첫 측정 1건" in line
    assert "슈기 463,731" in line and "09-09 16:00 기록" in line


def test_value_less_row_is_not_a_backfill():
    """값 없는 행은 소급 '기록'이 아니다(공백≠0)."""
    rows = [_row("p1", None, LATE)]
    assert late_backfills(rows, TGT, {})["late"] == []


def test_banner_reach_counts_as_value():
    """배너는 play 가 없고 reach 가 지표 — 이것도 소급 대상으로 세야 한다."""
    rows = [_row("p2", 8000, LATE, field="reach_count")]
    agg = late_backfills(rows, TGT, {"p2": TGT})
    assert len(agg["late"]) == 1 and len(agg["first"]) == 1


def test_cutoff_is_report_time_not_midnight():
    """경계 = D+1 12:00 KST(리포트 직전). 아침 도착분은 리포트에 실리므로 소급이 아니다."""
    morning = "2026-09-09T00:56:00+00:00"   # D+1 09:56 KST
    afternoon = "2026-09-09T04:00:00+00:00" # D+1 13:00 KST
    assert late_backfills([_row("p1", 10, morning)], TGT, {})["late"] == []
    assert len(late_backfills([_row("p1", 10, afternoon)], TGT, {})["late"]) == 1


def test_bad_created_at_does_not_crash():
    assert late_backfills([_row("p1", 10, "not-a-date")], TGT, {})["late"] == []
    assert late_backfills([_row("p1", 10, None)], TGT, {})["late"] == []


# ── notify_status 배선 계약 ─────────────────────────────────────────────
# 아래 둘은 2026-09-10 에 실제로 조용히 깨져 있었다. 순수함수 테스트만으로는 못 잡는다.
def _notify_status_src():
    import io, pathlib
    return io.open(pathlib.Path(__file__).resolve().parent / "notify_status.py", encoding="utf-8").read()


def test_scan_selects_created_at():
    """🚨 공용 스캔이 created_at 을 안 뽑으면 체크 ⑬는 **항상 0건**이 된다(조용한 무력화).

    실제로 그렇게 배선돼 있었고, 실데이터로 순수함수만 돌려선 통과했다 —
    `_integrity_lines` 를 직접 태워보고서야 드러났다.
    """
    src = _notify_status_src()
    i = src.index('db.table("post_daily_stats").select(')
    assert "created_at" in src[i:i + 400], "공용 스캔 select 에 created_at 이 없다 → 체크 ⑬ 무력화"


def test_backfill_window_covers_two_days():
    """🚨 어제 하루만 보면 영원히 무음이다.

    notify_status 는 수집 직후(새벽)에만 도는데 소급 기록은 재시도(오후)가 만든다.
    새벽에 어제를 보면 아직 안 일어났고, 다음 새벽엔 그 날짜를 더 이상 안 본다.
    2026-09-08 슈기 건이 정확히 그 사각이었다 → 그저께까지 봐야 한다.
    """
    src = _notify_status_src()
    assert "backfill_dates" in src, "소급 감시 날짜 창 변수를 찾지 못함"
    i = src.index("backfill_dates")
    window = src[i:i + 200]
    assert "(1, 2)" in window, "소급 감시가 어제 하루만 본다 — 오후 소급을 영원히 못 잡는다"
