"""reverse_watchdog 순수 함수·optimized rollout 회귀 테스트."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
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
    assert msg is not None
    assert "누적 감소·직전 고값 오독 감사" in msg
    assert "최근 2일 내 1건" in msg


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
    assert out[0]["prev_date"] == "2026-08-30"
    assert out[0]["suspect_value"] == 65_500
    assert out[0]["value"] == 745

    # Live run started 2026-08-31 21:58Z = 2026-09-01 06:58 KST.
    kst_now = datetime(2026, 9, 1, 6, 58, tzinfo=timezone.utc)
    msg = w.build_alert(out, 2, kst_now)
    assert msg is not None
    assert "65,500" in msg and "745" in msg
    assert "누적 감소·직전 고값 오독 감사" in msg
    assert "https://x/vid" in msg


def test_mid_multiple_bad_high_is_identified_by_next_lower_value():
    rows = [
        _s("vid", "2026-09-01", 35_000),
        _s("vid", "2026-09-02", 116_853),
        _s("vid", "2026-09-03", 36_000),
    ]
    out = w.detect_reverses(rows, POSTS, 0.05)
    assert len(out) == 1
    assert out[0]["suspect_date"] == "2026-09-02"
    assert out[0]["suspect_value"] == 116_853


def test_confirmed_real_viral_growth_has_no_reverse():
    rows = [
        _s("vid", "2026-09-01", 2_479),
        _s("vid", "2026-09-02", 63_119),
        _s("vid", "2026-09-03", 67_000),
    ]
    assert w.detect_reverses(rows, POSTS, 0.05) == []


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


RAW_EVENT = {
    "post_id": "vid",
    "url": "https://x/vid",
    "account_name": "acc_vid",
    "date": "2026-08-31",
    "metric": "조회수",
    "value": 745,
    "prev": 65_500,
    "prev_date": "2026-08-30",
}


def test_rollout_mode_defaults_and_invalid_value_fail_to_legacy():
    assert w.resolve_mode(None) == "legacy"
    assert w.resolve_mode("") == "legacy"
    assert w.resolve_mode(" SHADOW ") == "shadow"
    assert w.resolve_mode("optimized") == "optimized"
    assert w.resolve_mode("unexpected") == "legacy"


def test_rpc_decoder_rebuilds_exact_legacy_event_shape():
    out = w.decode_reverse_event_bundle([{"events": [RAW_EVENT]}], 0.05)
    assert out == [{
        **RAW_EVENT,
        "suspect_value": 65_500,
        "suspect_date": "2026-08-30",
        "drop_ratio": 0.989,
    }]


@pytest.mark.parametrize(
    "payload",
    [
        [],
        [{"events": []}, {"events": []}],
        [{"events": None}],
        [{"events": [{**RAW_EVENT, "value": 0}]}],
        [{"events": [{**RAW_EVENT, "date": "not-a-date"}]}],
        [{"events": [{**RAW_EVENT, "prev_date": "2026-09-01"}]}],
        [{"events": [{**RAW_EVENT, "value": 64_000}]}],  # 2.3% < 5%
        [{"events": [RAW_EVENT, RAW_EVENT]}],
    ],
)
def test_rpc_decoder_rejects_partial_or_invalid_payload(payload):
    with pytest.raises(ValueError):
        w.decode_reverse_event_bundle(payload, 0.05)


def test_optimized_loader_uses_one_rpc_call(monkeypatch):
    calls = []

    def fake_rpc(url, key, function, payload):
        calls.append((url, key, function, payload))
        return [{"events": [RAW_EVENT]}]

    monkeypatch.setattr(w, "_sb_rpc", fake_rpc)
    out = w.load_optimized_reverses("https://db", "secret", 0.05)
    assert len(calls) == 1
    assert calls[0][2:] == (w.RPC_NAME, {"p_threshold": 0.05})
    assert out[0]["drop_ratio"] == 0.989


def test_optimized_success_does_not_download_legacy(monkeypatch):
    expected = w.decode_reverse_event_bundle([{"events": [RAW_EVENT]}], 0.05)
    monkeypatch.setattr(w, "load_optimized_reverses", lambda *_: expected)

    def unexpected_legacy(*_):
        raise AssertionError("legacy scan must not run after a valid optimized response")

    monkeypatch.setattr(w, "load_legacy_reverses", unexpected_legacy)
    out, effective = w.select_reverse_events(
        "optimized", "u", "k", 0.05, 2, datetime(2026, 9, 1)
    )
    assert out == expected
    assert effective == "optimized"


def test_optimized_invalid_response_falls_back_to_legacy(monkeypatch):
    expected = [{"legacy": True}]

    def invalid(*_):
        raise RuntimeError("unexpected optimized-path failure")

    monkeypatch.setattr(w, "load_optimized_reverses", invalid)
    monkeypatch.setattr(w, "load_legacy_reverses", lambda *_: expected)
    out, effective = w.select_reverse_events(
        "optimized", "u", "k", 0.05, 2, datetime(2026, 9, 1)
    )
    assert out is expected
    assert effective == "optimized-fallback"


def test_shadow_requires_exact_event_and_alert_parity(monkeypatch):
    legacy = w.decode_reverse_event_bundle([{"events": [RAW_EVENT]}], 0.05)
    monkeypatch.setattr(w, "load_legacy_reverses", lambda *_: legacy)
    monkeypatch.setattr(w, "load_optimized_reverses", lambda *_: [dict(legacy[0])])
    out, effective = w.select_reverse_events(
        "shadow", "u", "k", 0.05, 2, datetime(2026, 9, 1)
    )
    assert out is legacy
    assert effective == "shadow"

    mismatched = [{**legacy[0], "account_name": "wrong-account"}]
    monkeypatch.setattr(w, "load_optimized_reverses", lambda *_: mismatched)
    out, effective = w.select_reverse_events(
        "shadow", "u", "k", 0.05, 2, datetime(2026, 9, 1)
    )
    assert out is legacy
    assert effective == "shadow-mismatch"


def test_shadow_rpc_error_falls_back_to_legacy(monkeypatch):
    legacy = [{"legacy": True}]
    monkeypatch.setattr(w, "load_legacy_reverses", lambda *_: legacy)

    def rpc_error(*_):
        raise OSError("network down")

    monkeypatch.setattr(w, "load_optimized_reverses", rpc_error)
    out, effective = w.select_reverse_events(
        "shadow", "u", "k", 0.05, 2, datetime(2026, 9, 1)
    )
    assert out is legacy
    assert effective == "shadow-fallback"


def test_rpc_decoded_events_and_alert_match_legacy_exactly():
    posts = {
        "vid": POSTS["vid"],
        "ban": POSTS["ban"],
    }
    rows = [
        {**_s("vid", "2026-08-30", 65_500), "created_at": "2026-08-30T01:00:00Z", "id": "a"},
        # Same-day later correction must be the baseline used by both paths.
        {**_s("vid", "2026-08-30", 66_000), "created_at": "2026-08-30T02:00:00Z", "id": "b"},
        {**_s("vid", "2026-08-31", 745), "created_at": "2026-08-31T01:00:00Z", "id": "c"},
        {**_s("ban", "2026-08-30", reach=5_000), "created_at": "2026-08-30T01:00:00Z", "id": "d"},
        {**_s("ban", "2026-08-31", reach=0), "created_at": "2026-08-31T01:00:00Z", "id": "e"},
        {**_s("ban", "2026-09-01", reach=3_000), "created_at": "2026-09-01T01:00:00Z", "id": "f"},
    ]
    legacy = w.detect_reverses(rows, posts, 0.05)
    raw = [{key: event[key] for key in (
        "post_id", "url", "account_name", "date", "metric", "value", "prev", "prev_date"
    )} for event in legacy]
    optimized = w.decode_reverse_event_bundle([{"events": raw}], 0.05)
    now = datetime(2026, 9, 1)
    assert optimized == legacy
    assert w.build_alert(optimized, 2, now) == w.build_alert(legacy, 2, now)


def test_reverse_rpc_sql_contract_preserves_detector_semantics_and_permissions():
    migration = (
        Path(__file__).resolve().parents[1]
        / "supabase"
        / "migrations"
        / "20261026_monitoring_reverse_events.sql"
    ).read_text(encoding="utf-8").lower()
    compact = " ".join(migration.split())

    assert "returns table (events jsonb)" in compact
    assert "jsonb_agg(" in compact
    assert "partition by s.post_id, s.measured_at::date" in compact
    assert "order by s.measured_at desc, s.created_at desc nulls last, s.id desc" in compact
    assert "left join public.sponsored_posts p on p.id = s.post_id" in compact
    assert "where metric_value is not null and metric_value > 0" in compact
    assert "lag(v.metric_value) over ( partition by v.post_id order by v.measured_at )" in compact
    assert "p.posted_at::date >= date '2026-08-18'" in compact
    assert migration.index("valid_daily as") < migration.index("with_previous as")
    assert "revoke all on function public.monitoring_reverse_events_v1(double precision) from public" in compact
    assert "revoke all on function public.monitoring_reverse_events_v1(double precision) from anon" in compact
    assert "revoke all on function public.monitoring_reverse_events_v1(double precision) from authenticated" in compact
    assert "grant execute on function public.monitoring_reverse_events_v1(double precision) to service_role" in compact
