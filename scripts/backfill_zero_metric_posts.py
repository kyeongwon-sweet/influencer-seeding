#!/usr/bin/env python3
"""Backfill current view counts for posts that have no positive metric history.

This is a narrow one-off repair path for rows where the sheet cannot compute a
final cumulative value because DB has no positive play_count/reach_count rows.
Only approved channel types are considered, and only positive metrics returned
by the platform scrapers are written.
"""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any

from account_name_policy import collected_account_name_update
from auto_end_rules import row_metric
from db import get_client
from run_monitoring import (
    _fetch_ig_fallback,
    _fetch_stats,
    _fetch_tiktok,
    _fetch_twitter,
    _fetch_youtube,
    _fetch_youtube_api,
    _ig_shortcode,
    _stats_key,
    _tt_canonical,
    _tt_id,
    _tw_id,
    _yt_id,
)


BASE_MEASURED_AT = os.getenv("BACKFILL_MEASURED_AT") or (
    (datetime.now(timezone.utc) + timedelta(hours=9)).date() - timedelta(days=1)
).isoformat()
DRY_RUN = os.getenv("DRY_RUN", "1").lower() in ("1", "true", "yes")
LIMIT = int(os.getenv("BACKFILL_LIMIT", "0") or "0")
PAGE = 1000


def _compact(value: Any) -> str:
    return re.sub(r"[\s()./·_\-]+", "", str(value or ""))


def is_allowed_channel_type(channel_type: Any) -> bool:
    text = _compact(channel_type)
    allowed = (
        ("협찬", "인플루언서"),
        ("바이럴", "영상"),
        ("협찬", "먹스타"),
        ("협찬", "파워채널", "매거진"),
        ("무상시딩", "영상"),
    )
    return any(all(part in text for part in parts) for parts in allowed)


def platform_of(url: str) -> str | None:
    u = (url or "").lower()
    if "instagram.com" in u and _ig_shortcode(url):
        return "instagram"
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "tiktok.com" in u:
        return "tiktok"
    if _tw_id(url):
        return "twitter"
    return None


def positive_int(value: Any) -> int | None:
    try:
      n = int(value)
    except (TypeError, ValueError):
      return None
    return n if n > 0 else None


