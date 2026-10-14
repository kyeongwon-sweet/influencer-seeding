#!/usr/bin/env python3
"""Strictly guarded deletion of one sponsored_posts row.

This helper is intentionally narrow. It refuses to delete unless the live row
and its statistic-row count exactly match every caller-supplied expectation.
"""

from __future__ import annotations

import argparse
import json
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


def parse_expected_nullable_date(value: str) -> str:
    """Represent a required workflow input whose expected DB date is NULL.

    GitHub workflow_dispatch rejects an empty value for required inputs, so
    callers pass ``__NULL__`` and the strict comparison keeps using ``""``
    for a missing database date.
    """
    return "" if value == NULL_DATE_SENTINEL else value


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
        if actual != wanted:
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
            .eq("url", expected.url)
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
