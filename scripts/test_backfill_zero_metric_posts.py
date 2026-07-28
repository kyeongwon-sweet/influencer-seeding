from backfill_zero_metric_posts import (
    BASE_MEASURED_AT,
    has_exportable_metric,
    is_allowed_channel_type,
    platform_of,
    positive_int,
    target_measured_at,
)


def test_allowed_channel_types_are_exactly_the_requested_families():
    assert is_allowed_channel_type("협찬 (인플루언서)")
    assert is_allowed_channel_type("바이럴 (영상)")
    assert is_allowed_channel_type("협찬 (먹스타)")
    assert is_allowed_channel_type("협찬 (파워채널/매거진)")
    assert is_allowed_channel_type("협찬(파워채널.매거진)")
    assert is_allowed_channel_type("무상시딩 (영상)")


def test_unrequested_channel_types_are_excluded():
    assert not is_allowed_channel_type("바이럴 (배너)")
    assert not is_allowed_channel_type("협찬 (피드)")
    assert not is_allowed_channel_type("무상시딩 (피드)")
    assert not is_allowed_channel_type("위성채널")
    assert not is_allowed_channel_type("온드미디어")


def test_platform_of_keeps_only_view_capable_urls():
    assert platform_of("https://www.instagram.com/reel/DbS5X8WBgmM/") == "instagram"
    assert platform_of("https://www.instagram.com/p/DbS5X8WBgmM/") == "instagram"
    assert platform_of("https://youtube.com/shorts/ABC123456") == "youtube"
    assert platform_of("https://www.tiktok.com/@u/video/1234567890") == "tiktok"
    assert platform_of("https://x.com/u/status/1234567890") == "twitter"
    assert platform_of("https://www.instagram.com/some_handle/") is None
    assert platform_of("https://www.threads.net/@u/post/ABC123") is None


def test_positive_int_only_accepts_positive_numbers():
    assert positive_int("123") == 123
    assert positive_int(1.5) == 1
    assert positive_int(0) is None
    assert positive_int(None) is None
    assert positive_int("not-a-number") is None


def test_target_measured_at_uses_end_date_before_base_date():
    post = {"id": "p1", "ended_at": "2026-07-07"}
    assert target_measured_at(post) == "2026-07-07"


def test_target_measured_at_uses_base_date_for_active_posts():
    post = {"id": "p1", "ended_at": None}
    assert target_measured_at(post) == BASE_MEASURED_AT


def test_today_only_metric_does_not_satisfy_ended_post():
    post = {"id": "p1", "ended_at": "2026-07-07"}
    assert not has_exportable_metric(post, {"p1": ["2026-07-28"]})
    assert has_exportable_metric(post, {"p1": ["2026-07-07"]})


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("zero metric backfill regression tests passed")
