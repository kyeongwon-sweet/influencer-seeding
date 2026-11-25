"""저녁 재확인(2026-11-16) — 나간 리포트를 대시보드 숫자로 맞출지 판정.

실사례: 11/15 쫀득바 리포트 12:29 발송 뒤, 늦게 등록된 위성글 14개의 첫 조회수(+6,601)가
17시 재수집으로 11/15에 기록돼 대시보드와 리포트가 갈렸다.
"""
from pathlib import Path

from report_recheck import (blocked_summary, change_summary, needs_update, numbers_of, permalink,
                            report_messages, total_of)

OLD = ("📈 *쫀득바 조회수 일일 증분* `(2026-11-15)`\n오늘 총 증분 *+998,353*\n"
       "• <https://www.instagram.com/p/DfwW3_CShcs/|협찬 (인플루언서)> *+232,669*  CPV 6.2원")
# 늦게 등록된 위성글 → 총 증분과 채널 줄이 함께 바뀐다(실제 11/15: 총 +6,601)
NEW = OLD.replace("+998,353", "+1,004,954").replace("+232,669", "+239,270")


def test_same_numbers_no_update():
    assert not needs_update(OLD, OLD)


def test_slack_escaping_difference_is_not_a_change():
    """슬랙 저장본이 이스케이프만 달라도 숫자가 같으면 헛편집·헛알림을 보내지 않는다."""
    assert not needs_update(OLD.replace("(인플루언서)", "(인플루언서) &amp;"), OLD)


def test_late_registered_views_trigger_update():
    assert needs_update(OLD, NEW)


def test_cpv_only_change_triggers_update():
    assert needs_update(OLD, OLD.replace("CPV 6.2원", "CPV 6.3원"))


def test_ad_only_change_does_not_trigger_update():
    """11-16 실측: 바치케 전환(메타)이 발송 뒤 +25 — 대시보드 숫자가 아니라 헛편집 대상 아님(전환은 7일 뒤 확정 정책)."""
    ads = "• *인지 광고*  `CPV는 일일 기준`\n    전환 조회수 *+329,777*\n"
    old = OLD.replace("*+998,353*\n", "*+998,353*\n" + ads)
    new = old.replace("+329,777", "+329,802").replace("+998,353", "+998,378")
    assert old != OLD and not needs_update(old, new)


def test_top10_change_triggers_update():
    old = OLD + "\n1. [JD그사] <https://www.instagram.com/p/Dfwn_EcksX9/|happing_box> _(인스타)_ *+98,684*  CPV 3.5원  `2026-11-15`"
    assert needs_update(old, old.replace("+98,684", "+98,700"))


def test_total_parsed():
    assert total_of(OLD) == 998353 and total_of(NEW) == 1004954
    assert total_of("제목만") is None


def test_change_summary_shows_before_after_and_link():
    s = change_summary("쫀득바", "2026-11-15", OLD, NEW, "https://x/p1")
    assert "+998,353" in s and "+1,004,954" in s and "(+6,601)" in s and "https://x/p1" in s


def test_change_summary_decrease_sign():
    s = change_summary("쫀득바", "2026-11-15", NEW, OLD, "L")
    assert "(-6,601)" in s


def test_blocked_summary_lists_reasons():
    s = blocked_summary("바치케", "2026-11-15", ["인지광고 조회수 칸에 소수 감지"], "L")
    assert "보류" in s and "소수 감지" in s


def test_report_messages_matches_product_and_date_by_title_only():
    msgs = [
        {"ts": "1.1", "text": OLD},
        {"ts": "1.2", "text": ":바치케: *바치케 조회수 일일 증분* `(2026-11-15)`\n..."},
        {"ts": "1.3", "text": "📈 *쫀득바 조회수 일일 증분* `(2026-11-14)`\n정정(2026-11-15)"},
        {"text": OLD},  # ts 없음 → 편집 대상 아님
    ]
    assert [m["ts"] for m in report_messages(msgs, "2026-11-15", "쫀득바")] == ["1.1"]
    assert [m["ts"] for m in report_messages(msgs, "2026-11-15", "바치케")] == ["1.2"]


def test_permalink():
    assert permalink("C0B4F7GBX17", "1794799767.320889").endswith("/archives/C0B4F7GBX17/p1794799767320889")


def test_numbers_include_links_and_dates():
    assert numbers_of(OLD)[:3] == ["2026", "11", "15"]   # 제목 날짜
    assert "3" in numbers_of(OLD)                         # 링크 속 shortcode 숫자도 포함(다른 게시물로 바뀌면 감지)


def test_workflow_contract():
    """예약 재확인은 날짜 폴백 없이(STRICT_DATE) 어제 KST만, 두 제품 모두, 실패는 DM으로."""
    wf = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "report-evening-recheck.yml").read_text(encoding="utf-8")
    assert 'RECHECK: "1"' in wf and 'STRICT_DATE: "1"' in wf
    assert "TZ=Asia/Seoul date -d 'yesterday' +%F" in wf
    assert "product: [jd, kbong, pbachi]" in wf
    assert '[ "${{ matrix.product }}" != "pbachi" ]' in wf   # 바치케는 2026-11-25 중단 — 예약 재확인 제외
    assert "if: failure()" in wf
    assert wf.count("- cron:") >= 2
