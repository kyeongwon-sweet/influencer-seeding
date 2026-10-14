#!/usr/bin/env python3
"""Strictly guarded deletion of one sponsored_posts row.

This helper is intentionally narrow. It refuses to delete unless the live row
and its statistic-row count exactly match every caller-supplied expectation.
"""

from __future__ import annotations

import argparse
import json
import re
from urllib.parse import parse_qs, urlsplit
from dataclasses import dataclass
from typing import Any

from db import get_client


@dataclass(frozen=True)
class ExpectedPost:
    post_id: str
    url: str
    account_name: str
    posted_at: str
    ended_at: str
    cost: int
    stats_count: int


POST_SELECT = (
    "id,url,account_name,channel_type,posted_at,ended_at,cost,created_at,"
    "asset_name,project_name,product_name,notes,content_summary"
)

NULL_DATE_SENTINEL = "__NULL__"


NULL_DATE_SPELLINGS = {NULL_DATE_SENTINEL.lower(), "null"}

# TikTok 게시물 ID는 unsigned 64-bit snowflake (web/lib/url-utils.ts isValidTikTokSnowflake 와 동일).
_MAX_TIKTOK_SNOWFLAKE = "18446744073709551615"


def parse_expected_nullable_date(value: str) -> str:
    """Represent a required workflow input whose expected DB date is NULL.

    GitHub workflow_dispatch rejects an empty value for required inputs, so
    callers pass ``__NULL__`` and the strict comparison keeps using ``""``
    for a missing database date. ``NULL``/``null`` are accepted too: they mean
    the same thing, and rejecting them only produced a confusing abort
    (2026-10-14 run 38501857186).
    """
    return "" if value.strip().lower() in NULL_DATE_SPELLINGS else value


def _valid_tiktok_id(value: str) -> bool:
    digits = value.lstrip("0") or "0"
    if len(digits) != len(_MAX_TIKTOK_SNOWFLAKE):
        return len(digits) < len(_MAX_TIKTOK_SNOWFLAKE)
    return digits <= _MAX_TIKTOK_SNOWFLAKE


