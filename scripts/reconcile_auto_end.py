#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from supabase import create_client

from auto_end_rules import classify_auto_end, row_metric


PAGE = 1000
POST_SELECT = (
    "id,url,posted_at,account_name,company_name,project_name,product_name,"
    "channel_type,content_summary,notes,ended_at,reach_count,created_at"
)
STAT_SELECT = "post_id,measured_at,play_count,reach_count,manual,created_at"


def kst_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=9)).date().isoformat()


def get_client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    return create_client(url, key)


def fetch_all(client, table: str, select: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    start = 0
    while True:
        res = client.table(table).select(select).range(start, start + PAGE - 1).execute()
        rows = res.data or []
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        start += PAGE


def fetch_stats_for_posts(client, post_ids: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(post_ids), 100):
        chunk = post_ids[i:i + 100]
        start = 0
        while True:
            res = (
                client.table("post_daily_stats")
                .select(STAT_SELECT)
                .in_("post_id", chunk)
                .range(start, start + PAGE - 1)
                .execute()
            )
            rows = res.data or []
            out.extend(rows)
            if len(rows) < PAGE:
                break
            start += PAGE
    return out


def chunked(values: list[str], size: int = 100):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile sponsored_posts.ended_at from the canonical auto-end rules.")
    parser.add_argument("--target-date", default=kst_today())
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    client = get_client()
    posts = fetch_all(client, "sponsored_posts", POST_SELECT)
    stats = fetch_stats_for_posts(client, [p["id"] for p in posts])

    max_metric_by_post: dict[str, int] = {}
    for row in stats:
        metric = row_metric(row)
        pid = row["post_id"]
        if metric > max_metric_by_post.get(pid, 0):
            max_metric_by_post[pid] = metric

    classifications = []
    to_end: list[str] = []
    to_clear: list[str] = []
    keep_ended = 0
    keep_unended = 0

    for post in posts:
        decision = classify_auto_end(
            post,
            target_date=args.target_date,
            max_metric=max(max_metric_by_post.get(post["id"], 0), row_metric(post)),
        )
        current_ended = bool(post.get("ended_at"))
        desired_ended_at = args.target_date if decision.should_end else None
        if decision.should_end and not current_ended:
            action = "end"
            to_end.append(post["id"])
        elif not decision.should_end and current_ended:
            action = "clear"
            to_clear.append(post["id"])
        elif decision.should_end and current_ended:
            action = "keep_ended"
            keep_ended += 1
        else:
            action = "keep_unended"
            keep_unended += 1

        classifications.append({
            "id": post["id"],
            "url": post.get("url"),
            "account_name": post.get("account_name"),
            "company_name": post.get("company_name"),
            "project_name": post.get("project_name"),
            "product_name": post.get("product_name"),
            "channel_type": post.get("channel_type"),
            "posted_at": post.get("posted_at"),
            "current_ended_at": post.get("ended_at"),
            "desired_ended_at": desired_ended_at,
            "action": action,
            "reason": decision.reason,
            "age_days": decision.age_days,
            "threshold_days": decision.threshold_days,
            "max_metric": decision.metric,
            "content_summary": post.get("content_summary"),
        })

    summary = {
        "target_date": args.target_date,
        "apply": args.apply,
        "total_posts": len(posts),
        "to_end": len(to_end),
        "to_clear": len(to_clear),
        "keep_ended": keep_ended,
        "keep_unended": keep_unended,
        "actions": dict(Counter(c["action"] for c in classifications)),
        "reasons": dict(Counter(c["reason"] for c in classifications)),
    }

    report = {
        "summary": summary,
        "to_end": [c for c in classifications if c["action"] == "end"],
        "to_clear": [c for c in classifications if c["action"] == "clear"],
        "keep_ended": [c for c in classifications if c["action"] == "keep_ended"],
        "keep_unended": [c for c in classifications if c["action"] == "keep_unended"],
    }

    out_path = Path(args.out) if args.out else Path("data/output") / f"auto-end-reconcile-{args.target_date}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.apply:
        for ids in chunked(to_end):
            client.table("sponsored_posts").update({"ended_at": args.target_date}).in_("id", ids).execute()
        for ids in chunked(to_clear):
            client.table("sponsored_posts").update({"ended_at": None}).in_("id", ids).execute()

        reread = []
        changed_ids = to_end + to_clear
        for ids in chunked(changed_ids):
            reread.extend(
                client.table("sponsored_posts")
                .select("id,ended_at")
                .in_("id", ids)
                .execute()
                .data or []
            )
        ended_map = {r["id"]: r.get("ended_at") for r in reread}
        end_failed = [pid for pid in to_end if str(ended_map.get(pid))[:10] != args.target_date]
        clear_failed = [pid for pid in to_clear if ended_map.get(pid) is not None]
        summary["readback"] = {
            "checked": len(changed_ids),
            "end_failed": len(end_failed),
            "clear_failed": len(clear_failed),
        }
        if end_failed or clear_failed:
            out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            raise SystemExit(f"readback failed: end_failed={len(end_failed)} clear_failed={len(clear_failed)}")

    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"report={out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
