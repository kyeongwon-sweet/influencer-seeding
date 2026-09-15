#!/usr/bin/env python3
"""'수집 불가' 태깅이 **영구 침묵**이 되지 않게 하는 재확인 워치독.

왜 만들었나 (2026-09-14~15):
  인스타 제한(`restricted_page`) 2건을 수집기가 자동으로 `notes` 에 '수집 불가'로 태깅하게
  고쳤다. 매일 뜨던 오탐과 매일 나가던 Apify 재호출은 그걸로 멎었다 — 그런데 **그 태깅이
  세 곳 전부에서 글을 지운다**:
    · `build_view_missing_queue.exclusion_reason` → `collector_uncollectable` 로 큐 제외
    · `daily_collect_report` → `수집불가 N` 카운트만, 목록엔 안 뜸
    · `view_tracking_watchdog` → `"수집 불가" in notes` 면 skip
  게다가 두 글은 수기 입력 행이 있어 `auto_end_rules` 의 `manual_stat_tracked` 로 **나이
  종료(14일)까지 면제**된다. 즉 **사람이 손대지 않으면 활성 상태로 영원히 남는다**
  (유상 6만·9만원, CPV 가 2026-09-08 값에 멈춘 채).

  조회수가 돌아오면 수집기가 노트를 지워 자동 복귀한다(자가치유). 문제는 **안 돌아오는 경우
  아무도 다시 보지 않는다**는 것이다. 그래서 '조용해진 지 오래된 것'만 다시 한 줄로 띄운다.

설계 원칙:
  · **값을 바꾸지 않는다.** 종료(ended_at)도 자동으로 하지 않는다 — 살아 있는 글을 닫으면
    되돌리기 어렵다. 이 모듈은 **사람에게 다시 보여주는 일만** 한다.
  · 경과일 기준은 **마지막 실값 날짜**다(노트 문구가 아니라). 자동 태깅 노트에는 날짜가
    박혀 있지만 수동으로 적은 '수집 불가' 노트에는 없고, 운영상 의미 있는 숫자도
    "며칠째 값이 안 들어오는가"이기 때문이다.
"""

from __future__ import annotations

from datetime import date
from typing import Any

UNCOLLECTABLE_MARK = "수집 불가"
STALE_DAYS = 14          # 이 일수를 넘겨 값이 안 돌아오면 다시 띄운다
MAX_DETAIL = 10


def is_uncollectable_tagged(post: dict[str, Any]) -> bool:
    return UNCOLLECTABLE_MARK in str(post.get("notes") or "")


def _days_between(since: Any, today: str) -> int | None:
    s = str(since or "")[:10]
    if len(s) != 10:
        return None
    try:
        return (date.fromisoformat(today) - date.fromisoformat(s)).days
    except ValueError:
        return None


def stuck_uncollectable(
    posts,
    last_seen_by_post: dict[str, str],
    today: str,
    *,
    stale_days: int = STALE_DAYS,
) -> list[dict]:
    """'수집 불가' 태깅 후 stale_days 일 넘게 값이 안 돌아온 **활성** 글 (순수 함수).

    `last_seen_by_post`: post_id → 마지막으로 실제 값이 있었던 날짜(YYYY-MM-DD).
      값이 한 번도 없었던 글은 키를 비워 두면 `posted_at` 으로 대체한다.

    ⚠️ 종료된 글(ended_at)은 대상이 아니다 — 이미 사람이 닫은 건 다시 물어볼 일이 아니다.
    ⚠️ 기준 날짜를 모르면(둘 다 없음) **띄우지 않는다** — 경과일을 못 세는데 '오래됐다'고
       단정하면 갓 등록된 글이 끌려 나온다.
    """
    out = []
    for post in posts:
        if post.get("ended_at") or not is_uncollectable_tagged(post):
            continue
        since = last_seen_by_post.get(post.get("id")) or post.get("posted_at")
        days = _days_between(since, today)
        if days is None or days <= stale_days:
            continue
        out.append({
            "post_id": post.get("id"),
            "account_name": post.get("account_name"),
            "channel_type": post.get("channel_type"),
            "url": post.get("url"),
            "last_seen": str(since)[:10],
            "days": days,
            "notes": str(post.get("notes") or ""),
        })
    out.sort(key=lambda item: (-item["days"], str(item["url"])))
    return out


def stale_lines(items, *, stale_days: int = STALE_DAYS, max_detail: int = MAX_DETAIL) -> list[str]:
    """Slack 스레드용 줄. 건수가 0이면 빈 리스트(=섹션 자체를 안 붙인다)."""
    if not items:
        return []
    lines = [
        "🔁 수집 불가 재확인 — %d일 넘게 값이 안 돌아온 활성 게시물 %d건\n"
        "   (자동 종료하지 않습니다. 살아났는지·영구인지 사람이 확인해 주세요)"
        % (stale_days, len(items))
    ]
    for i, item in enumerate(items[:max_detail], 1):
        lines.append(
            "%d. %s · %s · 마지막 값 %s (%d일 경과)\n   %s"
            % (i, item.get("account_name") or "계정명 미등록",
               item.get("channel_type") or "-", item["last_seen"], item["days"],
               item.get("url") or "-")
        )
    if len(items) > max_detail:
        lines.append("... 외 %d건" % (len(items) - max_detail))
    return lines
