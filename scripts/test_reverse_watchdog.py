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


def test_twentyfifty_incident_is_detected_and_alerted_at_kst_boundary():
    rows = [
        _s("vid", "2026-08-29", 727),
        _s("vid", "2026-08-30", 65_500),
        _s("vid", "2026-08-31", 745),
    ]
    out = w.detect_reverses(rows, POSTS, 0.05)
    assert len(out) == 1
    assert out[0]["date"] == "2026-08-31"
    assert out[0]["prev"] == 65_500
    assert out[0]["value"] == 745

    # Live run started 2026-08-31 21:58Z = 2026-09-01 06:58 KST.
    kst_now = datetime(2026, 9, 1, 6, 58, tzinfo=timezone.utc)
    msg = w.build_alert(out, 2, kst_now)
    assert msg is not None
    assert "65,500" in msg and "745" in msg


def test_recent_scan_includes_one_baseline_day_and_merges_missing_full_event():
    now = datetime(2026, 9, 1, 6, 58, tzinfo=timezone.utc)
    assert w.recent_scan_start(2, now) == "2026-08-29"

    event = {
        "post_id": "vid",
        "date": "2026-08-31",
        "account_name": "acc_vid",
        "metric": "조회수",
        "value": 745,
        "prev": 65_500,
        "drop_ratio": 0.989,
        "url": "https://x/vid",
    }
    merged = w.merge_reverse_events([], [event], [event.copy()])
    assert merged == [event]


def test_same_day_rows_use_created_at_then_id_order():
    rows = [
        {**_s("vid", "2026-08-30", 745), "created_at": "2026-08-30T02:00:00Z", "id": "b"},
        {**_s("vid", "2026-08-30", 65_500), "created_at": "2026-08-30T01:00:00Z", "id": "a"},
        {**_s("vid", "2026-08-31", 760), "created_at": "2026-08-31T01:00:00Z", "id": "c"},
    ]
    # The later same-day correction (745) becomes the baseline, so 08-31=760
    # is monotonic. Input list order cannot fabricate a 65,500 -> 745 reverse.
    assert w.detect_reverses(rows, POSTS, 0.05) == []
