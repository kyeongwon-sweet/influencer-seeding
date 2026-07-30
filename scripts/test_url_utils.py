from url_utils import normalize_url, tt_video_id, tt_canonical_form
from run_monitoring import _has_positive_views, _is_instagram_collectable_url, _tt_canonical


def test_normalize_url_strips_query_hash_and_slash():
    assert normalize_url("https://instagram.com/p/ABC/?utm_x=1#c") == "https://instagram.com/p/ABC"
    assert normalize_url("https://youtube.com/shorts/XYZ?si=abc/") == "https://youtube.com/shorts/XYZ"


def test_tt_video_id_extracts_from_video_url():
    assert tt_video_id("https://www.tiktok.com/@foo/video/7665895022981565716/") == "7665895022981565716"
    assert tt_video_id("https://vt.tiktok.com/ZSabc/") is None
    assert tt_video_id("") is None


def test_tt_canonical_form_rewrites_photo_to_video():
    # 회귀 방지: 틱톡 photo(슬라이드쇼)는 /video/로 표준화돼야 액터가 조회수를 반환한다.
    assert tt_canonical_form(
        "https://www.tiktok.com/@issuetteugi/photo/7667152002266287378/"
    ) == "https://www.tiktok.com/@issuetteugi/video/7667152002266287378"
    # 표준화 후엔 video id가 잡혀야 함(수집·매칭 경로가 이 id로 동작).
    assert tt_video_id(
        tt_canonical_form("https://www.tiktok.com/@issuebox_/photo/7667158750612049160/")
    ) == "7667158750612049160"


def test_tt_canonical_form_passthrough_for_non_photo():
    v = "https://www.tiktok.com/@foo/video/123"
    assert tt_canonical_form(v) == v
    assert tt_canonical_form("https://vt.tiktok.com/ZSabc/") == "https://vt.tiktok.com/ZSabc/"
    assert tt_canonical_form("") == ""


def test_run_monitoring_photo_request_and_result_use_the_same_video_id():
    photo = "https://www.tiktok.com/@healing0315/photo/7665233491407260949/"
    canonical = _tt_canonical(photo)

    assert canonical == "https://www.tiktok.com/@healing0315/video/7665233491407260949"
    assert tt_video_id(canonical) == "7665233491407260949"


def test_positive_view_counter_treats_null_as_not_measured():
    assert _has_positive_views({"views": None}) is False
    assert _has_positive_views({}) is False
    assert _has_positive_views(None) is False
    assert _has_positive_views({"views": 1}) is True


def test_instagram_diagnostics_skip_non_instagram_posts():
    assert _is_instagram_collectable_url("https://www.instagram.com/p/DZXeAW8S9IQ/") is True
    assert _is_instagram_collectable_url("https://www.instagram.com/reel/DZXeAW8S9IQ/") is True
    assert _is_instagram_collectable_url("https://www.tiktok.com/@issuebox_/photo/76672043078207603388") is False
    assert _is_instagram_collectable_url("https://www.youtube.com/shorts/vx9Ijz7QG0k") is False
    assert _is_instagram_collectable_url("https://www.instagram.com/some_account/reels/") is False
