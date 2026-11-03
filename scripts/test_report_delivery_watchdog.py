"""계약: 워치독은 '실행 성공'이 아니라 **리포트가 채널에 실제로 있는지**를 본다.

🚨 2026-09-23 사고: 증분 리포트 워크플로가 success 로 끝났는데 발송은 0이었다(중복 판정 오판).
   실행 기준 감시(마감·신선도)는 성공을 보고 침묵했고, Apps Script 자가치유도 같은 오판으로
   건너뛰어 **3시간 26분간 아무 알림이 없었다**. 사람이 눈으로 발견했다.
   이 파일은 그 침묵이 다시 생기지 않는지 고정한다.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cron_watchdog import REPORT_DELIVERY, check_report_delivery  # noqa: E402

KST = timezone(timedelta(hours=9))


def at(hh, mm=0, day=24):
    return datetime(2026, 9, day, hh, mm, tzinfo=KST)


def msg(target, extra="", product="쫀득바"):
    return {"text": f"📈 *{product} 조회수 일일 증분* `({target})`\n오늘 총 증분 *+1,000*{extra}"}


def both(target):
    return [msg(target), msg(target, product="바치케")]


def test_silent_before_deadline():
    """마감 전에는 아직 안 왔어도 조용하다 — 크론이 늘 늦으므로 그전에 울리면 매일 오탐."""
    assert check_report_delivery(at(12, 30), "tok", fetch=lambda: []) == []


def test_alerts_when_missing_after_deadline():
    out = check_report_delivery(at(17, 30), "tok", fetch=lambda: [])
    assert len(out) == 2 and all("미발송" in x for x in out)   # 쫀득바·바치케 각각
    assert all("2026-09-23" in x for x in out), "대상일(어제)을 알려야 사람이 바로 조치한다"


def test_silent_when_delivered():
    out = check_report_delivery(at(17, 30), "tok", fetch=lambda: both("2026-09-23"))
    assert out == []


def test_other_day_report_does_not_count():
    """🚨 사고 재현 — 전날 리포트가 채널에 있다고 오늘 것이 온 게 아니다."""
    assert check_report_delivery(at(17, 30), "tok", fetch=lambda: [msg("2026-09-22")])


def test_body_date_does_not_count():
    """🚨 사고의 정확한 형태 — 본문 정정 주석의 날짜를 '도착'으로 세면 안 된다."""
    edited = msg("2026-09-22", extra="\n_정정(2026-09-23): 교차게시 합산 반영._")
    out = check_report_delivery(at(17, 30), "tok", fetch=lambda: [edited])
    assert out, "본문 날짜를 도착으로 세면 미발송을 영영 못 잡는다"


def test_fetch_failure_is_reported_not_swallowed():
    """조회 실패를 '없음'으로도, 침묵으로도 처리하지 않는다."""
    def boom():
        raise RuntimeError("missing_scope")
    out = check_report_delivery(at(17, 30), "tok", fetch=boom)
    assert len(out) == 1 and "확인 실패" in out[0] and "미발송" not in out[0]


def test_no_token_is_silent():
    """토큰이 없으면 판단할 수 없다 — 매시간 울리지 않는다."""
    assert check_report_delivery(at(17, 30), None, fetch=lambda: []) == []


def test_deadline_is_after_last_recovery_path():
    """마감은 마지막 자가치유(Apps Script 16:10 KST)보다 뒤여야 한다.
    앞이면 복구가 제 일을 하기 전에 울려 매일 오탐이 된다."""
    hh, mm = (int(x) for x in REPORT_DELIVERY["due_kst"].split(":"))
    assert hh * 60 + mm >= 16 * 60 + 10


def test_wired_into_main():
    """main() 에 연결돼 있지 않으면 이 검사는 존재만 하고 돌지 않는다."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cron_watchdog.py"),
               encoding="utf-8").read()
    body = src[src.index("def main() -> int:"):]
    assert "check_report_delivery(" in body, "main 에서 호출하지 않는다"
    assert "not undelivered" in body, "'이상 없음' 조기 반환이 미도착을 무시한다"


# ── 2026-11-03 재발방지: 바치케도 도착 감시 ──

def test_pbachi_missing_alone_is_reported():
    """쫀득바만 왔고 바치케가 안 왔으면 바치케만 경고(예전엔 바치케를 아예 안 봐서 침묵)."""
    out = check_report_delivery(at(17, 30), "tok", fetch=lambda: [msg("2026-09-23")])
    assert len(out) == 1 and "바치케" in out[0] and "product=pbachi" in out[0]


def test_products_match_report_generator():
    """감시 대상 제품명 = 발송기 PRODUCT_PROFILES 제목 — 제품이 늘면 둘 다 바꿔야 한다."""
    from notify_increments import PRODUCT_PROFILES
    assert sorted(REPORT_DELIVERY["products"]) == sorted(p["title"] for p in PRODUCT_PROFILES.values())
