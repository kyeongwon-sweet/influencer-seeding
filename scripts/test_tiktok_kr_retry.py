"""틱톡 재시도는 한국 경유(proxyCountryCode=KR) — 2026-10-27 실측: 한국에서만 보이는 위성 글."""
import sys
import types
from pathlib import Path

import run_monitoring as rm


class _FakeClient:
    calls: list = []

    def __init__(self, token):
        pass

    def actor(self, name):
        client = self

        class _Actor:
            def call(self, run_input):
                _FakeClient.calls.append((name, run_input))
                return {"defaultDatasetId": "ds"}
        return _Actor()

    def dataset(self, _id):
        class _Ds:
            def iterate_items(self):
                return iter([{"webVideoUrl": "https://www.tiktok.com/@a/video/7698138117114465556",
                              "playCount": 1165, "diggCount": 7, "commentCount": 0}])
        return _Ds()


def _install_fake(monkeypatch):
    _FakeClient.calls = []
    monkeypatch.setitem(sys.modules, "apify_client", types.SimpleNamespace(ApifyClient=_FakeClient))


def test_default_fetch_has_no_proxy_country(monkeypatch):
    _install_fake(monkeypatch)
    out = rm._fetch_tiktok(["https://www.tiktok.com/@a/video/7698138117114465556"])
    assert out["7698138117114465556"]["views"] == 1165
    name, run_input = _FakeClient.calls[0]
    assert name == "clockworks/tiktok-scraper"
    assert "proxyCountryCode" not in run_input


def test_retry_fetch_sends_korea_proxy(monkeypatch):
    _install_fake(monkeypatch)
    rm._fetch_tiktok(["https://www.tiktok.com/@a/video/7698138117114465556"], rm.TIKTOK_RETRY_PROXY_COUNTRY)
    assert _FakeClient.calls[0][1]["proxyCountryCode"] == "KR"


def test_both_retry_paths_use_korea_proxy():
    root = Path(__file__).resolve().parent
    monitoring = (root / "run_monitoring.py").read_text(encoding="utf-8")
    backfill = (root / "backfill_zero_metric_posts.py").read_text(encoding="utf-8")
    assert "_fetch_tiktok(retry_urls, TIKTOK_RETRY_PROXY_COUNTRY)" in monitoring
    assert "_fetch_tiktok(missing, TIKTOK_RETRY_PROXY_COUNTRY)" in backfill
