#!/usr/bin/env python3
"""patch_report_conversion.patch_text 단위 테스트 — 2026-10 전환 조회수 사후 보정 회귀 케이스.

배경: 10/1~10/11 리포트가 발송 시점에 시트 '전환 노출수' 칸이 비어 전환 조회수 없이 나갔다.
보정은 발송 당시 숫자를 건드리지 않고 전환 줄 삽입 + 총 증분 합산 + 목표% 재계산만 해야 한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from patch_report_conversion import patch_text  # noqa: E402

AD_SECTION = """• *인지 광고*  `CPV는 일일 기준`
    메타 *+212,173*  CPV 4.9원
    틱톡 *+15,783*  CPV 5.2원
    유튜브 *+144,255*  CPV 15.8원

"""

REPORT = (
    """:chart_with_upwards_trend: *쫀득바 조회수 일일 증분* `(2026-10-05)`
오늘 총 증분 *+658,089*
:dart: *일 190만 목표* 35% · 미달 -1,241,911
:black_medium_small_square: *제품별*  JD혼 +183K · JD멜 +57.5K · JD복 +45.4K

:black_medium_small_square: *채널분류별*

"""
    + AD_SECTION
    + """`CPV는 누적 기준 / 하이퍼링크 금일 채널별 BEST`

• <https://www.instagram.com/p/DdbCnMYS4SN/|협찬 (인플루언서)> *+240,943*  CPV 7.2원"""
)


def test_adds_line_total_and_goal_only():
    new, info = patch_text(REPORT, 39670)
    assert info["new_total"] == 697_759
    assert "오늘 총 증분 *+697,759*" in new
    assert "*일 190만 목표* 37% · 미달 -1,202,241" in new
    assert "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+39,670*\n\n`CPV는 누적" in new
    # 나머지 줄은 발송 당시 그대로
    untouched = [ln for ln in REPORT.split("\n") if "총 증분" not in ln and "만 목표" not in ln]
    assert all(ln in new.split("\n") for ln in untouched)


def test_idempotent_when_line_exists():
    new, _ = patch_text(REPORT, 39670)
    again, reason = patch_text(new, 39670)
    assert again is None and "이미" in reason


def test_creates_section_when_report_had_no_ad_lines():
    no_ads = REPORT.replace(AD_SECTION, "")
    new, info = patch_text(no_ads, 1000)
    assert info["new_total"] == 659_089
    assert "• *인지 광고*  `CPV는 일일 기준`\n    전환 조회수 *+1,000*\n\n`CPV는 누적" in new


def test_goal_crossing_and_rounding():
    near = REPORT.replace("+658,089", "+1,880,000").replace("35% · 미달 -1,241,911", "99% · 미달 -20,000")
    new, info = patch_text(near, 30000.4)
    assert info["conv"] == 30000
    assert "*일 190만 목표* 101% · 달성 +10,000" in new


def test_zero_without_section_is_not_shown():
    new, reason = patch_text(REPORT.replace(AD_SECTION, ""), 0)
    assert new is None and "표시 안 함" in reason


def test_default_dates_use_kst_yesterday_backwards():
    import datetime as dt
    from patch_report_conversion import default_dates

    # 17:30 KST(08:30 UTC) 실행 → KST 어제(10/13)부터 5일
    assert default_dates(dt.datetime(2026, 10, 14, 8, 30), 5) == [
        "2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10", "2026-10-09"]
    # UTC로는 아직 10/13이지만 KST는 10/14 01:00 → 어제는 10/13
    assert default_dates(dt.datetime(2026, 10, 13, 16, 0), 1) == ["2026-10-13"]


def test_find_report_reads_channel_history_once_for_many_dates(monkeypatch):
    import patch_report_conversion as prc

    page = {"ok": True, "messages": [
        {"ts": "2", "bot_id": "B", "text": ":chart: *쫀득바 조회수 일일 증분* `(2026-10-13)`\n오늘 총 증분 *+1*"},
        {"ts": "1", "bot_id": "B", "text": ":chart: *쫀득바 조회수 일일 증분* `(2026-10-12)`\n오늘 총 증분 *+1*"},
        {"ts": "0", "text": "사람이 쓴 `(2026-10-12)` 일일 증분 언급"},  # 봇 아님 → 제외
    ], "response_metadata": {"next_cursor": ""}}
    calls = []
    monkeypatch.setattr(prc, "_slack", lambda *a, **k: calls.append(a) or page)
    monkeypatch.setattr(prc, "_history", {"msgs": [], "cursor": None, "done": False, "pages": 0})

    assert [m["ts"] for m in prc.find_report("tok", "2026-10-13")] == ["2"]
    assert [m["ts"] for m in prc.find_report("tok", "2026-10-12")] == ["1"]
    assert prc.find_report("tok", "2026-10-01") == []
    assert len(calls) == 1


# ── 재발방지(2026-10-14): 발송 때 시트가 비면 notify가 '미입력' 줄을 남기고, 보정이 그 줄을 값으로 바꾼다 ──

def test_notify_conversion_line_states():
    from notify_increments import CONV_PENDING_LINE, conversion_line

    assert conversion_line({"views": 39670}) == "    전환 조회수 *+39,670*"
    assert conversion_line({"views": 0}) == "    전환 조회수 *+0*"        # 0은 명시값 → 그대로 표시
    assert conversion_line({"views": 1234.6}) == "    전환 조회수 *+1,235*"
    assert conversion_line({"views": None}) == CONV_PENDING_LINE          # 빈칸 → 숨기지 않고 미입력
    assert conversion_line({}) == CONV_PENDING_LINE
    assert conversion_line(None) is None                                 # 구버전 라우트 → 생략


def test_patch_replaces_pending_line_in_place():
    from notify_increments import CONV_PENDING_LINE

    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, info = patch_text(pending, 39670)
    assert info["new_total"] == 697_759
    assert CONV_PENDING_LINE not in new
    assert "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+39,670*\n\n`CPV는 누적" in new
    assert new.count("전환 조회수") == 1


def test_patch_zero_keeps_totals_and_still_applies():
    from notify_increments import CONV_PENDING_LINE

    # 미입력 → 0 입력: 줄만 +0으로, 총 증분·목표는 그대로(예전 가드는 '2줄 변경'을 강제해 0을 거부했음)
    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, info = patch_text(pending, 0)
    assert info["new_total"] == 658_089 and "    전환 조회수 *+0*" in new
    assert "*일 190만 목표* 35% · 미달 -1,241,911" in new
    # 섹션은 있는데 전환 줄이 아예 없던 옛 발송본도 0 보정 가능
    new2, info2 = patch_text(REPORT, 0)
    assert info2["new_total"] == 658_089 and "    전환 조회수 *+0*" in new2


def test_pending_line_is_not_mistaken_for_value():
    from notify_increments import CONV_PENDING_LINE

    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, reason = patch_text(pending, 100)
    assert new is not None, reason   # '이미 있음'으로 건너뛰면 안 됨
