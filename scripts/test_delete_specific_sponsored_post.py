#!/usr/bin/env python3

from delete_specific_sponsored_post import (
    ExpectedPost,
    parse_expected_nullable_date,
    post_identity,
    preflight_errors,
)


EXPECTED = ExpectedPost(
    post_id="post-1",
    url="https://youtube.com/@issuebox_x/shorts/",
    account_name="이슈박스(유튜브)",
    posted_at="2026-08-30",
    ended_at="2026-08-30",
    cost=0,
    stats_count=0,
)


def live_row() -> dict:
    return {
        "id": "post-1",
        "url": "https://youtube.com/@issuebox_x/shorts/",
        "account_name": "이슈박스(유튜브)",
        "posted_at": "2026-08-30",
        "ended_at": "2026-08-30",
        "cost": 0,
    }


def test_exact_row_with_no_stats_passes() -> None:
    assert preflight_errors([live_row()], 0, EXPECTED) == []


def test_url_mismatch_aborts() -> None:
    row = live_row()
    row["url"] = "https://www.youtube.com/shorts/6ronnq9uRbE/"
    assert preflight_errors([row], 0, EXPECTED) == [{
        "field": "url",
        "expected": EXPECTED.url,
        "actual": row["url"],
    }]


def test_stat_row_or_duplicate_row_aborts() -> None:
    assert preflight_errors([live_row()], 1, EXPECTED)[0]["field"] == "post_daily_stats_count"
    assert preflight_errors([live_row(), live_row()], 0, EXPECTED) == [{
        "field": "row_count",
        "expected": 1,
        "actual": 2,
    }]

def test_null_date_sentinel_maps_to_empty_expected_value() -> None:
    assert parse_expected_nullable_date("__NULL__") == ""


def test_real_date_is_preserved() -> None:
    assert parse_expected_nullable_date("2026-10-14") == "2026-10-14"


# ── 2026-10-14 재발방지: 같은 게시물의 '표기 차이'로 정상 삭제가 중단되던 문제 ──
IG_EXPECTED = ExpectedPost(
    post_id="post-ig",
    url="https://www.instagram.com/reels/DdTfR1VTzxE/",
    account_name="ma__si__jjung",
    posted_at="2026-10-04",
    ended_at="",
    cost=12599,
    stats_count=0,
)


def ig_row(url: str = "https://www.instagram.com/p/DdTfR1VTzxE/") -> dict:
    return {
        "id": "post-ig",
        "url": url,
        "account_name": "ma__si__jjung",
        "posted_at": "2026-10-04",
        "ended_at": None,
        "cost": 12599,
    }


def test_instagram_reels_and_p_forms_are_the_same_post() -> None:
    # run 38501857186: /reels/ 입력 vs DB /p/ 로 중단됐던 실제 케이스
    assert preflight_errors([ig_row()], 0, IG_EXPECTED) == []


def test_instagram_query_and_slash_variants_are_the_same_post() -> None:
    row = ig_row("https://instagram.com/reel/DdTfR1VTzxE?igsh=abc123")
    assert preflight_errors([row], 0, IG_EXPECTED) == []


def test_different_instagram_post_still_aborts() -> None:
    # 표기 정규화가 '다른 글'까지 통과시키면 안 된다 (shortcode는 대소문자 구분)
    for other in ("https://www.instagram.com/p/DdTfR1VTzxF/",
                  "https://www.instagram.com/p/ddtfr1vtzxe/"):
        errors = preflight_errors([ig_row(other)], 0, IG_EXPECTED)
        assert errors and errors[0]["field"] == "url"


def test_null_spellings_all_mean_missing_date() -> None:
    # run 38501857186: ended_at 에 "NULL" 을 넣어 중단됐던 케이스
    for spelling in ("__NULL__", "NULL", "null", " Null "):
        assert parse_expected_nullable_date(spelling) == ""


def test_identity_matches_web_post_identity_key_rules() -> None:
    assert post_identity("https://www.youtube.com/watch?v=6ronnq9uRbE") == "yt:6ronnq9uRbE"
    assert post_identity("https://youtu.be/6ronnq9uRbE") == "yt:6ronnq9uRbE"
    assert post_identity("https://www.youtube.com/shorts/6ronnq9uRbE/") == "yt:6ronnq9uRbE"
    assert post_identity("https://www.tiktok.com/@a/video/7694208839746407687") == "tt:7694208839746407687"
    # ID 없는 프로필형 URL은 식별키를 만들지 않고 원문 근사형으로 비교한다
    assert post_identity("https://youtube.com/@issuebox_x/shorts/").startswith("url:")
    # uint64 범위를 넘는 틱톡 ID는 게시물로 인정하지 않는다
    assert post_identity("https://www.tiktok.com/@a/video/99999999999999999999").startswith("url:")
