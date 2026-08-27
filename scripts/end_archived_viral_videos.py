#!/usr/bin/env python3
"""End the explicitly approved 2026-08-10 archived paid viral videos.

The operation is intentionally surgical:
- active ``바이럴 (영상)`` only;
- last stats row must be 2026-08-09;
- no stats rows on both 2026-08-10 and 2026-08-11;
- only ``sponsored_posts.ended_at`` is updated;
- an exact-count guard and JSON backup are mandatory.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv
from supabase import create_client


LAST_MEASURED_DATE = "2026-08-09"
MISSING_DATES = ("2026-08-10", "2026-08-11")
ENDED_AT = "2026-08-10"
EXPECTED_COUNT = 139
PAGE = 1000


def fetch_all(query_factory: Callable[[], Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = query_factory().order("id").range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def chunked(values: list[str], size: int = 100):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def get_client(env_file: str):
    load_dotenv(env_file, override=False)
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("[ARCHIVED_VIRAL_ABORT] Supabase credentials are missing")
    return create_client(url, key)


def fetch_candidates(db) -> list[dict[str, Any]]:
    return fetch_all(
        lambda: db.table("sponsored_posts")
        .select(
            "id,url,account_name,channel_type,posted_at,ended_at,notes,manual_fields,created_at"
        )
        .is_("ended_at", "null")
        .like("channel_type", "%바이럴 (영상)%")
    )


def fetch_stats(db, post_ids: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for ids in chunked(post_ids):
        rows.extend(
            fetch_all(
                lambda ids=ids: db.table("post_daily_stats")
                .select(
                    "id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at"
                )
                .in_("post_id", ids)
                .lte("measured_at", MISSING_DATES[-1])
            )
        )
    return rows


def select_targets(
    posts: list[dict[str, Any]], stats: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], int]:
    dates_by_post: dict[str, set[str]] = {}
    latest_by_post: dict[str, dict[str, Any]] = {}
    for row in stats:
        post_id = str(row["post_id"])
        measured_at = str(row.get("measured_at") or "")[:10]
        if measured_at:
            dates_by_post.setdefault(post_id, set()).add(measured_at)
        current = latest_by_post.get(post_id)
        if current is None or measured_at > str(current.get("measured_at") or "")[:10]:
            latest_by_post[post_id] = row

    targets: list[dict[str, Any]] = []
    one_day_missing = 0
    for post in posts:
        post_id = str(post["id"])
        dates = dates_by_post.get(post_id, set())
        latest_date = str((latest_by_post.get(post_id) or {}).get("measured_at") or "")[:10]
        missing_both = all(day not in dates for day in MISSING_DATES)
        if missing_both and latest_date == LAST_MEASURED_DATE:
            targets.append(post)
        elif MISSING_DATES[-1] not in dates and MISSING_DATES[0] in dates:
            one_day_missing += 1
    return targets, latest_by_post, one_day_missing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--backup-dir", default="scratchpad")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = get_client(args.env_file)
    posts = fetch_candidates(db)
    stats = fetch_stats(db, [str(post["id"]) for post in posts])
    targets, latest_by_post, one_day_missing = select_targets(posts, stats)
    target_ids = sorted(str(post["id"]) for post in targets)

    summary = {
        "apply": bool(args.apply),
        "active_viral_video_posts": len(posts),
        "target_count": len(targets),
        "expected_count": EXPECTED_COUNT,
        "last_measured_date": LAST_MEASURED_DATE,
        "missing_dates": list(MISSING_DATES),
        "ended_at": ENDED_AT,
        "one_day_missing_excluded": one_day_missing,
    }
    if len(targets) != EXPECTED_COUNT:
        raise SystemExit("[ARCHIVED_VIRAL_ABORT] " + json.dumps(summary, ensure_ascii=False))
    if any(post.get("ended_at") is not None for post in targets):
        raise SystemExit("[ARCHIVED_VIRAL_ABORT] target already ended")

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_path = backup_dir / f"archived_viral_139_backup_{stamp}.json"
    backup = {
        "summary": summary,
        "targets": [
            {
                **post,
                "latest_stat": latest_by_post.get(str(post["id"])),
            }
            for post in targets
        ],
    }
    backup_path.write_text(
        json.dumps(backup, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    if args.apply:
        for ids in chunked(target_ids):
            (
                db.table("sponsored_posts")
                .update({"ended_at": ENDED_AT})
                .in_("id", ids)
                .is_("ended_at", "null")
                .execute()
            )

        reread: list[dict[str, Any]] = []
        for ids in chunked(target_ids):
            reread.extend(
                db.table("sponsored_posts")
                .select("id,ended_at,posted_at")
                .in_("id", ids)
                .execute()
                .data
                or []
            )
        ended_map = {str(row["id"]): str(row.get("ended_at") or "")[:10] for row in reread}
        failures = [post_id for post_id in target_ids if ended_map.get(post_id) != ENDED_AT]
        if failures:
            raise SystemExit(f"[ARCHIVED_VIRAL_ABORT] readback failures={len(failures)}")
        summary["readback"] = {"checked": len(reread), "failed": 0}

    backup["summary"] = summary
    backup_path.write_text(
        json.dumps(backup, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"backup={backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
