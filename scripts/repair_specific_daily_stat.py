#!/usr/bin/env python3
"""Strictly guarded one-row post_daily_stats repair helper.

This is intentionally narrow: it refuses to update unless the stat id, post id,
date, and expected current play_count all match the caller's inputs.
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from db import get_client


def parse_count(value: str) -> int | None:
    text = str(value or "").strip().replace(",", "")
    if text.upper() in {"", "NULL", "NONE"}:
        return None
    return int(text)


def fetch_stat(stat_id: str) -> dict[str, Any]:
    db = get_client()
    row = (
        db.table("post_daily_stats")
        .select("id,post_id,measured_at,play_count,reach_count,manual,created_at")
        .eq("id", stat_id)
        .single()
        .execute()
        .data
    )
    if not row:
        raise SystemExit(f"stat row not found: {stat_id}")
    return row


def inspect_posts(needle: str) -> dict[str, Any]:
    if not needle:
        return {"enabled": False}

    db = get_client()
    posts = (
        db.table("sponsored_posts")
        .select("id,url,account_name,channel_type,posted_at,created_at,ended_at")
        .ilike("url", f"%{needle}%")
        .execute()
        .data
        or []
    )
    inspected = []
    for post in posts:
        stats = (
            db.table("post_daily_stats")
            .select("id,measured_at,play_count,reach_count,manual,created_at")
            .eq("post_id", post["id"])
            .order("measured_at", desc=True)
            .limit(5)
            .execute()
            .data
            or []
        )
        inspected.append({
            "post": post,
            "stat_rows_returned": len(stats),
            "latest_stats": stats,
        })
    return {"enabled": True, "needle": needle, "matched_posts": len(posts), "posts": inspected}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stat-id", required=True)
    parser.add_argument("--post-id", required=True)
    parser.add_argument("--measured-at", required=True)
    parser.add_argument("--expected-play-count", required=True)
    parser.add_argument("--new-play-count", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--inspect-url-contains", default="")
    args = parser.parse_args()

    expected_play = parse_count(args.expected_play_count)
    new_play = parse_count(args.new_play_count)

    before = fetch_stat(args.stat_id)
    errors = []
    if before.get("post_id") != args.post_id:
        errors.append({"field": "post_id", "expected": args.post_id, "actual": before.get("post_id")})
    if str(before.get("measured_at"))[:10] != args.measured_at:
        errors.append({"field": "measured_at", "expected": args.measured_at, "actual": before.get("measured_at")})
    if before.get("play_count") != expected_play:
        errors.append({"field": "play_count", "expected": expected_play, "actual": before.get("play_count")})
    if errors:
        raise SystemExit("[REPAIR_SPECIFIC_DAILY_STAT_ABORT] " + json.dumps({
            "ok": False,
            "errors": errors,
            "row": before,
        }, ensure_ascii=False, default=str))

    update_result: list[dict[str, Any]] = []
    if args.apply:
        db = get_client()
        update_result = (
            db.table("post_daily_stats")
            .update({"play_count": new_play})
            .eq("id", args.stat_id)
            .eq("post_id", args.post_id)
            .eq("measured_at", args.measured_at)
            .execute()
            .data
            or []
        )
        if len(update_result) != 1:
            raise SystemExit("[REPAIR_SPECIFIC_DAILY_STAT_ABORT] " + json.dumps({
                "ok": False,
                "error": "unexpected update count",
                "updated_rows": len(update_result),
                "before": before,
            }, ensure_ascii=False, default=str))

    after = fetch_stat(args.stat_id)
    summary = {
        "ok": True,
        "apply": bool(args.apply),
        "stat_id": args.stat_id,
        "post_id": args.post_id,
        "measured_at": args.measured_at,
        "expected_play_count": expected_play,
        "new_play_count": new_play,
        "before": before,
        "after": after,
        "updated_rows": len(update_result),
        "inspect": inspect_posts(args.inspect_url_contains),
    }
    print("[REPAIR_SPECIFIC_DAILY_STAT_RESULT] " + json.dumps(summary, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
