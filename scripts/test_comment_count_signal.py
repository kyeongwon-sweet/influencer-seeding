from pathlib import Path

from run_monitoring import _coalesce_metric, _store_aux_rows


ROOT = Path(__file__).resolve().parents[1]


class _EmptyQuery:
    data = []

    def select(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def lt(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def range(self, *args, **kwargs):
        return self

    def execute(self):
        return self


class _EmptyDb:
    def table(self, _name):
        return _EmptyQuery()


def test_zero_comment_count_is_not_replaced_by_previous_or_null():
    assert _coalesce_metric(0, None) == 0
    assert _coalesce_metric(0, 7) == 0
    assert _coalesce_metric(None, 7) == 7


def test_aux_engagement_is_stored_when_view_metric_is_zero():
    rows = []
    post = {
        "id": "post-1",
        "url": "https://www.tiktok.com/@example/video/1234567890",
        "account_name": "example",
        "channel_type": "위성채널",
        "posted_at": "2026-08-10",
    }
    stats = {
        "key": {"views": 0, "likes": 3, "comments": 0},
    }

    _store_aux_rows(
        _EmptyDb(),
        rows,
        [post],
        stats,
        lambda _post: "key",
        "TikTok",
        views="clamp",
    )

    assert rows == [{
        "post_id": "post-1",
        "measured_at": rows[0]["measured_at"],
        "play_count": None,
        "likes_count": 3,
        "comments_count": 0,
    }]


def test_instagram_actor_mapping_preserves_zero_counts():
    source = (ROOT / "scripts" / "run_monitoring.py").read_text(encoding="utf-8")

    assert '_coalesce_metric(item.get("commentsCount"), item.get("comments"))' in source
    assert '_coalesce_metric(s.get("comments_count"), existing.get("comments_count"))' in source


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("comment count signal regression tests passed")
