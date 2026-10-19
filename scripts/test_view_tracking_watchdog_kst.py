"""수집 사각 워치독의 '오늘 막 등록' 제외는 KST 날짜로 판정해야 한다(2026-10-19 오탐 재현)."""
from datetime import date

import view_tracking_watchdog as wd


def _run(monkeypatch, created_at: str, today: date, posted_at: str = "2026-10-17") -> dict:
    post = {
        "id": "p1",
        "account_name": "썰박스 (틱톡)",
        "channel_type": "위성채널",
        "posted_at": posted_at,
        "created_at": created_at,
        "url": "https://www.tiktok.com/@ssulbox_1/video/7698134624303697173/",
        "notes": None,
        "not_found_streak": 0,
        "review_requested_at": None,
    }
    monkeypatch.setattr(wd, "fetch_active_posts", lambda: [post])
    monkeypatch.setattr(wd, "_get", lambda path, count=False: 0)  # stats 0행
    return wd.build(today)


def test_사고재현_KST_오늘아침_등록은_다음수집_대기로_제외(monkeypatch):
    # KST 2026-10-19 08:33 등록 = UTC 2026-10-18T23:33
    r = _run(monkeypatch, "2026-10-18T23:33:25.123456+00:00", date(2026, 10, 19))
    assert r["flagged_count"] == 0


def test_KST_어제_등록인데_수집행_0이면_여전히_잡는다(monkeypatch):
    # KST 2026-10-18 10:00 등록 → 10-19 00:41 수집이 닿았어야 함
    r = _run(monkeypatch, "2026-10-18T01:00:00+00:00", date(2026, 10, 19))
    assert r["flagged_count"] == 1


def test_kst_date_변환():
    assert wd.kst_date("2026-10-18T23:33:00Z") == "2026-10-19"
    assert wd.kst_date("2026-10-18T14:59:59+00:00") == "2026-10-18"
    assert wd.kst_date("2026-10-17") == "2026-10-17"
    assert wd.kst_date(None) == ""
