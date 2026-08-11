#!/usr/bin/env python3
# 협찬 모니터링 Instagram 데이터 수집 및 통계 생성
import os
import re
import json
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from db import get_client
from url_utils import normalize_url, tt_video_id as _tt_id, tt_canonical_form
from account_name_policy import collected_account_name_update
from caption_text import normalize_caption
from monitoring_retry_guard import zero_result_alert
from auto_end_rules import classify_auto_end, row_metric
from not_found_policy import (
    NOT_FOUND_REVIEW_THRESHOLD,
    is_not_found_review_eligible,
    next_not_found_state,
)


OVERRECORDED_WARNINGS = []
OVERRECORDED_RATIO = 0.8
OVERRECORDED_MIN_DIFF = 1000


def _has_positive_views(stats: dict | None) -> bool:
    return ((stats or {}).get("views") or 0) > 0


def _positive_int(value):
    try:
        n = int(value)
    except Exception:
        return None
    return n if n > 0 else None


def _is_instagram_reel_url(url: str | None) -> bool:
    return bool(re.search(r"/(?:reel|reels|tv)/[A-Za-z0-9_-]+", url or "", re.I))


def _pick_instagram_play_count(item: dict, url: str | None):
    """Return a trusted IG play count and the source field used.

    IG Reels must use explicit video fields. Generic fields such as views/count
    have repeatedly represented engagement-like counts on fresh Reels, which is
    worse than leaving the post retryable.
    """
    for field in ("videoPlayCount", "videoViewCount"):
        n = _positive_int(item.get(field))
        if n is not None:
            return n, field

    if _is_instagram_reel_url(url):
        return None, None

    for field in ("impressions", "viewCount", "views", "count"):
        n = _positive_int(item.get(field))
        if n is not None:
            return n, field
    return None, None


def _looks_like_engagement_count_as_views(play_count, likes_count, comments_count, existing: dict | None = None) -> bool:
    if (existing or {}).get("play_count"):
        return False
    play = _positive_int(play_count)
    if play is None:
        return False
    likes = _positive_int(likes_count)
    if likes is not None and likes >= 100 and play <= max(likes * 3, likes + 50):
        return True
    comments = _positive_int(comments_count)
    if comments is not None and comments >= 20 and play <= comments * 20:
        return True
    return False


