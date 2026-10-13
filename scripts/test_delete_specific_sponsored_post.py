#!/usr/bin/env python3

from delete_specific_sponsored_post import ExpectedPost, preflight_errors


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
