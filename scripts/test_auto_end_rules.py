from auto_end_rules import classify_auto_end


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


def test_caption_end_keyword_still_forces_end():
    decision = classify_auto_end(_post(content_summary="삭제 예정"), target_date="2026-07-15", max_metric=2_100_000)
    assert decision.should_end is True
    assert decision.reason == "caption_keyword"


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("auto_end_rules regression tests passed")
