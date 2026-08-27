#!/usr/bin/env python3
"""Strict rollback for the approved 2026-08-06 internal YouTube backfill."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client


TARGET_DATE = "2026-08-06"
EXPECTED_COUNT = 134
EXPECTED_PLAY_SUM = 556_054
PAGE = 1000


def fetch_all(query_factory) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = query_factory().order("id").range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def is_internal(channel_type: str) -> bool:
    return "위성채널" in channel_type or "온드미디어" in channel_type


def is_youtube(url: str) -> bool:
    text = url.lower()
    return "youtube.com" in text or "youtu.be" in text


def is_tiktok(url: str) -> bool:
    return "tiktok.com" in url.lower()


def is_instagram(url: str) -> bool:
    return "instagram.com" in url.lower()


def compute_snapshot(db, post_ids: list[str], upto: str) -> dict[str, int]:
    latest: dict[str, dict[str, Any]] = {}
    max_play: dict[str, int] = {}
    for start in range(0, len(post_ids), 100):
        ids = post_ids[start : start + 100]
        offset = 0
        while True:
            page = (
                db.table("post_daily_stats")
                .select("id,post_id,play_count,likes_count,comments_count,measured_at,created_at")
                .in_("post_id", ids)
                .lte("measured_at", upto)
                .order("measured_at", desc=True)
                .order("created_at", desc=True)
                .order("id", desc=True)
                .range(offset, offset + PAGE - 1)
                .execute()
                .data
                or []
            )
            for row in page:
                pid = str(row["post_id"])
                latest.setdefault(pid, row)
                play = row.get("play_count")
                if play is not None and int(play) > max_play.get(pid, -1):
                    max_play[pid] = int(play)
            if len(page) < PAGE:
                break
            offset += PAGE
    return {
        "total_play": sum(max_play.values()),
        "total_likes": sum(
            int(row.get("likes_count") or 0)
            for row in latest.values()
            if int(row.get("likes_count") or 0) >= 0
        ),
        "total_comments": sum(
            int(row.get("comments_count") or 0)
            for row in latest.values()
            if int(row.get("comments_count") or 0) >= 0
        ),
        "post_count": len(latest),
    }


def stable(rows: list[dict[str, Any]]) -> str:
    return json.dumps(sorted(rows, key=lambda row: str(row.get("id"))), sort_keys=True, default=str)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--backup-dir", default="scratchpad")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    load_dotenv(args.env_file, override=False)
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("[BACKFILL86_ABORT] Supabase credentials are missing")
    db = create_client(url, key)

    posts = fetch_all(
        lambda: db.table("sponsored_posts").select("id,url,account_name,channel_type")
    )
    post_by_id = {str(row["id"]): row for row in posts}
    day_rows = fetch_all(
        lambda: db.table("post_daily_stats")
        .select("id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at")
        .eq("measured_at", TARGET_DATE)
    )

    targets: list[dict[str, Any]] = []
    for row in day_rows:
        post = post_by_id.get(str(row.get("post_id"))) or {}
        channel_type = str(post.get("channel_type") or "")
        post_url = str(post.get("url") or "")
        if is_internal(channel_type) and is_youtube(post_url) and row.get("manual") is False:
            targets.append({**row, "post": post})

    target_ids = {str(row["id"]) for row in targets}
    target_post_ids = {str(row["post_id"]) for row in targets}
    play_sum = sum(int(row.get("play_count") or 0) for row in targets)
    duplicate_posts = len(target_post_ids) != len(targets)
    protected_tiktok = [
        row for row in day_rows
        if is_internal(str((post_by_id.get(str(row.get("post_id"))) or {}).get("channel_type") or ""))
        and is_tiktok(str((post_by_id.get(str(row.get("post_id"))) or {}).get("url") or ""))
    ]
    protected_free_ig = [
        row for row in day_rows
        if "무상시딩" in str((post_by_id.get(str(row.get("post_id"))) or {}).get("channel_type") or "")
        and is_instagram(str((post_by_id.get(str(row.get("post_id"))) or {}).get("url") or ""))
    ]

    errors = []
    if len(targets) != EXPECTED_COUNT:
        errors.append({"guard": "target_count", "expected": EXPECTED_COUNT, "actual": len(targets)})
    if play_sum != EXPECTED_PLAY_SUM:
        errors.append({"guard": "play_sum", "expected": EXPECTED_PLAY_SUM, "actual": play_sum})
    if duplicate_posts:
        errors.append({"guard": "unique_post_per_row", "actual": len(target_post_ids)})
    if any(row.get("manual") is not False for row in targets):
        errors.append({"guard": "manual_false"})
    if errors:
        raise SystemExit("[BACKFILL86_ABORT] " + json.dumps(errors, ensure_ascii=False))

    snapshot_before = (
        db.table("daily_view_snapshot")
        .select("*")
        .eq("date", TARGET_DATE)
        .maybe_single()
        .execute()
        .data
    )
    non_target_before = [row for row in day_rows if str(row["id"]) not in target_ids]
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"backfill86_rollback_backup_{stamp}.json"
    ids_path = backup_dir / f"backfill86_ids_reconstructed_{stamp}.txt"
    backup_path.write_text(json.dumps({
        "date": TARGET_DATE,
        "target_count": len(targets),
        "target_play_sum": play_sum,
        "targets": targets,
        "all_date_rows_before": day_rows,
        "snapshot_before": snapshot_before,
        "protected_internal_tiktok_count": len(protected_tiktok),
        "protected_free_seed_ig_count": len(protected_free_ig),
    }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    ids_path.write_text("\n".join(sorted(target_post_ids)) + "\n", encoding="utf-8")

    summary = {
        "apply": bool(args.apply),
        "date": TARGET_DATE,
        "target_count": len(targets),
        "target_play_sum": play_sum,
        "all_date_rows_before": len(day_rows),
        "protected_internal_tiktok": len(protected_tiktok),
        "protected_free_seed_ig": len(protected_free_ig),
        "created_at_min": min(str(row.get("created_at")) for row in targets),
        "created_at_max": max(str(row.get("created_at")) for row in targets),
        "backup": str(backup_path),
        "ids": str(ids_path),
        "snapshot_before": snapshot_before,
    }
    if not args.apply:
        print("[BACKFILL86_DRY_RUN] " + json.dumps(summary, ensure_ascii=False, default=str))
        return 0

    for start in range(0, len(target_ids), 100):
        ids = list(sorted(target_ids))[start : start + 100]
        (
            db.table("post_daily_stats")
            .delete()
            .in_("id", ids)
            .eq("measured_at", TARGET_DATE)
            .eq("manual", False)
            .execute()
        )

    day_after = fetch_all(
        lambda: db.table("post_daily_stats")
        .select("id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at")
        .eq("measured_at", TARGET_DATE)
    )
    remaining_targets = [row for row in day_after if str(row.get("id")) in target_ids]
    if remaining_targets or stable(day_after) != stable(non_target_before):
        raise SystemExit("[BACKFILL86_VERIFY_FAILED] " + json.dumps({
            "remaining_targets": len(remaining_targets),
            "other_date_rows_unchanged": stable(day_after) == stable(non_target_before),
            "backup": str(backup_path),
        }, ensure_ascii=False))

    post_ids = [str(row["id"]) for row in posts]
    snapshot_after_expected = compute_snapshot(db, post_ids, TARGET_DATE)
    db.table("daily_view_snapshot").upsert(
        {"date": TARGET_DATE, **snapshot_after_expected}, on_conflict="date"
    ).execute()
    snapshot_after = (
        db.table("daily_view_snapshot")
        .select("*")
        .eq("date", TARGET_DATE)
        .single()
        .execute()
        .data
    )
    for field, expected in snapshot_after_expected.items():
        if int(snapshot_after.get(field) or 0) != int(expected):
            raise SystemExit(f"[BACKFILL86_SNAPSHOT_VERIFY_FAILED] {field}")

    protected_tiktok_after = [
        row for row in day_after
        if is_internal(str((post_by_id.get(str(row.get("post_id"))) or {}).get("channel_type") or ""))
        and is_tiktok(str((post_by_id.get(str(row.get("post_id"))) or {}).get("url") or ""))
    ]
    protected_free_ig_after = [
        row for row in day_after
        if "무상시딩" in str((post_by_id.get(str(row.get("post_id"))) or {}).get("channel_type") or "")
        and is_instagram(str((post_by_id.get(str(row.get("post_id"))) or {}).get("url") or ""))
    ]
    if stable(protected_tiktok_after) != stable(protected_tiktok):
        raise SystemExit("[BACKFILL86_VERIFY_FAILED] internal TikTok changed")
    if stable(protected_free_ig_after) != stable(protected_free_ig):
        raise SystemExit("[BACKFILL86_VERIFY_FAILED] free-seed IG changed")

    summary.update({
        "deleted": len(target_ids),
        "all_date_rows_after": len(day_after),
        "other_date_rows_unchanged": True,
        "protected_internal_tiktok_unchanged": len(protected_tiktok_after),
        "protected_free_seed_ig_unchanged": len(protected_free_ig_after),
        "snapshot_after": snapshot_after,
    })
    print("[BACKFILL86_APPLIED] " + json.dumps(summary, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
