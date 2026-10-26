#!/usr/bin/env python3
"""Build a read-only retry/verification queue for missing view metrics."""

from __future__ import annotations

from kst_dates import kst_date, kst_now, kst_today
from channel_kind import is_banner_channel, is_reach_only_manual_channel
from platform_kind import is_view_capable, platform

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
VIEW_MISSING_RPC = "monitoring_view_missing_candidates_v1"
VIEW_MISSING_QUERY_MODES = frozenset({"legacy", "shadow", "optimized"})

POST_FIELDS = (
    "id", "url", "account_name", "created_at", "posted_at", "ended_at",
    "channel_type", "notes", "not_found_streak", "not_found_last_at",
    "review_requested_at",
)
SAME_DAY_FIELDS = (
    "same_day_rows", "same_day_has_positive_metric",
    "same_day_has_null_metric", "same_day_has_play_zero",
)
HISTORY_FIELDS = (
    "has_metric", "has_likes_or_comments", "has_manual_zero",
    "has_auto_play_ever", "has_auto_reach_ever", "has_reach_ever",
    "last_metric", "last_metric_date",
)


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


def view_missing_query_mode(value: str | None = None) -> str:
    """Select the rollout lane. Unknown values stay on the proven legacy path."""
    configured = str(value if value is not None else os.getenv("VIEW_MISSING_QUERY_MODE", "legacy"))
    configured = configured.strip().lower()
    return configured if configured in VIEW_MISSING_QUERY_MODES else "legacy"


# 매체 판정은 platform_kind 단일 정본을 쓴다(알림과 큐가 갈라지지 않게). 이름은 재수출해
# 기존 호출부·테스트가 그대로 동작한다.


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
    # 이 분기는 **재시도 가능 여부**만 정한다. TikTok 배너는 공개 playCount를
    # 자동 수집할 수 있으므로 큐에 남기되, 수집된 값은 다른 모든 배너와 같이
    # canonical reach_count에 저장한다(run_monitoring의 저장 정책과 별개).
    if is_banner_channel(channel_type, post.get("posted_at")) and "tiktok.com" not in url:
        return "non_tiktok_banner_reach_only"
    return None


def empty_same_day_state() -> dict[str, Any]:
    return {
        "same_day_rows": 0,
        "same_day_has_positive_metric": False,
        "same_day_has_null_metric": False,
        "same_day_has_play_zero": False,
    }