def fetch_all_posts(db) -> list[dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    for start in range(0, 100000, PAGE):
        res = (
            db.table("sponsored_posts")
            .select(
                "id,url,posted_at,account_name,content_summary,channel_type,"
                "ended_at,influencer_id"
            )
            .order("id")
            .range(start, start + PAGE - 1)
            .execute()
        )
        chunk = res.data or []
        posts.extend(chunk)
        if len(chunk) < PAGE:
            break
    return posts


def positive_metric_dates(db, post_ids: list[str]) -> dict[str, list[str]]:
    has_metric: dict[str, list[str]] = {}
    for i in range(0, len(post_ids), 100):
        chunk = post_ids[i:i + 100]
        start = 0
        while True:
            res = (
                db.table("post_daily_stats")
                .select("post_id,measured_at,play_count,reach_count")
                .in_("post_id", chunk)
                .range(start, start + PAGE - 1)
                .execute()
            )
            rows = res.data or []
            for row in rows:
                if row_metric(row) > 0:
                    has_metric.setdefault(row["post_id"], []).append(str(row.get("measured_at") or "")[:10])
            if len(rows) < PAGE:
                break
            start += PAGE
    return has_metric


def target_measured_at(post: dict[str, Any]) -> str:
    # Store when this repair actually measured the post. The sheet/export layer
    # is responsible for preserving the final H value for ended posts.
    return BASE_MEASURED_AT


def has_exportable_metric(post: dict[str, Any], metric_dates: dict[str, list[str]]) -> bool:
    target_date = target_measured_at(post)
    return any(date and date <= target_date for date in metric_dates.get(post["id"], []))


def select_targets(posts: list[dict[str, Any]], metric_dates: dict[str, list[str]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for post in posts:
        if has_exportable_metric(post, metric_dates):
            continue
        if not is_allowed_channel_type(post.get("channel_type")):
            continue
        url = str(post.get("url") or "")
        platform = platform_of(url)
        if not platform:
            continue
        post["_measured_at"] = target_measured_at(post)
        posted_at = str(post.get("posted_at") or "")[:10]
        if posted_at and posted_at > post["_measured_at"]:
            continue
        post["_platform"] = platform
        out.append(post)
    if LIMIT > 0:
        return out[:LIMIT]
    return out


def maybe_update_post_metadata(db, post: dict[str, Any], stat: dict[str, Any]) -> None:
    updates: dict[str, Any] = {}
    account_name_update = collected_account_name_update(post, stat)
    if account_name_update is not None:
        updates["account_name"] = account_name_update
    if not post.get("content_summary") and stat.get("content_summary"):
        updates["content_summary"] = stat["content_summary"]
    if updates and not DRY_RUN:
        db.table("sponsored_posts").update(updates).eq("id", post["id"]).execute()


def add_row(rows: list[dict[str, Any]], post: dict[str, Any], stat: dict[str, Any], play_field="play_count") -> bool:
    play = positive_int(stat.get(play_field))
    if not play:
        return False
    rows.append({
        "post_id": post["id"],
        "measured_at": post["_measured_at"],
        "play_count": play,
        "likes_count": stat.get("likes_count") if "likes_count" in stat else stat.get("likes"),
        "comments_count": stat.get("comments_count") if "comments_count" in stat else stat.get("comments"),
        "manual": False,
    })
    return True


def collect_instagram(db, posts: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, int]:
    urls = [p["url"] for p in posts]
    stats = _fetch_stats(urls)
    by_key = {_stats_key(s["url"]): s for s in stats}

    missing_urls = []
    written = 0
    for post in posts:
        stat = by_key.get(_stats_key(post["url"]))
        if stat and positive_int(stat.get("play_count")):
            maybe_update_post_metadata(db, post, stat)
            written += 1 if add_row(rows, post, stat, "play_count") else 0
        else:
            missing_urls.append(post["url"])

    fallback = _fetch_ig_fallback(missing_urls) if missing_urls else {}
    fallback_written = 0
    for post in posts:
        if any(r["post_id"] == post["id"] for r in rows):
            continue
        code = _ig_shortcode(post["url"])
        stat = fallback.get(code or "")
        if stat and positive_int(stat.get("play_count")):
            maybe_update_post_metadata(db, post, stat)
            fallback_written += 1 if add_row(rows, post, stat, "play_count") else 0

    return {"requested": len(posts), "written": written + fallback_written, "fallback_written": fallback_written}


def collect_youtube(db, posts: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, int]:
    stats = _fetch_youtube([p["url"] for p in posts])
    missing = [p["url"] for p in posts if not positive_int((stats.get(_yt_id(p["url"])) or {}).get("views"))]
    if missing:
        for vid, stat in _fetch_youtube(missing).items():
            if positive_int(stat.get("views")):
                stats[vid] = stat
    missing = [p["url"] for p in posts if not positive_int((stats.get(_yt_id(p["url"])) or {}).get("views"))]
    if missing:
        for vid, stat in _fetch_youtube_api(missing).items():
            if positive_int(stat.get("views")):
                stats[vid] = stat

    written = 0
    for post in posts:
        stat = stats.get(_yt_id(post["url"])) or {}
        normalized = {
            "play_count": stat.get("views"),
            "likes_count": stat.get("likes"),
            "comments_count": stat.get("comments"),
            "content_summary": (stat.get("title") or "")[:300] or None,
        }
        maybe_update_post_metadata(db, post, normalized)
        written += 1 if add_row(rows, post, normalized, "play_count") else 0
    return {"requested": len(posts), "written": written}


def collect_tiktok(db, posts: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, int]:
    canon = {p["url"]: _tt_canonical(p["url"]) for p in posts}
    stats = _fetch_tiktok([canon[p["url"]] for p in posts])
    missing = [canon[p["url"]] for p in posts if not positive_int((stats.get(_tt_id(canon[p["url"]])) or {}).get("views"))]
    if missing:
        for vid, stat in _fetch_tiktok(missing).items():
            if positive_int(stat.get("views")):
                stats[vid] = stat

    written = 0
    for post in posts:
        stat = stats.get(_tt_id(canon[post["url"]])) or {}
        normalized = {
            "play_count": stat.get("views"),
            "likes_count": stat.get("likes"),
            "comments_count": stat.get("comments"),
            "content_summary": stat.get("content_summary"),
        }
        maybe_update_post_metadata(db, post, normalized)
        written += 1 if add_row(rows, post, normalized, "play_count") else 0
    return {"requested": len(posts), "written": written}


def collect_twitter(db, posts: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, int]:
    stats = _fetch_twitter([p["url"] for p in posts])
    written = 0
    for post in posts:
        stat = stats.get(_tw_id(post["url"])) or {}
        normalized = {
            "play_count": stat.get("views"),
            "likes_count": stat.get("likes"),
            "comments_count": stat.get("comments"),
            "content_summary": stat.get("content_summary"),
        }
        maybe_update_post_metadata(db, post, normalized)
        written += 1 if add_row(rows, post, normalized, "play_count") else 0
    return {"requested": len(posts), "written": written}


def run() -> dict[str, Any]:
    db = get_client()
    posts = fetch_all_posts(db)
    candidate_ids = [p["id"] for p in posts if is_allowed_channel_type(p.get("channel_type"))]
    metric_dates = positive_metric_dates(db, candidate_ids)
    targets = select_targets(posts, metric_dates)

    by_platform = Counter(p["_platform"] for p in targets)
    by_channel = Counter(str(p.get("channel_type") or "") for p in targets)
    by_target_date = Counter(p["_measured_at"] for p in targets)
    print("[BACKFILL] " + json.dumps({
        "dry_run": DRY_RUN,
        "base_measured_at": BASE_MEASURED_AT,
        "all_posts": len(posts),
        "allowed_channel_posts": len(candidate_ids),
        "positive_metric_posts": len(metric_dates),
        "targets": len(targets),
        "by_platform": dict(by_platform),
        "by_channel": dict(by_channel),
        "by_target_date": dict(by_target_date),
        "sample": [
            {
                "id": p["id"],
                "url": p.get("url"),
                "channel_type": p.get("channel_type"),
                "ended_at": p.get("ended_at"),
                "measured_at": p["_measured_at"],
            }
            for p in targets[:20]
        ],
    }, ensure_ascii=False))

    if DRY_RUN or not targets:
        return {"targets": len(targets), "upserted": 0, "dry_run": DRY_RUN}

    rows: list[dict[str, Any]] = []
    summaries: dict[str, dict[str, int]] = {}
    groups = {
        "instagram": [p for p in targets if p["_platform"] == "instagram"],
        "youtube": [p for p in targets if p["_platform"] == "youtube"],
        "tiktok": [p for p in targets if p["_platform"] == "tiktok"],
        "twitter": [p for p in targets if p["_platform"] == "twitter"],
    }
    if groups["instagram"]:
        summaries["instagram"] = collect_instagram(db, groups["instagram"], rows)
    if groups["youtube"]:
        summaries["youtube"] = collect_youtube(db, groups["youtube"], rows)
    if groups["tiktok"]:
        summaries["tiktok"] = collect_tiktok(db, groups["tiktok"], rows)
    if groups["twitter"]:
        summaries["twitter"] = collect_twitter(db, groups["twitter"], rows)

    rows = [row for row in rows if positive_int(row.get("play_count"))]
    if rows:
        db.table("post_daily_stats").upsert(rows, on_conflict="post_id,measured_at").execute()

    result = {
        "targets": len(targets),
        "upserted": len(rows),
        "dry_run": DRY_RUN,
        "summaries": summaries,
        "unfilled": len(targets) - len({row["post_id"] for row in rows}),
    }
    print("[BACKFILL_RESULT] " + json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    run()
