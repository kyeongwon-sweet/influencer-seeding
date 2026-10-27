#!/usr/bin/env python3
"""google_ads_sync 단위 테스트 — 네트워크 없이 가짜 API 응답으로 필터·지표·날짜·실패 처리를 고정한다."""
from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import google_ads_sync as g  # noqa: E402

ENV = {"GOOGLE_ADS_DEVELOPER_TOKEN": "d", "GOOGLE_ADS_CLIENT_ID": "c", "GOOGLE_ADS_CLIENT_SECRET": "s",
       "GOOGLE_ADS_REFRESH_TOKEN": "r", "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "323-466-8229",
       "GOOGLE_ADS_CUSTOMER_ID": "815-143-8670"}


def _row(ag_name, date, cost_micros="1500000", imps="10", views="4", camp="[파인트] 인지광고_조회_26.10_관심사타깃_전체"):
    m = {"costMicros": cost_micros, "impressions": imps}
    if views is not None:
        m["videoTrueviewViews"] = views
    return {"campaign": {"id": "24375681538", "name": camp, "advertisingChannelType": "VIDEO"},
            "adGroup": {"id": str(abs(hash(ag_name)) % 10**10), "name": ag_name},
            "segments": {"date": date}, "metrics": m}


def test_product_rule_is_ad_group_name_only_ignoring_space_and_case():
    assert g.is_product_ad_group("1023_렉카형_P바치")
    assert g.is_product_ad_group("(운영X) 1023_먹스타형_p 바치")
    assert g.is_product_ad_group("1008_전화통화형_P바치2")
    assert not g.is_product_ad_group("[복숭아쫀득] 맛인지형_1017")
    assert not g.is_product_ad_group("P바_테스트") and not g.is_product_ad_group(None)


def test_to_rows_keeps_only_product_ad_groups_and_converts_units():
    rows = g.to_rows([_row("1023_렉카형_P바치", "2026-10-26", "4684875000000", "581253", "193586"),
                      _row("[복숭아쫀득] 맛인지형_1017", "2026-10-26")],
                     "metrics.video_trueview_views", "8151438670", "t")
    assert len(rows) == 1
    r = rows[0]
    assert (r["cost_krw"], r["impressions"], r["views"], r["product"]) == (4684875.0, 581253, 193586, "P바치")
    assert r["campaign_id"] == "24375681538" and r["date"] == "2026-10-26" and r["account_id"] == "8151438670"


def test_zero_metrics_omitted_by_api_json_become_zero_not_blank():
    # proto3 JSON 은 0 값을 생략한다 → 조회수 지표를 요청했으면 0, 요청 못 했으면(지표 없음) 빈 값
    rows = g.to_rows([_row("x_P바치", "2026-10-20", cost_micros=None, imps=None, views=None)],
                     "metrics.video_trueview_views", "1", "t")
    assert (rows[0]["cost_krw"], rows[0]["impressions"], rows[0]["views"]) == (0, 0, 0)
    rows2 = g.to_rows([_row("x_P바치", "2026-10-20", views=None)], None, "1", "t")
    assert rows2[0]["views"] is None


def test_older_api_view_field_name_is_mapped():
    r = _row("x_P바치", "2026-10-20", views=None)
    r["metrics"]["videoViews"] = "7"
    assert g.to_rows([r], "metrics.video_views", "1", "t")[0]["views"] == 7


def test_date_range_defaults_to_kst_yesterday_backwards():
    assert g.date_range(None, None, 10, "2026-10-27") == ("2026-10-17", "2026-10-26")
    assert g.date_range("2026-09-25", "2026-10-26", 10, "2026-10-27") == ("2026-09-25", "2026-10-26")
    with pytest.raises(ValueError):
        g.date_range("2026-10-26", "2026-10-01", 10, "2026-10-27")
    assert g.each_date("2026-10-30", "2026-11-02") == ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]


def test_run_markers_distinguish_confirmed_zero_days():
    rows = g.to_rows([_row("x_P바치", "2026-10-25")], "metrics.video_trueview_views", "1", "t")
    mk = g.run_markers(["2026-10-24", "2026-10-25"], rows, "metrics.video_trueview_views", "t")
    assert [(m["payload"]["run_date"], m["payload"]["ad_groups"]) for m in mk] == [
        ("2026-10-24", 0), ("2026-10-25", 1)
    ]
    assert all(m["type"] == "monitoring" and m["status"] == "done" for m in mk)
    assert all(m["payload"]["ops_marker"] == "google_ads_sync:pbachi" for m in mk)


class _FakeResult:
    def __init__(self, data=None):
        self.data = data or []


