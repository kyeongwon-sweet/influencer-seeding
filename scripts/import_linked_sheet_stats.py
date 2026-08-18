#!/usr/bin/env python3
"""Import one linked-sheet date column into stats-import.

This mirrors the Apps Script importStats path, but is intentionally narrower:
it reads the authenticated linked sheet through the production API and sends
only the requested measured_at date. Use this when clasp cannot execute the
live Apps Script function but the sheet is the source of truth for a specific
manual correction day.
"""

from __future__ import annotations

from channel_kind import is_banner_channel

import argparse
import json
import os
import re
import urllib.request
from datetime import date, datetime, timedelta
from typing import Any

from linked_sheet_reader import fetch_linked_sheet_rows


IMPORTSTATS_CLIENT_VERSION = "2026-08-03-import-source-v2"
ALLOWED_URL_RE = re.compile(
    r"^https://([a-z0-9-]+\.)*"
    r"(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)/",
    re.I,
)
EXCEL_EPOCH = date(1899, 12, 30)


FIELD_BY_HEADER = {
    "업로드일": "posted_at",
    "게시물url": "url",
    "채널명": "account_name",
    "업체명": "company_name",
    "캡션": "content_summary",
    "소재명": "asset_name",
    "채널분류": "channel_type",
    "프로젝트명": "project_name",
    "상품명": "product_name",
    "기획자": "planner",
    "제작자": "creator",
    "비용": "cost",
}


