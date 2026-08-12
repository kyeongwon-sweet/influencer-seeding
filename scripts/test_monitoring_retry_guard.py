from monitoring_retry_guard import zero_result_alert


def test_targeted_retry_with_zero_rows_is_a_hard_failure_signal():
    message = zero_result_alert(True, 191, 0, "2026-08-10")

    assert message is not None
    assert "대상 191건 → 저장 0건" in message
    assert "2026-08-10" in message


def test_targeted_retry_with_any_stored_row_is_not_zero_result():
    assert zero_result_alert(True, 191, 1, "2026-08-10") is None


def test_full_collection_does_not_use_the_targeted_retry_guard():
    assert zero_result_alert(False, 426, 0, "2026-08-10") is None


def test_verified_missing_posts_count_as_retry_progress():
    assert zero_result_alert(
        True,
        192,
        0,
        "2026-08-11",
        verified_missing=177,
    ) is None