def _send_status_alert(text: str):
    """Best-effort Slack alert. Never fail monitoring because alert delivery failed."""
    try:
        token = os.getenv("SLACK_BOT_TOKEN")
        channel = os.getenv("STATUS_USER") or os.getenv("SLACK_CHANNEL")
        if token and channel:
            data = json.dumps({"channel": channel, "text": text}).encode("utf-8")
            req = urllib.request.Request(
                "https://slack.com/api/chat.postMessage",
                data=data,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                if not body.get("ok"):
                    print(f"[WARN] Slack bot alert failed: {body.get('error')}")
            return

        webhook = os.getenv("SLACK_WEBHOOK_URL")
        if webhook:
            data = json.dumps({"text": text}).encode("utf-8")
            req = urllib.request.Request(webhook, data=data, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"[WARN] over-record alert delivery failed: {e}")


def _record_overrecord_candidate(post: dict, label: str, observed: int | float | None, existing: dict):
    """Detect likely manual over-recording when fresh auto measurement is far below stored manual value."""
    prev = existing.get("play_count")
    if observed is None or prev is None or not existing.get("manual"):
        return
    try:
        observed_n = int(observed)
        prev_n = int(prev)
    except Exception:
        return
    if observed_n <= 0 or prev_n <= 0:
        return
    diff = prev_n - observed_n
    if diff < OVERRECORDED_MIN_DIFF or observed_n > prev_n * OVERRECORDED_RATIO:
        return
    warning = {
        "label": label,
        "url": post.get("url"),
        "account_name": post.get("account_name"),
        "observed": observed_n,
        "stored": prev_n,
        "stored_date": existing.get("measured_at"),
    }
    OVERRECORDED_WARNINGS.append(warning)
    print(
        "[WARN] manual over-record candidate "
        f"{label} {warning['account_name'] or ''} {warning['url']} "
        f"(observed={observed_n:,}, stored_manual={prev_n:,}, stored_date={warning['stored_date']})"
    )


def _flush_overrecord_warnings():
    if not OVERRECORDED_WARNINGS:
        return
    sample = OVERRECORDED_WARNINGS[:8]
    lines = [
        "🚨 [협찬 모니터링] 자동 실측이 기존 수동 누적값보다 크게 낮습니다.",
        "값은 자동으로 낮추지 않았고 기존 monotonic/clamp 규칙대로 유지했습니다. 실제값 확인 후 시트+DB를 함께 정정하세요.",
    ]
    for w in sample:
        lines.append(
            f"- {w.get('label')} {w.get('account_name') or '-'} "
            f"{w.get('observed'):,} < {w.get('stored'):,} "
            f"({w.get('stored_date')}) {w.get('url')}"
        )
    if len(OVERRECORDED_WARNINGS) > len(sample):
        lines.append(f"- ...외 {len(OVERRECORDED_WARNINGS) - len(sample)}건")
    _send_status_alert("\n".join(lines))


def retry_on_network_error(max_retries=3, delay=5):
    """네트워크 에러 시 자동 재시도 데코레이터"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    # 네트워크 에러만 재시도 (DNS·연결 실패·타임아웃 등). "connect" 단독 매칭은
                    # "cannot connect actor input" 같은 비네트워크 에러까지 잡아 오탐 → 구체 문구로 한정.
                    _net = ("name or service not known", "connection reset", "connection refused",
                            "connection aborted", "connection timed out", "timed out",
                            "temporarily unavailable", "max retries exceeded", "connection error")
                    if any(p in error_str for p in _net):
                        if attempt < max_retries - 1:
                            print(f"[WARN] 네트워크 에러 발생. {delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                            time.sleep(delay)
                            continue
                    # 네트워크 에러가 아니면 즉시 실패
                    raise
            # 모든 재시도 실패
            raise last_error
        return wrapper
    return decorator

APIFY_IG_ACTOR = os.getenv("APIFY_IG_ACTOR_ID", "apify/instagram-scraper")
# GHA는 MONITORING_DATE(KST)를 항상 주입. 폴백(로컬 실행)도 러너 로컬시각 대신 KST로 계산 — UTC 러너에서 하루 밀림 방지.
# 새벽 예약 수집은 직전일 최종 스냅샷이므로 기본 귀속일은 KST 어제다.
TODAY = os.getenv("MONITORING_DATE") or ((datetime.now(timezone.utc) + timedelta(hours=9)).date() - timedelta(days=1)).isoformat()
MISSING_VIEW_EVENTS = []


def _metric_value(row: dict | None):
    if not row:
        return None
    for field in ("play_count", "reach_count", "views"):
        value = row.get(field)
        if value is not None:
            try:
                return int(value)
            except Exception:
                return value
    return None


def _drop_pre_post_rows(rows, posts):
    """게시일 이전(measured_at < posted_at) 측정행을 저장 대상에서 제외한다.

    수집은 measured_at을 KST 어제(TODAY)로 기록하는데(:188), 게시 당일 새벽 수집분이 걸리면
    measured_at=게시일-1 인 'pre-post' 행이 생긴다. 대시보드 API는 measured_at>=posted_at만
    노출하므로(web/app/api/sponsored-posts/route.ts) 표시엔 안 보이나, raw post_daily_stats에
    잠복해 정합성 알림(notify_status)을 울린다. 값 자체는 실측이지만 날짜 라벨이 하루 이르며,
    다음 수집이 게시일 당일 행을 정상 생성하므로 이 행은 저장하지 않는다
    (web collect-now의 prePostedSkipped와 동일 정책, 2026-08-06 추가).
    ⚠️ posted_at은 절대 자동수정하지 않는다 — 게시일 오기는 posted_at_mismatch 알림으로 사람이 정정.

    Returns (kept_rows, dropped_rows).
    """
    posted_by = {p["id"]: str(p.get("posted_at") or "")[:10] for p in posts if p.get("posted_at")}
    kept, dropped = [], []
    for r in rows:
        pa = posted_by.get(r.get("post_id"))
        ma = str(r.get("measured_at") or "")[:10]
        if pa and ma and ma < pa:
            dropped.append(r)
        else:
            kept.append(r)
    return kept, dropped


def _record_missing_view_event(post: dict, platform: str, reason: str, *, stat=None, existing=None, extra=None):
    event = {
        "measured_at": TODAY,
        "post_id": post.get("id"),
        "account_name": post.get("account_name"),
        "url": post.get("url"),
        "channel_type": post.get("channel_type"),
        "posted_at": str(post.get("posted_at") or "")[:10] or None,
        "platform": platform,
        "reason": reason,
        "previous_metric": _metric_value(existing),
        "returned_metric": _metric_value(stat),
    }
    if stat:
        event["returned_posted_at"] = str(stat.get("posted_at") or "")[:10] or None
        event["deleted"] = bool(stat.get("deleted") or stat.get("error"))
    if extra:
        event.update(extra)
    MISSING_VIEW_EVENTS.append(event)
    print(
        "[VIEW_MISSING] "
        + json.dumps(
            {
                "account_name": event["account_name"],
                "platform": platform,
                "reason": reason,
                "url": event["url"],
                "previous_metric": event["previous_metric"],
                "returned_metric": event["returned_metric"],
                "returned_posted_at": event.get("returned_posted_at"),
            },
            ensure_ascii=False,
            default=str,
        )
    )


def _flush_missing_view_events():
    if not MISSING_VIEW_EVENTS:
        return
    out_dir = os.getenv("VIEW_MISSING_LOG_DIR") or os.getenv("RUNNER_TEMP") or os.getcwd()
    try:
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"view_missing_events_{TODAY}.jsonl")
        with open(path, "w", encoding="utf-8") as f:
            for event in MISSING_VIEW_EVENTS:
                f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        print(f"[VIEW_MISSING_SUMMARY] count={len(MISSING_VIEW_EVENTS)} path={path}")
    except Exception as e:
        print(f"[WARN] view missing event log write failed: {e}")


def _flush_posted_at_mismatch_alert():
    """게시일 불일치로 '정상 응답을 버린' 건을 사람에게 알린다.

    2026-08-03 실측: `jjin.mood_`·`ddo_chichi`·`nasso_home` 3건이 Apify가 조회수를 정상 반환했는데도
    (3,544 / 1,945 / 3,276) 시트 게시일과 실제 게시일이 달라 가드에 걸려 조용히 버려지고 있었다.
    URL 키(shortcode)는 정확히 일치하므로 이건 '다른 게시물 응답'이 아니라 **시트 게시일 오입력**이다.
    가드는 보수적으로 유지하되(값을 함부로 넣지 않음), 조용히 사라지지 않도록 알림만 낸다.
    ⚠️ posted_at은 절대 자동 수정하지 않는다 — 사람이 시트에서 정정해야 다음 수집부터 자동 복구된다.
    """
    events = [e for e in MISSING_VIEW_EVENTS if e.get("reason") == "posted_at_mismatch"]
    if not events:
        return
    sample = events[:8]
    lines = [
        f"🚨 [협찬 모니터링] 시트 게시일이 실제와 달라 조회수를 버린 게시물 {len(events)}건",
        "Apify는 값을 정상 반환했지만 게시일이 1일 초과로 어긋나 저장하지 않았습니다.",
        "**시트의 게시일을 실제 값으로 정정**하면 다음 수집부터 자동 복구됩니다(게시일은 자동 수정하지 않습니다).",
    ]
    for e in sample:
        lines.append(
            f"- {e.get('account_name') or '-'} 시트={e.get('expected_posted_at')} "
            f"실제={e.get('actual_posted_at')} (미저장 조회수 {e.get('returned_metric')}) {e.get('url')}"
        )
    if len(events) > len(sample):
        lines.append(f"- ...외 {len(events) - len(sample)}건")
    _send_status_alert("\n".join(lines))


def _record_not_found_observation(db, post: dict, detected: bool):
    """Track Instagram-only not_found streaks without changing notes or ended_at."""
    if not is_not_found_review_eligible(post.get("url") or ""):
        return
    updates, needs_alert = next_not_found_state(post, detected, TODAY)
    if not updates:
        return
    db.table("sponsored_posts").update(updates).eq("id", post["id"]).execute()
    post.update(updates)
    if needs_alert:
        _send_status_alert(
            "🚨 [협찬 모니터링] Instagram 게시물 접근 실패가 3일 연속 확인됐습니다.\n"
            "자동 제외·종료하지 않았습니다. 확인 후 제외 여부를 결정해 주세요.\n"
            f"- {post.get('account_name') or '-'}\n"
            f"- {post.get('url') or '-'}"
        )
        print(f"  [ALERT] IG not_found {NOT_FOUND_REVIEW_THRESHOLD}일 연속, 검토 요청: {post.get('url')}")


def _ig_shortcode(url: str) -> str | None:
    """Instagram URL에서 숏코드 추출 (/p/, /reel/, /reels/, /tv/ 모두 처리)"""
    m = re.search(r'/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _is_instagram_collectable_url(url: str) -> bool:
    u = (url or "").lower()
    return "instagram.com" in u and _ig_shortcode(url) is not None


def _prev_stats(db, post_ids):
    """게시물들의 '오늘 이전' 최신 통계를 {post_id: row} 로 반환 (mono가드 기준값).

    - post_id를 100개씩 청크로 나눠 .in_ 쿼리 URL 길이 한도 회피
    - measured_at desc + created_at desc(같은 날 다중행을 결정적으로 최신 선택) 정렬
    - .range() 페이지네이션으로 PostgREST 기본 1000행 상한을 넘겨도 각 post의 최신행 유실 방지
    """
    last: dict = {}
    ids = [i for i in post_ids if i]
    PAGE = 1000
    for c in range(0, len(ids), 100):
        chunk = ids[c:c + 100]
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, play_count, likes_count, comments_count, measured_at, manual")
                   .in_("post_id", chunk)
                   .lt("measured_at", TODAY)
                   .order("measured_at", desc=True)
                   .order("created_at", desc=True)
                   .order("id", desc=True)   # 고유키 tiebreaker — range() 경계 행 누락 방지(직전값 오판 방지)
                   .range(frm, frm + PAGE - 1)
                   .execute())
            page = res.data or []
            for r in page:
                last.setdefault(r["post_id"], r)
            if len(page) < PAGE:
                break
            frm += PAGE
    return last


def _row_key(row):
    return f"{row.get('post_id')}|{str(row.get('measured_at'))[:10]}"


def _filter_manual_preserved_rows(rows, manual_keys):
    """Keep auto collection from overwriting same-date manual stat rows."""
    kept = []
    skipped = []
    for row in rows:
        if _row_key(row) in manual_keys:
            skipped.append(row)
        else:
            kept.append(row)
    return kept, skipped


def _same_date_manual_stat_keys(db, rows):
    ids_by_date = {}
    for row in rows:
        pid = row.get("post_id")
        measured_at = str(row.get("measured_at") or "")[:10]
        if not pid or not measured_at:
            continue
        ids_by_date.setdefault(measured_at, set()).add(pid)

    keys = set()
    for measured_at, ids in ids_by_date.items():
        id_list = list(ids)
        for i in range(0, len(id_list), 200):
            res = (
                db.table("post_daily_stats")
                .select("post_id, measured_at, manual")
                .eq("measured_at", measured_at)
                .eq("manual", True)
                .in_("post_id", id_list[i:i + 200])
                .execute()
            )
            for row in res.data or []:
                keys.add(f"{row['post_id']}|{str(row['measured_at'])[:10]}")
    return keys


def _preserve_same_date_manual_stats(db, rows, label):
    if not rows:
        return rows
    manual_keys = _same_date_manual_stat_keys(db, rows)
    if not manual_keys:
        return rows
    kept, skipped = _filter_manual_preserved_rows(rows, manual_keys)
    if skipped:
        print(f"[WARN] manual=True same-date rows preserved in {label}: skipped auto upsert {len(skipped)}")
    return kept


def _tracks_play_count(url):
    u = (url or "").lower()
    return any(
        host in u
        for host in (
            "instagram.com",
            "youtube.com",
            "youtu.be",
            "tiktok.com",
            "twitter.com",
            "x.com",
        )
    )


def _needs_metadata_recollect(post):
    """이미 조회수 행이 있어도 IG 계정명이 비어 있으면 1회 재수집해 owner_username을 회복한다."""
    url = post.get("url") or ""
    return (
        not str(post.get("account_name") or "").strip()
        and "instagram.com" in url.lower()
        and _ig_shortcode(url)
    )


def _select_metadata_recollect_posts(posts):
    """Return only the narrow, explicitly approved IG metadata repair targets."""
    return [post for post in posts if _needs_metadata_recollect(post)]


def _target_ids_from_missing_queue(path):
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except FileNotFoundError:
        print(f"[WARN] VIEW_MISSING_QUEUE_FILE not found: {path}")
        return set()
    except Exception as e:
        print(f"[WARN] VIEW_MISSING_QUEUE_FILE read failed({path}): {e}")
        return set()

    target_ids = set()
    for item in payload.get("queue") or []:
        if item.get("retryable") and item.get("post_id"):
            target_ids.add(item["post_id"])
    return target_ids


def _same_day_measured_ids(db, posts, measured_at=TODAY):
    """Return post ids that already have the needed measurement for measured_at.

    View-capable posts must have play_count. Auxiliary-only rows with likes or
    comments are intentionally treated as missing so retries recollect the view
    row instead of skipping the post.
    """
    done = set()
    ids = [p.get("id") for p in posts if p.get("id")]
    play_required = {p.get("id") for p in posts if p.get("id") and _tracks_play_count(p.get("url"))}
    for c in range(0, len(ids), 100):
        chunk = ids[c:c + 100]
        frm = 0
        while True:
            res = (
                db.table("post_daily_stats")
                .select("post_id, play_count, likes_count, comments_count, reach_count")
                .eq("measured_at", measured_at)
                .in_("post_id", chunk)
                .range(frm, frm + 999)
                .execute()
            )
            rows = res.data or []
            for row in rows:
                post_id = row["post_id"]
                if post_id in play_required:
                    if row.get("play_count") is not None:
                        done.add(post_id)
                elif any(row.get(k) is not None for k in ("play_count", "likes_count", "comments_count", "reach_count")):
                    done.add(post_id)
            if len(rows) < 1000:
                break
            frm += 1000
    return done


def _should_apply_same_day_cost_guard(*, recollect_all=False, final_snapshot=False):
    """Return whether an existing same-date row may skip collection.

    Daytime collect-now/webhook runs can create a partial same-date snapshot.
    The first nightly run must refresh those automatic rows to the end-of-day
    value. Backup/retry runs may keep the cost guard because the primary final
    snapshot has already run. Same-date manual rows remain protected again at
    write time by _preserve_same_date_manual_stats().
    """
    return not recollect_all and not final_snapshot


def _coalesce_metric(current, previous=None):
    """Prefer a present collector value, including a legitimate numeric zero."""
    return current if current is not None else previous


def _store_aux_rows(db, rows, posts, stats, key_fn, label, *, views="clamp", caption_field=None, caption_limit=None):
    """보조 플랫폼(YT/틱톡/스레드/FB/X) 공통 저장 루프 — 5개 블록의 복붙을 단일 구현으로.

    views:
      - "clamp":    0/미반환은 접근불가로 보고 행 자체를 저장 안 함(직전 값 유지) + 역행 clamp. (틱톡·X)
      - "optional": 조회수 None이어도 행 저장(좋아요 등 유지) + 값 있으면 역행 clamp. (유튜브)
      - "none":     플랫폼이 조회수 미제공 → play_count는 항상 None. (스레드·FB)
    caption_field: 비어 있는 content_summary만 stats의 이 필드로 자동 채움(시트/수동 캡션 보존).
    """
    last_stat = _prev_stats(db, [p["id"] for p in posts])
    for post in posts:
        s = stats.get(key_fn(post))
        # 캡션 자동채움 — 조회수 유무와 무관, 비어 있을 때만
        if s and caption_field and not post.get("content_summary") and s.get(caption_field):
            # 줄바꿈은 띄어쓰기 한 칸으로 저장한다(시트 셀이 여러 줄로 벌어지는 것 방지).
            cap = normalize_caption(s[caption_field], caption_limit)
            if cap:
                db.table("sponsored_posts").update({"content_summary": cap}).eq("id", post["id"]).execute()
        if not s:
            _record_missing_view_event(post, label, "no_collector_response")
            continue
        existing = last_stat.get(post["id"], {})
        if s.get("error"):
            # 액터가 명시적 에러(삭제/비공개/민감/수집불가) 반환 → 특이사항 자동 태깅(notes 빈 것만, 수동 특이사항 보존)
            # + 행 저장 안 함(직전값 유지). 모든 보조 매체(YT·틱톡·스레드·FB·X) 공통 처리.
            if not (post.get("notes") or "").strip():
                note = f"{label} 수집 불가 감지(자동 {TODAY}, {s.get('error')}) — 조회수 최종값에서 정지, 확인 필요"
                db.table("sponsored_posts").update({"notes": note}).eq("id", post["id"]).execute()
            _record_missing_view_event(post, label, "collector_error", stat=s, existing=existing)
            continue
        # 팀 수기값 보호는 '같은 post_id+measured_at' 행에만 적용한다.
        # 이전 날짜가 manual=True라는 이유로 이후 날짜 수집까지 영구 중단하면 TikTok photo 등
        # 보조 플랫폼의 일별 시계열이 끊긴다. 저장 직전 _preserve_same_date_manual_stats와
        # ignore_duplicates가 같은 날짜의 수기 행을 절대 덮지 않으면서 다음 날짜 수집은 허용한다.
        play = None if views == "none" else s.get("views")
        if views == "clamp" and (not play or play <= 0):
            _record_missing_view_event(post, label, "missing_or_zero_view", stat=s, existing=existing)
            # 조회수 실패가 독립적으로 수집된 댓글수까지 버리게 하지 않는다.
            # 직전 양수 조회수는 유지하고, 없으면 NULL로 두되 참여지표는 저장한다.
            previous_play = existing.get("play_count")
            play = previous_play if previous_play is not None and previous_play > 0 else None
        if play is not None and existing.get("play_count") is not None and play < existing.get("play_count"):
            _record_overrecord_candidate(post, label, play, existing)
            # 미세 감소는 정상 지터 → NULL 대신 직전 최대값 유지(clamp)
            print(f"  ⚠️  {label} 조회수 역행 clamp {post['url']} ({play} → {existing.get('play_count')} 유지)")
            play = existing.get("play_count")
        likes, comments = s.get("likes"), s.get("comments")
        rows.append({
            "post_id": post["id"],
            "measured_at": TODAY,
            "play_count": play,
            # 액터가 필드 누락 시 None으로 덮어쓰지 않도록 직전값 폴백 (실제 0은 그대로 저장)
            "likes_count": _coalesce_metric(likes, existing.get("likes_count")),
            "comments_count": _coalesce_metric(comments, existing.get("comments_count")),
        })


def _snapshot_totals(db, post_ids, upto):
    """게시물들의 upto(포함) 시점 누적 총합 스냅샷 — 일별 증분 락 저장용.
    - play: 각 post의 max(누적·mono) play_count(≤ upto). likes/comments: 각 post의 최신값.
    - 증분[D] = 스냅샷[D].total_play − 스냅샷[D-1].total_play (락되어 사후에 안 바뀜).
    표시 dailyTotals(전일 forward-fill + 단조보정)와 동일 정의(합=합의 차).
    """
    last: dict = {}      # post별 최신 행 (likes/comments용)
    maxplay: dict = {}   # post별 max play(누적)
    ids = [i for i in post_ids if i]
    PAGE = 1000
    for c in range(0, len(ids), 100):
        chunk = ids[c:c + 100]
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, play_count, likes_count, comments_count, measured_at")
                   .in_("post_id", chunk)
                   .lte("measured_at", upto)
                   .order("measured_at", desc=True)
                   .order("created_at", desc=True)
                   .order("id", desc=True)   # 고유키 tiebreaker — range() 경계 행 누락 방지(직전값 오판 방지)
                   .range(frm, frm + PAGE - 1)
                   .execute())
            page = res.data or []
            for r in page:
                pid = r["post_id"]
                last.setdefault(pid, r)  # desc 정렬 → 첫 = 최신
                pc = r.get("play_count")
                if pc is not None and pc > maxplay.get(pid, -1):
                    maxplay[pid] = pc
            if len(page) < PAGE:
                break
            frm += PAGE
    tp = sum(maxplay.values())
    tl = sum((v.get("likes_count") or 0) for v in last.values() if (v.get("likes_count") or 0) >= 0)
    tc = sum((v.get("comments_count") or 0) for v in last.values() if (v.get("comments_count") or 0) >= 0)
    return {"total_play": tp, "total_likes": tl, "total_comments": tc, "post_count": len(last)}


def _stats_key(url: str) -> str:
    """매칭 키: 인스타그램이면 숏코드, 아니면 정규화된 URL"""
    sc = _ig_shortcode(url)
    if sc:
        return sc
    return normalize_url(url)  # url_utils에서 import


def _yt_id(url: str):
    """유튜브 영상 ID 추출 (shorts/watch/youtu.be)"""
    m = re.search(r'(?:shorts/|watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})', url or "")
    return m.group(1) if m else None


def _fetch_youtube(urls: list) -> dict:
    """유튜브 영상 조회수 수집 (streamers/youtube-scraper). 반환: {video_id: {views,likes,comments,title}}.
    유튜브는 '캡션'이 따로 없어 영상 제목(title)을 캡션(content_summary)으로 쓴다."""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    if not urls:              # 빈 배치 → Apify 호출 스킵(빈 startUrls/resultsLimit=0 거부 방지)
        return {}
    run = client.actor("streamers/youtube-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
        "maxResults": 1,
        "maxResultStreams": 0,
        "maxResultsShorts": 0,
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        vid = _yt_id(it.get("url") or "")
        if not vid:
            continue
        # 비공개/삭제 영상은 액터가 {error:'VIDEO_UNAVAILABLE'}로 반환(실측 확인) → 자동 특이사항 태깅용 신호.
        if it.get("error"):
            out[vid] = {"error": it.get("error"), "views": None, "likes": None, "comments": None, "title": None}
            continue
        out[vid] = {
            "views": it.get("viewCount"),
            "likes": it.get("likes"),
            "comments": it.get("commentsCount"),
            "title": it.get("title"),
        }
    return out


def _fetch_youtube_api(urls: list) -> dict:
    """공식 YouTube Data API v3로 조회수 보강 — Apify 스크래퍼가 VIDEO_UNAVAILABLE 등으로
    못 읽은 영상만 폴백한다. YOUTUBE_API_KEY 미설정이면 무동작(빈 dict).
    무료 쿼터(1만 units/일, videos.list=1 unit)라 실사용 수십 건은 사실상 무비용.
    반환: {video_id: {views,likes,comments,title}} (스크래퍼와 동일 스키마)."""
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        print("[WARN] YOUTUBE_API_KEY 미설정 → 유튜브 Data API 폴백 건너뜀")
        return {}
    ids = [v for v in (_yt_id(u) for u in urls) if v]
    if not ids:
        return {}
    import urllib.request, urllib.parse, json as _json
    out = {}
    for i in range(0, len(ids), 50):  # videos.list는 id 최대 50개/요청
        q = urllib.parse.urlencode({"part": "statistics,snippet",
                                    "id": ",".join(ids[i:i + 50]), "key": api_key})
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(f"https://www.googleapis.com/youtube/v3/videos?{q}"),
                    timeout=15) as r:
                data = _json.loads(r.read().decode())
        except Exception as e:
            print(f"[WARN] 유튜브 Data API 호출 실패: {e}")
            continue
        for it in data.get("items", []):
            vid = it.get("id")
            if not vid:
                continue
            st = it.get("statistics") or {}
            sn = it.get("snippet") or {}
            vc, lc, cc = st.get("viewCount"), st.get("likeCount"), st.get("commentCount")
            out[vid] = {
                "views": int(vc) if vc is not None else None,
                "likes": int(lc) if lc is not None else None,
                "comments": int(cc) if cc is not None else None,
                "title": sn.get("title"),
            }
    return out


def _tt_canonical(url: str) -> str:
    """틱톡 단축/비표준 URL(vt.tiktok.com 등)을 /video/ID 표준 URL로 해석. 이미 표준이면 그대로.
    리다이렉트 Location 헤더만 따라가 본문 요청·차단을 피한다. 실패 시 원본 반환.
    photo(슬라이드쇼) → /video/ 표준화는 url_utils.tt_canonical_form(순수·테스트 대상)에서 수행."""
    url = tt_canonical_form(url)   # /photo/ID → /video/ID (슬라이드쇼 소재 조회수 누락 방지)
    if not url or _tt_id(url):
        return url
    import urllib.request, urllib.error, urllib.parse

    class _NoFollow(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(_NoFollow)
    cur = url
    for _ in range(5):
        try:
            req = urllib.request.Request(cur, method="HEAD",
                                         headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            opener.open(req, timeout=10)
            break  # 2xx 도달 — 더 이상 리다이렉트 없음
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location")
            if not loc:
                break
            cur = urllib.parse.urljoin(cur, loc)
            if _tt_id(cur):
                return cur
        except Exception as e:
            print(f"  [WARN] 틱톡 단축 URL 해석 실패 {url}: {e}")
            return url
    return cur if _tt_id(cur) else url


def _fetch_tiktok(urls: list) -> dict:
    """틱톡 영상 조회수 수집 (clockworks/tiktok-scraper). 반환: {video_id: {views,likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    if not urls:              # 빈 배치 → Apify 호출 스킵
        return {}
    run = client.actor("clockworks/tiktok-scraper").call(run_input={
        "postURLs": urls,
        "resultsPerPage": 1,
        "shouldDownloadVideos": False,
        "shouldDownloadCovers": False,
        "shouldDownloadSubtitles": False,
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        vid = _tt_id(it.get("webVideoUrl") or it.get("submittedVideoUrl") or it.get("url") or "")
        if not vid:
            continue
        # 삭제/비공개/민감(POST_SENSITIVE 등)은 액터가 error/errorCode 반환(실측 확인) → 자동 특이사항 태깅 신호.
        err = it.get("errorCode") or it.get("error")
        if err:
            out[vid] = {"error": err, "views": None, "likes": None, "comments": None, "content_summary": None}
            continue
        out[vid] = {
            "views": it.get("playCount"),
            "likes": it.get("diggCount"),
            "comments": it.get("commentCount"),
            # 틱톡 영상 설명 → 캡션(content_summary). 액터가 text로 반환(실측 확인). 300자 제한.
            "content_summary": (it.get("text") or "")[:300] or None,
        }
    return out


def _th_code(url: str):
    """스레드 게시물 코드 추출 (/post/CODE)"""
    m = re.search(r'/post/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _fetch_threads(urls: list) -> dict:
    """스레드 좋아요/답글 수집 (logical_scrapers/threads-post-scraper). 조회수 없음. 반환: {code: {likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    if not urls:              # 빈 배치 → Apify 호출 스킵
        return {}
    run = client.actor("logical_scrapers/threads-post-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        th = it.get("thread") or {}
        code = th.get("code") or _th_code(th.get("url") or "") or _th_code(it.get("url") or "")
        if not code:
            continue
        err = it.get("errorCode") or it.get("error")
        if err:
            out[code] = {"error": err, "likes": None, "comments": None}
            continue
        out[code] = {"likes": th.get("like_count"), "comments": th.get("reply_count")}
    return out


def _fb_key(url: str):
    """페이스북 게시물 식별자 (pfbid 또는 숫자 id)"""
    m = re.search(r'pfbid[0-9A-Za-z]+', url or "")
    if m:
        return m.group(0)
    m = re.search(r'/(?:posts|videos)/(\d+)', url or "")
    return m.group(1) if m else None


def _fetch_facebook(urls: list) -> dict:
    """페이스북 좋아요/공유 수집 (apify/facebook-posts-scraper). 일반 게시물은 조회수 없음(영상만). 반환: {key: {likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    if not urls:              # 빈 배치 → Apify 호출 스킵(resultsLimit=0 거부 방지)
        return {}
    run = client.actor("apify/facebook-posts-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
        "resultsLimit": len(urls),  # 요청 URL 수만큼만(단건에 최대 5 요청하던 과수집 제거)
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        # facebookUrl이 입력 pfbid를 보존(url 필드는 FB가 다른 pfbid로 재생성하므로 매칭 실패)
        key = _fb_key(it.get("facebookUrl") or it.get("url") or "") or it.get("postId")
        if not key:
            continue
        err = it.get("errorCode") or it.get("error")
        if err:
            out[key] = {"error": err, "likes": None, "comments": None}
            continue
        out[key] = {"likes": it.get("likes"), "comments": it.get("comments")}
    return out


def _tw_id(url: str):
    """트윗 status ID 추출 (x.com·twitter.com 공통). 호스트 앵커로 vox.com 등 오매칭 방지."""
    m = re.search(r'https?://(?:[\w-]+\.)?(?:twitter|x)\.com/[^/]+/status/(\d+)', url or "", re.I)
    return m.group(1) if m else None


def _tw_norm(url: str):
    """트위터 status URL 정규화 → 'https://x.com/<handle>/status/<id>' 표준형.
    ⚠️ twitter-scraper-lite는 끝 슬래시('.../status/123/')·쿼리가 붙은 URL을 'Unsupported URL'로 거부해 0건 반환한다(2026-06-29 확인). 표준형으로 잘라서 넘긴다."""
    m = re.search(r'(https?://(?:[\w-]+\.)?(?:twitter|x)\.com/[^/]+/status/\d+)', url or "", re.I)
    return m.group(1) if m else (url or "").split("?")[0].split("#")[0].rstrip("/")


def _fetch_twitter(urls: list) -> dict:
    """트위터(X) 조회수 수집 (apidojo/twitter-scraper-lite). 반환: {tweet_id: {views,likes,comments}}.
    ⚠️ apidojo/tweet-scraper는 이 트윗들에 noResults만 반환 → twitter-scraper-lite로 교체(2026-06-29 검증, viewCount O).
    ⚠️ startUrls는 끝 슬래시/쿼리를 떼고 표준형으로 넘겨야 한다(_tw_norm) — 안 그러면 'Unsupported URL'로 0건.
    X가 조회수(impressions)를 제한적으로 노출 → 없으면 views=None(그날치 건너뜀)."""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    if not urls:              # 빈 배치 → Apify 호출 스킵
        return {}
    clean = [_tw_norm(u) for u in urls]
    run = client.actor("apidojo/twitter-scraper-lite").call(run_input={
        "startUrls": clean,
        "maxItems": max(len(clean), 1),
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        tid = _tw_id(it.get("url") or it.get("twitterUrl") or it.get("tweetUrl") or "")
        if not tid:
            continue
        err = it.get("errorCode") or it.get("error")
        if err:
            out[tid] = {"error": err, "views": None, "likes": None, "comments": None, "content_summary": None}
            continue
        out[tid] = {
            "views": it.get("viewCount") or it.get("views") or it.get("viewsCount"),
            "likes": it.get("likeCount") or it.get("favoriteCount"),
            "comments": it.get("replyCount"),
            # 트윗 본문 → 캡션(content_summary). 액터가 fullText/text로 반환(실측 확인). 300자 제한.
            "content_summary": (it.get("fullText") or it.get("text") or "")[:300] or None,
        }
    return out


def run():
    print("[DEBUG] === 협찬 모니터링 시작 ===")
    print(f"[DEBUG] 환경변수 확인:")
    print(f"  - SUPABASE_URL: {'설정됨' if os.getenv('SUPABASE_URL') else '❌ 미설정'}")
    print(f"  - SUPABASE_SERVICE_ROLE_KEY: {'설정됨' if os.getenv('SUPABASE_SERVICE_ROLE_KEY') else '❌ 미설정'}")
    print(f"  - APIFY_API_TOKEN: {'설정됨' if os.getenv('APIFY_API_TOKEN') else '❌ 미설정'}")
    print(f"  - SKIP_APIFY: {os.getenv('SKIP_APIFY', '0')}")
    print(f"  - JOB_PAYLOAD: {os.getenv('JOB_PAYLOAD', '{}')}\n")

    # 네트워크 연결 테스트
    print("[DEBUG] 네트워크 연결 테스트...")
    try:
        import socket
        socket.gethostbyname("supabase.co")
        print("[DEBUG] ✅ DNS 해석 성공: supabase.co")
    except socket.gaierror as e:
        print(f"[DEBUG] ❌ DNS 해석 실패: {e}")
    except Exception as e:
        print(f"[DEBUG] ❌ 네트워크 테스트 실패: {e}")

    # JOB_PAYLOAD 환경변수 처리 (None, "null", 비어있음 모두 처리)
    job_payload_str = os.getenv("JOB_PAYLOAD", "{}")

    # null 문자열이거나 비어있으면 {}로 기본값 설정
    if not job_payload_str or job_payload_str.strip() in ("null", "None", ""):
        job_payload_str = "{}"

    try:
        payload = json.loads(job_payload_str)
    except (json.JSONDecodeError, TypeError, ValueError):
        payload = {}

    # json.loads("null")은 None을 반환하므로 명시적으로 체크
    if payload is None:
        payload = {}
    # payload가 dict가 아니면 기본값
    elif not isinstance(payload, dict):
        payload = {}

    job_id = payload.get("job_id")

    db = get_client()

    if job_id:
        db.table("jobs").update({"status": "running"}).eq("id", job_id).execute()

    try:
        print(f"[LOG] 협찬 모니터링 시작 - 날짜: {TODAY}")
        # 전체 게시물 로딩 — PostgREST 기본 1000행 제한을 페이지네이션으로 우회.
        # (게시물이 1000개를 넘어도 초과분이 조용히 누락되지 않도록 전부 수집)
        all_posts = []
        _start, _PAGE = 0, 1000
        while True:
            _res = db.table("sponsored_posts").select(
                "id, url, posted_at, account_name, influencer_id, ended_at, content_summary, notes, channel_type, asset_name, project_name, product_name, manual_fields, not_found_streak, not_found_last_at, review_requested_at"
            ).range(_start, _start + _PAGE - 1).execute()
            _chunk = _res.data or []
            all_posts.extend(_chunk)
            if len(_chunk) < _PAGE:
                break
            _start += _PAGE

        # 🛑 자동 종료 정책 — ended_at 딱지 부여(삭제 아님, 데이터 보존).
        #   규칙: 배너·캐러셀(피드) 업로드일 제외 7일 이후(8일째 종료) / 그 외(영상) 14일 이후(15일째 종료) / 캡션(content_summary) '종료·보관·삭제'.
        #   예외: 위성채널·온드미디어만(무상시딩·50만 예외는 2026-07-14 사용자 지시로 제거 — 무상시딩(피드)도 7일 종료). 업로드일은 카운트에서 제외(age 0).
        try:
            active_ids = [p["id"] for p in all_posts if not p.get("ended_at")]
            max_metric_by_post = {}
            manual_tracked_ids = set()  # 수동 입력(manual=true) stat이 하나라도 있는 post → 자동종료 예외(수동값 보존)
            for _i in range(0, len(active_ids), 100):
                _c = active_ids[_i:_i + 100]
                _f = 0
                while True:
                    _r = (db.table("post_daily_stats").select("post_id, play_count, reach_count, manual")
                          .in_("post_id", _c).range(_f, _f + 999).execute())
                    _pg = _r.data or []
                    for _x in _pg:
                        _metric = row_metric(_x)
                        if _metric > max_metric_by_post.get(_x["post_id"], 0):
                            max_metric_by_post[_x["post_id"]] = _metric
                        if _x.get("manual"):
                            manual_tracked_ids.add(_x["post_id"])
                    if len(_pg) < 1000:
                        break
                    _f += 1000
            to_end = []
            for p in all_posts:
                if p.get("ended_at"):
                    continue
                decision = classify_auto_end(
                    p,
                    target_date=TODAY,
                    max_metric=max_metric_by_post.get(p["id"], 0),
                    manual_tracked=(p["id"] in manual_tracked_ids),
                )
                if decision.should_end:
                    to_end.append(p["id"])
            if to_end:
                for _i in range(0, len(to_end), 100):
                    db.table("sponsored_posts").update({"ended_at": TODAY}).in_("id", to_end[_i:_i + 100]).execute()
                ended_set = set(to_end)
                for p in all_posts:
                    if p["id"] in ended_set:
                        p["ended_at"] = TODAY  # 이번 수집에서도 제외되도록 반영
                print(f"[LOG] 🛑 자동 종료: {len(to_end)}건 (ended_at={TODAY})")
        except Exception as e:
            print(f"[WARN] 자동 종료 처리 실패(무시): {e}")

        # 종료(ended_at) 처리된 글과 측정일 기준 업로드 전 글은 스크랩 제외.
        # 업로드 전 조회수는 존재할 수 없으므로 DB/API에 들어오지 않게 입구에서 차단한다.
        posts = [
            p for p in all_posts
            if not p.get("ended_at")
            and "수동추적 제외" not in str(p.get("notes") or "")
            and (not p.get("posted_at") or str(p.get("posted_at"))[:10] <= TODAY)
        ]
        print(f"[LOG] 추적 게시물: {len(posts)}개 (종료/업로드전 제외 {len(all_posts) - len(posts)}개)")

        metadata_only = os.getenv("METADATA_RECOLLECT_ONLY", "0").lower() in ("1", "true", "yes")
        if metadata_only:
            posts = _select_metadata_recollect_posts(posts)
            print(f"[LOG] METADATA_RECOLLECT_ONLY=1 - blank-account IG posts only: {len(posts)}")

        recollect_all = os.getenv("RECOLLECT_ALL", "0").lower() in ("1", "true", "yes")
        final_snapshot = os.getenv("FINAL_SNAPSHOT", "0").lower() in ("1", "true", "yes")
        target_only = os.getenv("VIEW_MISSING_TARGET_ONLY", "0").lower() in ("1", "true", "yes")
        retry_target_count = 0
        if target_only and not recollect_all and not metadata_only:
            target_ids = _target_ids_from_missing_queue(os.getenv("VIEW_MISSING_QUEUE_FILE"))
            if target_ids is not None:
                before = len(posts)
                posts = [p for p in posts if p.get("id") in target_ids]
                retry_target_count = len(posts)
                print(
                    f"[LOG] VIEW_MISSING_TARGET_ONLY=1 - retryable queue targets: "
                    f"{len(posts)}/{before} posts"
                )

        if recollect_all:
            print(f"[LOG] 🔁 RECOLLECT_ALL=1 — {TODAY} 기존 측정행이 있어도 전체 재수집")
        elif final_snapshot:
            print(
                f"[LOG] 🌙 FINAL_SNAPSHOT=1 — {TODAY} 낮 시간 중간값을 "
                "자정 최종값으로 재수집(동일 수기값은 저장 직전 보존)"
            )
        elif _should_apply_same_day_cost_guard(
            recollect_all=recollect_all,
            final_snapshot=final_snapshot,
        ):
            measured_ids = _same_day_measured_ids(db, posts)
            if measured_ids:
                metadata_recollect_ids = {p["id"] for p in posts if p.get("id") in measured_ids and _needs_metadata_recollect(p)}
                before = len(posts)
                posts = [p for p in posts if p["id"] not in measured_ids or p["id"] in metadata_recollect_ids]
                print(
                    f"[LOG] 💸 Apify 비용 가드: {TODAY} 이미 측정된 {before - len(posts)}건 제외, "
                    f"메타데이터 보강 {len(metadata_recollect_ids)}건 포함, 수집 대상 {len(posts)}건"
                )

        if not posts:
            print("[WARN] 추적 중인 게시물이 없습니다.")
            if job_id:
                db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()
            return

        # Apify 호출 여부 제어 (SKIP_APIFY=1이면 스킵, 기본값: 호출)
        # SKIP_APIFY=1일 때는 기존 데이터만 사용 (Apify 호출 없이 진행)
        skip_apify = os.getenv("SKIP_APIFY", "0").lower() in ("1", "true", "yes")

        stats_by_key = {}
        if skip_apify:
            print(f"[LOG] ⏭️ Apify 데이터 수집 스킵 (SKIP_APIFY=1) - 기존 데이터만 사용")
        else:
            print(f"[LOG] Apify 데이터 수집 시작...")
            # 인스타 액터에는 instagram.com URL만 전달 (유튜브/틱톡이 섞이면 액터가 입력 검증 실패 → 호출 전체 실패)
            # ⚠️ shortcode 없는 프로필형 URL(예: .../username/reels/)은 제외 — 액터가 그 계정 게시물을
            #    resultsLimit만큼 통째로 긁어 과수집(건당 비용 폭증)됨. 매칭도 shortcode 기준이라 어차피 불가.
            ig_all = [p["url"] for p in posts if "instagram.com" in (p.get("url") or "")]
            ig_urls = [u for u in ig_all if _ig_shortcode(u)]
            skipped = [u for u in ig_all if not _ig_shortcode(u)]
            if skipped:
                print(f"[WARN] shortcode 없는 IG URL {len(skipped)}개 제외(프로필형 과수집 방지): {skipped}")
            stats = _fetch_stats(ig_urls)
            stats_by_key = {_stats_key(s["url"]): s for s in stats}
            print(f"[LOG] Apify 수집 결과: {len(stats)}건 / {len(ig_urls)}개 요청(인스타)")

            # 🛟 IG 폴백: 인스타가 기본 액터를 차단하거나 조회수 필드만 빼고 반환하면 play_count가 대량 누락된다.
            # ⚠️ 감지 기준 교체(2026-07-06): 예전 'URL에 /reel/ 포함' 기준은 IG URL 정준화(64234f3, 전부 /p/형)로
            #    릴스 표본이 0이 돼 영구 거짓 — 그래서 2026-07-03~05 부분수집(실측 159/182/219)을 폴백이 못 구제했다.
            #    이제 '직전 측정에서 play가 있던 게시물'(=조회수가 나와야 정상인 영상들) 중 이번 수집에서
            #    빠진 비율로 판정한다. 사진 포스트(원래 play 없음)는 분모에서 자연 제외돼 오탐도 줄어든다.
            ig_url_set = set(ig_urls)
            prev_ig = _prev_stats(db, [p["id"] for p in posts if (p.get("url") or "") in ig_url_set])
            expected = [p["url"] for p in posts
                        if (p.get("url") or "") in ig_url_set and (prev_ig.get(p["id"]) or {}).get("play_count") is not None]
            exp_missing = [u for u in expected if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
            # 최소 표본(5개↑) 확보 시에만 비율 판정 — 소표본 오탐으로 더 비싼 data-slayer 폴백이 트리거되는 것을 방지.
            if len(expected) >= 5 and len(exp_missing) / len(expected) >= 0.4:
                missing = [u for u in ig_urls if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
                print(f"[WARN] IG 조회수 누락 {len(exp_missing)}/{len(expected)}(직전값 보유 기준) → 차단/필드누락 추정, data-slayer 폴백 {len(missing)}건 호출")
                fb = _fetch_ig_fallback(missing)
                merged = 0
                for u in missing:
                    m = fb.get(_ig_shortcode(u) or "")
                    if not m:
                        continue
                    key = _stats_key(u)
                    cur = stats_by_key.get(key) or {"url": u}
                    if m.get("play_count") is not None:
                        cur["play_count"] = m["play_count"]
                        merged += 1
                    if m.get("likes_count") is not None:
                        cur["likes_count"] = m["likes_count"]
                    if m.get("comments_count") is not None:
                        cur["comments_count"] = m["comments_count"]
                    if m.get("content_summary") and not cur.get("content_summary"):
                        cur["content_summary"] = m["content_summary"]
                    stats_by_key[key] = cur
                print(f"[LOG] data-slayer 폴백 보강 완료: 조회수 {merged}건 채움")
            elif exp_missing:
                # 전체 차단 비율에는 못 미쳐도 직전 측정값이 있던 개별 게시물이 갑자기 빠지면
                # 해당 누락분만 data-slayer로 보강한다. 비용 폭주 방지를 위해 일일 20건 상한.
                missing = exp_missing[:20]
                print(f"[WARN] IG 개별 조회수 누락 {len(exp_missing)}건 → data-slayer 선택 폴백 {len(missing)}건 호출")
                fb = _fetch_ig_fallback(missing)
                merged = 0
                for u in missing:
                    m = fb.get(_ig_shortcode(u) or "")
                    if not m:
                        continue
                    key = _stats_key(u)
                    cur = stats_by_key.get(key) or {"url": u}
                    for field in ("play_count", "likes_count", "comments_count", "content_summary"):
                        if m.get(field) is not None and (field != "content_summary" or not cur.get(field)):
                            cur[field] = m[field]
                    if m.get("play_count") is not None:
                        merged += 1
                    stats_by_key[key] = cur
                print(f"[LOG] data-slayer 선택 폴백 완료: 조회수 {merged}건 채움")

            # 🛟 comments_count 보강(2026-07-24): 기본 IG 액터가 play는 주면서 commentsCount를 빼먹는 경우가 있어
            #    바이럴 게시물 다수가 comments_count=null → 부정댓글 봇 델타 신호가 비어 재스캔을 못 함(미탐 원인).
            #    play 유무와 무관하게 '이번 수집에서 comments_count 없는 IG글'만 data-slayer로 보강(회차당 30건 상한).
            #    ⚠️ null만 채우고 실측(non-null)은 덮지 않음. data-slayer도 없으면 그대로 비워둠(값 지어내지 않음).
            #    ⚠️ 오늘(measured_at=TODAY) 이미 채워진 글은 건너뛴다(2026-07-27) — 하루 여러 회차가 같은 글을
            #       중복 보강하던 비용 제거 + 회차를 거치며 남은 null만 채워 하루 안에 수렴(봇 noSignal 실제 감소).
            cand = [u for u in ig_urls
                    if (stats_by_key.get(_stats_key(u)) or {}).get("comments_count") is None]
            url2pid = {p["url"]: p["id"] for p in posts}
            cand_pids = [url2pid[u] for u in cand if u in url2pid]
            filled_today = set()
            for c in range(0, len(cand_pids), 100):
                chunk = cand_pids[c:c + 100]
                try:
                    res = (db.table("post_daily_stats").select("post_id, comments_count")
                           .eq("measured_at", TODAY).in_("post_id", chunk).execute())
                    for r in (res.data or []):
                        if r.get("comments_count") is not None:
                            filled_today.add(r["post_id"])
                except Exception as e:
                    print(f"  [WARN] comments_count 오늘 보강여부 조회 실패: {e}")
            cmt_missing = [u for u in cand if url2pid.get(u) not in filled_today]
            if cmt_missing:
                cap = cmt_missing[:30]
                print(f"[LOG] comments_count 누락 {len(cand)}건(오늘 보강됨 {len(cand) - len(cmt_missing)} 제외 → 대상 {len(cmt_missing)}) → data-slayer {len(cap)}건 호출")
                fb2 = _fetch_ig_fallback(cap)
                filled = 0
                for u in cap:
                    m = fb2.get(_ig_shortcode(u) or "")
                    if not m or m.get("comments_count") is None:
                        continue
                    key = _stats_key(u)
                    cur = stats_by_key.get(key) or {"url": u}
                    cur["comments_count"] = m["comments_count"]
                    for fld in ("play_count", "likes_count"):
                        if cur.get(fld) is None and m.get(fld) is not None:
                            cur[fld] = m[fld]
                    if m.get("content_summary") and not cur.get("content_summary"):
                        cur["content_summary"] = m["content_summary"]
                    stats_by_key[key] = cur
                    filled += 1
                print(f"[LOG] comments_count 보강 완료: {filled}건")

        rows = []
        # 직전(오늘 이전) 누적값 일괄 조회 — per-post 개별 쿼리(N+1) 제거.
        # .lt(TODAY)라서 같은 날 재수집 시 '오늘 행'을 기준값으로 삼지 않음(멱등) — 글리치로 부푼 값이 clamp로 고착되는 것 방지.
        last_stat = _prev_stats(db, [p["id"] for p in posts])
        for post in posts:
            post_url = post.get("url") or ""
            if not _is_instagram_collectable_url(post_url):
                continue

            key = _stats_key(post_url)
            s = stats_by_key.get(key)
            if not s:
                _record_missing_view_event(post, "Instagram", "no_collector_response")
                print(f"  매칭 실패: {post_url} (key={key})")
                continue

            # Guard against Apify returning a different post for a requested URL.
            # Instagram timestamps can differ by one calendar day between UTC/KST,
            # but larger gaps mean the collected item is not the sponsored post.
            if post.get("posted_at") and s.get("posted_at"):
                try:
                    post_date = date.fromisoformat(str(post["posted_at"])[:10])
                    stat_date = date.fromisoformat(str(s["posted_at"])[:10])
                    if abs((stat_date - post_date).days) > 1:
                        _record_missing_view_event(
                            post,
                            "Instagram",
                            "posted_at_mismatch",
                            stat=s,
                            extra={"expected_posted_at": str(post_date), "actual_posted_at": str(stat_date)},
                        )
                        print(
                            f"  [WARN] IG 게시일 불일치 응답 제외: {post['url']} "
                            f"(sheet={post_date}, apify={stat_date}, key={key})"
                        )
                        continue
                except Exception:
                    pass

            # Apify IG not_found는 간헐 오탐이 있어 3일 연속일 때 알림만 보낸다.
            # TikTok not_found는 종료·제외·streak 판정에 절대 사용하지 않는다.
            if s.get("deleted") and is_not_found_review_eligible(post.get("url") or ""):
                _record_missing_view_event(post, "Instagram", "not_found", stat=s)
                _record_not_found_observation(db, post, True)
                continue
            _record_not_found_observation(db, post, False)

            updates = {}
            if not post.get("posted_at") and s.get("posted_at"):
                updates["posted_at"] = s["posted_at"]
            account_name_update = collected_account_name_update(post, s)
            if account_name_update is not None:
                updates["account_name"] = account_name_update
            # 시트에 캡션이 없으면 스크랩한 캡션으로 채움(비어 있을 때만 — 수동/시트 캡션 보존). webhook과 동일.
            if not post.get("content_summary") and s.get("content_summary"):
                # 줄바꿈 → 띄어쓰기 한 칸(연동 시트 캡션 셀 한 줄 유지)
                cap = normalize_caption(s["content_summary"])
                if cap:
                    updates["content_summary"] = cap

            # influencer_id 자동 연결 (스크리닝 지표 표시용)
            if not post.get("influencer_id") and s.get("owner_username"):
                profile_url = f"https://www.instagram.com/{s['owner_username']}/"
                inf_res = db.table("influencers").select("id").eq("url", profile_url).limit(1).execute()
                if inf_res.data:
                    updates["influencer_id"] = inf_res.data[0]["id"]

            if updates:
                db.table("sponsored_posts").update(updates).eq("id", post["id"]).execute()

            # 기존 데이터 조회 (누적값 검증) — 위에서 _prev_stats로 일괄 조회한 '오늘 이전' 최신값
            existing = last_stat.get(post["id"], {})

            play_count = s.get("play_count")

            # Banner posts have no play metric \u2014 reach only. Daily reach is stored by reach_rows below.
            # \uc608\uc678: \ud2f1\ud1a1 \ubc30\ub108(\uc0ac\uc9c4/\uc2ac\ub77c\uc774\ub4dc\uc1fc)\ub294 \uc2e4\uc81c playCount\uac00 \uc788\uc5b4 \uc870\ud68c\uc218\ub85c \uc218\uc9d1\ud55c\ub2e4(\uc0ac\uc6a9\uc790 \uc9c0\uc2dc 2026-07-28).
            _is_tiktok = "tiktok.com" in (post.get("url") or "")
            if "\ubc30\ub108" in (post.get("channel_type") or "") and not _is_tiktok:
                rows.append({
                    "post_id": post["id"],
                    "measured_at": TODAY,
                    "likes_count": _coalesce_metric(s.get("likes_count"), existing.get("likes_count")),
                    "comments_count": _coalesce_metric(s.get("comments_count"), existing.get("comments_count")),
                })
                continue

            # 조회수 검증
            if play_count is None:
                _record_missing_view_event(post, "Instagram", "missing_play_count", stat=s, existing=existing)
                # Apify가 조회수를 반환하지 않음 (게시물 타입상 조회수 없을 수 있음)
                print(f"  ⚠️  조회수 없음: {post['url']} (account={s.get('account_name')})")
                play_count = None
            elif play_count <= 0:
                # 🛡️ 조회수 0 = 접근불가·수집 글리치(IG가 조회수를 0으로 반환). '수집 실패 ≠ 0' 원칙.
                #   0을 저장하면 ①다음날 증분이 pmax 대비 폭증(며칠치 몰림) ②수기 입력값을 0으로 덮음.
                #   직전값이 있으면 그 값으로 clamp(누적 유지), 없으면 이 행 자체를 스킵(0 미적재).
                if existing.get("play_count"):
                    print(f"  ⚠️  IG 조회수 0(글리치) → 직전값 유지 {post['url']} (→{existing.get('play_count')})")
                    play_count = existing.get("play_count")
                else:
                    _record_missing_view_event(post, "Instagram", "zero_play_no_previous", stat=s, existing=existing)
                    print(f"  ⚠️  IG 조회수 0(글리치)·직전값 없음 → 조회수 NULL, 참여지표만 저장 {post['url']}")
                    play_count = None
            elif _looks_like_engagement_count_as_views(
                play_count,
                s.get("likes_count"),
                s.get("comments_count"),
                existing,
            ):
                _record_missing_view_event(post, "Instagram", "implausible_play_engagement_ratio", stat=s, existing=existing)
                print(
                    f"  [WARN] IG suspicious first play skipped: {post['url']} "
                    f"(play={play_count}, likes={s.get('likes_count')}, comments={s.get('comments_count')})"
                )
                # 의심스러운 조회수만 버리고 댓글·좋아요 신호는 보존한다.
                play_count = None
            elif existing.get("play_count") is not None and play_count < existing.get("play_count"):
                _record_overrecord_candidate(post, "Instagram", play_count, existing)
                # 누적값인데 줄어들었다 = 오류(글리치) 또는 IG 정상 미세감소(중복/봇 필터링 지터).
                # NULL로 버리면 성숙 게시물에 톱니형 결측이 생기고 유효값이 사라지므로,
                # 직전 최대값으로 clamp(하향 무시) — 표시 레이어의 monotonic과 동일하게 누적 불변식 유지.
                print(f"  ⚠️  조회수 역행 clamp {post['url']} ({play_count} → {existing.get('play_count')} 유지)")
                play_count = existing.get("play_count")

            rows.append({
                "post_id": post["id"],
                "measured_at": TODAY,
                "play_count": play_count,
                "likes_count": _coalesce_metric(s.get("likes_count"), existing.get("likes_count")),
                "comments_count": _coalesce_metric(s.get("comments_count"), existing.get("comments_count")),
            })

        # YouTube 수집 (인스타 액터로는 불가 → 전용 액터). IG 루프에서 매칭 실패로 건너뛴 유튜브 글을 채움
        yt_posts = [p for p in posts if ("youtube.com" in (p.get("url") or "") or "youtu.be" in (p.get("url") or ""))]
        yt_failed = False
        if yt_posts and not skip_apify:
            try:
                yt_stats = _fetch_youtube([p["url"] for p in yt_posts])
                _miss = lambda: [p["url"] for p in yt_posts
                                 if not ((yt_stats.get(_yt_id(p["url"])) or {}).get("views"))]
                # (B) 미반환/0 조회수 1회 재시도 — 간헐적 스크래퍼 공백 보강(틱톡과 동일 패턴).
                #     영구오류(VIDEO_UNAVAILABLE)는 재시도 무의미 → 제외하고 (A) Data API로 넘김.
                yt_retry = [u for u in _miss()
                            if (yt_stats.get(_yt_id(u)) or {}).get("error") != "VIDEO_UNAVAILABLE"]
                if yt_retry:
                    print(f"[LOG] 유튜브 미반환 {len(yt_retry)}건 → 1회 재시도")
                    for vid, s in _fetch_youtube(yt_retry).items():
                        if (s.get("views") or 0) > 0:
                            yt_stats[vid] = s
                # (A) 스크래퍼가 끝내 못 준 영상(VIDEO_UNAVAILABLE 등) → 공식 Data API 보강(YOUTUBE_API_KEY 있을 때만)
                yt_unavail = _miss()
                if yt_unavail:
                    filled = 0
                    for vid, s in _fetch_youtube_api(yt_unavail).items():
                        if (s.get("views") or 0) > 0:
                            yt_stats[vid] = s
                            filled += 1
                    if filled:
                        print(f"[LOG] 유튜브 Data API 폴백 보강: {filled}건 / 미반환 {len(yt_unavail)}건")
                print(f"[LOG] 유튜브 수집: 실값 {sum(1 for s in yt_stats.values() if (s.get('views') or 0) > 0)}건 / {len(yt_posts)}개 요청")
                # 비공개/삭제(error=VIDEO_UNAVAILABLE) 자동 특이사항 태깅은 _store_aux_rows가 공통 처리.
                # 유튜브 캡션 = 영상 제목. 조회수 None이어도 행 저장(좋아요 유지) + 역행 clamp.
                _store_aux_rows(db, rows, yt_posts, yt_stats, lambda p: _yt_id(p["url"]), "유튜브",
                                views="optional", caption_field="title", caption_limit=300)
            except Exception as e:
                # 무음 실패 방지: 에러를 명시하고 아래에서 작업을 실패로 표시(IG는 정상 저장됨)
                print(f"[ERROR] 유튜브 수집 실패: {e}")
                yt_failed = True

        # TikTok 수집 (전용 액터). playCount 0 = 접근불가(삭제/비공개/지역제한)로 보고 저장 안 함(직전 값 유지)
        tt_posts = [p for p in posts if "tiktok.com" in (p.get("url") or "")]
        tt_failed = False
        if tt_posts and not skip_apify:
            try:
                # 단축/비표준 URL(vt.tiktok.com 등)을 /video/ID 표준형으로 해석 → 결과 매칭 실패 방지
                tt_canon = {p["url"]: _tt_canonical(p["url"]) for p in tt_posts}
                tt_stats = _fetch_tiktok([tt_canon[p["url"]] for p in tt_posts])
                # 액터가 간헐적으로 일부 영상만 미반환/0 (살아있는 영상인데 그날 수집 공백 발생,
                # 2026-07-08 시으니네 등 3/26건). 미반환분만 모아 1회 재시도.
                retry_urls = [tt_canon[p["url"]] for p in tt_posts
                              if (tt_stats.get(_tt_id(tt_canon[p["url"]])) or {}).get("views") in (None, 0)]
                if retry_urls:
                    print(f"[LOG] 틱톡 미반환 {len(retry_urls)}건 재시도")
                    for vid, s in _fetch_tiktok(retry_urls).items():
                        if _has_positive_views(s):
                            tt_stats[vid] = s
                got = sum(1 for s in tt_stats.values() if _has_positive_views(s))
                print(f"[LOG] 틱톡 수집: 실값 {got}건 / {len(tt_posts)}개 요청")
                tt_photo_posts = [p for p in tt_posts if re.search(r"/photo/\d+", p.get("url") or "")]
                if tt_photo_posts:
                    photo_got = sum(
                        1 for p in tt_photo_posts
                        if _has_positive_views(tt_stats.get(_tt_id(tt_canon[p["url"]])))
                    )
                    print(f"[LOG] 틱톡 photo 수집: 실값 {photo_got}건 / {len(tt_photo_posts)}개 요청")
                _store_aux_rows(db, rows, tt_posts, tt_stats, lambda p: _tt_id(tt_canon[p["url"]]), "틱톡",
                                views="clamp", caption_field="content_summary")
            except Exception as e:
                print(f"[ERROR] 틱톡 수집 실패: {e}")
                tt_failed = True

        # Threads 수집 (전용 액터). 조회수 없음 → 좋아요/답글만 (play_count는 미설정)
        th_posts = [p for p in posts if ("threads.com" in (p.get("url") or "") or "threads.net" in (p.get("url") or ""))]
        th_failed = False
        if th_posts and not skip_apify:
            try:
                th_stats = _fetch_threads([p["url"] for p in th_posts])
                print(f"[LOG] 스레드 수집: {len(th_stats)}건 / {len(th_posts)}개 요청")
                _store_aux_rows(db, rows, th_posts, th_stats, lambda p: _th_code(p["url"]), "스레드", views="none")
            except Exception as e:
                print(f"[ERROR] 스레드 수집 실패: {e}")
                th_failed = True

        # Facebook 수집 (전용 액터). 일반 게시물은 조회수 없음(영상만) → 좋아요만 (댓글 미반환)
        fb_posts = [p for p in posts if "facebook.com" in (p.get("url") or "")]
        fb_failed = False
        if fb_posts and not skip_apify:
            try:
                fb_stats = _fetch_facebook([p["url"] for p in fb_posts])
                print(f"[LOG] 페이스북 수집: {len(fb_stats)}건 / {len(fb_posts)}개 요청")
                _store_aux_rows(db, rows, fb_posts, fb_stats, lambda p: _fb_key(p["url"]), "페이스북", views="none")
            except Exception as e:
                print(f"[ERROR] 페이스북 수집 실패: {e}")
                fb_failed = True

        # 트위터(X) 수집 (apidojo/tweet-scraper). 조회수 있음 → 틱톡과 동일 처리(역행 가드 포함).
        tw_posts = [p for p in posts if _tw_id(p.get("url") or "")]
        tw_failed = False
        if tw_posts and not skip_apify:
            try:
                tw_stats = _fetch_twitter([p["url"] for p in tw_posts])
                got = sum(1 for s in tw_stats.values() if (s.get("views") or 0) > 0)
                print(f"[LOG] 트위터 수집: 실값 {got}건 / {len(tw_posts)}개 요청")
                _store_aux_rows(db, rows, tw_posts, tw_stats, lambda p: _tw_id(p["url"]), "트위터",
                                views="clamp", caption_field="content_summary")
            except Exception as e:
                print(f"[ERROR] 트위터 수집 실패: {e}")
                tw_failed = True

        if rows:
            # 🛡️ 수집 도중 삭제된 게시물 행 제거 — 없는 post_id가 섞이면 FK 위반으로 upsert 전체가 실패한다.
            row_pids = list({r["post_id"] for r in rows})
            valid = set()
            for i in range(0, len(row_pids), 200):
                vr = db.table("sponsored_posts").select("id").in_("id", row_pids[i:i + 200]).execute()
                for x in (vr.data or []):
                    valid.add(x["id"])
            before = len(rows)
            rows = [r for r in rows if r["post_id"] in valid]
            if len(rows) < before:
                print(f"[WARN] 수집 중 삭제된 게시물 행 {before - len(rows)}건 제외(FK 보호)")
        # 🛡️ 재발방지(2026-08-06): 게시일 이전 measured_at 행 차단(pre-post 가드). 상세는 _drop_pre_post_rows.
        rows, _pre_post = _drop_pre_post_rows(rows, posts)
        if _pre_post:
            _samp = ", ".join(sorted({f"{str(r.get('post_id'))[:8]}@{str(r.get('measured_at'))[:10]}" for r in _pre_post}))
            print(f"[WARN] 게시일 이전 measured_at 행 {len(_pre_post)}건 저장 제외(pre-post 가드): {_samp[:300]}")
        # 🛡️ 재발방지(전 수집경로 공통 초크포인트): play_count 0/음수는 '수집 실패'다(실측 0회가 아님).
        #    직전 실측이 있으면 그 값으로 clamp, 없으면 None(측정 안 됨) — 0을 baseline으로 절대 남기지 않는다.
        #    (플랫폼별 _store/IG 개별 가드에 더해, 저장 직전 단일 지점에서 모든 경로를 전수 차단.)
        for _r in rows:
            _pc = _r.get("play_count")
            if _pc is not None and _pc <= 0:
                _prev = (last_stat.get(_r["post_id"]) or {}).get("play_count")
                _r["play_count"] = _prev if (_prev and _prev > 0) else None
        rows = _preserve_same_date_manual_stats(db, rows, "run_monitoring")
        if rows:
            print(f"[LOG] 데이터 저장 시작: {len(rows)}건")
            result = db.table("post_daily_stats").upsert(
                rows,
                on_conflict="post_id,measured_at",
                # FINAL_SNAPSHOT/RECOLLECT_ALL은 등록 직후 생긴 동일일 자동 중간행을
                # 최종값으로 교체해야 한다. manual=True 동일일 행은 위
                # _preserve_same_date_manual_stats()에서 이미 제외되어 안전하다.
                ignore_duplicates=_should_apply_same_day_cost_guard(
                    recollect_all=recollect_all,
                    final_snapshot=final_snapshot,
                ),
            ).execute()
            print(f"[LOG] ✅ 데이터 저장 완료: {len(rows)}건")
            # (역방향 baseline=0 자동추가 제거 — '전날에 play_count=0을 심는' 안티패턴이 baseline-zero 파괴의 원인이었음.
            #  증분은 safeIncrement가 '첫 유효측정=그날 전체(업로드날 성과), 이후 델타'로 처리하므로 baseline=0 불필요.)
        else:
            print(f"[WARN] 저장할 데이터가 없습니다 (매칭 실패 또는 조회수 오류)")

        retry_zero_alert = zero_result_alert(target_only, retry_target_count, len(rows), TODAY)
        if retry_zero_alert:
            print(f"[ERROR] {retry_zero_alert}")
            _send_status_alert(retry_zero_alert)
            raise RuntimeError(retry_zero_alert)

        print(f"[SUCCESS] 모니터링 완료: {len(rows)}건 저장")
        _flush_overrecord_warnings()

        # 📸 배너 도달수(reach) 일별 스냅샷 — 배너는 조회수(play_count)가 없어 '도달수'로 증분 계산한다.
        #    활성 배너의 현재 reach_count(시트/대시보드 수동입력)를 오늘 post_daily_stats.reach_count로 기록
        #    → 도달수 일별 이력 생성 → viewIncrement/리포트가 '전일 대비 도달수 증분'을 산출.
        #    (첫 스냅샷일엔 이전 이력이 없어 도달수 전체가 신규 증분으로 잡힘 = 의도된 규칙)
        #    best-effort: 실패해도 수집 자체엔 영향 없음(경고만).
        try:
            # ⛔ 배너 도달수 자동 스냅샷 비활성화 (2026-08-05).
            #    IG 배너 reach는 '시트 수기'가 정본이며 banner-reach-sync(시트 per-date → DB)가 이미 반영한다.
            #    이 스냅샷은 sponsored_posts.reach_count를 팀 미입력일(금/토 등)에도 매일 자동 기록해서
            #    (a) 수기 없는 날을 자동 채우고 (b) 잘못된 reach_count(예 7,834·15,668 오배정)를 전파했다.
            #    → 배너 reach는 banner-reach-sync 단일 경로만 사용한다(양방향 클로버·자동채움 제거).
            print("[LOG] 배너 도달수 자동 스냅샷 비활성화됨 — banner-reach-sync(시트→DB per-date)가 정본")
        except Exception as e:
            print(f"[WARN] 배너 도달수 스냅샷 실패(무시): {e}")

        # 📈 증분(increment) 저장 폐기(2026-07-08) — 단일 진실은 표시단계 safeIncrement(오늘값 − 직전 유효>0값,
        #   첫 유효측정=전체)로 이관. 대시보드(viewIncrement/dailyTotals)·리포트(notify_increments)가 raw play/reach
        #   시리즈에서 매번 재계산하므로 저장 increment 컬럼은 아무도 안 읽음(웹/스크립트 전수 확인). 오염 자가치유+일관.
        #   → run_monitoring은 play_count/reach_count(원천값)만 저장하고 increment는 계산·저장하지 않는다.

        # 📸 일별 증분 스냅샷(락) — 오늘 시점 누적 총합을 daily_view_snapshot에 저장.
        #    이후 게시물이 늦게 추가돼도 과거 스냅샷은 안 바뀜 → '일자별 증감' 과거값 안정화.
        #    best-effort: 테이블 미생성 등 어떤 오류도 수집 자체엔 영향 주지 않음(경고만).
        try:
            snap = _snapshot_totals(db, [p["id"] for p in all_posts], TODAY)
            db.table("daily_view_snapshot").upsert({"date": TODAY, **snap}, on_conflict="date").execute()
            print(f"[LOG] 📸 일별 스냅샷 저장({TODAY}): {snap}")
        except Exception as e:
            print(f"[WARN] 일별 스냅샷 저장 실패(무시): {e}")

        _flush_missing_view_events()
        _flush_posted_at_mismatch_alert()
        if job_id:
            db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()

        # 보조 플랫폼(유튜브/틱톡/페북/스레드/트위터) 일부 실패 처리:
        #  - 저장된 데이터가 있으면(주 수집 성공) 전체 run을 실패로 만들지 않고 경고만 남긴다.
        #    누락 aux 데이터는 status='missing' 재수집(02/05/08시)이 복구 → 매일 false '실패' 알림 방지.
        #  - 아무것도 저장 못 했으면(총 실패) 하드 실패로 raise해 알림/원인 확인.
        if yt_failed or tt_failed or fb_failed or th_failed or tw_failed:
            _aux = f"유튜브={yt_failed}, 틱톡={tt_failed}, 페북={fb_failed}, 스레드={th_failed}, 트위터={tw_failed}"
            if rows:
                print(f"[WARN] 보조 플랫폼 일부 실패({_aux}) — 주 수집 {len(rows)}건은 저장됨(부분성공). 누락분은 재수집으로 복구.")
            else:
                raise RuntimeError(f"수집 실패({_aux}) — 저장된 데이터 없음, 원인 확인 필요")

    except Exception as e:
        print(f"[ERROR] 모니터링 실패: {str(e)}")
        import traceback
        print(f"[ERROR] Traceback:\n{traceback.format_exc()}")
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


def _fetch_ig_fallback(urls: list) -> dict:
    """기본 IG 액터(apify/instagram-scraper)가 인스타 차단으로 no_items만 반환할 때, data-slayer/instagram-post-details로 조회수 보강.
    반환: {shortcode: {play_count, likes_count, comments_count, content_summary}}.
    ⚠️ data-slayer의 aggregate metric은 Facebook 교차게시 값을 포함할 수 있으므로 Instagram 전용값만 사용한다.
    비용↑(~2.7배)이라 차단 감지 시에만 호출한다.
    ⚠️ data-slayer의 caption은 객체({text,...}) — apify(문자열)와 형식이 달라 .text를 꺼낸다."""
    from apify_client import ApifyClient
    from instagram_metric_policy import pick_instagram_metric
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    out = {}
    for i in range(0, len(urls), 40):
        chunk = urls[i:i + 40]
        try:
            run = client.actor("data-slayer/instagram-post-details").call(run_input={"postUrls": chunk})
            for it in client.dataset(run["defaultDatasetId"]).iterate_items():
                code = it.get("code") or it.get("shortcode") or it.get("shortCode")
                if not code:
                    continue
                m = it.get("metrics") or {}
                cap = it.get("caption")
                cap_text = cap.get("text") if isinstance(cap, dict) else (cap if isinstance(cap, str) else None)
                out[code] = {
                    "play_count": pick_instagram_metric(m, "play_count", "fb_play_count", "ig_play_count"),
                    "likes_count": pick_instagram_metric(m, "like_count", "fb_like_count"),
                    "comments_count": pick_instagram_metric(m, "comment_count", "fb_comment_count"),
                    "content_summary": (cap_text or "")[:300] or None,
                }
        except Exception as e:
            print(f"  [WARN] data-slayer 폴백 배치 실패: {e}")
    return out


@retry_on_network_error(max_retries=3, delay=10)
def _fetch_stats(urls: list) -> list:
    from apify_client import ApifyClient
    if not urls:              # 빈 배치 → IG 액터 호출 스킵(resultsLimit=0 'must be >= 1' 거부 방지)
        return []

    # ⚠️ Apify API 토큰 확인
    apify_token = os.getenv("APIFY_API_TOKEN")
    if not apify_token:
        raise RuntimeError("[ERROR] APIFY_API_TOKEN 환경변수가 설정되지 않았습니다")

    print(f"[LOG] Apify 액터 호출: {APIFY_IG_ACTOR}")
    print(f"[LOG] 수집 대상 URL: {len(urls)}개")

    try:
        client = ApifyClient(apify_token)
        run = client.actor(APIFY_IG_ACTOR).call(run_input={
            "directUrls": urls,
            "resultsType": "posts",
            "resultsLimit": len(urls),
            "maxRequestRetries": 3,
            # 데이터센터 IP는 인스타에 차단됨 → 레지덴셜 프록시로 릴스 조회수 수집
            "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
        })
    except Exception as e:
        raise RuntimeError(f"[ERROR] Apify 액터 호출 실패: {str(e)}")

    print(f"[LOG] Apify 실행 ID: {run.get('id')}")

    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    print(f"[LOG] Apify 응답 아이템: {len(items)}개")

    requested_keys = {_stats_key(u) for u in urls}
    result = []
    for idx, item in enumerate(items):
        shortcode = item.get("shortCode") or item.get("shortcode")
        url = (
            item.get("url")
            or (shortcode and f"https://www.instagram.com/p/{shortcode}/")
        )
        if not url:
            continue
        response_key = _stats_key(url)
        if response_key not in requested_keys:
            print(f"  [WARN] 요청하지 않은 IG 응답 제외: {url} (key={response_key})")
            continue

        # 게시일 추출
        posted_at = None
        ts = item.get("timestamp") or item.get("takenAt")
        if isinstance(ts, str):
            posted_at = ts[:10]
        elif isinstance(ts, (int, float)):
            posted_at = datetime.utcfromtimestamp(ts).date().isoformat()

        # 계정 정보 추출
        owner = item.get("owner") or {}
        owner_username = item.get("ownerUsername") or owner.get("username")
        account_name = (
            item.get("ownerFullName") or owner.get("fullName")
            or owner_username
        )

        # 조회수 추출 (필드별 우선순위)
        # - 릴스: videoPlayCount, videoViewCount
        # - 일반 포스트: impressions (Instagram 인사이트)
        # - 폴백: views (legacy field)
        play_count = (
            item.get("videoPlayCount")
            or item.get("videoViewCount")
            or item.get("impressions")  # 일반 포스트의 임프레션 (조회수)
            or item.get("views")
            or item.get("count")  # 일부 버전의 조회수 필드
            or None
        )

        # 📊 상세 로깅: 조회수 필드 분석
        play_count, play_count_source = _pick_instagram_play_count(item, url)

        available_count_fields = {
            "videoPlayCount": item.get("videoPlayCount"),
            "videoViewCount": item.get("videoViewCount"),
            "impressions": item.get("impressions"),
            "views": item.get("views"),
            "count": item.get("count"),
        }
        non_none_fields = {k: v for k, v in available_count_fields.items() if v is not None}

        # 조회수가 없는 게시물 기록
        if not play_count:
            post_type_indicators = []
            if item.get("videoPlayCount") or item.get("videoViewCount"):
                post_type_indicators.append("Reel/Video")
            else:
                post_type_indicators.append("Post")

            if idx < 3:  # 처음 3개만 상세 로깅
                print(f"[DEBUG] 조회수 미제공 ({post_type_indicators[0]}): {url}")
                print(f"        계정: {account_name}")
                print(f"        가능한 조회수 필드: {non_none_fields or 'NONE'}")
                print(f"        모든 필드 키: {list(item.keys())}\n")

        # 삭제/비공개 감지 — Apify가 not_found(게시물 없음)로 응답한 경우. (자동 특이사항 태깅용)
        deleted = (item.get("error") == "not_found") or ("does not exist" in str(item.get("errorDescription") or "").lower())

        result.append({
            "url": url,
            "play_count": play_count,
            "play_count_source": play_count_source,
            "likes_count": _coalesce_metric(item.get("likesCount"), item.get("likes")),
            "comments_count": _coalesce_metric(item.get("commentsCount"), item.get("comments")),
            "posted_at": posted_at,
            "account_name": account_name,
            "owner_username": owner_username,
            "content_summary": (item.get("caption") or "")[:300] or None,
            "deleted": deleted,
        })

    return result


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        import traceback
        print(f"\n❌ [ERROR] 모니터링 실패!")
        print(f"오류: {str(e)}")
        print(f"\n스택 트레이스:")
        traceback.print_exc()
        exit(1)
