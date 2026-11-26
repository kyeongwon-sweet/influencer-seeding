#!/usr/bin/env python3
"""주간 교차-복사 스캔(scan_cross_post_copies.py) 계약 테스트.

배경
  - 2026-11-20: 시트 입력 복사 검사가 'DB에 이미 같은 값'은 매일 경고하지 않게 바뀌어, DB에 이미 든 교차복사는
    이 주간 스캔이 유일한 보고처가 됐다. 그래서 기준을 시트 검사와 같게(조회수·도달수, 1천 이상) 넓혔다.
  - 2026-11-26 진단: 넓힌 기준이 저조회(1~3천) 위성 영상끼리의 **우연 일치**를 대량으로 '진짜의심'에 올렸다
    (22쌍 → 324쌍). 유튜브 8개 실측에서 DB 값이 진짜였고, 수집기는 영상 ID가 같을 때만 값을 붙인다.
    그래서 '진짜의심'은 복사 증거(① 시트 수기값 ② 같은 영상 중복 등록)가 있는 쌍만으로 좁혔고,
    슬랙 알림은 최근 14일 안에 증거가 있을 때만 보낸다. 아래 테스트가 이 규칙을 고정한다.
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


def row(post_id, date, play=None, reach=None, manual=False, likes=None, comments=None):
    return {"post_id": post_id, "measured_at": date, "play_count": play, "reach_count": reach,
            "manual": manual, "likes_count": likes, "comments_count": comments}


def test_automatic_low_count_coincidence_is_not_listed(scan):
    # 11/18 실제 표본 모양: 이슈뜨기·이슈박스(틱톡)가 10-22=1,056, 10-27=1,097을 똑같이 가졌다.
    # 둘 다 수집기 자동값이고 좋아요가 다르다 → 각자 측정된 진짜 값의 우연 일치(11-26 진단). 목록에 올리지 않는다.
    stats = [row("a", "2026-10-22", 1056, likes=13), row("b", "2026-10-22", 1056, likes=10),
             row("a", "2026-10-27", 1097, likes=14), row("b", "2026-10-27", 1097, likes=13)]
    genuine, noisy, coincidence = scan.find_copy_pairs(stats, {"a", "b"})
    assert genuine == []
    assert coincidence == [("a", "b")]
    assert noisy == []


def test_sheet_entered_copy_is_reported(scan):
    # 같은 값이라도 한쪽이 사람이 시트에 적은 값이면 복사 경로(시트 복사·드래그 → importStats)다.
    stats = [row("a", "2026-07-29", 482920, manual=True), row("b", "2026-07-29", 482920, likes=21000),
             row("a", "2026-07-30", 494165, manual=True), row("b", "2026-07-30", 494165, likes=21500)]
    genuine, _, coincidence = scan.find_copy_pairs(stats, {"a", "b"})
    assert [(p.a, p.b, sorted(p.dates), p.kinds) for p in genuine] == [
        ("a", "b", ["2026-07-29", "2026-07-30"], (scan.KIND_SHEET,))]
    assert coincidence == []


def test_play_copied_into_banner_reach_is_reported(scan):
    # 2026-08-03 anavocado(배너 도달·시트 수기) ← 박홍(영상 조회·자동) 사고 모양.
    stats = [row("video", "2026-07-29", play=934189, likes=21700), row("banner", "2026-07-29", reach=934189, manual=True),
             row("video", "2026-07-30", play=948550, likes=21900), row("banner", "2026-07-30", reach=948550, manual=True)]
    genuine, _, _ = scan.find_copy_pairs(stats, {"video", "banner"})
    assert len(genuine) == 1
    assert genuine[0].kinds == (scan.KIND_SHEET,)
    assert {"reach_count", "play_count"} <= genuine[0].metrics


def test_one_sheet_entered_day_is_not_enough(scan):
    # 증거 날짜도 2일 이상이어야 한다(자동값 우연 일치 1일 + 수기 1일 = 통과).
    stats = [row("a", "2026-10-22", 1056, manual=True), row("b", "2026-10-22", 1056, likes=10),
             row("a", "2026-10-27", 1097, likes=14), row("b", "2026-10-27", 1097, likes=13)]
    genuine, _, coincidence = scan.find_copy_pairs(stats, {"a", "b"})
    assert genuine == [] and coincidence == [("a", "b")]


def test_same_video_registered_twice_is_reported(scan):
    # 같은 영상이 두 행으로 등록되면 수집 결과(조회수·좋아요·댓글)가 날마다 통째로 같다.
    stats = []
    for i, d in enumerate(["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]):
        for pid in ("a", "b"):
            stats.append(row(pid, d, 2345 + i * 11, likes=40 + i, comments=3))
    genuine, _, _ = scan.find_copy_pairs(stats, {"a", "b"})
    assert len(genuine) == 1
    assert genuine[0].kinds == (scan.KIND_DUPLICATE,)
    assert len(genuine[0].dates) == 4


def test_small_equal_likes_on_a_few_days_are_not_a_duplicate(scan):
    # 11-26 실측 모양: 좋아요 7·12처럼 작은 수는 우연히 같기 쉽다. 함께 측정한 20일 중 3일만 통째로 같으면
    # (3일 이상이지만 80%에 못 미침) 같은 영상이 아니라 우연이다.
    stats = []
    for n in range(20):
        d = f"2026-11-{n + 1:02d}"
        same = n in (5, 6, 7)
        stats.append(row("a", d, 1300 + n * 3, likes=7, comments=2))
        stats.append(row("b", d, 1300 + n * 3 + (0 if same else 2), likes=7, comments=2 if same else 1))
    genuine, _, coincidence = scan.find_copy_pairs(stats, {"a", "b"})
    assert genuine == [] and coincidence == [("a", "b")]


def test_views_equal_but_likes_differ_is_not_a_duplicate(scan):
    # 조회수·댓글이 같아도 좋아요가 다르면 다른 영상이다(썰뜨기 두 쇼츠: 1,204·1,204, 좋아요 5·8).
    stats = []
    for d in ("2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"):
        stats += [row("a", d, 1204, likes=5, comments=0), row("b", d, 1204, likes=8, comments=0)]
    genuine, _, coincidence = scan.find_copy_pairs(stats, {"a", "b"})
    assert genuine == [] and coincidence == [("a", "b")]


def test_single_shared_date_is_not_a_copy(scan):
    stats = [row("a", "2026-11-01", 1227, manual=True), row("b", "2026-11-01", 1227)]
    assert scan.find_copy_pairs(stats, {"a", "b"}) == ([], [], [])


def test_round_values_are_counted_as_noise_not_listed(scan):
    # 100 단위(1,200·3,500)도 반올림 수기값으로 본다 — 예전 스캔의 1000 단위 기준으로 되돌아가면 실패한다.
    stats = [row("a", "2026-09-01", 1200, manual=True), row("b", "2026-09-01", 1200, manual=True),
             row("a", "2026-09-02", 3500, manual=True), row("b", "2026-09-02", 3500, manual=True),
             row("c", "2026-09-01", 89000, manual=True), row("d", "2026-09-01", 89000, manual=True),
             row("c", "2026-09-02", 90000, manual=True), row("d", "2026-09-02", 90000, manual=True)]
    genuine, noisy, coincidence = scan.find_copy_pairs(stats, {"a", "b", "c", "d"})
    assert genuine == [] and coincidence == []
    assert sorted(noisy) == [("a", "b"), ("c", "d")]


def test_small_values_and_self_pairs_are_ignored(scan):
    stats = [row("a", "2026-06-15", 14, manual=True), row("b", "2026-06-15", 14, manual=True),
             row("a", "2026-06-16", 15, manual=True), row("b", "2026-06-16", 15, manual=True),
             # 한 게시물의 조회수와 도달수가 같은 값이어도 자기 자신과는 쌍이 아니다.
             row("c", "2026-08-01", play=5123, reach=5123, manual=True),
             row("c", "2026-08-02", play=5234, reach=5234, manual=True)]
    assert scan.find_copy_pairs(stats, {"a", "b", "c"}) == ([], [], [])


def test_unknown_posts_are_skipped(scan):
    stats = [row("a", "2026-10-22", 1056, manual=True), row("ghost", "2026-10-22", 1056),
             row("a", "2026-10-27", 1097, manual=True), row("ghost", "2026-10-27", 1097)]
    assert scan.find_copy_pairs(stats, {"a"}) == ([], [], [])


def test_alert_window_is_recent_14_days_in_kst(scan):
    old = [row("a", "2026-07-01", 40297, manual=True), row("b", "2026-07-01", 40297, manual=True),
           row("a", "2026-07-02", 41123, manual=True), row("b", "2026-07-02", 41123, manual=True)]
    new = [row("c", "2026-11-12", 2341, manual=True), row("d", "2026-11-12", 2341),
           row("c", "2026-11-20", 2457, manual=True), row("d", "2026-11-20", 2457)]
    genuine, _, _ = scan.find_copy_pairs(old + new, {"a", "b", "c", "d"})
    assert len(genuine) == 2
    assert scan.recent_cutoff("2026-11-26") == "2026-11-12"
    assert [(p.a, p.b) for p in scan.recent_pairs(genuine, "2026-11-26")] == [("c", "d")]
    assert scan.recent_pairs(genuine, "2026-12-05") == []  # 11-20 증거가 14일 창을 벗어남


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
    """두 검사의 값 기준이 갈라지면 '시트 검사는 DB 값이라 안 알리고 주간 스캔은 기준이 달라 못 보는' 구멍이 생긴다."""
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


def test_workflow_alerts_only_on_recent_evidence(scan):
    """옛 오염 목록을 매주 반복하지 않도록, 슬랙 단계는 recent_count 로만 켜진다."""
    workflow = (ROOT / ".github" / "workflows" / "cross-post-copy-scan.yml").read_text(encoding="utf-8")
    assert "if: steps.scan.outputs.recent_count != '0'" in workflow
    assert "if: steps.scan.outputs.genuine_count != '0'" not in workflow
    assert "RECENT_COUNT: ${{ steps.scan.outputs.recent_count }}" in workflow
    assert "STATUS_USER: U0B2Y0ZC8QZ" in workflow  # 받는 사람은 그대로


def test_main_reports_with_output_keys(scan, monkeypatch, tmp_path):
    """Slack 단계가 읽는 출력 키와 보고서 첫 줄 형식."""
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    report = tmp_path / "report.txt"
    out = tmp_path / "gh_output"
    monkeypatch.setenv("SCAN_REPORT_PATH", str(report))
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    posts = [{"id": "a", "account_name": "이슈뜨기 (틱톡)", "url": "u1", "ended_at": None},
             {"id": "b", "account_name": "이슈박스(틱톡)", "url": "u2", "ended_at": "2026-11-10"},
             {"id": "c", "account_name": "썰뜨기(유튜브)", "url": "u3", "ended_at": None},
             {"id": "d", "account_name": "썰뜨기(유튜브)", "url": "u4", "ended_at": None}]
    stats = [dict(row("a", "2026-11-20", 1056, manual=True), id=1), dict(row("b", "2026-11-20", 1056, likes=10), id=2),
             dict(row("a", "2026-11-21", 1097, manual=True), id=3), dict(row("b", "2026-11-21", 1097, likes=13), id=4),
             # 자동값끼리 우연 일치(썰뜨기 두 쇼츠 1,204 — 11-26 실측 진짜 값)
             dict(row("c", "2026-11-20", 1204, likes=5), id=5), dict(row("d", "2026-11-20", 1204, likes=8), id=6),
             dict(row("c", "2026-11-21", 1204, likes=5), id=7), dict(row("d", "2026-11-21", 1204, likes=8), id=8)]

    def fake_page(base_url, headers, table, query, opener=None):
        assert query["order"] == "id.asc"
        if table == "post_daily_stats":
            assert {"manual", "likes_count", "comments_count"} <= set(query["select"].split(","))
        return posts if table == "sponsored_posts" else stats

    monkeypatch.setattr(scan, "page", fake_page)
    scan.main([], today="2026-11-26")
    text = report.read_text(encoding="utf-8")
    assert text.splitlines()[0] == "교차-복사 스캔: stats 8행 / 진짜의심 1쌍 / 라운드오탐 0쌍"
    assert "새 증거가 있는 진짜의심: 1쌍" in text
    assert "우연 일치(복사 아님, 목록 제외): 1쌍" in text
    assert "[최근] 이슈뜨기 (틱톡)(종료-) ↔ 이슈박스(틱톡)(종료2026-11-10): 2일(최근 2026-11-21)" in text
    assert "[시트 수기]" in text
    assert "썰뜨기(유튜브)(종료-) ↔" not in text  # 우연 일치는 목록에 없다
    assert out.read_text(encoding="utf-8") == "genuine_count=1\nnoisy_count=0\nrecent_count=1\ncoincidence_count=1\n"
