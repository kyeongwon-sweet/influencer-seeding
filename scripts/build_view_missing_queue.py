#!/usr/bin/env python3
"""Build a read-only retry/verification queue for missing view metrics."""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Any

from db import get_client


PAGE = 1000
INTERNAL_VIEW_RETRY_FROM = "2026-08-07"


def fetch_pages(table: str, select: str, query=None) -> list[dict[str, Any]]:
    db = get_client()
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        q = db.table(table).select(select)
        if query:
            q = query(q)
        page = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def chunks(values: list[str], size: int = 100):
    for index in range(0, len(values), size):
        yield values[index:index + size]


def platform(url: str | None) -> str:
    value = (url or "").lower()
    if "instagram.com" in value:
        return "instagram"
    if "youtube.com" in value or "youtu.be" in value:
        return "youtube"
    if "tiktok.com" in value:
        return "tiktok"
    if "x.com" in value or "twitter.com" in value:
        return "x"
    return "other"


def is_view_capable(post: dict[str, Any]) -> bool:
    value = (post.get("url") or "").lower()
    if any(host in value for host in ("threads.", "facebook.com", "naver.com", "kakao.com")):
        return False
    return platform(value) in {"instagram", "youtube", "tiktok", "x"}


def is_tiktok_view_post(url: str | None) -> bool:
    value = (url or "").lower()
    return bool(
        "tiktok.com" in value
        and re.search(r"/(?:video|photo)/\d+", value)
    )


def exclusion_reason(post: dict[str, Any], target_date: str | None = None) -> str | None:
    channel_type = str(post.get("channel_type") or "")
    url = (post.get("url") or "").lower()
    notes = str(post.get("notes") or "")
    if "수동추적 제외" in notes:
        return "manual_note"
    # 수집기(run_monitoring)가 액터 에러(POST_SENSITIVE·not_found/private=지역제한 등)로 '수집 불가'를
    # 자동 감지해 notes에 마킹한 건은 재시도해도 같은 에러가 나므로 재시도 큐에서 제외한다(워치독 오탐 방지).
    # 게시물이 다시 수집되면 run_monitoring이 그 자동 노트를 지워(self-heal) 자동으로 재시도 대상으로 돌아온다.
    if "수집 불가" in notes:
        return "collector_uncollectable"
    if post.get("review_requested_at"):
        return "not_found_review_pending"
    # 위성/온드도 조회수형 플랫폼이면 재시도해야 한다. 틱톡만 예외로 두면
    # 메인 수집이 빈 응답을 낸 날 유튜브·인스타그램 누락이 영구 결측으로 남는다.
    if "위성채널" in channel_type or "온드미디어" in channel_type:
        if not is_view_capable(post):
            return "internal_channel"
        # 8/6 누락은 다음날 누적값으로 소급 복원할 수 없다. 기존에 허용했던
        # 틱톡은 유지하고, 유튜브·인스타·X 확대는 정확히 측정 가능한 8/7부터 적용한다.
        if target_date and target_date < INTERNAL_VIEW_RETRY_FROM and not is_tiktok_view_post(url):
            return "internal_channel"
    # 무상시딩 (영상)은 조회수가 있어 자동 재수집 대상이다 — (피드/이미지)만 수기 관리로 제외.
    # (2026-08-07: '무상시딩' 통째 제외라 IG 영상 미수집이 재시도 큐에서 빠져 자동 복구가 안 되던 버그 수정)
    if "무상시딩" in channel_type and "영상" not in channel_type:
        return "free_seed_manual"
    if "배너" in channel_type and "tiktok.com" not in url:
        return "non_tiktok_banner_reach_only"
    return None


def metric(row: dict[str, Any] | None) -> int | None:
    if not row:
        return None
    for field in ("play_count", "reach_count"):
        value = row.get(field)
        if value is None:
            continue
        try:
            return int(value)
        except Exception:
            return None
    return None


