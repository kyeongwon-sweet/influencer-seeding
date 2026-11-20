#!/usr/bin/env python3
"""주간 교차-복사 스캔(scan_cross_post_copies.py) 계약 테스트.

배경(2026-11-20): 시트 입력 복사 검사(web/lib/stats-import-copy.ts)가 'DB에 이미 같은 값'은 매일
경고하지 않게 바뀌면서, DB에 이미 든 교차복사는 이 주간 스캔이 유일한 보고처가 됐다.
그런데 예전 스캔은 조회수 1만 이상만 봐서 배너 도달수와 1천~1만 사이 위성 값 대부분을 못 봤고,
정렬 없이 페이지를 넘겨 경계 행이 빠질 수 있었다. 아래 테스트가 그 셋을 고정한다.
"""

from __future__ import annotations

import importlib
import io
import json
import re
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))


@pytest.fixture()
def scan(monkeypatch):
    # 예전에는 import 시점에 환경변수를 읽어(키가 없으면 KeyError) 순수 로직을 시험할 수 없었다.
    for name in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)
    import scan_cross_post_copies
    return importlib.reload(scan_cross_post_copies)


def row(post_id, date, play=None, reach=None):
    return {"post_id": post_id, "measured_at": date, "play_count": play, "reach_count": reach}


def test_satellite_values_between_1000_and_10000_are_reported(scan):
    # 11/18 실제 표본 모양: 이슈뜨기·이슈박스(틱톡)가 10-22=1,056, 10-27=1,097을 똑같이 가짐(예전 기준 1만 미만이라 못 봄).
    stats = [row("a", "2026-10-22", 1056), row("b", "2026-10-22", 1056),
             row("a", "2026-10-27", 1097), row("b", "2026-10-27", 1097)]
    genuine, noisy = scan.find_copy_pairs(stats, {"a", "b"})
    assert [(g[0], g[1], sorted(g[2])) for g in genuine] == [("a", "b", ["2026-10-22", "2026-10-27"])]
    assert noisy == []


def test_play_copied_into_banner_reach_is_reported(scan):
    # 2026-08-03 anavocado(배너 도달) ← 박홍(영상 조회) 사고 모양.
    stats = [row("video", "2026-07-29", play=934189), row("banner", "2026-07-29", reach=934189),
             row("video", "2026-07-30", play=948550), row("banner", "2026-07-30", reach=948550)]
    genuine, _ = scan.find_copy_pairs(stats, {"video", "banner"})
    assert len(genuine) == 1
    assert "reach_count" in genuine[0][4] and "play_count" in genuine[0][4]


def test_single_shared_date_is_not_a_copy(scan):
    stats = [row("a", "2026-11-01", 1227), row("b", "2026-11-01", 1227)]
    assert scan.find_copy_pairs(stats, {"a", "b"}) == ([], [])


def test_round_values_are_counted_as_noise_not_listed(scan):
    # 100 단위(1,200·3,500)도 반올림 수기값으로 본다 — 예전 스캔의 1000 단위 기준으로 되돌아가면 실패한다.
    stats = [row("a", "2026-09-01", 1200), row("b", "2026-09-01", 1200),
             row("a", "2026-09-02", 3500), row("b", "2026-09-02", 3500),
             row("c", "2026-09-01", 89000), row("d", "2026-09-01", 89000),
             row("c", "2026-09-02", 90000), row("d", "2026-09-02", 90000)]
    genuine, noisy = scan.find_copy_pairs(stats, {"a", "b", "c", "d"})
    assert genuine == []
    assert sorted(noisy) == [("a", "b"), ("c", "d")]


def test_small_values_and_self_pairs_are_ignored(scan):
    stats = [row("a", "2026-06-15", 14), row("b", "2026-06-15", 14),
             row("a", "2026-06-16", 15), row("b", "2026-06-16", 15),
             # 한 게시물의 조회수와 도달수가 같은 값이어도 자기 자신과는 쌍이 아니다.
             row("c", "2026-08-01", play=5123, reach=5123), row("c", "2026-08-02", play=5234, reach=5234)]
    assert scan.find_copy_pairs(stats, {"a", "b", "c"}) == ([], [])


