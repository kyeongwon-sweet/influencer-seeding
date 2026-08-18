from pathlib import Path
from datetime import date, timedelta

import run_monitoring as rm


ROOT = Path(__file__).resolve().parents[1]


def test_shared_history_summary_keeps_prev_stats_and_auto_end_meanings_separate():
    today = date.fromisoformat(rm.TODAY)
    yesterday = str(today - timedelta(days=1))
    two_days_ago = str(today - timedelta(days=2))
    rows = [
        {"id": "null-date", "post_id": "p1", "measured_at": None, "play_count": 1001, "reach_count": None, "likes_count": 10, "comments_count": 1, "manual": False},
        {"id": "today", "post_id": "p1", "measured_at": rm.TODAY, "play_count": 999, "reach_count": None, "likes_count": 9, "comments_count": 1, "manual": False},
        {"id": "newer", "post_id": "p1", "measured_at": yesterday, "play_count": 120, "reach_count": None, "likes_count": 8, "comments_count": 1, "manual": False},
        {"id": "older", "post_id": "p1", "measured_at": two_days_ago, "play_count": 80, "reach_count": None, "likes_count": 7, "comments_count": 1, "manual": True},
        {"id": "reach", "post_id": "p2", "measured_at": yesterday, "play_count": None, "reach_count": 500, "likes_count": 2, "comments_count": 0, "manual": False},
    ]
    last, maximums, manual_ids = {}, {}, set()

    rm._summarize_history_rows(rows, last, maximums, manual_ids)

    assert last["p1"] == {
        "post_id": "p1", "play_count": 120, "likes_count": 8,
        "comments_count": 1, "measured_at": yesterday, "manual": False,
    }
    assert last["p2"]["play_count"] is None
    assert maximums == {"p1": 1001, "p2": 500}
    assert manual_ids == {"p1"}


def test_aux_store_uses_injected_last_stat_without_rescanning(monkeypatch):
    monkeypatch.setattr(rm, "_prev_stats", lambda *_args: (_ for _ in ()).throw(AssertionError("unexpected rescan")))
    rows = []
    rm._store_aux_rows(
        None,
        rows,
        [{"id": "p1", "url": "https://www.tiktok.com/@a/video/1"}],
        {"1": {"views": 120, "likes": 2, "comments": 1}},
        lambda _post: "1",
        "TikTok",
        last_stat={"p1": {"play_count": 100, "likes_count": 1, "comments_count": 0}},
    )
    assert rows[0]["play_count"] == 120


class _Response:
    def __init__(self, data):
        self.data = data


class _InfluencerQuery:
    def __init__(self, rows, calls):
        self.rows = rows
        self.calls = calls
        self.urls = []

    def select(self, columns):
        assert columns == "id, url"
        return self

    def in_(self, column, urls):
        assert column == "url"
        self.urls = list(urls)
        self.calls.append(self.urls)
        return self

    def execute(self):
        return _Response([row for row in self.rows if row["url"] in self.urls])


class _InfluencerDb:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def table(self, name):
        assert name == "influencers"
        return _InfluencerQuery(self.rows, self.calls)


def test_influencer_profiles_are_deduped_and_queried_in_one_batch():
    db = _InfluencerDb([
        {"id": "i1", "url": "https://www.instagram.com/a/"},
        {"id": "i2", "url": "https://www.instagram.com/b/"},
    ])
    result = rm._influencer_ids_by_profile_url(db, [
        "https://www.instagram.com/a/",
        "https://www.instagram.com/a/",
        "https://www.instagram.com/b/",
    ])
    assert db.calls == [["https://www.instagram.com/a/", "https://www.instagram.com/b/"]]
    assert result == {
        "https://www.instagram.com/a/": "i1",
        "https://www.instagram.com/b/": "i2",
    }


def test_run_passes_the_shared_last_stat_to_every_aux_platform():
    source = (ROOT / "scripts" / "run_monitoring.py").read_text(encoding="utf-8")
    assert source.count("last_stat=last_stat") == 5
    assert "prev_ig = last_stat" in source
    summary_source = source[source.index("def _active_stats_summary"):source.index("def _influencer_ids_by_profile_url")]
    assert '.order("measured_at", desc=True)' in summary_source
    assert '.order("created_at", desc=True)' in summary_source
    assert '.order("id", desc=True)' in summary_source
