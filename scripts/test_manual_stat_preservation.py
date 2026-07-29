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


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("manual stat preservation regression tests passed")