def build_same_day_state(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Reduce target-day rows without collapsing NULL into zero."""
    return {
        "same_day_rows": len(rows),
        "same_day_has_positive_metric": any((metric(row) or 0) > 0 for row in rows),
        "same_day_has_null_metric": any(
            row.get("play_count") is None and row.get("reach_count") is None for row in rows
        ),
        "same_day_has_play_zero": any(row.get("play_count") == 0 for row in rows),
    }


def build_history_state(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """게시물 한 건의 이력 요약(순수 함수 — 행동 테스트용).

    ⚠️ `has_manual_zero` 는 **manual=True 인 0만** 인정한다. 자동 0 은 수집 실패·접근 불가일 수
    있어서 이를 '확정된 0'으로 받으면 수집 실패를 조용히 감추게 된다(프로젝트 절대규칙).
    """
    state: dict[str, Any] = {
        "has_metric": False,
        "has_likes_or_comments": False,
        "has_manual_zero": False,
        "has_auto_play_ever": False,
        "has_auto_reach_ever": False,
        "has_reach_ever": False,
        "last_metric": None,
        "last_metric_date": None,
    }
    for row in rows:
        value = metric(row)
        # ⚠️ '조회수형 글인가'의 증거는 **자동수집된** play_count 뿐이다. 수기 행은 사람이 도달수를
        #    어느 칸에 적었는지의 문제라 증거력이 없다 — 실측('오늘의 메뉴' 2026-08-10):
        #    play_count=45,795 / reach_count=45,795 로 **같은 도달수가 두 칸에 복사된** 수기 행이 있어,
        #    이걸 조회수로 세면 사진 캐러셀이 영원히 '조회수형 글'로 남는다.
        if row.get("play_count") is not None and row.get("manual") is not True:
            state["has_auto_play_ever"] = True
        if row.get("reach_count") is not None and row.get("manual") is not True:
            state["has_auto_reach_ever"] = True
        if (row.get("reach_count") or 0) > 0:
            state["has_reach_ever"] = True
        if value is not None and value > 0:
            state["has_metric"] = True
            measured = str(row.get("measured_at"))[:10]
            if not state["last_metric_date"] or measured >= state["last_metric_date"]:
                state["last_metric"] = value
                state["last_metric_date"] = measured
        if row.get("manual") is True and value == 0:
            state["has_manual_zero"] = True
        if row.get("likes_count") is not None or row.get("comments_count") is not None:
            state["has_likes_or_comments"] = True
    return state


def is_reach_only_manual_channel_state(post: dict[str, Any], state: dict[str, Any]) -> bool:
    """`build_history_state()` 결과로 단일 정본 판정(channel_kind)을 호출하는 얇은 어댑터.

    판정 규칙 자체는 `channel_kind.is_reach_only_manual_channel()` 한 곳에만 둔다 —
    알림(daily_collect_report)과 재시도 큐가 서로 다른 규칙을 쓰면, 큐에서 빠진 글이
    알림에는 매일 뜨는 식으로 조용히 어긋난다(2026-09-14 실측).
    """
    return is_reach_only_manual_channel(
        post.get("channel_type"),
        has_reach_ever=bool(state.get("has_reach_ever")),
        has_auto_play_ever=bool(state.get("has_auto_play_ever")),
        has_auto_reach_ever=bool(state.get("has_auto_reach_ever")),
    )


# 재시도해도 값을 얻을 수 없다고 '확정'된 사유들 — 큐에서 빼고 excluded 에 따로 센다.
NON_RETRYABLE_REASONS = frozenset({
    "no_public_view_metric",
    "manual_zero_confirmed",
    "reach_only_manual_channel",
})


def decide_reason(
    post: dict[str, Any],
    rows: list[dict[str, Any]],
    state: dict[str, Any],
    target_date: str | None,
) -> str:
    """대상일 행 + 이력 상태로 '미수집 사유'를 정한다(순수 함수 — 행동 테스트용).

    `manual_zero_confirmed` (2026-09-07 신설):
      사람이 실물을 확인해 **조회수가 진짜 0**임을 입력한 글은 재시도해도 얻을 값이 없다.
      기존 규칙은 `best_today > 0` 만 '측정됨'으로 봤기 때문에 **실측 0이 영원히 미수집으로 남아**
      매일 재시도되고 `cron-daily-collect` 게이트를 상시 '미수집'으로 만들었다(실측: 이슈뜨기 8건).
      틱톡은 `is_unambiguous_view_post()` 때문에 `no_public_view_metric` 탈출구를 쓸 수 없어 더더욱 갇힌다.
      ⚠️ **자동 0은 인정하지 않는다** — 자동 0은 수집 실패·접근 불가일 수 있다(프로젝트 규칙).
         `manual=True` 인 0만 근거로 삼는다.
      ⚠️ YouTube는 예외다. 공식 Data API 폴백이 공개 viewCount=0도 확정하므로, 당일 0은
         측정 완료로 보되 과거 수기 0 때문에 다음 날짜까지 영구 제외하지 않는다.
      ⚠️ **양수 실측 이력이 한 번이라도 있으면 적용하지 않는다** → 나중에 값이 붙는 순간
         조건이 깨져 자동으로 큐에 복귀한다(self-heal). 값을 지어내거나 고치지 않는다.
    """
    return decide_reason_from_state(post, build_same_day_state(rows), state, target_date)


def decide_reason_from_state(
    post: dict[str, Any],
    same_day: dict[str, Any],
    state: dict[str, Any],
    target_date: str | None,
) -> str:
    """The existing reason policy applied to losslessly aggregated DB facts."""
    if int(same_day.get("same_day_rows") or 0) == 0:
        reason = "missing_same_day_row"
    elif same_day.get("same_day_has_null_metric") is True:
        reason = "same_day_row_without_view_metric"
    else:
        reason = "same_day_non_positive_metric"

    if (state.get("has_likes_or_comments") and not state.get("has_metric")
            and has_no_public_view_metric(post, target_date)):
        reason = "no_public_view_metric"

    if (state.get("has_manual_zero") and not state.get("has_metric")
            and platform(post.get("url")) != "youtube"):
        reason = "manual_zero_confirmed"

    if is_reach_only_manual_channel_state(post, state):
        reason = "reach_only_manual_channel"

    return reason


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


def has_same_day_measurement(post: dict[str, Any], rows: list[dict[str, Any]]) -> bool:
    """대상일의 유효 누적값이 있는가(YouTube 공식 0 포함).

    일반 플랫폼의 자동 0은 수집 실패일 수 있어 종전처럼 미수집으로 둔다. YouTube는
    ``run_monitoring`` 이 외부 스크래퍼 0을 버리고 공식 Data API 확인분만 자동 0으로
    저장하므로, 같은 날짜의 play_count=0도 유효 측정이다. 수기 0도 그 날짜에 한해서만
    유효하고, 다음 날짜에는 다시 공식 API를 조회한다.
    """
    return has_same_day_measurement_from_state(post, build_same_day_state(rows))


def has_same_day_measurement_from_state(post: dict[str, Any], same_day: dict[str, Any]) -> bool:
    """Aggregated equivalent of :func:`has_same_day_measurement`."""
    if same_day.get("same_day_has_positive_metric") is True:
        return True
    if platform(post.get("url")) != "youtube":
        return False
    return same_day.get("same_day_has_play_zero") is True


def tail(url: str | None) -> str:
    return (url or "").rstrip("/").split("/")[-1]


def _raw_eligible(posts: list[dict[str, Any]], target: str) -> list[dict[str, Any]]:
    """Keep the existing Python policy as the only platform eligibility source."""
    return [
        post for post in posts
        if not post.get("ended_at")
        and (not post.get("posted_at") or str(post.get("posted_at"))[:10] <= target)
        and is_view_capable(post)
    ]


def _legacy_source(target: str) -> dict[str, Any]:
    """Original fully paginated implementation, retained as the fail-open path."""
    posts = fetch_pages(
        "sponsored_posts",
        "id,url,account_name,created_at,posted_at,ended_at,channel_type,notes,not_found_streak,not_found_last_at,review_requested_at",
    )
    raw_eligible = _raw_eligible(posts, target)
    eligible = [post for post in raw_eligible if not exclusion_reason(post, target)]
    eligible_ids = [post["id"] for post in eligible if post.get("id")]

    same_day_rows: dict[str, list[dict[str, Any]]] = {}
    hist_by_post: dict[str, list[dict[str, Any]]] = {}
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

        # ⚠️ 2026-09-07 실측: 게시물 100개 묶음의 이력이 1,677행이라 단발 `.execute()` 는
        #    PostgREST 1000 상한에 걸려 **조용히 절단**됐다. 그러면 has_metric 이 거짓으로 False 가 되어
        #    ① no_public_view_metric 이 조회수 있는 글을 영구 제외할 수 있고(2026-08-18 사고와 같은 형태)
        #    ② 아래 manual_zero_confirmed 의 self-heal 조건도 깨진다. fetch_pages 로 끝까지 읽는다.
        hist_rows = fetch_pages(
            "post_daily_stats",
            "post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual",
            lambda q, _ids=ids: q.in_("post_id", _ids),
        )
        for row in hist_rows:
            hist_by_post.setdefault(row["post_id"], []).append(row)

    return {
        "raw_eligible": raw_eligible,
        "same_day": {
            pid: build_same_day_state(same_day_rows.get(pid, [])) for pid in eligible_ids
        },
        "history": {
            pid: build_history_state(hist_by_post.get(pid, [])) for pid in eligible_ids
        },
        "source_stat_rows": sum(len(rows) for rows in hist_by_post.values()),
    }


def _as_nonnegative_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"RPC {field} must be a non-negative integer")
    return value


def decode_candidate_bundle(data: Any) -> tuple[list[dict[str, Any]], int]:
    """Validate the single-row RPC bundle before it can influence a retry queue."""
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError("RPC must return exactly one bundle row")
    bundle = data[0]
    candidates = bundle.get("candidates")
    if isinstance(candidates, str):
        try:
            candidates = json.loads(candidates)
        except json.JSONDecodeError as exc:
            raise ValueError("RPC candidates is not valid JSON") from exc
    if not isinstance(candidates, list):
        raise ValueError("RPC candidates must be a JSON array")

    candidate_count = _as_nonnegative_int(bundle.get("candidate_count"), "candidate_count")
    source_stat_rows = _as_nonnegative_int(bundle.get("source_stat_rows"), "source_stat_rows")
    if candidate_count != len(candidates):
        raise ValueError(
            f"RPC candidate coverage mismatch: declared={candidate_count} returned={len(candidates)}"
        )

    seen: set[str] = set()
    target_day_rows = 0
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise ValueError(f"RPC candidate[{index}] is not an object")
        missing = [field for field in (*POST_FIELDS, *SAME_DAY_FIELDS, *HISTORY_FIELDS) if field not in candidate]
        if missing:
            raise ValueError(f"RPC candidate[{index}] missing fields: {','.join(missing)}")
        post_id = candidate.get("id")
        if not isinstance(post_id, str) or not post_id:
            raise ValueError(f"RPC candidate[{index}] has invalid id")
        if post_id in seen:
            raise ValueError(f"RPC duplicate candidate id: {post_id}")
        seen.add(post_id)

        same_day_count = _as_nonnegative_int(candidate.get("same_day_rows"), "same_day_rows")
        target_day_rows += same_day_count
        for field in (*SAME_DAY_FIELDS[1:], *HISTORY_FIELDS[:6]):
            if not isinstance(candidate.get(field), bool):
                raise ValueError(f"RPC candidate[{index}].{field} must be boolean")
        last_metric = candidate.get("last_metric")
        if last_metric is not None and (isinstance(last_metric, bool) or not isinstance(last_metric, int)):
            raise ValueError(f"RPC candidate[{index}].last_metric must be integer or null")
        last_date = candidate.get("last_metric_date")
        if last_date is not None:
            try:
                date.fromisoformat(str(last_date))
            except ValueError as exc:
                raise ValueError(f"RPC candidate[{index}].last_metric_date is invalid") from exc
        if (last_metric is None) != (last_date is None):
            raise ValueError(f"RPC candidate[{index}] last metric/date pair is incomplete")

    if source_stat_rows < target_day_rows:
        raise ValueError(
            f"RPC stat coverage mismatch: source={source_stat_rows} target_day={target_day_rows}"
        )
    return candidates, source_stat_rows


def _rpc_source(target: str, created_before: str) -> dict[str, Any]:
    response = get_client().rpc(VIEW_MISSING_RPC, {
        "p_target": target,
        "p_created_before": created_before,
    }).execute()
    candidates, source_stat_rows = decode_candidate_bundle(response.data)
    raw_eligible = _raw_eligible(candidates, target)
    eligible = [post for post in raw_eligible if not exclusion_reason(post, target)]
    eligible_ids = {str(post["id"]) for post in eligible}
    return {
        "raw_eligible": raw_eligible,
        "same_day": {
            str(post["id"]): {field: post[field] for field in SAME_DAY_FIELDS}
            for post in candidates if str(post["id"]) in eligible_ids
        },
        "history": {
            str(post["id"]): {field: post[field] for field in HISTORY_FIELDS}
            for post in candidates if str(post["id"]) in eligible_ids
        },
        "source_stat_rows": source_stat_rows,
    }


def _source_fingerprint(source: dict[str, Any]) -> dict[str, Any]:
    posts = {
        str(post["id"]): {
            "id": str(post["id"]),
            "url": post.get("url"),
            "account_name": post.get("account_name"),
            "created_at": kst_date(post.get("created_at")) or None,
            "posted_at": str(post.get("posted_at") or "")[:10] or None,
            "channel_type": post.get("channel_type"),
            "notes": post.get("notes"),
            "not_found_streak": post.get("not_found_streak"),
            # Only presence affects the queue policy; PostgREST and jsonb can
            # serialize the same timestamptz with different textual offsets.
            "review_requested": bool(post.get("review_requested_at")),
        }
        for post in source["raw_eligible"]
    }
    return {
        post_id: {
            "post": posts[post_id],
            "same_day": source["same_day"].get(post_id, empty_same_day_state()),
            "history": source["history"].get(post_id, build_history_state([])),
        }
        for post_id in sorted(posts)
    }


def source_parity_issues(legacy: dict[str, Any], optimized: dict[str, Any]) -> list[str]:
    """Return bounded diagnostics; shadow mode always serves the legacy result."""
    left = _source_fingerprint(legacy)
    right = _source_fingerprint(optimized)
    issues: list[str] = []
    left_ids, right_ids = set(left), set(right)
    if left_ids != right_ids:
        issues.append(
            f"candidate_ids legacy={len(left_ids)} optimized={len(right_ids)} "
            f"legacy_only={len(left_ids - right_ids)} optimized_only={len(right_ids - left_ids)}"
        )
    for post_id in sorted(left_ids & right_ids):
        if left[post_id] != right[post_id]:
            issues.append(f"state:{post_id}")
            if len(issues) >= 21:
                break
    return issues


def load_queue_source(target: str, mode: str | None = None, created_before: str | None = None) -> dict[str, Any]:
    rollout = view_missing_query_mode(mode)
    snapshot = created_before or kst_now().isoformat()
    if rollout == "legacy":
        source = _legacy_source(target)
        print(f"[view-missing-state] mode=legacy stats={source['source_stat_rows']}")
        return source

    if rollout == "shadow":
        legacy = _legacy_source(target)
        try:
            optimized = _rpc_source(target, snapshot)
            issues = source_parity_issues(legacy, optimized)
            if issues:
                print(
                    "[view-missing-state] [WARN] shadow mismatch; legacy retained — "
                    + " | ".join(issues[:20])
                )
            else:
                print(
                    "[view-missing-state] shadow parity ok; legacy retained — "
                    f"candidates={len(legacy['raw_eligible'])} stats={optimized['source_stat_rows']}"
                )
        except Exception as exc:
            print(f"[view-missing-state] [WARN] shadow RPC failed; legacy retained — {exc}")
        return legacy

    try:
        optimized = _rpc_source(target, snapshot)
        print(
            "[view-missing-state] mode=optimized "
            f"candidates={len(optimized['raw_eligible'])} stats={optimized['source_stat_rows']}"
        )
        return optimized
    except Exception as exc:
        print(f"[view-missing-state] [WARN] optimized RPC failed; falling back to legacy — {exc}")
        return _legacy_source(target)


def build_queue_summary(
    target: str,
    include_all: bool,
    source: dict[str, Any],
) -> dict[str, Any]:
    raw_eligible = source["raw_eligible"]
    same_day = source["same_day"]
    history = source["history"]
    eligible = [post for post in raw_eligible if not exclusion_reason(post, target)]

    queue: list[dict[str, Any]] = []
    excluded = {
        "measured": 0,
        "no_public_view_metric": 0,
        "manual_zero_confirmed": 0,
        "reach_only_manual_channel": 0,
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
        if include_all:
            queue.append({
                "post_id": post.get("id"),
                "account_name": post.get("account_name"),
                "url": post.get("url"),
                "tail": tail(post.get("url")),
                "platform": platform(post.get("url")),
                "channel_type": post.get("channel_type"),
                "posted_at": str(post.get("posted_at") or "")[:10] or None,
                "created_at": kst_date(post.get("created_at")) or None,
                "reason": reason,
                "retryable": False,
                "same_day_rows": 0,
                "last_metric": None,
                "last_metric_date": None,
            })
    for post in eligible:
        day_state = same_day.get(post["id"], empty_same_day_state())
        if has_same_day_measurement_from_state(post, day_state):
            excluded["measured"] += 1
            continue

        state = history.get(post["id"], {})
        reason = decide_reason_from_state(post, day_state, state, target)

        pf = platform(post.get("url"))
        retryable = pf in {"instagram", "youtube", "tiktok"} and reason not in NON_RETRYABLE_REASONS
        if not retryable and not include_all:
            excluded[reason if reason in NON_RETRYABLE_REASONS else "not_retryable"] += 1
            continue

        queue.append({
            "post_id": post.get("id"),
            "account_name": post.get("account_name"),
            "url": post.get("url"),
            "tail": tail(post.get("url")),
            "platform": pf,
            "channel_type": post.get("channel_type"),
            "posted_at": str(post.get("posted_at") or "")[:10] or None,
            "created_at": kst_date(post.get("created_at")) or None,
            "reason": reason,
            "retryable": retryable,
            "same_day_rows": int(day_state.get("same_day_rows") or 0),
            "last_metric": state.get("last_metric"),
            "last_metric_date": state.get("last_metric_date"),
        })

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
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=kst_today())
    parser.add_argument("--out-dir", default=os.getenv("RUNNER_TEMP") or "data/monitoring")
    parser.add_argument("--include-all", action="store_true", help="Include non-retryable diagnostics in queue.")
    args = parser.parse_args()
    target = args.date

    source = load_queue_source(target)
    summary = build_queue_summary(target, args.include_all, source)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"view_missing_queue_{target}.json"
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("[VIEW_MISSING_QUEUE] " + json.dumps({k: v for k, v in summary.items() if k != "queue"}, ensure_ascii=False, default=str))
    print(f"[VIEW_MISSING_QUEUE_FILE] {out_path}")


if __name__ == "__main__":
    main()
