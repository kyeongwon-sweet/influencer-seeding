#!/usr/bin/env python3
"""Report sheet rows whose cumulative view cell is blank but DB has metrics."""

from __future__ import annotations

import csv
import io
import json
import re
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

from auto_end_rules import row_metric
from backfill_zero_metric_posts import is_allowed_channel_type, platform_of
from db import get_client


SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak"
GID = "1937186871"
BASE_MEASURED_AT = (
    (datetime.now(timezone.utc) + timedelta(hours=9)).date() - timedelta(days=1)
).isoformat()
PAGE = 1000


def link_key(url: str) -> str:
    u = (url or "").strip()
    m = re.search(r"instagram\.com/(?:[^/?#]+/)*(?:p|reel|reels|tv)/([^/?#]+)", u, re.I)
    if m:
        return "ig:" + m.group(1)
    m = re.search(r"(?:youtube\.com/(?:shorts/|watch\?v=)|youtu\.be/)([^/?#&]+)", u, re.I)
    if m:
        return "yt:" + m.group(1)
    m = re.search(r"tiktok\.com/.*/video/(\d+)", u, re.I)
    if m:
        return "tt:" + m.group(1)
    return u.split("?")[0].rstrip("/").lower()


def normalized_url(url: str) -> str:
    return (url or "").split("?")[0].rstrip("/").lower()


def target_measured_at(post: dict[str, Any] | None) -> str:
    ended_at = str((post or {}).get("ended_at") or "")[:10]
    if ended_at and ended_at < BASE_MEASURED_AT:
        return ended_at
    return BASE_MEASURED_AT


def fetch_sheet_rows() -> list[dict[str, Any]]:
    url = (
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export"
        f"?format=csv&gid={GID}&cb={int(time.time() * 1000)}"
    )
    text = urllib.request.urlopen(url, timeout=60).read().decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    out: list[dict[str, Any]] = []
    for row_num, row in enumerate(rows[1:], start=2):
        if len(row) < 8:
            continue
        channel_type = row[3].strip()
        url_value = row[1].strip()
        if row[7].strip():
            continue
        if not is_allowed_channel_type(channel_type):
            continue
        if not platform_of(url_value):
            continue
        out.append({
            "row": row_num,
            "posted_at": row[0].strip(),
            "url": url_value,
            "account_name": row[2].strip(),
            "channel_type": channel_type,
            "key": link_key(url_value),
        })
    return out


def fetch_posts(db) -> list[dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    for start in range(0, 100000, PAGE):
        res = (
            db.table("sponsored_posts")
            .select("id,url,posted_at,channel_type,ended_at")
            .order("id")
            .range(start, start + PAGE - 1)
            .execute()
        )
        chunk = res.data or []
        posts.extend(chunk)
        if len(chunk) < PAGE:
            break
    return posts


def fetch_stats(db, post_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for i in range(0, len(post_ids), 100):
        chunk = post_ids[i:i + 100]
        start = 0
        while True:
            res = (
                db.table("post_daily_stats")
                .select("post_id,measured_at,play_count,reach_count")
                .in_("post_id", chunk)
                .range(start, start + PAGE - 1)
                .execute()
            )
            rows = res.data or []
            for row in rows:
                if row_metric(row) > 0:
                    out[row["post_id"]].append(row)
            if len(rows) < PAGE:
                break
            start += PAGE
    return out


def best_metric(stats: list[dict[str, Any]], cutoff: str) -> dict[str, Any] | None:
    eligible = []
    for row in stats:
        date = str(row.get("measured_at") or "")[:10]
        metric = row_metric(row)
        if date and date <= cutoff and metric > 0:
            eligible.append({"date": date, "metric": metric})
    if not eligible:
        return None
    eligible.sort(key=lambda item: (item["metric"], item["date"]), reverse=True)
    return eligible[0]


def run() -> dict[str, Any]:
    db = get_client()
    sheet_rows = fetch_sheet_rows()
    posts = fetch_posts(db)
    by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_url: dict[str, dict[str, Any]] = {}
    for post in posts:
        key = link_key(str(post.get("url") or ""))
        if key:
            by_key[key].append(post)
        by_url[normalized_url(str(post.get("url") or ""))] = post

    candidate_ids = sorted({p["id"] for row in sheet_rows for p in by_key.get(row["key"], [])})
    stats_by_post = fetch_stats(db, candidate_ids)
    fillable = []
    unfillable = []
    for row in sheet_rows:
        exact_post = by_url.get(normalized_url(row["url"]))
        candidates = [exact_post] if exact_post else by_key.get(row["key"], [])
        candidates = [p for p in candidates if p]
        best = None
        best_post = None
        target_date = BASE_MEASURED_AT
        for post in candidates:
            cutoff = target_measured_at(post)
            metric = best_metric(stats_by_post.get(post["id"], []), cutoff)
            if metric and (best is None or metric["metric"] > best["metric"]):
                best = metric
                best_post = post
                target_date = cutoff
        if best and best_post:
            fillable.append({
                **row,
                "post_id": best_post["id"],
                "target_date": target_date,
                "write_date": best["date"],
                "metric": best["metric"],
                "ended_at": best_post.get("ended_at"),
            })
        else:
            unfillable.append(row)

    result = {
        "base_measured_at": BASE_MEASURED_AT,
        "blank_rows": len(sheet_rows),
        "fillable": len(fillable),
        "unfillable": len(unfillable),
        "fillable_rows": fillable,
        "unfillable_rows": unfillable,
    }
    print("[BLANK_SHEET_METRICS] " + json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    run()
