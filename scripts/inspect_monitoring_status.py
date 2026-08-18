#!/usr/bin/env python3
"""Inspect active posts missing a stat row for a target monitoring date.

Read-only helper for checking the same class of issues reported by
notify_status.py without sending a Slack message.
"""

from __future__ import annotations

from channel_kind import is_banner_channel

import argparse
import json
import re
from datetime import date
from typing import Any

from db import get_client


PAGE = 1000


def fetch_pages(table: str, select: str, query=None) -> list[dict[str, Any]]:
    db = get_client()
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        q = db.table(table).select(select)
        if query:
            q = query(q)
        page = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def chunks(values: list[str], size: int = 100):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def is_banner(post: dict[str, Any]) -> bool:
    return is_banner_channel(post.get("channel_type"), post.get("posted_at"))


def is_internal(post: dict[str, Any]) -> bool:
    channel_type = str(post.get("channel_type") or "")
    return "위성채널" in channel_type or "온드미디어" in channel_type


def is_free_seed_manual(post: dict[str, Any]) -> bool:
    return "무상시딩" in str(post.get("channel_type") or "")


def is_uncollectable_play_platform(post: dict[str, Any]) -> bool:
    url = (post.get("url") or "").lower()
    return (
        "threads." in url
        or "facebook.com" in url
        or "naver.com" in url
        or "kakao.com" in url
    )


def shortcode_tail(url: str | None) -> str:
    return (url or "").rstrip("/").split("/")[-1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()
    target = args.date

    today_rows = fetch_pages(
        "post_daily_stats",
        "post_id,play_count,reach_count,measured_at",
        lambda q: q.eq("measured_at", target),
    )
    today_ids = {row["post_id"] for row in today_rows if row.get("post_id")}
    posts = fetch_pages(
        "sponsored_posts",
        "id,url,account_name,created_at,ended_at,content_summary,posted_at,channel_type,notes",
    )

    waiting: list[dict[str, Any]] = []
    check: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    excluded = {
        "manual_note": 0,
        "future_created": 0,
        "already_measured": len(today_ids),
        "banner": 0,
        "internal": 0,
        "free_seed_manual": 0,
        "uncollectable_platform": 0,
        "image_like_only": 0,
    }

    for post in posts:
        if post.get("ended_at"):
            continue
        notes = str(post.get("notes") or "")
        if "수동추적 제외" in notes:
            excluded["manual_note"] += 1
            continue
        if post.get("id") in today_ids:
            continue
        created = str(post.get("created_at") or "")[:10]
        if created > target:
            excluded["future_created"] += 1
            continue
        if created == target:
            waiting.append(post)
            continue
        if is_banner(post):
            excluded["banner"] += 1
            continue
        if is_internal(post):
            excluded["internal"] += 1
            continue
        if is_free_seed_manual(post):
            excluded["free_seed_manual"] += 1
            continue
        if is_uncollectable_play_platform(post):
            excluded["uncollectable_platform"] += 1
            continue

        url = (post.get("url") or "").lower()
        if "instagram.com" in url and not re.search(r"/(?:p|reels|reel|tv)/[A-Za-z0-9_-]+", url):
            check.append({**post, "reason": "URL오류(게시물 링크 아님)"})
        else:
            candidates.append(post)

    history: dict[str, dict[str, bool]] = {}
    candidate_ids = [post["id"] for post in candidates if post.get("id")]
    db = get_client()
    for ids in chunks(candidate_ids, 100):
        rows = db.table("post_daily_stats").select("post_id,play_count,likes_count").in_("post_id", ids).execute().data or []
        for row in rows:
            state = history.setdefault(row["post_id"], {"play": False, "likes": False})
            if row.get("play_count") is not None:
                state["play"] = True
            if row.get("likes_count") is not None:
                state["likes"] = True

    for post in candidates:
        state = history.get(post["id"])
        if state and state["likes"] and not state["play"]:
            excluded["image_like_only"] += 1
        else:
            check.append({**post, "reason": "미측정"})

    def sample(post: dict[str, Any]) -> dict[str, Any]:
        return {
            "account_name": post.get("account_name"),
            "reason": post.get("reason"),
            "tail": shortcode_tail(post.get("url")),
            "url": post.get("url"),
            "channel_type": post.get("channel_type"),
            "created_at": str(post.get("created_at") or "")[:10],
            "posted_at": str(post.get("posted_at") or "")[:10],
        }

    summary = {
        "ok": True,
        "date": target,
        "today_stat_rows": len(today_rows),
        "today_post_ids": len(today_ids),
        "waiting_count": len(waiting),
        "check_count": len(check),
        "unmeasured_total": len(waiting) + len(check),
        "excluded": excluded,
        "waiting_sample": [sample({**post, "reason": "신규대기"}) for post in waiting[:20]],
        "check_sample": [sample(post) for post in check[:30]],
    }
    print("[MONITORING_STATUS_RESULT] " + json.dumps(summary, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
