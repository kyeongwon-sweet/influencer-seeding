#!/usr/bin/env python3
"""patch_report_youtube_gads — 발송된 바치케 리포트의 유튜브 줄만 Google Ads 값으로 교체(2026-10-27)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("REPORT_PRODUCT", "pbachi")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import patch_report_youtube_gads as p  # noqa: E402

# 10/26 바치케 리포트(전환 메타 반영 뒤) 실물 축약
REPORT = """:바치케: *바치케 조회수 일일 증분* `(2026-10-26)`
오늘 총 증분 *+303,319*

──────────

:black_medium_small_square: *채널분류별*

• *인지 광고*  `CPV는 일일 기준`
    유튜브 *+193,586*  CPV 24.2원
    전환 조회수 *+81,038*

`CPV는 누적 기준 / 하이퍼링크 금일 채널별 BEST`

• <https://www.instagram.com/p/DegjWPft3Db/|협찬 (인플루언서)> *+27,142*  CPV 27.5원"""


def test_replaces_only_youtube_line_and_total_by_delta():
    new, info = p.replace_youtube_line(REPORT, 193_700, 4_685_900.0)
    assert info["new_total"] == 303_319 - 193_586 + 193_700
    assert "    유튜브 *+193,700*  CPV 24.2원" in new and "오늘 총 증분 *+303,433*" in new
    changed = [ln for ln in REPORT.split("\n") if ln not in new.split("\n")]
    assert len(changed) == 2 and "    전환 조회수 *+81,038*" in new


def test_same_values_is_noop_and_cpv_only_change_keeps_total():
    again, reason = p.replace_youtube_line(REPORT, 193_586, 4_684_875.0)
    assert again is None and "같음" in reason
    new, info = p.replace_youtube_line(REPORT, 193_586, 5_000_000.0)
    assert info["new_total"] == 303_319 and "CPV 25.8원" in new and not info["views_changed"]


def test_report_without_youtube_line_is_not_touched():
    no_yt = REPORT.replace("    유튜브 *+193,586*  CPV 24.2원\n", "")
    new, reason = p.replace_youtube_line(no_yt, 10, 1.0)
    assert new is None and "유튜브 줄 없음" in reason


def test_goal_line_recomputed_when_present():
    jd = REPORT.replace("오늘 총 증분 *+303,319*\n", "오늘 총 증분 *+303,319*\n:dart: *일 190만 목표* 16% · 미달 -1,596,681\n")
    new, _ = p.replace_youtube_line(jd, 193_686, 1.0)
    assert "*일 190만 목표* 16% · 미달 -1,596,581" in new


def test_cpv_format_matches_report_generator():
    from notify_increments import _ad_cpv
    for c, v in ((4_684_875, 193_586), (0, 5), (12, 0), (1_234_567.8, 12_345)):
        assert p.ad_cpv(c, v) == _ad_cpv(c, v)


class _Q:
    def __init__(self, data):
        self.data = data
    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def contains(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def execute(self): return self


class _SB:
    def __init__(self, marker, rows):
        self.marker, self.rows = marker, rows
    def table(self, name):
        return _Q(self.marker if name == "jobs" else self.rows)


def test_unfetched_day_or_blank_views_is_blank_not_zero():
    assert p.gads_day(_SB([], [{"views": 1, "cost_krw": 2}]), "2026-10-26") is None
    assert p.gads_day(_SB([{"run_date": "x"}], [{"views": None, "cost_krw": 2}]), "2026-10-26") is None
    assert p.gads_day(_SB([{"run_date": "x"}], []), "2026-10-26") == (0, 0)   # 조회했고 행 없음 = 노출 없음
    assert p.gads_day(_SB([{"run_date": "x"}], [{"views": 3, "cost_krw": "10.5"}, {"views": 4, "cost_krw": 1}]),
                      "2026-10-26") == (7, 11.5)


def test_reader_matches_marker_written_by_sync():
    """보정 도구가 찾는 마커 = 수집기가 jobs 에 쓰는 마커(type·status·payload 키) — 한쪽만 바뀌면 조용히 '미조회'가 된다."""
    import google_ads_sync as g
    m = g.run_markers(["2026-10-26"], [], "metrics.video_trueview_views", "t")[0]
    assert m["type"] == "monitoring" and m["status"] == "done"
    assert m["payload"]["ops_marker"] == p.RUN_SERVICE and m["payload"]["run_date"] == "2026-10-26"


# ── 2026-10-27 사용자 결정 "지금 바꿔": 바치케 리포트 유튜브 줄 = Google Ads, 미조회 날은 시트 + '(시트)' ──

def _notify_with(monkeypatch, product, gads):
    """notify._fetch_awareness_ads 를 가짜 시트·메타 라우트 + 가짜 DB(gads=(views,cost) | None=미조회)로 돌린다."""
    import io
    import json as _json
    import meta_conversion
    import notify_increments as ni
    monkeypatch.setenv("APP_URL", "https://x.example")
    monkeypatch.setenv("CRON_SECRET", "s")
    monkeypatch.setattr(ni, "PROFILE", ni.PRODUCT_PROFILES[product])
    sheet = {"found": True, "youtube": {"views": 193586, "cost": 4684875}, "meta": {"views": None, "cost": None},
             "conversion": {"views": 97539}}

    def fake_urlopen(req, timeout=0):
        if "/api/meta-ads-pbachi" in req.full_url:
            return io.BytesIO(_json.dumps({"scanned": 5, "conversion": {"impressions": 81038}}).encode())
        return io.BytesIO(_json.dumps(sheet).encode())

    monkeypatch.setattr(ni.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(meta_conversion.urllib.request, "urlopen", fake_urlopen)
    calls = []
    monkeypatch.setattr(ni, "get_client", lambda: calls.append(1) or object())
    monkeypatch.setattr(ni, "product_day_totals", lambda sb, d: gads)
    return ni, ni._fetch_awareness_ads("2026-10-26"), calls


def test_pbachi_report_youtube_uses_google_ads(monkeypatch):
    ni, d, _ = _notify_with(monkeypatch, "pbachi", (193585, 4684658.0))
    assert d["youtube"] == {"views": 193585, "cost": 4684658.0, "source": "google_ads"}
    assert d["conversion"]["views"] == 81038   # 전환(메타)은 그대로


def test_pbachi_unfetched_day_falls_back_to_sheet_and_is_marked(monkeypatch):
    ni, d, _ = _notify_with(monkeypatch, "pbachi", None)
    assert d["youtube"] == {"views": 193586, "cost": 4684875, "source": "sheet_fallback"}


def test_jd_report_youtube_untouched(monkeypatch):
    ni, d, calls = _notify_with(monkeypatch, "jd", (1, 1.0))
    assert d["youtube"] == {"views": 193586, "cost": 4684875} and calls == []   # 쫀득바는 DB 조회도 안 함


def test_patch_can_replace_sheet_fallback_line():
    fb = REPORT.replace("    유튜브 *+193,586*  CPV 24.2원", "    유튜브 *+193,586*  CPV 24.2원  _(시트)_")
    new, info = p.replace_youtube_line(fb, 193_585, 4_684_658.0)
    assert "_(시트)_" not in new and "    유튜브 *+193,585*  CPV 24.2원" in new and info["new_total"] == 303_318
