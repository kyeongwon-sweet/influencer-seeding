#!/usr/bin/env python3
"""Build a read-only retry/verification queue for missing view metrics."""

from __future__ import annotations

from channel_kind import is_banner_channel

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
        page = q.order("id").range(offset, offset + PAGE - 1).execute().data or []
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


# 조회수를 못 얻는 이유는 '이미지 글'만이 아니다. 인스타는 **팔로워가 적은 개인 계정의 조회수를
# 아예 공개하지 않는다**(실측 2026-08-19: xeoj.ng 2,848명·cmonprefere__k 8,256명은 프로필
# 그리드에 조회수 숫자가 없고 `클립`/`슬라이드` 라벨만 뜬다. one_star_video 30.9만명은 조회수 표시).
# 그래서 판정은 '이미지냐'가 아니라 **'조회수를 공개적으로 얻을 수 있느냐'**로 본다.
NO_PUBLIC_VIEW_AFTER_DAYS = 7


def is_unambiguous_view_post(url: str | None) -> bool:
    """URL만으로 조회수 지표가 존재한다고 확정할 수 있는가.

    틱톡 /video/·/photo/, 유튜브, IG 릴스는 이미지 글일 수 없다. IG `/p/`는 사진·캐러셀·영상이
    모두 같은 형태라 여기서 판정하지 않는다.
    """
    value = (url or "").lower()
    if is_tiktok_view_post(value):
        return True
    if "youtube.com" in value or "youtu.be" in value:
        return True
    return bool(re.search(r"/(?:reel|reels|tv)/[A-Za-z0-9_-]+", value))


def has_no_public_view_metric(post: dict[str, Any], target_date: str | None) -> bool:
    """참여지표만 있고 조회수가 한 번도 없는 글을 '조회수 확보 불가'로 확정해도 되는가.

    🚨 2026-08-18 실측 사고: `apify/instagram-scraper`가 videoUrl은 주면서 videoPlayCount를
    빼먹어(응답 필드 키에 재생수 없음) 신규 릴스 11건이 '좋아요만 있고 조회수 없음'이 됐다.
    옛 규칙(`likely_image_no_view`)은 이를 곧바로 이미지 글로 단정해 **재시도 큐에서 영구 제외**
    했고(retryable=False), 알림도 없어 조용히 결측으로 굳었다. 당시 걸린 활성 24건이 전부 영상이었다.
    진짜 이미지 글은 free_seed_manual·non_tiktok_banner_reach_only에서 이미 앞단 제외된다.

    🔎 2026-08-19 후속 규명: 다음날 재시도로 6건은 조회수가 붙었고, 남은 5건은 **무상시딩 개인
    계정**(팔로워 2.8천~8.2천)이었다. 실물 확인 결과 게시물은 영상이 맞지만 **인스타가 그 계정의
    조회수를 공개하지 않는다**. 즉 액터 결함이 아니라 원천적으로 얻을 수 없는 값이다.
    그래서 사유 이름을 `likely_image_no_view` → `no_public_view_metric`으로 바꿨다.
    ⚠️ 2026-08-19 이전 GHA 로그를 조회할 때는 옛 키 이름으로 찾아야 한다.

    두 조건을 모두 만족할 때만 '확보 불가'로 본다:
      · URL로 영상임이 확정되지 않는다(IG `/p/`처럼 사진·영상이 같은 형태)
      · 게시 후 NO_PUBLIC_VIEW_AFTER_DAYS일 이상 지났는데 아직 조회수가 한 번도 없다
        (액터 글리치는 하루 이틀에 회복되지만, 비공개 계정·사진 글은 영원히 값이 없다)
    게시일을 모르면 경과일을 알 수 없으므로 확정하지 않는다(재시도 유지).
    """
    if is_unambiguous_view_post(post.get("url")):
        return False
    posted = str(post.get("posted_at") or "")[:10]
    if len(posted) != 10 or not target_date:
        return False
    try:
        gap = (date.fromisoformat(target_date) - date.fromisoformat(posted)).days
    except ValueError:
        return False
    return gap >= NO_PUBLIC_VIEW_AFTER_DAYS


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
    if is_banner_channel(channel_type, post.get("posted_at")) and "tiktok.com" not in url:
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
        "no_public_view_metric": 0,
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

        if (state.get("has_likes_or_comments") and not state.get("has_metric")
                and has_no_public_view_metric(post, target)):
            reason = "no_public_view_metric"

        pf = platform(post.get("url"))
        retryable = pf in {"instagram", "youtube", "tiktok"} and reason != "no_public_view_metric"
        if not retryable and not args.include_all:
            excluded["no_public_view_metric" if reason == "no_public_view_metric" else "not_retryable"] += 1
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