def normalize_header(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def parse_number(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value).strip()
    if not text:
        return None
    cleaned = re.sub(r"[^0-9.-]", "", text)
    if not cleaned or cleaned in {"-", ".", "-."}:
        return None
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return int(round(parsed))


def parse_sheet_date(value: Any, *, current_year: int = 2026) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        serial = int(value)
        if 40000 <= serial <= 50000:
            return (EXCEL_EPOCH + timedelta(days=serial)).isoformat()
    text = str(value).strip()
    if not text:
        return None
    numeric = parse_number(text)
    if numeric is not None and text.replace(".", "", 1).isdigit() and 40000 <= numeric <= 50000:
        return (EXCEL_EPOCH + timedelta(days=numeric)).isoformat()

    iso = re.search(r"(20\d{2})[-./](\d{1,2})[-./](\d{1,2})", text)
    if iso:
        return f"{int(iso.group(1)):04d}-{int(iso.group(2)):02d}-{int(iso.group(3)):02d}"

    short = re.search(r"(\d{2})\.(\d{1,2})\.(\d{1,2})", text)
    if short:
        return f"20{int(short.group(1)):02d}-{int(short.group(2)):02d}-{int(short.group(3)):02d}"

    md = re.search(r"(?<!\d)(\d{1,2})\.(\d{1,2})(?!\d)", text)
    if md:
        return f"{current_year:04d}-{int(md.group(1)):02d}-{int(md.group(2)):02d}"
    return None


def to_date_str(value: Any) -> str | None:
    return parse_sheet_date(value)


def build_field_cols(headers: list[Any]) -> dict[str, int]:
    cols: dict[str, int] = {}
    for idx, header in enumerate(headers):
        field = FIELD_BY_HEADER.get(normalize_header(header))
        if field and field not in cols:
            cols[field] = idx
    if "url" not in cols:
        raise RuntimeError("Missing required header: 게시물URL")
    return cols


def date_columns(headers: list[Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    rolling_year = 2026
    prev_month: int | None = None
    for idx, header in enumerate(headers):
        parsed = parse_sheet_date(header, current_year=rolling_year)
        if not parsed:
            continue
        month = int(parsed[5:7])
        if prev_month is not None and month < prev_month and re.search(r"(?<!\d)\d{1,2}\.\d{1,2}(?!\d)", str(header)):
            rolling_year += 1
            parsed = parse_sheet_date(header, current_year=rolling_year)
            if not parsed:
                continue
            month = int(parsed[5:7])
        prev_month = month
        out[parsed] = idx
    return out


def make_post(row: list[str], field_cols: dict[str, int]) -> dict[str, Any]:
    post: dict[str, Any] = {"url": str(row[field_cols["url"]]).strip()}
    for field in (
        "posted_at",
        "account_name",
        "company_name",
        "content_summary",
        "asset_name",
        "channel_type",
        "project_name",
        "product_name",
        "planner",
        "creator",
        "cost",
    ):
        col = field_cols.get(field)
        if col is None:
            continue
        value = row[col] if col < len(row) else ""
        if field == "posted_at":
            post[field] = to_date_str(value)
        elif field == "cost":
            post[field] = parse_number(value)
        else:
            text = str(value or "").strip()
            post[field] = text or None
    return post


def collect_payload(target_date: str) -> dict[str, Any]:
    rows = fetch_linked_sheet_rows()
    if not rows:
        raise RuntimeError("Linked sheet returned no rows")
    headers = rows[0]
    field_cols = build_field_cols(headers)
    date_by_col = date_columns(headers)
    target_col = date_by_col.get(target_date)
    if target_col is None:
        raise RuntimeError(f"Target date column not found: {target_date}")

    posts_by_url: dict[str, dict[str, Any]] = {}
    stats: list[dict[str, Any]] = []
    scanned_rows = 0
    skipped_invalid_url = 0
    skipped_pre_post = 0
    skipped_blank = 0
    skipped_carry = 0

    earlier_cols = sorted((d, c) for d, c in date_by_col.items() if d < target_date)

    for row in rows[1:]:
        scanned_rows += 1
        url = str(row[field_cols["url"]]).strip() if field_cols["url"] < len(row) else ""
        if not url or not ALLOWED_URL_RE.search(url):
            skipped_invalid_url += 1
            continue

        if url not in posts_by_url:
            posts_by_url[url] = make_post(row, field_cols)

        post = posts_by_url[url]
        posted_at = post.get("posted_at")
        if posted_at and str(posted_at)[:10] > target_date:
            skipped_pre_post += 1
            continue

        value = parse_number(row[target_col] if target_col < len(row) else None)
        if value is None:
            skipped_blank += 1
            continue

        is_banner = is_banner_channel(post.get("channel_type"), post.get("posted_at"))
        if not is_banner:
            prev_value = None
            for _, col in earlier_cols:
                if col >= len(row):
                    continue
                n = parse_number(row[col])
                if n is not None:
                    prev_value = n
            if prev_value is not None and prev_value == value:
                skipped_carry += 1
                continue

        stats.append({"url": url, "measured_at": target_date, "play_count": value})

    return {
        "posts": list(posts_by_url.values()),
        "stats": stats,
        "client_version": IMPORTSTATS_CLIENT_VERSION,
        "source": "manual_sheet",
        "_summary": {
            "target_date": target_date,
            "target_col": target_col + 1,
            "scanned_rows": scanned_rows,
            "posts": len(posts_by_url),
            "stats": len(stats),
            "skipped_invalid_url": skipped_invalid_url,
            "skipped_pre_post": skipped_pre_post,
            "skipped_blank": skipped_blank,
            "skipped_carry": skipped_carry,
        },
    }


def post_stats(payload: dict[str, Any]) -> dict[str, Any]:
    app_url = os.environ["APP_URL"].rstrip("/")
    secret = os.environ["CRON_SECRET"]
    body = json.dumps({k: v for k, v in payload.items() if not k.startswith("_")}).encode()
    req = urllib.request.Request(
        f"{app_url}/api/sponsored-posts/stats-import",
        data=body,
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-date", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    datetime.strptime(args.target_date, "%Y-%m-%d")
    payload = collect_payload(args.target_date)
    summary = payload["_summary"]
    result: dict[str, Any] | None = None
    if args.apply:
        result = post_stats(payload)
    print("[LINKED_SHEET_IMPORT_RESULT] " + json.dumps({
        "apply": args.apply,
        "summary": summary,
        "result": result,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