def post_identity(url: str) -> str:
    """Same post → same key. Mirrors web/lib/url-utils.ts ``postIdentityKey``.

    Instagram /p/·/reel/·/reels/·/tv/ and tracking query strings all point at
    one post, so comparing raw strings aborted a correct deletion
    (``/reels/DdTfR1VTzxE/`` vs DB ``/p/DdTfR1VTzxE/``, 2026-10-14). URLs
    without a post ID fall back to a near-exact form so a different row never
    matches.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw if raw.startswith("http") else "https://" + raw)
    host = (parts.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    path = parts.path

    if "instagram.com" in host or "instagr.am" in host:
        m = re.search(r"/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)", path)
        if m:
            return f"ig:{m.group(1)}"
    if "tiktok.com" in host:
        m = re.search(r"/(?:video|photo)/(\d+)", path)
        if m and _valid_tiktok_id(m.group(1)):
            return f"tt:{m.group(1)}"
    if host == "youtu.be" or host.endswith("youtube.com"):
        m = re.search(r"/shorts/([A-Za-z0-9_-]{6,})", path)
        if m:
            return f"yt:{m.group(1)}"
        m = re.search(r"/(?:embed|live|v)/([A-Za-z0-9_-]{6,})", path)
        vid = None
        if host == "youtu.be":
            vid = next((seg for seg in path.split("/") if seg), None)
        elif m:
            vid = m.group(1)
        elif path.rstrip("/") == "/watch":
            vid = (parse_qs(parts.query).get("v") or [None])[0]
        if vid and re.fullmatch(r"[A-Za-z0-9_-]{6,}", vid):
            return f"yt:{vid}"

    rest = path.rstrip("/") + (("?" + parts.query) if parts.query else "")
    return f"url:{host}{rest}"


def fetch_rows(post_id: str) -> list[dict[str, Any]]:
    db = get_client()
    return (
        db.table("sponsored_posts")
        .select(POST_SELECT)
        .eq("id", post_id)
        .limit(2)
        .execute()
        .data
        or []
    )


def fetch_stats_count(post_id: str) -> int:
    db = get_client()
    response = (
        db.table("post_daily_stats")
        .select("id", count="exact")
        .eq("post_id", post_id)
        .limit(1)
        .execute()
    )
    return int(response.count or 0)


def preflight_errors(
    rows: list[dict[str, Any]], stats_count: int, expected: ExpectedPost
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if len(rows) != 1:
        return [{"field": "row_count", "expected": 1, "actual": len(rows)}]

    row = rows[0]
    checks = {
        "id": expected.post_id,
        "url": expected.url,
        "account_name": expected.account_name,
        "posted_at": expected.posted_at,
        "ended_at": expected.ended_at,
        "cost": expected.cost,
    }
    for field, wanted in checks.items():
        actual = row.get(field)
        if field == "cost":
            actual = int(actual or 0)
        elif field in {"posted_at", "ended_at"}:
            actual = str(actual or "")[:10]
        if field == "url":
            same = post_identity(str(actual or "")) == post_identity(str(wanted or ""))
        else:
            same = actual == wanted
        if not same:
            errors.append({"field": field, "expected": wanted, "actual": actual})
    if stats_count != expected.stats_count:
        errors.append({
            "field": "post_daily_stats_count",
            "expected": expected.stats_count,
            "actual": stats_count,
        })
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--post-id", required=True)
    parser.add_argument("--expected-url", required=True)
    parser.add_argument("--expected-account-name", required=True)
    parser.add_argument("--expected-posted-at", required=True)
    parser.add_argument("--expected-ended-at", required=True)
    parser.add_argument("--expected-cost", required=True, type=int)
    parser.add_argument("--expected-stats-count", required=True, type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    expected = ExpectedPost(
        post_id=args.post_id,
        url=args.expected_url,
        account_name=args.expected_account_name,
        posted_at=args.expected_posted_at,
        ended_at=parse_expected_nullable_date(args.expected_ended_at),
        cost=args.expected_cost,
        stats_count=args.expected_stats_count,
    )
    before_rows = fetch_rows(args.post_id)
    stats_before = fetch_stats_count(args.post_id)
    errors = preflight_errors(before_rows, stats_before, expected)
    if errors:
        raise SystemExit("[DELETE_SPECIFIC_POST_ABORT] " + json.dumps({
            "ok": False,
            "errors": errors,
            "rows": before_rows,
            "stats_count": stats_before,
        }, ensure_ascii=False, default=str))

    deleted_rows = 0
    if args.apply:
        db = get_client()
        result = (
            db.table("sponsored_posts")
            .delete()
            .eq("id", expected.post_id)
            # 입력 URL이 아니라 사전검증을 통과한 DB 원문 URL — 표기만 다른 입력(/reels/ 등)으로
            # 0건 삭제되는 일 없이 id·url 이중 조건은 그대로 유지한다.
            .eq("url", before_rows[0]["url"])
            .execute()
            .data
            or []
        )
        deleted_rows = len(result)
        if deleted_rows != 1:
            raise SystemExit("[DELETE_SPECIFIC_POST_ABORT] " + json.dumps({
                "ok": False,
                "error": "unexpected delete count",
                "deleted_rows": deleted_rows,
                "before": before_rows[0],
            }, ensure_ascii=False, default=str))

    after_rows = fetch_rows(args.post_id)
    stats_after = fetch_stats_count(args.post_id)
    if args.apply and (after_rows or stats_after != 0):
        raise SystemExit("[DELETE_SPECIFIC_POST_ABORT] " + json.dumps({
            "ok": False,
            "error": "post or statistic rows remain after delete",
            "after_rows": after_rows,
            "stats_count": stats_after,
        }, ensure_ascii=False, default=str))

    print("[DELETE_SPECIFIC_POST_RESULT] " + json.dumps({
        "ok": True,
        "apply": bool(args.apply),
        "post_id": expected.post_id,
        "before": before_rows[0],
        "stats_count_before": stats_before,
        "deleted_rows": deleted_rows,
        "after_rows": after_rows,
        "stats_count_after": stats_after,
    }, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
