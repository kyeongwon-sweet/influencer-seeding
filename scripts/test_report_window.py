#!/usr/bin/env python3
"""예약 리포트 발송 창 — 2026-11-03 새벽 01:15 발송 사고 회귀 테스트.

전날 12:20 예약이 GitHub에서 13시간 지연돼 자정 넘어 돌면, 그 시각 기준 '어제'(=막 끝난 날)를
시트 입력·광고 집계 전에 보내 버렸다. 예약 실행은 KST 12시 이후에만 보낸다.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("REPORT_PRODUCT", "jd")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from notify_increments import REPORT_WINDOW_START_HOUR, outside_report_window  # noqa: E402

KST = timezone(timedelta(hours=9))


def at(h, m=0):
    return datetime(2026, 11, 3, h, m, tzinfo=KST)


def test_delayed_schedule_after_midnight_does_not_send():
    assert outside_report_window(True, "", at(1, 15))       # 사고 재현: 01:15 예약 실행
    assert outside_report_window(True, "", at(11, 59))


def test_schedule_in_window_sends():
    assert REPORT_WINDOW_START_HOUR == 12
    for h, m in ((12, 0), (12, 20), (15, 20), (23, 59)):    # 예약 4슬롯 + 지연 여유
        assert not outside_report_window(True, "", at(h, m))


def test_manual_selfheal_and_edit_are_never_blocked():
    assert not outside_report_window(False, "", at(1, 15))          # 수동·자가치유(dispatch)
    assert not outside_report_window(True, "1793636218.7", at(1, 15))  # update_ts 편집
