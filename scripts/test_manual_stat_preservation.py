import run_monitoring as rm

from run_monitoring import _filter_manual_preserved_rows


def test_same_date_manual_row_is_removed_from_auto_upsert():
    rows = [
        {"post_id": "p1", "measured_at": "2026-07-28", "play_count": 2112},
        {"post_id": "p2", "measured_at": "2026-07-28", "play_count": 915},
    ]

    kept, skipped = _filter_manual_preserved_rows(rows, {"p1|2026-07-28"})

    assert kept == [rows[1]]
    assert skipped == [rows[0]]


def test_manual_preservation_is_date_specific():
    rows = [{"post_id": "p1", "measured_at": "2026-07-29", "play_count": 2300}]

    kept, skipped = _filter_manual_preserved_rows(rows, {"p1|2026-07-28"})

    assert kept == rows
    assert skipped == []


def test_previous_date_manual_row_does_not_stop_next_date_collection():
    original_prev_stats = rm._prev_stats
    rm._prev_stats = lambda _db, _ids: {
        "p1": {
            "post_id": "p1",
            "measured_at": "2026-07-28",
            "play_count": 2056,
            "likes_count": 10,
            "comments_count": 2,
            "manual": True,
        }
    }
    try:
        rows = []
        posts = [{"id": "p1", "url": "https://www.tiktok.com/@u/photo/123", "content_summary": "team"}]
        stats = {"123": {"views": 2300, "likes": 12, "comments": 3}}
        rm._store_aux_rows(None, rows, posts, stats, lambda _p: "123", "틱톡", views="clamp")
    finally:
        rm._prev_stats = original_prev_stats

    assert rows == [{
        "post_id": "p1",
        "measured_at": rm.TODAY,
        "play_count": 2300,
        "likes_count": 12,
        "comments_count": 3,
    }]


def test_tiktok_banner_collects_public_metric_into_reach_not_play():
    rows = []
    posts = [{
        "id": "banner-1",
        "url": "https://www.tiktok.com/@u/photo/456",
        "channel_type": "바이럴 (배너)",
        "posted_at": "2026-10-01",
        "content_summary": "team",
    }]
    stats = {"456": {"views": 2300, "likes": 12, "comments": 3}}

    rm._store_aux_rows(
        None,
        rows,
        posts,
        stats,
        lambda _p: "456",
        "틱톡",
        views="clamp",
        last_stat={
            "banner-1": {
                "post_id": "banner-1",
                "measured_at": "2026-10-14",
                "play_count": 99_999,
                "reach_count": 2200,
                "likes_count": 10,
                "comments_count": 2,
                "manual": False,
            }
        },
    )

    assert rows == [{
        "post_id": "banner-1",
        "measured_at": rm.TODAY,
        "reach_count": 2300,
        "play_count": None,
        "likes_count": 12,
        "comments_count": 3,
    }]


def test_tiktok_banner_clamp_uses_previous_reach_not_legacy_play():
    rows = []
    post = {
        "id": "banner-2",
        "url": "https://www.tiktok.com/@u/photo/789",
        "channel_type": "바이럴 (배너)",
        "posted_at": "2026-10-01",
        "content_summary": "team",
    }

    rm._store_aux_rows(
        None,
        rows,
        [post],
        {"789": {"views": 2500, "likes": 14, "comments": 4}},
        lambda _p: "789",
        "틱톡",
        views="clamp",
        last_stat={
            "banner-2": {
                "post_id": "banner-2",
                "measured_at": "2026-10-14",
                "play_count": 100_000,
                "reach_count": 3000,
                "likes_count": 13,
                "comments_count": 3,
                "manual": False,
            }
        },
    )

    assert rows[0]["reach_count"] == 3000
    assert rows[0]["play_count"] is None


def test_non_tiktok_banner_keeps_manual_reach_policy():
    rows = []
    post = {
        "id": "ig-banner",
        "url": "https://www.instagram.com/p/ABC123/",
        "channel_type": "협찬 (파워채널/매거진 배너)",
        "posted_at": "2026-10-01",
        "content_summary": "team",
    }

    rm._store_aux_rows(
        None,
        rows,
        [post],
        {"ABC123": {"views": 9999, "likes": 14, "comments": 4}},
        lambda _p: "ABC123",
        "Instagram",
        views="optional",
        last_stat={
            "ig-banner": {
                "reach_count": 3000,
                "likes_count": 13,
                "comments_count": 3,
                "manual": True,
            }
        },
    )

    assert rows == [{
        "post_id": "ig-banner",
        "measured_at": rm.TODAY,
        "play_count": None,
        "likes_count": 14,
        "comments_count": 4,
    }]


class _Response:
    def __init__(self, data):
        self.data = data


class _SameDayStatsQuery:
    def __init__(self, rows):
        self.rows = rows
        self.start = 0
        self.end = 999

    def select(self, _columns):
        return self

    def eq(self, _column, _value):
        return self

    def in_(self, _column, _values):
        return self

    def order(self, _column):
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        return _Response(self.rows[self.start:self.end + 1])


class _SameDayStatsDb:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "post_daily_stats"
        return _SameDayStatsQuery(self.rows)


def test_same_day_tiktok_banner_requires_reach_not_legacy_play():
    posts = [
        {
            "id": "reach-ok",
            "url": "https://www.tiktok.com/@u/photo/111",
            "channel_type": "바이럴 (배너)",
            "posted_at": "2026-10-01",
        },
        {
            "id": "play-only",
            "url": "https://www.tiktok.com/@u/photo/222",
            "channel_type": "바이럴 (배너)",
            "posted_at": "2026-10-01",
        },
    ]
    db = _SameDayStatsDb([
        {"post_id": "reach-ok", "play_count": None, "reach_count": 2300, "likes_count": 12, "comments_count": 3},
        {"post_id": "play-only", "play_count": 2300, "reach_count": None, "likes_count": 12, "comments_count": 3},
    ])

    assert rm._same_day_measured_ids(db, posts, "2026-10-15") == {"reach-ok"}


def test_same_day_non_banner_view_post_still_requires_play():
    posts = [
        {
            "id": "play-ok",
            "url": "https://www.tiktok.com/@u/video/333",
            "channel_type": "바이럴 (영상)",
            "posted_at": "2026-10-01",
        },
        {
            "id": "reach-only",
            "url": "https://www.tiktok.com/@u/video/444",
            "channel_type": "바이럴 (영상)",
            "posted_at": "2026-10-01",
        },
    ]
    db = _SameDayStatsDb([
        {"post_id": "play-ok", "play_count": 2300, "reach_count": None, "likes_count": 12, "comments_count": 3},
        {"post_id": "reach-only", "play_count": None, "reach_count": 2300, "likes_count": 12, "comments_count": 3},
    ])

    assert rm._same_day_measured_ids(db, posts, "2026-10-15") == {"play-ok"}


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("manual stat preservation regression tests passed")
