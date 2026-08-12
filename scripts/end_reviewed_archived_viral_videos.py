#!/usr/bin/env python3
"""End the 36 reviewed archived viral videos approved on 2026-08-12."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from end_archived_viral_videos import chunked, fetch_all, get_client


MEASURED_DATE = "2026-08-10"
MISSING_DATE = "2026-08-11"
ENDED_AT = "2026-08-11"
EXPECTED_COUNT = 36


def select_targets(
    posts: list[dict[str, Any]], stats: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    stats_by_post: dict[str, dict[str, dict[str, Any]]] = {}
    for row in stats:
        post_id = str(row["post_id"])
        measured_at = str(row.get("measured_at") or "")[:10]
        stats_by_post.setdefault(post_id, {})[measured_at] = row

    targets = []
    for post in posts:
        post_id = str(post["id"])
        by_date = stats_by_post.get(post_id, {})
        measured_row = by_date.get(MEASURED_DATE)
        has_metric = measured_row is not None and any(
            measured_row.get(field) is not None
            for field in ("play_count", "reach_count", "likes_count", "comments_count")
        )
        if has_metric and MISSING_DATE not in by_date:
            targets.append(post)
    return targets, {post_id: rows.get(MEASURED_DATE) for post_id, rows in stats_by_post.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--backup-dir", default="scratchpad")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    db = get_client(args.env_file)
    posts = fetch_all(
        lambda: db.table("sponsored_posts")
        .select(
            "id,url,account_name,channel_type,posted_at,ended_at,review_requested_at,"
            "not_found_streak,not_found_last_at,notes,manual_fields,created_at"
        )
        .is_("ended_at", "null")
        .like("channel_type", "%바이럴 (영상)%")
        .not_.is_("review_requested_at", "null")
    )
    post_ids = [str(post["id"]) for post in posts]
    stats: list[dict[str, Any]] = []
    for ids in chunked(post_ids):
        stats.extend(
            fetch_all(
                lambda ids=ids: db.table("post_daily_stats")
                .select(
                    "id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at"
                )
                .in_("post_id", ids)
                .in_("measured_at", [MEASURED_DATE, MISSING_DATE])
            )
        )

    targets, measured_rows = select_targets(posts, stats)
    target_ids = sorted(str(post["id"]) for post in targets)
    summary = {
        "apply": bool(args.apply),
        "active_reviewed_viral": len(posts),
        "target_count": len(targets),
        "expected_count": EXPECTED_COUNT,
        "measured_date": MEASURED_DATE,
        "missing_date": MISSING_DATE,
        "ended_at": ENDED_AT,
    }
    if len(targets) != EXPECTED_COUNT:
        raise SystemExit("[REVIEWED_ARCHIVE_ABORT] " + json.dumps(summary, ensure_ascii=False))
    if any(post.get("ended_at") is not None or not post.get("review_requested_at") for post in targets):
        raise SystemExit("[REVIEWED_ARCHIVE_ABORT] target state changed")

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_path = backup_dir / f"reviewed_archived_viral_36_backup_{stamp}.json"
    backup = {
        "summary": summary,
        "targets": [
            {**post, "measured_stat": measured_rows.get(str(post["id"]))}
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
                .update({"ended_at": ENDED_AT, "review_requested_at": None})
                .in_("id", ids)
                .is_("ended_at", "null")
                .not_.is_("review_requested_at", "null")
                .execute()
            )

        reread: list[dict[str, Any]] = []
        for ids in chunked(target_ids):
            reread.extend(
                db.table("sponsored_posts")
                .select("id,ended_at,review_requested_at,posted_at")
                .in_("id", ids)
                .execute()
                .data
                or []
            )
        current = {str(row["id"]): row for row in reread}
        failures = [
            post_id
            for post_id in target_ids
            if str((current.get(post_id) or {}).get("ended_at") or "")[:10] != ENDED_AT
            or (current.get(post_id) or {}).get("review_requested_at") is not None
        ]
        if failures:
            raise SystemExit(f"[REVIEWED_ARCHIVE_ABORT] readback failures={len(failures)}")
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
