from auto_end_rules import classify_auto_end
from not_found_policy import classify_confirmed_deleted_end


def _post(**overrides):
    post = {
        "posted_at": "2026-06-25",
        "channel_type": "협찬 (인플루언서)",
        "project_name": "듬뿍바 출시마케팅",
        "product_name": "DB딸",
        "content_summary": "",
    }
    post.update(overrides)
    return post


def test_high_metric_over_age_is_not_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=2_100_000)
    assert decision.should_end is False
    assert decision.reason == "high_metric_500k"
    assert decision.metric == 2_100_000


def test_high_metric_threshold_boundary_is_not_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=500_000)
    assert decision.should_end is False
    assert decision.reason == "high_metric_500k"


def test_normal_metric_over_age_is_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is True
    assert decision.reason == "age_after_14"
    assert decision.age_days == 20
    assert decision.threshold_days == 14


def test_short_lived_type_uses_seven_day_threshold():
    decision = classify_auto_end(_post(channel_type="바이럴 (배너)"), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is True
    assert decision.reason == "age_after_7"
    assert decision.threshold_days == 7


def test_owned_or_satellite_channel_is_excluded():
    decision = classify_auto_end(_post(channel_type="위성채널"), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is False
    assert decision.reason == "excluded_channel_project"


def test_free_seeding_policy_stays_age_based_not_excluded():
    decision = classify_auto_end(
        _post(channel_type="무상시딩 (피드)"),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is True
    assert decision.reason == "age_after_7"


def test_asset_name_participates_in_owned_channel_exclusion():
    decision = classify_auto_end(
        _post(channel_type="협찬 (인플루언서)", asset_name="온드미디어_리컷"),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is False
    assert decision.reason == "excluded_channel_project"


def test_caption_end_keyword_still_forces_end():
    decision = classify_auto_end(_post(content_summary="삭제 예정"), target_date="2026-07-15", max_metric=2_100_000)
    assert decision.should_end is True
    assert decision.reason == "caption_keyword"


def test_manual_ended_at_field_is_never_auto_ended():
    decision = classify_auto_end(
        _post(manual_fields=["ended_at"]),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is False
    assert decision.reason == "manual_ended_at"


def test_manual_stat_tracked_post_is_never_auto_ended():
    decision = classify_auto_end(
        _post(),
        target_date="2026-07-15",
        max_metric=100_000,
        manual_tracked=True,
    )
    assert decision.should_end is False
    assert decision.reason == "manual_stat_tracked"


def test_confirmed_delete_override_ends_manual_tracked_post_without_weakening_age_rule():
    age_decision = classify_auto_end(
        _post(),
        target_date="2026-09-02",
        max_metric=100_000,
        manual_tracked=True,
    )
    assert not age_decision.should_end
    assert age_decision.reason == "manual_stat_tracked"

    delete_decision = classify_confirmed_deleted_end(
        {**_post(), "not_found_streak": 3, "manual_fields": ["reach_count"]},
        error_description="Post does not exist",
        last_valid_measured_at="2026-08-30",
        observed_at="2026-09-02",
    )
    assert delete_decision.should_end
    assert delete_decision.ended_at == "2026-08-31"
    assert "ended_at" in delete_decision.manual_fields


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("auto_end_rules regression tests passed")
