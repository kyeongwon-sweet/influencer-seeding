from not_found_policy import is_not_found_review_eligible, next_not_found_state


def test_only_instagram_post_urls_are_eligible():
    assert is_not_found_review_eligible("https://www.instagram.com/reel/ABC_123/")
    assert is_not_found_review_eligible("https://www.instagram.com/user/p/ABC_123/")
    assert not is_not_found_review_eligible("https://www.instagram.com/user/reels/")
    assert not is_not_found_review_eligible("https://www.tiktok.com/@user/video/1234567890")
    assert not is_not_found_review_eligible("https://youtube.com/shorts/ABC_123")


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
