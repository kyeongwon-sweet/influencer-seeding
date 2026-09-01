"""Regression tests for automatic Instagram upward-spike verification."""

import run_monitoring as rm


POST = {
    "id": "post-1",
    "url": "https://www.instagram.com/p/DcfLIInTFAV/",
    "account_name": "twentyfifty_ena",
    "channel_type": "무상시딩 (영상)",
    "posted_at": "2026-08-17",
}


def _key():
    return rm._stats_key(POST["url"])


def _clear_events():
    rm.UPWARD_SPIKE_WARNINGS.clear()
    rm.MISSING_VIEW_EVENTS.clear()


def test_candidate_matches_twentyfifty_incident_but_not_normal_growth():
    assert rm._is_upward_spike_candidate(727, 65_500)
    assert not rm._is_upward_spike_candidate(727, 6_500)
    assert not rm._is_upward_spike_candidate(None, 65_500)


def test_true_viral_jump_is_preserved_when_independent_actor_confirms_level():
    _clear_events()
    stats = {_key(): {"url": POST["url"], "play_count": 63_119, "likes_count": 100}}
    last = {POST["id"]: {"play_count": 2_479, "measured_at": "2026-08-29"}}

    result = rm._guard_instagram_upward_spikes(
        [POST],
        stats,
        last,
        fetcher=lambda _urls: {_key(): {"play_count": 67_000}},
    )

    assert result == {"candidates": 1, "verified": 1, "quarantined": 0}
    assert stats[_key()]["play_count"] == 63_119
    assert rm.UPWARD_SPIKE_WARNINGS == []


def test_cross_contaminated_jump_is_quarantined_without_inventing_replacement():
    _clear_events()
    stats = {
        _key(): {
            "url": POST["url"],
            "play_count": 65_500,
            "likes_count": 23,
            "comments_count": 2,
        }
    }
    last = {POST["id"]: {"play_count": 727, "measured_at": "2026-08-29"}}

    result = rm._guard_instagram_upward_spikes(
        [POST],
        stats,
        last,
        fetcher=lambda _urls: {_key(): {"play_count": 745}},
    )

    assert result == {"candidates": 1, "verified": 0, "quarantined": 1}
    assert stats[_key()]["play_count"] is None
    assert stats[_key()]["likes_count"] == 23
    assert stats[_key()]["comments_count"] == 2
    assert rm.UPWARD_SPIKE_WARNINGS[0]["observed"] == 65_500
    assert rm.UPWARD_SPIKE_WARNINGS[0]["confirmed"] == 745
    assert rm.MISSING_VIEW_EVENTS[0]["reason"] == "upward_spike_unconfirmed"


def test_confirmation_failure_is_fail_closed():
    _clear_events()
    stats = {_key(): {"url": POST["url"], "play_count": 65_500, "likes_count": 23}}
    last = {POST["id"]: {"play_count": 727, "measured_at": "2026-08-29"}}

    def fail(_urls):
        raise RuntimeError("actor unavailable")

    result = rm._guard_instagram_upward_spikes([POST], stats, last, fetcher=fail)

    assert result["quarantined"] == 1
    assert stats[_key()]["play_count"] is None
    assert stats[_key()]["likes_count"] == 23
    assert rm.UPWARD_SPIKE_WARNINGS[0]["confirmed"] is None


def test_quarantined_marker_is_checked_before_daily_row_is_built():
    source = open(rm.__file__, encoding="utf-8").read()
    marker_check = 'if s.get("upward_spike_quarantined"):'
    row_build = 'play_count = s.get("play_count")'
    assert marker_check in source
    assert source.index(marker_check) < source.index(row_build)


def test_banner_and_first_measurement_are_not_rechecked():
    _clear_events()
    banner = {**POST, "channel_type": "바이럴 (배너)"}
    stats = {_key(): {"url": POST["url"], "play_count": 65_500}}
    calls = []

    result = rm._guard_instagram_upward_spikes(
        [banner],
        stats,
        {POST["id"]: {"play_count": 727}},
        fetcher=lambda urls: calls.append(urls),
    )
    assert result["candidates"] == 0

    result = rm._guard_instagram_upward_spikes(
        [POST],
        stats,
        {},
        fetcher=lambda urls: calls.append(urls),
    )
    assert result["candidates"] == 0
    assert calls == []
