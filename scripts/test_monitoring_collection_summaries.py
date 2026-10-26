from pathlib import Path

import run_monitoring as rm


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20261026_monitoring_collection_summaries.sql"


class _Response:
    def __init__(self, data):
        self.data = data


class _RpcCall:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return _Response(self.data)


class _RpcDb:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        value = self.responses[name]
        if isinstance(value, Exception):
            raise value
        return _RpcCall(value)


def _active_rpc_row(post_id="p1"):
    return {
        "post_id": post_id,
        "last_play_count": 120,
        "last_reach_count": None,
        "last_likes_count": 8,
        "last_comments_count": 1,
        "last_measured_at": "2026-10-25",
        "last_manual": False,
        "max_metric": 500,
        "manual_tracked": True,
        "last_valid_metric_date": "2026-10-25",
        "had_positive_play": True,
        "last_manual_at": "2026-10-24",
    }


def _active_rpc_bundle(*rows, row_count=None):
    payload = list(rows)
    return [{
        "summary_rows": payload,
        "row_count": len(payload) if row_count is None else row_count,
    }]


def _active_expected(post_id="p1"):
    return (
        {
            post_id: {
                "post_id": post_id,
                "play_count": 120,
                "reach_count": None,
                "likes_count": 8,
                "comments_count": 1,
                "measured_at": "2026-10-25",
                "manual": False,
            }
        },
        {post_id: 500},
        {post_id},
        {post_id: "2026-10-25"},
        {post_id},
        {post_id: "2026-10-24"},
    )


def test_default_mode_is_legacy_and_does_not_call_rpc(monkeypatch):
    monkeypatch.delenv(rm.COLLECTION_SUMMARY_MODE_ENV, raising=False)
    expected = ({}, {}, set(), {}, set(), {})
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: expected)
    db = _RpcDb({})

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") == expected
    assert db.calls == []


def test_optimized_active_summary_uses_explicit_target_and_exact_legacy_shape(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    db = _RpcDb({"monitoring_collection_active_summary_v1": _active_rpc_bundle(_active_rpc_row())})
    monkeypatch.setattr(
        rm,
        "_active_stats_summary",
        lambda *_args: (_ for _ in ()).throw(AssertionError("legacy query should not run")),
    )

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") == _active_expected()
    assert db.calls == [
        (
            "monitoring_collection_active_summary_v1",
            {"p_post_ids": ["p1"], "p_target_date": "2026-10-26"},
        )
    ]


def test_active_rpc_incomplete_result_fails_open_to_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    expected = ({"legacy": {}}, {}, set(), {}, set(), {})
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: expected)
    db = _RpcDb({"monitoring_collection_active_summary_v1": _active_rpc_bundle()})

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") == expected


def test_shadow_requires_exact_parity_but_always_returns_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "shadow")
    expected = _active_expected()
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: expected)
    db = _RpcDb({"monitoring_collection_active_summary_v1": _active_rpc_bundle(_active_rpc_row())})

    result = rm._load_active_stats_summary(db, ["p1"], "2026-10-26")

    assert result is expected
    assert result == _active_expected()


def test_shadow_active_mismatch_preserves_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "shadow")
    legacy = _active_expected()
    rpc_row = {**_active_rpc_row(), "max_metric": 501}
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: legacy)
    db = _RpcDb({"monitoring_collection_active_summary_v1": _active_rpc_bundle(rpc_row)})

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") is legacy


def test_active_rpc_exception_fails_open_to_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    legacy = ({}, {}, set(), {}, set(), {})
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: legacy)
    db = _RpcDb({"monitoring_collection_active_summary_v1": RuntimeError("rpc unavailable")})

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") is legacy


def test_active_rpc_declared_count_mismatch_fails_open_to_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    legacy = ({"legacy": {}}, {}, set(), {}, set(), {})
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: legacy)
    db = _RpcDb({
        "monitoring_collection_active_summary_v1": _active_rpc_bundle(
            _active_rpc_row(), row_count=1001
        )
    })

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") is legacy


