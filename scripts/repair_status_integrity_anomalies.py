#!/usr/bin/env python3
"""Inspect and optionally repair notify_status integrity anomalies."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from db import get_client


PAGE = 1000


def fetch_pages(table: str, select: str) -> list[dict[str, Any]]:
    db = get_client()
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = db.table(table).select(select).range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def chunks(values: list[str], size: int = 100):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def metric(row: dict[str, Any]) -> int:
    return int(row.get("play_count") or row.get("reach_count") or 0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir", default="data/backups")
    args = parser.parse_args()

    db = get_client()
    posts = fetch_pages("sponsored_posts", "id,url,account_name,channel_type,posted_at,ended_at")
    stats = fetch_pages(
        "post_daily_stats",
        "id,post_id,measured_at,play_count,reach_count,manual,created_at",
    )
    post_by_id = {p["id"]: p for p in posts if p.get("id")}
    name_of = {p["id"]: (p.get("account_name") or "?") for p in posts if p.get("id")}

    stats_by_post: dict[str, list[dict[str, Any]]] = {}
    value_index: dict[tuple[str, int], set[str]] = {}
    for row in stats:
        pid = row.get("post_id")
        if not pid:
            continue
        stats_by_post.setdefault(pid, []).append(row)
        value = metric(row)
        if value > 0:
            value_index.setdefault((str(row["measured_at"])[:10], value), set()).add(pid)

    early = []
    for pid, rows in stats_by_post.items():
        post = post_by_id.get(pid) or {}
        posted_at = str(post.get("posted_at") or "")[:10]
        if not posted_at:
            continue
        first_date = min(str(r["measured_at"])[:10] for r in rows)
        if first_date < posted_at:
            early.append({
                "post_id": pid,
                "account_name": name_of.get(pid),
                "url": post.get("url"),
                "posted_at": posted_at,
                "first_measured_at": first_date,
            })

    copy_hits = []
    for pid, rows in stats_by_post.items():
        post = post_by_id.get(pid) or {}
        ended_at = str(post.get("ended_at") or "")[:10]
        if not ended_at:
            continue
        positive = sorted(
            (str(r["measured_at"])[:10], metric(r), r)
            for r in rows
            if metric(r) > 0
        )
        pre = [(d, v, r) for d, v, r in positive if d <= ended_at]
        carry = pre[-1][1] if pre else None
        for d, value, row in positive:
            if d <= ended_at or value == carry:
                continue
            peers = value_index.get((d, value), set()) - {pid}
            if not peers:
                continue
            copy_hits.append({
                "stat_id": row.get("id"),
                "post_id": pid,
                "account_name": name_of.get(pid),
                "url": post.get("url"),
                "ended_at": ended_at,
                "measured_at": d,
                "value": value,
                "manual": bool(row.get("manual")),
                "source_accounts": sorted(name_of.get(x, "?") for x in peers)[:5],
            })

    drops = []
    for pid, rows in stats_by_post.items():
        positive = sorted(
            (str(r["measured_at"])[:10], int(r.get("play_count") or 0), r)
            for r in rows
            if (r.get("play_count") or 0) > 0
        )
        if len(positive) < 2:
            continue
        last_d, last_v, last_row = positive[-1]
        prior_max = max(v for _, v, _ in positive[:-1])
        last_manual = bool(last_row.get("manual"))
        if last_v < prior_max and (last_manual or last_v < prior_max * 0.95):
            post = post_by_id.get(pid) or {}
            drops.append({
                "stat_id": last_row.get("id"),
                "post_id": pid,
                "account_name": name_of.get(pid),
                "url": post.get("url"),
                "measured_at": last_d,
                "value": last_v,
                "prior_max": prior_max,
                "manual": last_manual,
            })

    repair_ids: dict[str, str] = {}
    for item in copy_hits:
        if not item["manual"] and item.get("stat_id"):
            repair_ids[item["stat_id"]] = "copy_after_end"
    for item in drops:
        if not item["manual"] and item.get("stat_id"):
            repair_ids[item["stat_id"]] = "auto_drop"

    summary = {
        "ok": True,
        "apply": bool(args.apply),
        "early_count": len(early),
        "copy_hit_count": len(copy_hits),
        "drop_count": len(drops),
        "repairable_rows": len(repair_ids),
        "early_sample": early[:10],
        "copy_sample": copy_hits[:10],
        "drop_sample": drops[:10],
        "repair_reasons": {reason: list(repair_ids.values()).count(reason) for reason in sorted(set(repair_ids.values()))},
    }

    if repair_ids:
        backup_dir = Path(args.backup_dir)
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"status_integrity_repair_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        backup_rows = [row for row in stats if row.get("id") in repair_ids]
        backup_path.write_text(json.dumps({
            "repair_ids": repair_ids,
            "rows": backup_rows,
            "summary": summary,
        }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        summary["backup"] = str(backup_path)

    if args.apply and repair_ids:
        deleted = 0
        for ids in chunks(list(repair_ids.keys())):
            result = db.table("post_daily_stats").delete().in_("id", ids).execute().data or []
            deleted += len(result)
        summary["deleted_rows"] = deleted

    print("[STATUS_INTEGRITY_RESULT] " + json.dumps(summary, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
