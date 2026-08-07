#!/usr/bin/env python3
"""Sync approved viral banner costs from the linked sheet into sponsored_posts.

The linked sheet is the source of truth for cost. This repair is intentionally
narrow: it only considers the approved 2026-08-06 banner target list and only
writes positive sheet costs into active viral banner DB rows whose cost is
currently blank/zero.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from db import get_client
from linked_sheet_reader import fetch_linked_sheet_rows


TARGET_IDS = [
    "Dbc2UOUkTq9",
    "DbsikcqE5qk",
    "DbsjBuwn7ki",
    "DbsiQ-ZibwH",
    "DbsuYftE2A2",
    "Dbskz12kpWy",
    "Dbsi4-yCdRc",
    "Dbspfp2mrI6",
    "DbnLmD4EUSJ",
    "Dbsi1SKkxqM",
    "DbsqKFhGve1",
    "Dbsp8SuGWUX",
    "Dbsp59VHUVO",
    "DbsqQwMlE9E",
    "Dbsp5fPkmfP",
    "DbsnryvlD6n",
    "DbsmXLPkgPH",
    "7670875393716522261",
]

PAGE = 1000


def link_key(url: str | None) -> str:
    value = (url or "").strip()
    patterns = (
        ("ig", r"instagram\.com/(?:[^/?#]+/)*(?:p|reel|reels|tv)/([\w-]+)"),
        ("tt", r"tiktok\.com/(?:@[^/]+/)?(?:video|photo)/(\d+)"),
        ("yt", r"youtube\.com/(?:shorts/|watch\?v=)([\w-]+)"),
        ("yt", r"youtu\.be/([\w-]+)"),
    )
    for prefix, pattern in patterns:
        match = re.search(pattern, value, re.I)
        if match:
            return f"{prefix}:{match.group(1)}"
    normalized = re.sub(r"[?#].*$", "", value.lower()).rstrip("/")
    normalized = re.sub(r"^https?://(?:www\.)?", "", normalized)
    return f"url:{normalized}" if normalized else ""


def target_key(value: str) -> str:
    return f"tt:{value}" if value.isdigit() else f"ig:{value}"


def parse_cost(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(value)) if value > 0 else None
    text = str(value).strip()
    if not text:
        return None
    cleaned = re.sub(r"[^0-9.-]", "", text)
    if not cleaned:
        return None
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return int(round(parsed)) if parsed > 0 else None


def header_index(headers: list[str], *names: str) -> int:
    normalized = {str(name).strip(): index for index, name in enumerate(headers)}
    for name in names:
        if name in normalized:
            return normalized[name]
    raise RuntimeError(f"Missing required sheet header: {names}")


def fetch_all_posts() -> list[dict[str, Any]]:
    db = get_client()
    rows: list[dict[str, Any]] = []
    offset = 0
    select = "id,url,normalized_key,account_name,channel_type,cost,manual_fields,ended_at"
    while True:
        page = db.table("sponsored_posts").select(select).range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def collect_sheet_costs() -> dict[str, dict[str, Any]]:
    rows = fetch_linked_sheet_rows()
    if not rows:
        raise RuntimeError("Linked sheet returned no rows")
    headers = [str(cell).strip() for cell in rows[0]]
    url_col = header_index(headers, "게시물URL", "게시물 URL", "URL")
    cost_col = header_index(headers, "비용")
    type_col = header_index(headers, "채널분류", "채널 분류")
    account_col = header_index(headers, "채널명")

    targets = {target_key(value) for value in TARGET_IDS}
    found: dict[str, dict[str, Any]] = {}
    duplicates: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows[1:], start=2):
        url = str(row[url_col]).strip() if url_col < len(row) else ""
        key = link_key(url)
        if key not in targets:
            continue
        item = {
            "sheet_row": row_number,
            "key": key,
            "url": url,
            "account_name": row[account_col] if account_col < len(row) else "",
            "channel_type": row[type_col] if type_col < len(row) else "",
            "sheet_cost": parse_cost(row[cost_col] if cost_col < len(row) else None),
            "sheet_cost_raw": row[cost_col] if cost_col < len(row) else "",
        }
        if key in found:
            duplicates.append(item)
        else:
            found[key] = item
    if duplicates:
        raise RuntimeError("Duplicate target rows in linked sheet: " + json.dumps(duplicates[:5], ensure_ascii=False))
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int, default=None)
    parser.add_argument("--backup-dir", default="data/backups")
    args = parser.parse_args()

    target_keys = {target_key(value) for value in TARGET_IDS}
    sheet_by_key = collect_sheet_costs()
    posts = fetch_all_posts()
    post_by_key = {str(post.get("normalized_key") or link_key(post.get("url"))): post for post in posts}

    candidates: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    missing_sheet = sorted(target_keys - set(sheet_by_key))
    missing_db = sorted(target_keys - set(post_by_key))
    active_viral_banner_blank_cost = [
        {
            "key": str(post.get("normalized_key") or link_key(post.get("url"))),
            "id": post.get("id"),
            "url": post.get("url"),
            "account_name": post.get("account_name"),
            "channel_type": post.get("channel_type"),
            "cost": post.get("cost"),
        }
        for post in posts
        if "바이럴" in str(post.get("channel_type") or "")
        and "배너" in str(post.get("channel_type") or "")
        and not post.get("ended_at")
        and (post.get("cost") in (None, "") or float(post.get("cost") or 0) <= 0)
    ]

    for key in sorted(target_keys):
        sheet = sheet_by_key.get(key)
        post = post_by_key.get(key)
        if not sheet or not post:
            continue
        sheet_cost = sheet.get("sheet_cost")
        db_cost = post.get("cost")
        manual_fields = post.get("manual_fields") if isinstance(post.get("manual_fields"), list) else []
        current_cost = float(db_cost) if db_cost not in (None, "") else 0
        item = {
            "key": key,
            "post_id": post.get("id"),
            "db_url": post.get("url"),
            "sheet_url": sheet.get("url"),
            "sheet_row": sheet.get("sheet_row"),
            "account_name": post.get("account_name") or sheet.get("account_name"),
            "channel_type": post.get("channel_type"),
            "before_cost": db_cost,
            "after_cost": sheet_cost,
            "manual_fields": manual_fields,
        }
        if sheet_cost is None:
            skipped.append({**item, "reason": "sheet_cost_not_positive"})
            continue
        if "배너" not in str(post.get("channel_type") or ""):
            skipped.append({**item, "reason": "not_banner"})
            continue
        if post.get("ended_at"):
            skipped.append({**item, "reason": "ended_post"})
            continue
        if current_cost > 0:
            skipped.append({**item, "reason": "db_already_has_cost"})
            continue
        candidates.append(item)

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"banner_cost_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    backup_payload = {
        "apply": args.apply,
        "target_count": len(target_keys),
        "sheet_found": len(sheet_by_key),
        "db_found": len([key for key in target_keys if key in post_by_key]),
        "candidate_count": len(candidates),
        "missing_sheet": missing_sheet,
        "missing_db": missing_db,
        "candidates": candidates,
        "skipped": skipped,
        "active_viral_banner_blank_cost_count": len(active_viral_banner_blank_cost),
        "active_viral_banner_blank_cost_sample": active_viral_banner_blank_cost[:10],
    }
    backup_path.write_text(json.dumps(backup_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.expected_count is not None and len(candidates) != args.expected_count:
        print("[BANNER_COST_SYNC_RESULT] " + json.dumps({**backup_payload, "backup": str(backup_path), "updated": 0}, ensure_ascii=False))
        raise SystemExit(f"Fail closed: expected {args.expected_count} candidates, got {len(candidates)}")

    updated = 0
    if args.apply:
        db = get_client()
        for item in candidates:
            manual = [field for field in item["manual_fields"] if field != "cost"]
            update = {"cost": item["after_cost"], "manual_fields": manual}
            db.table("sponsored_posts").update(update).eq("id", item["post_id"]).execute()
            updated += 1

    print("[BANNER_COST_SYNC_RESULT] " + json.dumps({
        **backup_payload,
        "backup": str(backup_path),
        "updated": updated,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
