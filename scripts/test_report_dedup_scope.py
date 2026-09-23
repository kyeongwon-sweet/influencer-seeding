"""계약: '그날 리포트가 이미 있나' 판정은 **제목줄만** 본다.

🚨 2026-09-23 실사고: 09-21 리포트를 정정하며 본문에 "정정(2026-09-22): …" 을 넣었더니
   본문 전체를 훑던 판정이 그 메시지를 09-22 리포트로 오인했다. 그 결과
   ① 그날 증분 리포트가 '중복'으로 막혀 발송되지 않았고
   ② Apps Script ensureDailyReport 안전망도 같은 이유로 dispatch 를 건너뛰어
   3시간 넘게 아무도 모른 채 리포트가 비었다(사람이 눈으로 발견).
   같은 판정을 쓰는 _find_report_ts 가 틀리면 REPLACE/DELETE 가 **다른 날짜 리포트를 지운다.**
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from notify_increments import is_report_for  # noqa: E402

HEAD = "📈 *쫀득바 조회수 일일 증분* `(2026-09-22)`"


def test_title_line_matches():
    assert is_report_for(HEAD + "\n오늘 총 증분 *+1,037,638*", "2026-09-22")


def test_other_day_title_does_not_match():
    other = "📈 *쫀득바 조회수 일일 증분* `(2026-09-21)`\n오늘 총 증분 *+1,393,880*"
    assert not is_report_for(other, "2026-09-22")


def test_body_date_must_not_match():
    """🚨 사고 재현 — 본문 주석의 날짜로 다른 날 리포트를 막으면 안 된다."""
    edited = (
        "📈 *쫀득바 조회수 일일 증분* `(2026-09-21)`\n"
        "오늘 총 증분 *+1,393,880*\n"
        "_정정(2026-09-22): 교차게시 조회수를 합산 반영했습니다._"
    )
    assert not is_report_for(edited, "2026-09-22"), "본문 날짜가 판정에 새면 그날 리포트가 통째로 막힌다"
    assert is_report_for(edited, "2026-09-21")


def test_empty_and_garbage():
    for t in ("", None, "\n\n", "아무 말"):
        assert not is_report_for(t, "2026-09-22")


def test_non_report_message_with_same_date():
    """검색량 리포트 등 다른 봇 메시지는 제목에 '일일 증분'이 없다."""
    other_bot = "📊 *라라스윗 검색량 리포트* (2026-09-22 화요일 기준)\n전일 검색량: *2,311*"
    assert not is_report_for(other_bot, "2026-09-22")