def test_active_rpc_single_bundle_covers_more_than_postgrest_row_cap(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    rows = [_active_rpc_row(f"p{index}") for index in range(1001)]
    ids = [row["post_id"] for row in rows]
    db = _RpcDb({
        "monitoring_collection_active_summary_v1": _active_rpc_bundle(*rows)
    })
    monkeypatch.setattr(
        rm,
        "_active_stats_summary",
        lambda *_args: (_ for _ in ()).throw(AssertionError("legacy query should not run")),
    )

    result = rm._load_active_stats_summary(db, ids, "2026-10-26")

    assert len(result[0]) == 1001
    assert len(result[1]) == 1001
    assert len(result[2]) == 1001


def test_invalid_mode_fails_open_to_legacy_without_rpc(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "fast-but-unsafe")
    expected = ({}, {"p1": 7}, set(), {}, set(), {})
    monkeypatch.setattr(rm, "_active_stats_summary", lambda db, ids: expected)
    db = _RpcDb({})

    assert rm._load_active_stats_summary(db, ["p1"], "2026-10-26") == expected
    assert db.calls == []


def test_optimized_snapshot_and_invalid_rpc_fallback(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "optimized")
    optimized = {"total_play": 1000, "total_likes": 40, "total_comments": 3, "post_count": 2}
    db = _RpcDb({"monitoring_collection_snapshot_totals_v1": [optimized]})
    monkeypatch.setattr(
        rm,
        "_snapshot_totals",
        lambda *_args: (_ for _ in ()).throw(AssertionError("legacy query should not run")),
    )
    assert rm._load_snapshot_totals(db, ["p1", "p2"], "2026-10-26") == optimized
    assert db.calls[0][1] == {"p_post_ids": ["p1", "p2"], "p_upto": "2026-10-26"}

    fallback = {"total_play": 9, "total_likes": 8, "total_comments": 7, "post_count": 1}
    monkeypatch.setattr(rm, "_snapshot_totals", lambda *_args: fallback)
    bad_db = _RpcDb({"monitoring_collection_snapshot_totals_v1": []})
    assert rm._load_snapshot_totals(bad_db, ["p1"], "2026-10-26") == fallback


def test_shadow_snapshot_mismatch_preserves_legacy(monkeypatch):
    monkeypatch.setenv(rm.COLLECTION_SUMMARY_MODE_ENV, "shadow")
    legacy = {"total_play": 10, "total_likes": 2, "total_comments": 1, "post_count": 1}
    optimized = {**legacy, "total_play": 11}
    monkeypatch.setattr(rm, "_snapshot_totals", lambda *_args: legacy)
    db = _RpcDb({"monitoring_collection_snapshot_totals_v1": [optimized]})

    assert rm._load_snapshot_totals(db, ["p1"], "2026-10-26") is legacy


def test_rpc_integer_decoder_rejects_fractional_values():
    try:
        rm._rpc_optional_int(1.5, "total_play")
    except ValueError as exc:
        assert "non-integer" in str(exc)
    else:
        raise AssertionError("fractional RPC aggregates must fail closed")


def test_sql_preserves_boundaries_tiebreaks_and_service_role_only():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "monitoring_collection_active_summary_v1" in sql
    assert "monitoring_collection_snapshot_totals_v1" in sql
    assert "h.measured_at < p_target_date" in sql
    assert "s.measured_at <= p_upto" in sql
    assert "h.measured_at desc, h.created_at desc, h.id desc" in sql
    assert "h.manual is true" in sql
    assert "h.play_count is not null or h.reach_count is not null" in sql
    assert "returns table (\n  summary_rows jsonb,\n  row_count bigint\n)" in sql
    assert "jsonb_agg(to_jsonb(o) order by o.post_id)" in sql
    assert "current_date" not in sql.lower()
    assert "grant execute on function public.monitoring_collection_active_summary_v1(uuid[], date) to service_role" in sql.lower()
    assert "grant execute on function public.monitoring_collection_snapshot_totals_v1(uuid[], date) to service_role" in sql.lower()
    assert sql.lower().count("from anon") >= 2
    assert sql.lower().count("from authenticated") >= 2
