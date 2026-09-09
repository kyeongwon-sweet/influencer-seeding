#!/usr/bin/env python3
"""플랫폼 수집 붕괴 감시 회귀 테스트 (2026-09-08 유튜브 268건 사고)."""
from __future__ import annotations

from platform_coverage_guard import platform_collapse_line, platform_collapses

TARGET = "2026-09-08"
PREV = ["2026-09-0%d" % i for i in range(1, 8)]      # 09-01 ~ 09-07


def _posts(prefix, n, host):
    return [{"id": f"{prefix}{i}", "url": f"https://{host}/x{i}"} for i in range(n)]


YT = _posts("yt", 100, "www.youtube.com")
IG = _posts("ig", 100, "www.instagram.com")


def _cov(yt_on_target, ig_on_target=95, yt_prev=95):
    m = {d: {p["id"] for p in YT[:yt_prev]} | {p["id"] for p in IG[:95]} for d in PREV}
    m[TARGET] = {p["id"] for p in YT[:yt_on_target]} | {p["id"] for p in IG[:ig_on_target]}
    return m


def test_youtube_collapse_is_detected():
    """🚨 실제 사고 형태: 평소 95% → 당일 3%."""
    hits = platform_collapses(YT + IG, _cov(3), TARGET, PREV)
    assert [h["platform"] for h in hits] == ["유튜브"]
    h = hits[0]
    assert h["measured"] == 3 and h["missing"] == 97 and h["active"] == 100
    line = platform_collapse_line(hits, TARGET)
    assert "플랫폼 수집 붕괴" in line and "유튜브 3/100건" in line and "미수집 97건" in line


def test_normal_day_is_silent():
    assert platform_collapses(YT + IG, _cov(94), TARGET, PREV) == []
    assert platform_collapse_line([], TARGET) is None


def test_small_gap_below_threshold_is_silent():
    """일상적 소규모 공백(임계 미만)은 알리지 않는다 — 매일 울리면 신호가 죽는다."""
    tiny = [{"id": f"t{i}", "url": f"https://www.tiktok.com/@a/video/{i}"} for i in range(15)]
    cov = {d: {p["id"] for p in tiny} for d in PREV}
    cov[TARGET] = set()                                  # 15건 전멸이지만 임계(20) 미만
    assert platform_collapses(tiny, cov, TARGET, PREV) == []


def test_platform_with_low_baseline_is_ignored():
    """평소부터 자동수집이 거의 없는 플랫폼(수기 관리)은 대상 아님 — 상시 오탐 방지."""
    cov = {d: set() for d in PREV}
    cov[TARGET] = set()
    assert platform_collapses(IG, cov, TARGET, PREV) == []


def test_multiple_platforms_sorted_by_missing():
    cov = _cov(3, ig_on_target=0)
    hits = platform_collapses(YT + IG, cov, TARGET, PREV)
    assert [h["platform"] for h in hits] == ["인스타", "유튜브"]   # 미수집 100 > 97 순
