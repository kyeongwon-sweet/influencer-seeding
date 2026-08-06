"""Delete empty automatic post_daily_stats rows dated before their post date.

Only rows satisfying all conditions are deleted:
- post_daily_stats.measured_at < sponsored_posts.posted_at
- play_count is null
- reach_count is null
- manual is not true

Rows with any metric value or manual=true are reported and preserved.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


STEP = 1000


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def request_json(method: str, url: str, key: str, body: bytes | None = None) -> list[dict]:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if method == "DELETE":
        headers["Prefer"] = "return=representation"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = res.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} failed: {exc.code} {details[:500]}") from exc
    return json.loads(data or "[]")


def fetch_all(base: str, key: str, table: str, select: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        qs = urllib.parse.urlencode({"select": select, "limit": str(STEP), "offset": str(offset)})
        page = request_json("GET", f"{base}/{table}?{qs}", key)
        rows.extend(page)
        if len(page) < STEP:
            return rows
        offset += STEP


def classify_rows(stats: list[dict], posts: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    post_by_id = {p["id"]: p for p in posts if p.get("posted_at")}
    pre_post: list[dict] = []
    delete_candidates: list[dict] = []
    hold: list[dict] = []
    for stat in stats:
        post = post_by_id.get(stat.get("post_id"))
        if not post:
            continue
        if str(stat.get("measured_at") or "") >= str(post.get("posted_at") or ""):
            continue
        row = {**stat, "post": post}
        pre_post.append(row)
        empty_metric = row.get("play_count") is None and row.get("reach_count") is None
        non_manual = row.get("manual") is not True
        if empty_metric and non_manual:
            delete_candidates.append(row)
        else:
            hold.append(row)
    return pre_post, delete_candidates, hold


def delete_by_ids(base: str, key: str, ids: list[str]) -> list[dict]:
    if not ids:
        return []
    encoded = ",".join(ids)
    qs = urllib.parse.urlencode({"select": "id,post_id,measured_at,play_count,reach_count,manual"})
    return request_json("DELETE", f"{base}/post_daily_stats?id=in.({encoded})&{qs}", key)


def summarize(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": r.get("id"),
            "post_id": r.get("post_id"),
            "account": (r.get("post") or {}).get("account_name"),
            "url": (r.get("post") or {}).get("url"),
            "posted_at": (r.get("post") or {}).get("posted_at"),
            "measured_at": r.get("measured_at"),
            "play_count": r.get("play_count"),
            "reach_count": r.get("reach_count"),
            "manual": r.get("manual"),
            "created_at": r.get("created_at"),
        }
        for r in rows
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="delete eligible empty automatic rows")
    parser.add_argument("--backup-dir", default="scratchpad")
    args = parser.parse_args()

    supabase_url = (os.environ.get("SUPABASE_URL") or env("NEXT_PUBLIC_SUPABASE_URL")).rstrip("/")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    base = f"{supabase_url}/rest/v1"

    posts = fetch_all(base, key, "sponsored_posts", "id,url,account_name,posted_at")
    stats = fetch_all(base, key, "post_daily_stats", "id,post_id,measured_at,play_count,reach_count,manual,created_at")
    pre_post, delete_candidates, hold = classify_rows(stats, posts)

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"pre_post_empty_stats_backup_{stamp}.json"
    backup_payload = {
        "mode": "apply" if args.apply else "dry_run",
        "total_pre_post": len(pre_post),
        "delete_candidates": len(delete_candidates),
        "hold": len(hold),
        "rows": summarize(pre_post),
    }
    backup_path.write_text(json.dumps(backup_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    deleted: list[dict] = []
    if args.apply:
        ids = [str(r["id"]) for r in delete_candidates]
        deleted = delete_by_ids(base, key, ids)
        posts_after = fetch_all(base, key, "sponsored_posts", "id,url,account_name,posted_at")
        stats_after = fetch_all(base, key, "post_daily_stats", "id,post_id,measured_at,play_count,reach_count,manual,created_at")
        _, remaining_delete_candidates, remaining_hold = classify_rows(stats_after, posts_after)
    else:
        remaining_delete_candidates = delete_candidates
        remaining_hold = hold

    result = {
        "mode": "apply" if args.apply else "dry_run",
        "backup": str(backup_path),
        "total_pre_post_before": len(pre_post),
        "delete_candidates_before": len(delete_candidates),
        "hold_before": len(hold),
        "deleted": len(deleted),
        "remaining_delete_candidates": len(remaining_delete_candidates),
        "remaining_hold": len(remaining_hold),
        "hold_summary": summarize(remaining_hold),
    }
    print("[PRE_POST_REPAIR] " + json.dumps(result, ensure_ascii=False))
    if args.apply and len(deleted) != len(delete_candidates):
        print("[PRE_POST_REPAIR_ERROR] deleted count mismatch", file=sys.stderr)
        return 1
    if args.apply and remaining_delete_candidates:
        print("[PRE_POST_REPAIR_ERROR] delete candidates remain", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