class _FakeJobsQuery:
    def __init__(self, db):
        self.db, self.mode, self.filters, self.contains_filter = db, None, [], None
        self.values, self.limit_n = None, None

    def select(self, *_args):
        self.mode = "select"
        return self

    def update(self, values):
        self.mode, self.values = "update", values
        return self

    def insert(self, values):
        self.mode, self.values = "insert", values
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def contains(self, column, value):
        self.contains_filter = (column, value)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self.limit_n = value
        return self

    def _matches(self, row):
        if any(row.get(k) != v for k, v in self.filters):
            return False
        if self.contains_filter:
            column, subset = self.contains_filter
            value = row.get(column) or {}
            if any(value.get(k) != v for k, v in subset.items()):
                return False
        return True

    def execute(self):
        if self.mode == "select":
            rows = [row for row in self.db.rows if self._matches(row)]
            return _FakeResult(rows[: self.limit_n] if self.limit_n else rows)
        if self.mode == "insert":
            row = {**self.values, "id": f"job-{len(self.db.rows) + 1}"}
            self.db.rows.append(row)
            self.db.inserts += 1
            return _FakeResult([row])
        if self.mode == "update":
            matched = []
            for row in self.db.rows:
                if self._matches(row):
                    row.update(self.values)
                    matched.append(row)
            self.db.updates += len(matched)
            return _FakeResult(matched)
        raise AssertionError("query mode missing")


class _FakeJobsDb:
    def __init__(self):
        self.rows, self.inserts, self.updates = [], 0, 0

    def table(self, name):
        assert name == "jobs"
        return _FakeJobsQuery(self)


def test_job_markers_insert_once_then_update_idempotently():
    db = _FakeJobsDb()
    markers = g.run_markers(["2026-10-24", "2026-10-25"], [], "metrics.video_views", "t1")
    g.upsert_job_markers(db, markers)
    assert (len(db.rows), db.inserts, db.updates) == (2, 2, 0)

    changed = g.run_markers(["2026-10-24", "2026-10-25"], [], "metrics.video_views", "t2")
    changed[1]["payload"]["ad_groups"] = 3
    g.upsert_job_markers(db, changed)
    assert (len(db.rows), db.inserts, db.updates) == (2, 2, 2)
    assert [row["payload"]["fetched_at"] for row in db.rows] == ["t2", "t2"]
    assert db.rows[1]["payload"]["ad_groups"] == 3


class _FakeOpen:
    """oauth → access_token, searchStream → 첫 조회수 지표 이름은 거부(400), 두 번째는 수락."""

    def __init__(self, reject=("metrics.video_trueview_views",)):
        self.reject, self.queries = reject, []

    def __call__(self, req, timeout=0):
        if "oauth2" in req.full_url:
            return io.BytesIO(json.dumps({"access_token": "a"}).encode())
        q = json.loads(req.data.decode())["query"]
        self.queries.append(q)
        assert req.headers["Login-customer-id"] == "3234668229"
        assert "/customers/8151438670/" in req.full_url
        bad = next((f for f in self.reject if f in q), None)
        if bad:
            body = io.BytesIO(json.dumps({"error": {"message": f"Unrecognized field in the query: '{bad}'."}}).encode())
            raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, body)
        if "FROM customer" in q:
            return io.BytesIO(json.dumps([{"results": [{"customer": {"timeZone": "Asia/Seoul"}}]}]).encode())
        r = _row("1016_렉카형_P바치", "2026-10-19", views=None)
        r["metrics"]["videoViews"] = "3"
        return io.BytesIO(json.dumps([{"results": [r]}]).encode())


def test_view_metric_fallback_and_ids_without_hyphens():
    fake = _FakeOpen()
    ads = g.GoogleAds(ENV, fake)
    assert g.account_time_zone(ads) == "Asia/Seoul"
    results, vf = g.fetch_ad_group_daily(ads, "2026-10-19", "2026-10-19")
    assert vf == "metrics.video_views" and len(fake.queries) == 3
    assert g.to_rows(results, vf, ads.customer, "t")[0]["views"] == 3


def test_other_api_errors_are_not_swallowed():
    class Boom(_FakeOpen):
        def __call__(self, req, timeout=0):
            if "oauth2" in req.full_url:
                return io.BytesIO(b'{"access_token":"a"}')
            raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b'{"error":"PERMISSION_DENIED"}'))
    with pytest.raises(g.GoogleAdsError):
        g.fetch_ad_group_daily(g.GoogleAds(ENV, Boom()), "2026-10-19", "2026-10-19")


def test_missing_credentials_fail_loudly():
    with pytest.raises(RuntimeError, match="자격증명 미설정"):
        g.GoogleAds({**ENV, "GOOGLE_ADS_REFRESH_TOKEN": ""})


def test_wrong_account_time_zone_stops_before_saving(monkeypatch):
    class TokyoOpen(_FakeOpen):
        def __call__(self, req, timeout=0):
            if "oauth2" not in req.full_url and "FROM customer" in json.loads(req.data.decode())["query"]:
                return io.BytesIO(json.dumps([{"results": [{"customer": {"timeZone": "America/Los_Angeles"}}]}]).encode())
            return super().__call__(req, timeout)
    real = g.GoogleAds
    monkeypatch.setattr(g, "GoogleAds", lambda: real(ENV, TokyoOpen()))
    monkeypatch.setenv("DRY_RUN", "true")
    assert g.main() == 1

