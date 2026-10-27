#!/usr/bin/env python3
"""patch_report_youtube_gads — 발송된 바치케 리포트의 유튜브 줄만 Google Ads 값으로 교체(2026-10-27)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("REPORT_PRODUCT", "pbachi")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import patch_report_youtube_gads as p  # noqa: E402

# 10/26 바치케 리포트(전환 메타 반영 뒤) 실물 축약
REPORT = """:바치케: *바치케 조회수 일일 증분* `(2026-10-26)`
오늘 총 증분 *+303,319*

──────────

:black_medium_small_square: *채널분류별*

• *인지 광고*  `CPV는 일일 기준`
    유튜브 *+193,586*  CPV 24.2원
    전환 조회수 *+81,038*

`CPV는 누적 기준 / 하이퍼링크 금일 채널별 BEST`

• <https://www.instagram.com/p/DegjWPft3Db/|협찬 (인플루언서)> *+27,142*  CPV 27.5원"""


def test_replaces_only_youtube_line_and_total_by_delta():
    new, info = p.replace_youtube_line(REPORT, 193_700, 4_685_900.0)
    assert info["new_total"] == 303_319 - 193_586 + 193_700
    assert "    유튜브 *+193,700*  CPV 24.2원" in new and "오늘 총 증분 *+303,433*" in new
    changed = [ln for ln in REPORT.split("\n") if ln not in new.split("\n")]
    assert len(changed) == 2 and "    전환 조회수 *+81,038*" in new


def test_same_values_is_noop_and_cpv_only_change_keeps_total():
    again, reason = p.replace_youtube_line(REPORT, 193_586, 4_684_875.0)
    assert again is None and "같음" in reason
    new, info = p.replace_youtube_line(REPORT, 193_586, 5_000_000.0)
    assert info["new_total"] == 303_319 and "CPV 25.8원" in new and not info["views_changed"]


def test_report_without_youtube_line_is_not_touched():
    no_yt = REPORT.replace("    유튜브 *+193,586*  CPV 24.2원\n", "")
    new, reason = p.replace_youtube_line(no_yt, 10, 1.0)
    assert new is None and "유튜브 줄 없음" in reason


def test_goal_line_recomputed_when_present():
    jd = REPORT.replace("오늘 총 증분 *+303,319*\n", "오늘 총 증분 *+303,319*\n:dart: *일 190만 목표* 16% · 미달 -1,596,681\n")
    new, _ = p.replace_youtube_line(jd, 193_686, 1.0)
    assert "*일 190만 목표* 16% · 미달 -1,596,581" in new


def test_cpv_format_matches_report_generator():
    from notify_increments import _ad_cpv
    for c, v in ((4_684_875, 193_586), (0, 5), (12, 0), (1_234_567.8, 12_345)):
        assert p.ad_cpv(c, v) == _ad_cpv(c, v)


class _Q:
    def __init__(self, data):
        self.data = data
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def execute(self): return self


class _SB:
    def __init__(self, marker, rows):
        self.marker, self.rows = marker, rows
    def table(self, name):
        return _Q(self.marker if name == "ops_daily_runs" else self.rows)


def test_unfetched_day_or_blank_views_is_blank_not_zero():
    assert p.gads_day(_SB([], [{"views": 1, "cost_krw": 2}]), "2026-10-26") is None
    assert p.gads_day(_SB([{"run_date": "x"}], [{"views": None, "cost_krw": 2}]), "2026-10-26") is None
    assert p.gads_day(_SB([{"run_date": "x"}], []), "2026-10-26") == (0, 0)   # 조회했고 행 없음 = 노출 없음
    assert p.gads_day(_SB([{"run_date": "x"}], [{"views": 3, "cost_krw": "10.5"}, {"views": 4, "cost_krw": 1}]),
                      "2026-10-26") == (7, 11.5)
