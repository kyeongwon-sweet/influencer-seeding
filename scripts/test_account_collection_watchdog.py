#!/usr/bin/env python3
"""계정 단위 수집 전멸 감시 단위 테스트 — 2026-08-28 유머박스(틱톡) 사고를 회귀 케이스로 고정.

사고: 활성 56건이 08-19부터 9일 연속 0건이었는데 알림이 한 번도 없었다.
삭제 감지가 not_found에만 걸려 있어 collector_error(null)로 떨어진 삭제를 못 봤고,
자정수집 리포트는 위성/온드를 '측정 제외'로 빼서 그 스코프로도 안 잡혔다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from account_collection_watchdog import (  # noqa: E402
    eligible_on,
    find_dead_accounts,
    format_alert,
    is_global_failure,
    should_alert,
)

DAYS = ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23"]


def post(pid, acct, posted="2026-07-01", ended=None, url=None):
    return {"id": pid, "account_name": acct, "posted_at": posted,
            "ended_at": ended, "url": url or ("https://x/" + pid)}


def rows(mapping):
    return {day: set(ids) for day, ids in mapping.items()}


def test_dead_account_is_detected_with_streak():
    """사고 재현: 한 계정 전체가 최근 3일 연속 0건 → 감지."""
    posts = [post("a1", "유머박스"), post("a2", "유머박스"), post("a3", "유머박스")]
    r = rows({
        "2026-08-27": [], "2026-08-26": [], "2026-08-25": [],
        "2026-08-24": ["a1", "a2", "a3"],
    })
    dead = find_dead_accounts(posts, r, DAYS, streak_days=1, min_posts=3)
    assert len(dead) == 1, dead
    assert dead[0]["account"] == "유머박스"
    assert dead[0]["streak"] == 3
    assert dead[0]["since"] == "2026-08-25"
    assert dead[0]["last_ok"] == "2026-08-24"


def test_partial_failure_is_not_flagged():
    """개별 게시물 실패는 흔하다 — 계정 전체가 0%일 때만 잡아야 오탐이 안 난다."""
    posts = [post("b1", "썰박스"), post("b2", "썰박스"), post("b3", "썰박스")]
    r = rows({"2026-08-27": ["b1"], "2026-08-26": ["b1", "b2"]})
    assert find_dead_accounts(posts, r, DAYS, streak_days=1, min_posts=3) == []


def test_small_accounts_are_skipped():
    """게시물 1~2건 계정은 표본이 작아 소음이 된다 — min_posts 미만은 판정하지 않는다."""
    posts = [post("c1", "작은계정"), post("c2", "작은계정")]
    r = rows({"2026-08-27": [], "2026-08-26": []})
    assert find_dead_accounts(posts, r, DAYS, streak_days=1, min_posts=3) == []


def test_ended_and_unposted_are_excluded():
    """종료된 게시물과 아직 게시 전인 게시물은 '수집돼야 했던' 대상이 아니다."""
    assert eligible_on(post("d1", "x", posted="2026-08-28"), "2026-08-27") is False
    assert eligible_on(post("d2", "x", ended="2026-08-20"), "2026-08-27") is False
    assert eligible_on(post("d3", "x"), "2026-08-27") is True

    posts = [post("e1", "종료계정", ended="2026-08-01"),
             post("e2", "종료계정", ended="2026-08-01"),
             post("e3", "종료계정", ended="2026-08-01")]
    assert find_dead_accounts(posts, rows({}), DAYS, streak_days=1, min_posts=3) == []


def test_alert_escalates_instead_of_repeating_daily():
    """유머박스는 9일 연속이었다 — 매일 알리면 DM 9통이 되어 오히려 무시된다.

    첫 감지일과 이후 7일마다만 알린다.
    """
    fired = [s for s in range(1, 16) if should_alert(s, threshold=1, every=7)]
    assert fired == [1, 8, 15], fired
    assert should_alert(0, threshold=1, every=7) is False
    # 임계가 3이면 3일째 첫 알림, 이후 10·17일째
    assert [s for s in range(1, 18) if should_alert(s, threshold=3, every=7)] == [3, 10, 17]


def test_global_failure_is_reported_as_one_line():
    """수집 자체가 안 돈 날엔 모든 계정이 0%가 된다 — 계정 나열은 오히려 방해다."""
    assert is_global_failure(30, 40, ratio=0.5) is True
    assert is_global_failure(1, 40, ratio=0.5) is False
    assert is_global_failure(20, 40, ratio=0.5) is True     # 경계 포함
    assert is_global_failure(5, 0, ratio=0.5) is False      # 0으로 나누지 않는다


def test_alert_text_pins_down_urls():
    """알림은 계정명만으로 식별되지 않는다 — 게시물 URL을 반드시 짚어야 한다."""
    dead = [{"account": "유머박스(틱톡)", "streak": 9, "posts": 56,
             "since": "2026-08-19", "last_ok": "2026-08-18",
             "sample_urls": ["https://www.tiktok.com/@humorbox_/photo/7675349887461936392/"]}]
    text = format_alert(dead, "2026-08-27")
    assert "유머박스(틱톡)" in text
    assert "9일 연속 0건" in text
    assert "2026-08-18" in text
    assert "7675349887461936392" in text
    assert "collector_error" in text     # 자동종료가 안 도는 이유를 함께 알린다


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("[OK] test_account_collection_watchdog 통과 (감지/부분실패/소표본/종료제외/"
          "에스컬레이션/전역실패/URL명시 7종)")