def tail(url: str | None) -> str:
    return (url or "").rstrip("/").split("/")[-1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--out-dir", default=os.getenv("RUNNER_TEMP") or "data/monitoring")
    parser.add_argument("--include-all", action="store_true", help="Include non-retryable diagnostics in queue.")
    args = parser.parse_args()
    target = args.date

    posts = fetch_pages(
        "sponsored_posts",
        "id,url,account_name,created_at,posted_at,ended_at,channel_type,notes,not_found_streak,not_found_last_at,review_requested_at",
    )
    raw_eligible = [
        post for post in posts
        if not post.get("ended_at")
        and (not post.get("posted_at") or str(post.get("posted_at"))[:10] <= target)
        and is_view_capable(post)
    ]
    eligible = [post for post in raw_eligible if not exclusion_reason(post, target)]
    eligible_ids = [post["id"] for post in eligible if post.get("id")]

    same_day_rows: dict[str, list[dict[str, Any]]] = {}
    history: dict[str, dict[str, Any]] = {}
    db = get_client()
    for ids in chunks(eligible_ids, 100):
        same = (
            db.table("post_daily_stats")
            .select("post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual,created_at")
            .eq("measured_at", target)
            .in_("post_id", ids)
            .execute()
            .data
            or []
        )
        for row in same:
            same_day_rows.setdefault(row["post_id"], []).append(row)

        hist_rows = (
            db.table("post_daily_stats")
            .select("post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual")
            .in_("post_id", ids)
            .execute()
            .data
            or []
        )
        for row in hist_rows:
            state = history.setdefault(
                row["post_id"],
                {"has_metric": False, "has_likes_or_comments": False, "last_metric": None, "last_metric_date": None},
            )
            value = metric(row)
            if value is not None and value > 0:
                state["has_metric"] = True
                if not state["last_metric_date"] or str(row["measured_at"])[:10] >= state["last_metric_date"]:
                    state["last_metric"] = value
                    state["last_metric_date"] = str(row["measured_at"])[:10]
            if row.get("likes_count") is not None or row.get("comments_count") is not None:
                state["has_likes_or_comments"] = True

    queue: list[dict[str, Any]] = []
    excluded = {
        "measured": 0,
        "likely_image_no_view": 0,
        "not_retryable": 0,
        "manual_note": 0,
        "collector_uncollectable": 0,
        "not_found_review_pending": 0,
        "internal_channel": 0,
        "free_seed_manual": 0,
        "non_tiktok_banner_reach_only": 0,
    }
    for post in raw_eligible:
        reason = exclusion_reason(post, target)
        if not reason:
            continue
        excluded[reason] += 1
        if args.include_all:
            queue.append({
                "post_id": post.get("id"),
                "account_name": post.get("account_name"),
                "url": post.get("url"),
                "tail": tail(post.get("url")),
                "platform": platform(post.get("url")),
                "channel_type": post.get("channel_type"),
                "posted_at": str(post.get("posted_at") or "")[:10] or None,
                "created_at": str(post.get("created_at") or "")[:10] or None,
                "reason": reason,
                "retryable": False,
                "same_day_rows": 0,
                "last_metric": None,
                "last_metric_date": None,
            })
    for post in eligible:
        rows = same_day_rows.get(post["id"], [])
        best_today = max((metric(row) or 0 for row in rows), default=0)
        if best_today > 0:
            excluded["measured"] += 1
            continue

        state = history.get(post["id"], {})
        if not rows:
            reason = "missing_same_day_row"
        elif any(row.get("play_count") is None and row.get("reach_count") is None for row in rows):
            reason = "same_day_row_without_view_metric"
        else:
            reason = "same_day_non_positive_metric"

        if state.get("has_likes_or_comments") and not state.get("has_metric"):
            reason = "likely_image_no_view"

        pf = platform(post.get("url"))
        retryable = pf in {"instagram", "youtube", "tiktok"} and reason != "likely_image_no_view"
        if not retryable and not args.include_all:
            excluded["likely_image_no_view" if reason == "likely_image_no_view" else "not_retryable"] += 1
            continue

        queue.append({
            "post_id": post.get("id"),
            "account_name": post.get("account_name"),
            "url": post.get("url"),
            "tail": tail(post.get("url")),
            "platform": pf,
            "channel_type": post.get("channel_type"),
            "posted_at": str(post.get("posted_at") or "")[:10] or None,
            "created_at": str(post.get("created_at") or "")[:10] or None,
            "reason": reason,
            "retryable": retryable,
            "same_day_rows": len(rows),
            "last_metric": state.get("last_metric"),
            "last_metric_date": state.get("last_metric_date"),
        })

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"view_missing_queue_{target}.json"
    summary = {
        "ok": True,
        "date": target,
        "eligible": len(eligible),
        "queue_count": len(queue),
        "retryable_count": sum(1 for item in queue if item["retryable"]),
        "excluded": excluded,
        "by_reason": {},
        "by_platform": {},
        "sample": queue[:20],
        "queue": queue,
    }
    for item in queue:
        summary["by_reason"][item["reason"]] = summary["by_reason"].get(item["reason"], 0) + 1
        summary["by_platform"][item["platform"]] = summary["by_platform"].get(item["platform"], 0) + 1
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("[VIEW_MISSING_QUEUE] " + json.dumps({k: v for k, v in summary.items() if k != "queue"}, ensure_ascii=False, default=str))
    print(f"[VIEW_MISSING_QUEUE_FILE] {out_path}")


if __name__ == "__main__":
    main()
