#!/usr/bin/env python3
"""Strictly delete one post's fully-empty stats rows dated before posted_at."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client


STAT_FIELDS = (
    "id,post_id,measured_at,play_count,reach_count,likes_count,"
    "comments_count,manual,created_at"
)
METRIC_FIELDS = ("play_count", "reach_count", "likes_count", "comments_count")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--post-id", required=True)
    parser.add_argument("--expected-posted-at", required=True)
    parser.add_argument("--expected-total", required=True, type=int)
    parser.add_argument("--expected-dates", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--backup-dir", default="scratchpad")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(args.env_file, override=False)
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("[PRE_POST_EMPTY_ABORT] Supabase credentials are missing")
    db = create_client(url, key)

    post = (
        db.table("sponsored_posts")
        .select("id,url,account_name,channel_type,posted_at")
        .eq("id", args.post_id)
        .single()
        .execute()
        .data
    )
    if not post or str(post.get("posted_at"))[:10] != args.expected_posted_at:
        raise SystemExit("[PRE_POST_EMPTY_ABORT] posted_at guard failed")

    before = (
        db.table("post_daily_stats")
        .select(STAT_FIELDS)
        .eq("post_id", args.post_id)
        .order("measured_at")
        .execute()
        .data
        or []
    )
    expected_dates = sorted(x.strip() for x in args.expected_dates.split(",") if x.strip())
    pre_post = [r for r in before if str(r.get("measured_at"))[:10] < args.expected_posted_at]
    actual_dates = sorted(str(r.get("measured_at"))[:10] for r in pre_post)
    nonempty = [
        {"id": r.get("id"), "measured_at": r.get("measured_at")}
        for r in pre_post
        if any(r.get(field) is not None for field in METRIC_FIELDS)
    ]
    errors = []
    if len(before) != args.expected_total:
        errors.append({"guard": "total", "expected": args.expected_total, "actual": len(before)})
    if actual_dates != expected_dates:
        errors.append({"guard": "dates", "expected": expected_dates, "actual": actual_dates})
    if nonempty:
        errors.append({"guard": "all_metrics_null", "rows": nonempty})
    if errors:
        raise SystemExit("[PRE_POST_EMPTY_ABORT] " + json.dumps(errors, ensure_ascii=False))

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_path = Path(args.backup_dir) / f"specific_pre_post_empty_backup_{stamp}.json"
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(
        json.dumps(
            {
                "post": post,
                "expected_posted_at": args.expected_posted_at,
                "total_before": len(before),
                "delete_rows": pre_post,
                "all_rows_before": before,
            },
            ensure_ascii=False,
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    if not args.apply:
        print("[PRE_POST_EMPTY_DRY_RUN] " + json.dumps({
            "post_id": args.post_id,
            "posted_at": args.expected_posted_at,
            "total_before": len(before),
            "candidate_count": len(pre_post),
            "candidate_dates": actual_dates,
            "backup": str(backup_path),
        }, ensure_ascii=False))
        return 0

    ids = [str(r["id"]) for r in pre_post]
    query = (
        db.table("post_daily_stats")
        .delete()
        .eq("post_id", args.post_id)
        .in_("id", ids)
        .lt("measured_at", args.expected_posted_at)
    )
    for field in METRIC_FIELDS:
        query = query.is_(field, "null")
    query.execute()

    after = (
        db.table("post_daily_stats")
        .select(STAT_FIELDS)
        .eq("post_id", args.post_id)
        .order("measured_at")
        .execute()
        .data
        or []
    )
    remaining_pre_post = [r for r in after if str(r.get("measured_at"))[:10] < args.expected_posted_at]
    expected_after = [r for r in before if str(r.get("id")) not in set(ids)]
    if len(after) != args.expected_total - len(ids) or remaining_pre_post or after != expected_after:
        raise SystemExit("[PRE_POST_EMPTY_VERIFY_FAILED] " + json.dumps({
            "total_after": len(after),
            "expected_total_after": args.expected_total - len(ids),
            "remaining_pre_post": len(remaining_pre_post),
            "survivors_unchanged": after == expected_after,
            "backup": str(backup_path),
        }, ensure_ascii=False))

    print("[PRE_POST_EMPTY_APPLIED] " + json.dumps({
        "post_id": args.post_id,
        "deleted": len(ids),
        "deleted_dates": actual_dates,
        "total_before": len(before),
        "total_after": len(after),
        "remaining_pre_post": 0,
        "survivors_unchanged": True,
        "backup": str(backup_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
