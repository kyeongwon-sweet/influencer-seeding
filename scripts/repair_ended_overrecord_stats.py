#!/usr/bin/env python3
"""Find or delete post_daily_stats rows written after tracking ended."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from db import get_client


PAGE = 1000


def fetch_all(table, select: str, **filters):
    db = get_client()
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = db.table(table).select(select)
        for name, value in filters.items():
            if name.endswith("__eq"):
                query = query.eq(name[:-4], value)
            elif name.endswith("__lt"):
                query = query.lt(name[:-4], value)
            elif name.endswith("__is"):
                query = query.is_(name[:-4], value)
            else:
                raise ValueError(f"unsupported filter {name}")
        page = query.order("id").range(offset, offset + PAGE - 1).execute().data or []
        out.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return out


def chunks(values: list[str], size: int = 100):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="measured_at date to repair, YYYY-MM-DD")
    parser.add_argument("--apply", action="store_true", help="delete matching rows after backup")
    parser.add_argument("--backup-dir", default="data/backups")
    args = parser.parse_args()

    try:
        datetime.strptime(args.date, "%Y-%m-%d")
    except ValueError as exc:
        raise SystemExit(f"--date must be YYYY-MM-DD: {args.date}") from exc

    db = get_client()
    ended_posts = fetch_all(
        "sponsored_posts",
        "id,url,account_name,channel_type,posted_at,ended_at",
        ended_at__lt=args.date,
    )
    posts_by_id = {row["id"]: row for row in ended_posts if row.get("id")}
    candidates: list[dict[str, Any]] = []

    for ids in chunks(list(posts_by_id.keys())):
        offset = 0
        while True:
            page = (
                db.table("post_daily_stats")
                .select("id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at")
                .eq("measured_at", args.date)
                .eq("manual", False)
                .in_("post_id", ids)
                .order("id")
                .range(offset, offset + PAGE - 1)
                .execute()
                .data
                or []
            )
            for row in page:
                post = posts_by_id.get(row.get("post_id"))
                if not post:
                    continue
                candidates.append({**row, "post": post})
            if len(page) < PAGE:
                break
            offset += PAGE

    candidates.sort(key=lambda r: (
        str(r["post"].get("account_name") or ""),
        str(r["post"].get("url") or ""),
        str(r.get("id") or ""),
    ))
    summary = {
        "ok": True,
        "apply": bool(args.apply),
        "date": args.date,
        "ended_posts_before_date": len(ended_posts),
        "candidate_rows": len(candidates),
        "manual_false_only": True,
        "sample": [
            {
                "stat_id": row.get("id"),
                "account_name": row["post"].get("account_name"),
                "channel_type": row["post"].get("channel_type"),
                "url": row["post"].get("url"),
                "ended_at": row["post"].get("ended_at"),
                "play_count": row.get("play_count"),
                "reach_count": row.get("reach_count"),
                "created_at": row.get("created_at"),
            }
            for row in candidates[:20]
        ],
    }

    backup_path: Path | None = None
    if candidates:
        backup_dir = Path(args.backup_dir)
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"ended_overrecord_{args.date}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        backup_path.write_text(json.dumps(candidates, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        summary["backup"] = str(backup_path)

    if args.apply and candidates:
        fresh_ids: set[str] = set()
        for ids in chunks([row["id"] for row in candidates if row.get("id")]):
            page = (
                db.table("post_daily_stats")
                .select("id,post_id,measured_at,manual")
                .eq("measured_at", args.date)
                .eq("manual", False)
                .in_("id", ids)
                .execute()
                .data
                or []
            )
            for row in page:
                post = posts_by_id.get(row.get("post_id"))
                if post and str(post.get("ended_at") or "")[:10] < args.date:
                    fresh_ids.add(row["id"])

        candidate_ids = {row["id"] for row in candidates if row.get("id")}
        if fresh_ids != candidate_ids:
            raise SystemExit(json.dumps({
                "ok": False,
                "error": "candidate set changed before delete",
                "candidate_rows": len(candidate_ids),
                "fresh_rows": len(fresh_ids),
            }, ensure_ascii=False))

        deleted = 0
        for ids in chunks(list(fresh_ids)):
            result = db.table("post_daily_stats").delete().in_("id", ids).execute().data or []
            deleted += len(result)
        summary["deleted_rows"] = deleted

    print("[ENDED_OVERRECORD_RESULT] " + json.dumps(summary, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
