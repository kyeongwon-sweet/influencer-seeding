#!/usr/bin/env python3
"""Dry-run/apply cleanup for banner rows where play_count leaked from reach_count."""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client


def chunks(values, size=100):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env.production.local")
    load_dotenv(root / "web" / ".env.local")
    load_dotenv(root / ".env.local")
    load_dotenv(root / ".env")
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing")
    db = create_client(url, key)

    banners = []
    offset = 0
    while True:
        page = (db.table("sponsored_posts")
                .select("id,url,channel_type")
                .ilike("channel_type", "%배너%")
                .range(offset, offset + 999).execute()).data or []
        banners.extend(page)
        if len(page) < 1000:
            break
        offset += 1000

    candidates = []
    for ids in chunks([post["id"] for post in banners]):
        offset = 0
        while True:
            page = (db.table("post_daily_stats")
                    .select("id,post_id,measured_at,play_count,reach_count,manual,increment")
                    .in_("post_id", ids)
                    .not_.is_("play_count", "null")
                    .not_.is_("reach_count", "null")
                    .range(offset, offset + 999).execute()).data or []
            candidates.extend(row for row in page if row["play_count"] == row["reach_count"])
            if len(page) < 1000:
                break
            offset += 1000

    print(json.dumps({"banner_posts": len(banners), "leaked_rows": len(candidates)}, ensure_ascii=False))
    if not args.apply or not candidates:
        return

    # Re-read immediately before the write; abort if the candidate set changed.
    fresh = []
    for ids in chunks([row["id"] for row in candidates]):
        page = (db.table("post_daily_stats")
                .select("id,post_id,measured_at,play_count,reach_count,manual,increment")
                .in_("id", ids).execute()).data or []
        fresh.extend(row for row in page if row["play_count"] == row["reach_count"] and row["play_count"] is not None)
    if {row["id"] for row in fresh} != {row["id"] for row in candidates}:
        raise SystemExit("candidate set changed; aborting before write")

    backup_dir = root / "data" / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = backup_dir / f"banner_play_leak_{stamp}.json"
    backup.write_text(json.dumps(fresh, ensure_ascii=False, indent=2), encoding="utf-8")

    updated = 0
    for ids in chunks([row["id"] for row in fresh]):
        result = (db.table("post_daily_stats")
                  .update({"play_count": None})
                  .in_("id", ids).execute()).data or []
        updated += len(result)

    print(json.dumps({"updated": updated, "backup": str(backup)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
