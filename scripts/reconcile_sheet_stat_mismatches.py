#!/usr/bin/env python3
"""Reconcile direct daily-stat mismatches with the linked sheet as source of truth."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from db import get_client
from linked_sheet_reader import fetch_linked_sheet_rows


PAGE = 1000


def link_key(url: str | None) -> str:
    value = (url or "").strip().lower()
    patterns = (
        ("ig", r"instagram\.com/(?:[^/?#]+/)?(?:p|reel|reels|tv)/([\w-]+)"),
        ("tt", r"tiktok\.com/(?:@[^/]+/)?(?:video|photo)/(\d+)"),
        ("yt", r"youtube\.com/(?:shorts/|watch\?v=)([\w-]+)"),
        ("yt", r"youtu\.be/([\w-]+)"),
    )
    for prefix, pattern in patterns:
        match = re.search(pattern, value, re.I)
        if match:
            return f"{prefix}:{match.group(1).lower()}"
    normalized = re.sub(r"[?#].*$", "", value).rstrip("/")
    normalized = re.sub(r"^https?://(?:www\.)?", "", normalized)
    return f"url:{normalized}" if normalized else ""


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        pass
    numbers = [int(v) for v in re.findall(r"\d+", text)]
    if len(numbers) >= 3:
        year, month, day = numbers[:3]
        if year < 100:
            year += 2000
    elif len(numbers) >= 2:
        year, month, day = 2026, numbers[0], numbers[1]
    else:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_number(value: Any) -> int | None:
    text = str(value or "").strip().replace(",", "").replace("₩", "")
    if not text:
        return None
    try:
        return round(float(text))
    except ValueError:
        return None


def fetch_all(table: str, select: str) -> list[dict[str, Any]]:
    db = get_client()
    output: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = db.table(table).select(select).range(offset, offset + PAGE - 1).execute().data or []
        output.extend(page)
        if len(page) < PAGE:
            return output
        offset += PAGE


def metric_column(post: dict[str, Any]) -> str:
    channel_type = str(post.get("channel_type") or "")
    url = str(post.get("url") or "").lower()
    return "reach_count" if "배너" in channel_type and "tiktok.com" not in url else "play_count"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before-date", required=True, help="Only reconcile measured dates before YYYY-MM-DD")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--backup-dir", default="data/backups")
    args = parser.parse_args()
    cutoff = date.fromisoformat(args.before_date)

    rows = fetch_linked_sheet_rows()
    headers = rows[0]
    date_columns = {index: parse_date(value) for index, value in enumerate(headers) if index >= 14}
    date_columns = {index: value for index, value in date_columns.items() if value}

    sheet_by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row_number, row in enumerate(rows[1:], start=2):
        url = row[1].strip() if len(row) > 1 else ""
        key = link_key(url)
        if not key:
            continue
        sheet_by_key[key].append({
            "row": row_number,
            "url": url,
            "values": {measured: parse_number(row[index]) if index < len(row) else None for index, measured in date_columns.items()},
        })

    posts = fetch_all("sponsored_posts", "id,url,channel_type,posted_at,ended_at")
    stats = fetch_all("post_daily_stats", "id,post_id,measured_at,play_count,reach_count,manual")
    post_by_id = {post["id"]: post for post in posts}
    posts_by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        posts_by_key[link_key(post.get("url"))].append(post)

    candidates: list[dict[str, Any]] = []
    for stat in stats:
        post = post_by_id.get(stat.get("post_id"))
        if not post:
            continue
        sheet_rows = sheet_by_key.get(link_key(post.get("url")), [])
        if len(sheet_rows) != 1 or len(posts_by_key.get(link_key(post.get("url")), [])) != 1:
            continue
        measured = parse_date(stat.get("measured_at"))
        posted = parse_date(post.get("posted_at"))
        ended = parse_date(post.get("ended_at"))
        if not measured or measured >= cutoff or (posted and measured < posted) or (ended and measured > ended):
            continue
        column = metric_column(post)
        db_value = stat.get(column)
        sheet_value = sheet_rows[0]["values"].get(measured)
        if not isinstance(db_value, (int, float)) or db_value <= 0:
            continue
        if not isinstance(sheet_value, (int, float)) or sheet_value <= 0 or int(db_value) == int(sheet_value):
            continue
        candidates.append({
            "stat_id": stat["id"],
            "post_id": post["id"],
            "url": post.get("url"),
            "sheet_row": sheet_rows[0]["row"],
            "measured_at": measured.isoformat(),
            "metric_column": column,
            "old_value": int(db_value),
            "new_value": int(sheet_value),
            "old_manual": bool(stat.get("manual")),
        })

    candidates.sort(key=lambda item: (item["sheet_row"], item["measured_at"]))
    if args.expected_count is not None and len(candidates) != args.expected_count:
        raise SystemExit(f"candidate count changed: expected={args.expected_count}, actual={len(candidates)}")

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"sheet_stat_mismatch_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    backup.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")

    updated = 0
    if args.apply:
        db = get_client()
        for item in candidates:
            fresh = (
                db.table("post_daily_stats")
                .select("id,play_count,reach_count,manual")
                .eq("id", item["stat_id"])
                .single()
                .execute()
                .data
            )
            if not fresh or fresh.get(item["metric_column"]) != item["old_value"]:
                raise SystemExit(f"row changed before update: {item['stat_id']}")
            result = (
                db.table("post_daily_stats")
                .update({item["metric_column"]: item["new_value"], "manual": True})
                .eq("id", item["stat_id"])
                .execute()
                .data
                or []
            )
            updated += len(result)

    print("[SHEET_STAT_RECONCILE_RESULT] " + json.dumps({
        "ok": True,
        "apply": args.apply,
        "before_date": args.before_date,
        "candidate_rows": len(candidates),
        "updated_rows": updated,
        "backup": str(backup),
        "sample": candidates[:10],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
