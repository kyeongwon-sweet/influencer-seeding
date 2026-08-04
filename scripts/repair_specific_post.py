#!/usr/bin/env python3
"""Strictly guarded one-row sponsored_posts repair helper."""

from __future__ import annotations

import argparse
import json
from typing import Any

from db import get_client


def parse_nullable(value: str) -> str | None:
    text = str(value or "").strip()
    if text.upper() in {"", "NULL", "NONE"}:
        return None
    return text


def fetch_post(post_id: str) -> dict[str, Any]:
    db = get_client()
    row = (
        db.table("sponsored_posts")
        .select("id,url,account_name,channel_type,posted_at,created_at,ended_at,manual_fields")
        .eq("id", post_id)
        .single()
        .execute()
        .data
    )
    if not row:
        raise SystemExit(f"post row not found: {post_id}")
    return row


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--post-id", required=True)
    parser.add_argument("--expected-ended-at", required=True)
    parser.add_argument("--new-ended-at", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    expected_ended_at = parse_nullable(args.expected_ended_at)
    new_ended_at = parse_nullable(args.new_ended_at)
    before = fetch_post(args.post_id)
    actual_ended_at = parse_nullable(str(before.get("ended_at") or ""))
    if actual_ended_at != expected_ended_at:
        raise SystemExit("[REPAIR_SPECIFIC_POST_ABORT] " + json.dumps({
            "ok": False,
            "error": "ended_at mismatch",
            "expected_ended_at": expected_ended_at,
            "actual_ended_at": actual_ended_at,
            "row": before,
        }, ensure_ascii=False, default=str))

    updated_rows = 0
    if args.apply:
        db = get_client()
        result = (
            db.table("sponsored_posts")
            .update({"ended_at": new_ended_at})
            .eq("id", args.post_id)
            .execute()
            .data
            or []
        )
        updated_rows = len(result)
        if updated_rows != 1:
            raise SystemExit("[REPAIR_SPECIFIC_POST_ABORT] " + json.dumps({
                "ok": False,
                "error": "unexpected update count",
                "updated_rows": updated_rows,
                "before": before,
            }, ensure_ascii=False, default=str))

    after = fetch_post(args.post_id)
    print("[REPAIR_SPECIFIC_POST_RESULT] " + json.dumps({
        "ok": True,
        "apply": bool(args.apply),
        "post_id": args.post_id,
        "expected_ended_at": expected_ended_at,
        "new_ended_at": new_ended_at,
        "before": before,
        "after": after,
        "updated_rows": updated_rows,
    }, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
