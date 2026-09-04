#!/usr/bin/env python3
"""진단 조회 함정 회귀 테스트 — 2026-09-04 하루에 네 번 틀린 것을 각각 고정한다.

수치는 전부 그날 실측이다(09-03 적재 1,196행 / 값 881, 오염값 116,853 은 reach 쪽).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db_probe import (  # noqa: E402
    PAGE_MAX,
    assert_window_covers,
    count,
    fetch_all,
    fmt,
    load_env,
    metric,
)

ENV = {"url": "https://x.supabase.co", "key": "k"}


def fake_pages(total: int):
    """offset/limit 을 해석해 total 행을 페이지로 잘라주는 가짜 전송."""
    def transport(url, headers):
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(url).query)
        limit = int(q.get("limit", ["1000"])[0])
        off = int(q.get("offset", ["0"])[0])
        rows = [{"id": i} for i in range(off, min(off + limit, total))]
        return json.dumps(rows).encode(), {}
    return transport


# ── ③ 절단: limit 을 크게 줘도 상한 1000 → 첫 페이지만 받는 실수 ──
def test_fetch_all_pages_past_the_server_cap():
    got = fetch_all(ENV, "post_daily_stats", {"select": "id", "order": "id.asc"},
                    transport=fake_pages(1196))
    assert len(got) == 1196, len(got)          # 실측: 09-03 적재 행수
    assert PAGE_MAX == 1000


def test_fetch_all_rejects_manual_limit_offset():
    for bad in ({"limit": 3000}, {"offset": 0}):
        try:
            fetch_all(ENV, "t", dict({"select": "id", "order": "id.asc"}, **bad),
                      transport=fake_pages(10))
        except RuntimeError as e:
            assert "절단" in str(e)
        else:
            raise AssertionError(f"limit/offset 직접 지정을 막지 못했다: {bad}")


def test_fetch_all_requires_unique_sort_key():
    try:
        fetch_all(ENV, "t", {"select": "id", "order": "measured_at.asc"},
                  transport=fake_pages(10))
    except RuntimeError as e:
        assert "유일 정렬키" in str(e)
    else:
        raise AssertionError("유일 정렬키 없는 페이지네이션을 막지 못했다")


def test_count_reads_server_total_not_page_length():
    def transport(url, headers):
        assert headers.get("Prefer") == "count=exact"
        return b"[]", {"Content-Range": "0-0/1196"}
    assert count(ENV, "post_daily_stats", {"select": "id"}, transport=transport) == 1196


# ── ① play_count 만 보고 reach 를 놓치는 실수 ──
def test_metric_finds_reach_when_play_is_null():
    assert metric({"play_count": None, "reach_count": 116853}) == 116853   # 실측 오염값
    assert metric({"play_count": 37970, "reach_count": None}) == 37970
    assert metric({"play_count": None, "reach_count": None}) is None
    assert metric(None) is None


def test_metric_keeps_real_zero():
    """play_count == 0 은 '아무도 안 봤다'는 실측 → None 으로 뭉개면 안 된다."""
    assert metric({"play_count": 0, "reach_count": 999}) == 0


# ── ② NULL 을 0 으로 찍는 실수 ──
def test_fmt_never_confuses_null_with_zero():
    assert fmt(None) == "NULL"
    assert fmt(0) == "0"
    assert fmt(None) != fmt(0)
    assert fmt(180654) == "180,654"


# ── ④ 검증 창이 변경일을 비켜가는 실수 ──
def test_window_must_cover_the_change_manifest():
    manifest = ["2026-08-26", "2026-08-27", "2026-09-01"]   # 백업 파일이 지목한 실제 변경일
    try:
        assert_window_covers(manifest, "2026-08-28", "2026-09-03")
    except RuntimeError as e:
        assert "2026-08-26" in str(e) and "2026-08-27" in str(e)
        assert "무효" in str(e)
    else:
        raise AssertionError("변경일을 비켜간 창을 통과시켰다")
    assert_window_covers(manifest, "2026-08-20", "2026-09-03")   # 덮으면 통과


def test_load_env_rejects_placeholder_file(tmp=None):
    """워크트리 web/.env.local 은 값이 전부 ""인 placeholder — 그대로 쓰면 조용히 실패한다."""
    import tempfile, os
    d = tempfile.mkdtemp()
    empty = os.path.join(d, "empty.env")
    real = os.path.join(d, "real.env")
    open(empty, "w", encoding="utf-8").write('NEXT_PUBLIC_SUPABASE_URL=""\nSUPABASE_SERVICE_ROLE_KEY=""\n')
    open(real, "w", encoding="utf-8").write('NEXT_PUBLIC_SUPABASE_URL="https://real.supabase.co"\nSUPABASE_SERVICE_ROLE_KEY="rk"\n')
    env = load_env((empty, real))
    assert env["url"] == "https://real.supabase.co", env
    assert env["source"] == real


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("[OK] test_db_probe 통과 (10종: 절단/limit금지/유일키/서버카운트/reach탐지/실측0/"
          "NULL≠0/창검증×2/placeholder env)")
