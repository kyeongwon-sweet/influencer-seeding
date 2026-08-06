"""reverse_watchdog 순수 함수 회귀 테스트 (stdlib, pytest)."""
from datetime import datetime, timezone

import reverse_watchdog as w

POSTS = {
    "vid": {"url": "https://x/vid", "account_name": "acc_vid", "channel_type": "바이럴 (영상)"},
    "ban": {"url": "https://x/ban", "account_name": "acc_ban", "channel_type": "바이럴 (배너)"},
}


def _s(pid, date, play=None, reach=None):
    return {"post_id": pid, "measured_at": date, "play_count": play, "reach_count": reach}


def test_monotonic_no_reverse():
    rows = [_s("vid", "2026-08-01", 100), _s("vid", "2026-08-02", 100), _s("vid", "2026-08-03", 150)]
    assert w.detect_reverses(rows, POSTS, 0.05) == []


def test_day_over_day_drop_flagged():
    rows = [_s("vid", "2026-08-01", 1000), _s("vid", "2026-08-02", 400)]  # -60%
    out = w.detect_reverses(rows, POSTS, 0.05)
    assert len(out) == 1 and out[0]["value"] == 400 and out[0]["prev"] == 1000


def test_small_drop_below_threshold_ignored():
    rows = [_s("vid", "2026-08-01", 1000), _s("vid", "2026-08-02", 980)]  # -2% < 5%
    assert w.detect_reverses(rows, POSTS, 0.05) == []


def test_zero_is_deletion_not_reverse_and_keeps_prev():
    # 1000 → 0(삭제, 무시) → 1100(정상 회복). 0도 1100도 역행 아님.
    rows = [_s("vid", "2026-08-01", 1000), _s("vid", "2026-08-02", 0), _s("vid", "2026-08-03", 1100)]
    assert w.detect_reverses(rows, POSTS, 0.05) == []


def test_spike_then_stable_flags_once():
    # 1000 → 200(하락, 플래그) → 210(전날 200보다 오름=정상). below-peak면 210도 오탐인데 day-over-day는 1건만.
    rows = [_s("vid", "2026-08-01", 1000), _s("vid", "2026-08-02", 200), _s("vid", "2026-08-03", 210)]
    out = w.detect_reverses(rows, POSTS, 0.05)
    assert len(out) == 1 and out[0]["date"] == "2026-08-02"


def test_banner_uses_reach_not_play():
    rows = [_s("ban", "2026-08-01", reach=5000), _s("ban", "2026-08-02", reach=3000)]  # -40% reach
    out = w.detect_reverses(rows, POSTS, 0.05)
    assert len(out) == 1 and out[0]["metric"] == "도달수" and out[0]["value"] == 3000


def test_build_alert_none_when_no_recent():
    old = [{"date": "2026-07-01", "account_name": "a", "metric": "조회수", "value": 1, "prev": 2, "drop_ratio": 0.5, "url": "u"}]
    assert w.build_alert(old, 2, datetime(2026, 8, 6, tzinfo=timezone.utc)) is None


def test_build_alert_fires_on_recent():
    recent = [{"date": "2026-08-05", "account_name": "a", "metric": "도달수", "value": 1, "prev": 2, "drop_ratio": 0.5, "url": "u"}]
    msg = w.build_alert(recent, 2, datetime(2026, 8, 6, tzinfo=timezone.utc))
    assert msg is not None and "역행 1건" in msg