def test_unknown_posts_are_skipped(scan):
    stats = [row("a", "2026-10-22", 1056), row("ghost", "2026-10-22", 1056),
             row("a", "2026-10-27", 1097), row("ghost", "2026-10-27", 1097)]
    assert scan.find_copy_pairs(stats, {"a"}) == ([], [])


def test_page_requires_unique_final_id_order(scan):
    with pytest.raises(ValueError):
        scan.page("https://x", {}, "post_daily_stats", {"select": "post_id"}, opener=lambda req: io.StringIO("[]"))
    with pytest.raises(ValueError):
        scan.page("https://x", {}, "post_daily_stats", {"select": "post_id", "order": "measured_at.asc"},
                  opener=lambda req: io.StringIO("[]"))


def test_page_reads_every_page_in_id_order(scan):
    seen = []

    def opener(req):
        seen.append((req.full_url, req.get_header("Range")))
        start = int(req.get_header("Range").split("-")[0])
        size = 1000 if start < 2000 else 5
        return io.StringIO(json.dumps([{"id": start + i} for i in range(size)]))

    rows = scan.page("https://x", {}, "post_daily_stats",
                     {"select": "id,post_id", "order": "measured_at.asc,id.asc"}, opener=opener)
    assert len(rows) == 2005
    assert [r for _, r in seen] == ["0-999", "1000-1999", "2000-2999"]
    assert all("order=measured_at.asc%2Cid.asc" in url for url, _ in seen)


def test_criteria_match_the_sheet_import_copy_check(scan):
    """두 검사의 기준이 갈라지면 '시트 검사는 DB 값이라 안 알리고 주간 스캔은 기준이 달라 못 보는' 구멍이 생긴다."""
    lib = (ROOT / "web" / "lib" / "stats-import-copy.ts").read_text(encoding="utf-8")

    def ts_const(name):
        m = re.search(rf"export const {name} = (\d+);", lib)
        assert m, f"{name} 를 web/lib/stats-import-copy.ts 에서 찾지 못했다"
        return int(m.group(1))

    assert scan.MIN_VALUE_DEFAULT == ts_const("COPY_MIN_VALUE")
    assert scan.ROUNDING_EXCLUDE == ts_const("COPY_ROUNDING_EXCLUDE")
    assert scan.MIN_DAYS_DEFAULT == ts_const("COPY_MIN_SHARED_DATES")
    assert set(scan.METRICS) == {"play_count", "reach_count"}

    workflow = (ROOT / ".github" / "workflows" / "cross-post-copy-scan.yml").read_text(encoding="utf-8")
    assert re.search(r"min_value:[\s\S]*?default: \"1000\"", workflow), "수동 실행 기본값이 1000이 아니다"
    assert "inputs.min_value || '1000'" in workflow, "예약 실행 기본값이 1000이 아니다"
    assert "10000" not in workflow


def test_main_reports_with_unchanged_output_keys(scan, monkeypatch, tmp_path):
    """Slack 단계가 읽는 genuine_count/noisy_count 와 보고서 첫 줄 형식은 그대로다."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    report = tmp_path / "report.txt"
    out = tmp_path / "gh_output"
    monkeypatch.setenv("SCAN_REPORT_PATH", str(report))
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    posts = [{"id": "a", "account_name": "이슈뜨기 (틱톡)", "url": "u1", "ended_at": None},
             {"id": "b", "account_name": "이슈박스(틱톡)", "url": "u2", "ended_at": "2026-11-10"}]
    stats = [dict(row("a", "2026-10-22", 1056), id=1), dict(row("b", "2026-10-22", 1056), id=2),
             dict(row("a", "2026-10-27", 1097), id=3), dict(row("b", "2026-10-27", 1097), id=4)]

    def fake_page(base_url, headers, table, query, opener=None):
        assert query["order"] == "id.asc"
        return posts if table == "sponsored_posts" else stats

    monkeypatch.setattr(scan, "page", fake_page)
    scan.main([])
    text = report.read_text(encoding="utf-8")
    assert text.splitlines()[0] == "교차-복사 스캔: stats 4행 / 진짜의심 1쌍 / 라운드오탐 0쌍"
    assert "이슈뜨기 (틱톡)(종료-) ↔ 이슈박스(틱톡)(종료2026-11-10): 2일" in text
    assert out.read_text(encoding="utf-8") == "genuine_count=1\nnoisy_count=0\n"
