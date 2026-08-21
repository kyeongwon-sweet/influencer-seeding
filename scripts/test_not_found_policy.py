from not_found_policy import (
    is_not_found_review_eligible,
    is_platform_not_found_outage,
    next_not_found_state,
    normalize_instagram_handle,
)


def test_only_instagram_post_urls_are_eligible():
    assert is_not_found_review_eligible("https://www.instagram.com/reel/ABC_123/")
    assert is_not_found_review_eligible("https://www.instagram.com/user/p/ABC_123/")
    assert not is_not_found_review_eligible("https://www.instagram.com/user/reels/")
    assert not is_not_found_review_eligible("https://www.tiktok.com/@user/video/1234567890")
    assert not is_not_found_review_eligible("https://youtube.com/shorts/ABC_123")


def test_batch_wide_not_found_is_treated_as_platform_outage():
    assert is_platform_not_found_outage(596, 205)
    assert is_platform_not_found_outage(177, 177)


def test_small_or_low_rate_not_found_stays_per_post_actionable():
    assert not is_platform_not_found_outage(10, 10)
    assert not is_platform_not_found_outage(596, 19)
    assert not is_platform_not_found_outage(100, 29)


def test_only_profile_safe_instagram_handles_are_normalized():
    assert normalize_instagram_handle("@Ufo__NIGHT") == "ufo__night"
    assert normalize_instagram_handle("힐링하고 가세요") is None
    assert normalize_instagram_handle("https://instagram.com/ufo__night") is None


def test_live_owner_profile_can_request_review_without_forcing_streak():
    first, alert = next_not_found_state({}, True, "2026-08-11", confirmed=True)
    assert first["not_found_streak"] == 1
    assert first["not_found_last_at"] == "2026-08-11"
    assert first.get("review_requested_at")
    assert "ended_at" not in first
    assert alert


def test_same_day_profile_confirmation_promotes_review_without_incrementing_streak():
    state = {
        "not_found_streak": 2,
        "not_found_last_at": "2026-08-20",
        "review_requested_at": None,
    }

    promoted, alert = next_not_found_state(
        state,
        True,
        "2026-08-20",
        confirmed=True,
    )

    assert promoted.get("review_requested_at")
    assert "not_found_streak" not in promoted
    assert "not_found_last_at" not in promoted
    assert alert

    repeated, repeated_alert = next_not_found_state(
        {**state, **promoted},
        True,
        "2026-08-20",
        confirmed=True,
    )
    assert repeated == {}
    assert not repeated_alert


def test_first_and_second_consecutive_days_do_not_alert():
    first, first_alert = next_not_found_state({}, True, "2026-07-20")
    second, second_alert = next_not_found_state(first, True, "2026-07-21")
    assert first["not_found_streak"] == 1
    assert second["not_found_streak"] == 2
    assert not first_alert
    assert not second_alert


def test_third_consecutive_day_requests_review_once():
    state = {
        "not_found_streak": 2,
        "not_found_last_at": "2026-07-21",
        "review_requested_at": None,
    }
    third, third_alert = next_not_found_state(state, True, "2026-07-22")
    assert third["not_found_streak"] == 3
    assert third_alert
    assert "review_requested_at" in third

    fourth, fourth_alert = next_not_found_state({**state, **third}, True, "2026-07-23")
    assert fourth["not_found_streak"] == 4
    assert not fourth_alert


def test_gap_restarts_streak_and_same_day_retry_is_idempotent():
    state = {
        "not_found_streak": 2,
        "not_found_last_at": "2026-07-20",
        "review_requested_at": None,
    }
    restarted, alert = next_not_found_state(state, True, "2026-07-22")
    assert restarted["not_found_streak"] == 1
    assert not alert

    retry, retry_alert = next_not_found_state({**state, **restarted}, True, "2026-07-22")
    assert retry == {}
    assert not retry_alert


def test_success_resets_only_db_review_fields():
    reset, alert = next_not_found_state(
        {
            "not_found_streak": 3,
            "not_found_last_at": "2026-07-22",
            "review_requested_at": "2026-07-22T00:00:00+00:00",
            "notes": "사람이 작성한 메모",
            "ended_at": "2026-07-10",
        },
        False,
        "2026-07-23",
    )
    assert reset == {
        "not_found_streak": 0,
        "not_found_last_at": None,
        "review_requested_at": None,
    }
    assert not alert
    assert "notes" not in reset
    assert "ended_at" not in reset


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("not_found policy regression tests passed")
