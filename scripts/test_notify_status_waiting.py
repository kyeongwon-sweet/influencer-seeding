"""수집 상태 알림의 '신규 대기' 판정 — KST 날짜 전환(37245e4f)이 만든 빈틈 재발 방지."""
import notify_status as ns


def test_예약수집_대상일에_등록된_글은_대기가_아니라_점검대상():
    # 대상일 10-18(10-19 00:41 수집), 10-18 08:30 dailyAuto 등록 → 그 수집에 들어가야 정상
    assert ns.is_waiting_registration("2026-10-18", "2026-10-18", "2026-10-19") is False


def test_오늘_대상_수동수집에서_오늘_등록분만_대기():
    assert ns.is_waiting_registration("2026-10-19", "2026-10-19", "2026-10-19") is True


def test_대상일_이전_등록은_대기_아님():
    assert ns.is_waiting_registration("2026-10-17", "2026-10-18", "2026-10-19") is False
    assert ns.is_waiting_registration("", "2026-10-19", "2026-10-19") is False
