#!/usr/bin/env python3
"""Inspect organic_mentions URL integrity before adding DB constraints."""

from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any

from db import get_client


PAGE = 1000


def fetch_all() -> list[dict[str, Any]]:
    db = get_client()
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = (
            db.table("organic_mentions")
            .select("id,url,account_name,platform,source,created_at")
            .order("id", desc=False)
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        offset += PAGE


def normalize_url(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    # Preserve YouTube video id because watch?v=... is the post identity.
    yt_match = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)", raw, re.I)
    if yt_match:
        return f"https://www.youtube.com/watch?v={yt_match.group(1)}"

    text = re.sub(r"[?#].*$", "", raw).rstrip("/")
    text = re.sub(r"^http://", "https://", text, flags=re.I)
    text = re.sub(r"^https://(?:m\.)?instagram\.com/", "https://www.instagram.com/", text, flags=re.I)
    text = re.sub(r"^https://(?:www\.)?tiktok\.com/", "https://www.tiktok.com/", text, flags=re.I)
    text = re.sub(r"^https://(?:www\.)?x\.com/", "https://x.com/", text, flags=re.I)
    return text


def duplicate_samples(rows: list[dict[str, Any]], key_fn) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = key_fn(row)
        if not key:
            continue
        groups.setdefault(key, []).append(row)
    out = []
    for key, group in groups.items():
        if len(group) > 1:
            out.append({
                "key": key,
                "count": len(group),
                "rows": [
                    {"id": item.get("id"), "url": item.get("url"), "account_name": item.get("account_name")}
                    for item in group[:10]
                ],
            })
    return out


def main() -> None:
    rows = fetch_all()
    exact_duplicates = duplicate_samples(rows, lambda row: row.get("url") or "")
    normalized_duplicates = duplicate_samples(rows, lambda row: normalize_url(row.get("url")))
    urls_with_query = [
        {"id": row.get("id"), "url": row.get("url")}
        for row in rows
        if isinstance(row.get("url"), str) and ("?" in row["url"] or "#" in row["url"])
    ]
    source_counts = Counter(str(row.get("source") or "") for row in rows)
    summary = {
        "ok": True,
        "total_rows": len(rows),
        "exact_duplicate_groups": len(exact_duplicates),
        "normalized_duplicate_groups": len(normalized_duplicates),
        "urls_with_query_or_hash": len(urls_with_query),
        "source_counts": dict(source_counts),
        "exact_duplicate_samples": exact_duplicates[:10],
        "normalized_duplicate_samples": normalized_duplicates[:10],
        "query_samples": urls_with_query[:10],
    }
    print("[ORGANIC_MENTIONS_INTEGRITY] " + json.dumps(summary, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
