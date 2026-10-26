#!/usr/bin/env python3
"""역행(누적 지표 감소) 감지 워치독 — DB 기준으로 매일 검사해 Slack DM으로 알린다.

배경(2026-08-06): 시트 유효성 검사(날짜열 단조증가)가 행 삽입/삭제로 파편화·#REF!가 되어
오탐/미탐이 반복됐다. 단조(역행) 검사를 **시트 수식에서 DB 워치독으로 이관**한다.
DB는 편집과 무관하게 안정적이고, 이미 배너 reach 정리 때 쓴 역행 로직을 그대로 쓴다.

역행 = 누적 지표(배너는 reach_count, 그 외는 play_count)가 **그 게시물의 직전 유효값보다
낮아진 것**(누적이라 불가능 = 확실한 오류). 스냅샷 복붙·수집 글리치·오배정의 시그니처.

cry-wolf 방지(2026-08-05 교훈):
  - 삭제 신호(0/null)는 제외(게시물 비공개/삭제는 별도 태깅 대상).
  - 미세 감소(스크래퍼 노이즈)는 제외 — 직전 유효값 대비 THRESHOLD(기본 5%) 이상 하락만.
  - **알림은 최근 RECENT_DAYS(기본 2일) 측정분만**(오늘·어제 새로 생긴 역행 = 조치 대상).
    전체 이력 역행 수는 참고로만 로그. → 평소엔 0건이라 알림이 안 뜬다(조용한 정상).

읽기 전용(Supabase 조회 + Slack 발송). 의존성 없음(stdlib).
"""

from __future__ import annotations

from channel_kind import is_banner_channel
from kst_dates import kst_now

import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

THRESHOLD = float(os.environ.get("REVERSE_THRESHOLD", "0.05"))  # 직전 유효값 대비 하락 비율 하한
RECENT_DAYS = int(os.environ.get("REVERSE_RECENT_DAYS", "2"))    # 알림 대상 최근 일수
MODE_ENV = "REVERSE_WATCHDOG_MODE"
VALID_MODES = {"legacy", "shadow", "optimized"}
RPC_NAME = "monitoring_reverse_events_v1"


def detect_reverses(stats: list[dict], posts: dict[str, dict], threshold: float) -> list[dict]:
    """게시물별 누적 지표의 역행을 검출한다. 순수 함수 — 테스트 대상.

    stats: [{post_id, measured_at, play_count, reach_count}] (measured_at ASC 정렬 불필요)
    posts: {post_id: {url, account_name, channel_type}}
    반환: [{post_id, url, account_name, date, metric, value, peak, drop_ratio, kind}]
    """
    by_post: dict[str, list[dict]] = {}
    for s in stats:
        by_post.setdefault(s["post_id"], []).append(s)

    out: list[dict] = []
    for pid, rows in by_post.items():
        p = posts.get(pid) or {}
        is_banner = is_banner_channel(p.get("channel_type"), p.get("posted_at"))
        metric = "reach_count" if is_banner else "play_count"
        # Same-date rows are rare but possible in legacy data. Date-only sorting
        # leaves their order dependent on pagination input, so a later correction
        # can be compared in the wrong direction. Use the write order as a stable
        # tie-breaker whenever the API returns it.
        rows.sort(key=lambda r: (
            str(r.get("measured_at") or ""),
            str(r.get("created_at") or ""),
            str(r.get("id") or ""),
        ))
        latest_by_date = {}
        for row in rows:
            latest_by_date[str(row.get("measured_at") or "")[:10]] = row
        rows = [latest_by_date[day] for day in sorted(latest_by_date)]
        prev = None  # 직전(마지막 유효) 측정값. 규칙: 누적은 '전날보다' 크거나 같아야(day-over-day).
        prev_date = None
        for r in rows:
            v = r.get(metric)
            if v is None or v <= 0:  # 삭제/미측정 제외(0·null은 역행 아님, prev도 갱신 안 함)
                continue
            if prev is not None and v < prev and (prev - v) / prev >= threshold:
                out.append({
                    "post_id": pid,
                    "url": p.get("url") or "(URL 없음)",
                    "account_name": p.get("account_name") or "",
                    "date": str(r["measured_at"])[:10],
                    "metric": "도달수" if is_banner else "조회수",
                    "value": v,
                    "prev": prev,
                    "prev_date": prev_date,
                    "suspect_value": prev,
                    "suspect_date": prev_date,
                    "drop_ratio": round((prev - v) / prev, 3),
                })
            prev = v  # 하락 이벤트 후엔 그 값이 새 기준(스파이크가 영구 오탐을 내지 않게)
            prev_date = str(r["measured_at"])[:10]
    return out


def _stat_identity(row: dict) -> tuple:
    """Stable identity used to compare full-history and recent-window scans."""
    if row.get("id"):
        return ("id", str(row["id"]))
    return (
        "legacy",
        str(row.get("post_id") or ""),
        str(row.get("measured_at") or ""),
        row.get("play_count"),
        row.get("reach_count"),
    )


def _reverse_identity(row: dict) -> tuple:
    return (
        row.get("post_id"),
        row.get("date"),
        row.get("metric"),
        row.get("value"),
        row.get("prev"),
    )


def merge_reverse_events(*groups: list[dict]) -> list[dict]:
    """Union detector outputs without double-alerting the same transition."""
    merged = {}
    for group in groups:
        for row in group:
            merged.setdefault(_reverse_identity(row), row)
    return list(merged.values())


def resolve_mode(raw: str | None) -> str:
    """Rollout mode. Unknown values fail safely to the proven legacy scan."""
    mode = str(raw or "legacy").strip().lower()
    if mode in VALID_MODES:
        return mode
    print(f"[reverse-watchdog] [WARN] {MODE_ENV}={raw!r} 무효 — legacy로 폴백")
    return "legacy"


def recent_scan_start(recent_days: int, today: datetime) -> str:
    """Include one comparison day before the alert window."""
    return (today.date() - timedelta(days=recent_days + 1)).isoformat()


def build_alert(reverses: list[dict], recent_days: int, today: datetime) -> str | None:
    """최근 recent_days 내 역행이 있으면 Slack 메시지 문자열, 없으면 None. 순수 함수 — 테스트 대상."""
    cutoff = (today.date() - timedelta(days=recent_days)).isoformat()
    recent = [r for r in reverses if r["date"] >= cutoff]
    if not recent:
        return None
    recent.sort(key=lambda r: r["drop_ratio"], reverse=True)
    lines = [
        f"🚨 [누적 감소·직전 고값 오독 감사] 최근 {recent_days}일 내 {len(recent)}건 "
        f"(전체 이력 {len(reverses)}건)",
        "누적 지표가 하락해 직전 고값과 현재값이 서로 모순됩니다. 값을 자동 수정하지 않았으니 실물 확인 후 시트+DB를 함께 정정하세요.",
    ]
    for r in recent[:15]:
        lines.append(
            f"• {r['account_name'][:16]} {r['metric']} "
            f"{r.get('prev_date') or '?'} {r['prev']:,} → {r['date']} {r['value']:,} "
            f"(-{int(r['drop_ratio']*100)}%) {r['url']}"
        )
    if len(recent) > 15:
        lines.append(f"…외 {len(recent) - 15}건")
    return "\n".join(lines)


# ---- I/O (stdlib) ----

def _sb_get(url: str, key: str, path: str) -> list[dict]:
    out: list[dict] = []
    off = 0
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/{path}&order=id.asc&limit=1000&offset={off}",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            chunk = json.loads(res.read().decode("utf-8"))
        out += chunk
        if len(chunk) < 1000:
            break
        off += 1000
    return out


def _sb_rpc(url: str, key: str, function: str, payload: dict) -> object:
    """Call a PostgREST RPC once. Optimized RPCs return one JSON bundle row."""
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/{function}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode("utf-8"))


def _positive_integer(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be numeric")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric <= 0 or not numeric.is_integer():
        raise ValueError(f"{field} must be a positive integer")
    return int(numeric)


def _iso_date(value: object, field: str) -> str:
    text = str(value or "")
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{field} must be YYYY-MM-DD") from exc
    if parsed.strftime("%Y-%m-%d") != text:
        raise ValueError(f"{field} must be YYYY-MM-DD")
    return text


def decode_reverse_event_bundle(payload: object, threshold: float) -> list[dict]:
    """Validate the single-row RPC contract and rebuild the exact legacy shape.

    Validation is deliberately fail-closed: optimized/shadow callers fall back
    to the legacy scan rather than accepting a partial or malformed event list.
    drop_ratio is recomputed with Python's round(), preserving alert parity at
    rounding boundaries instead of trusting a database numeric representation.
    """
    if not isinstance(payload, list) or len(payload) != 1 or not isinstance(payload[0], dict):
        raise ValueError("RPC response must contain exactly one bundle row")
    raw_events = payload[0].get("events")
    if not isinstance(raw_events, list):
        raise ValueError("RPC bundle events must be a list")

    out: list[dict] = []
    identities: set[tuple] = set()
    for index, raw in enumerate(raw_events):
        if not isinstance(raw, dict):
            raise ValueError(f"events[{index}] must be an object")
        post_id = str(raw.get("post_id") or "")
        date = _iso_date(raw.get("date"), f"events[{index}].date")
        prev_date = _iso_date(raw.get("prev_date"), f"events[{index}].prev_date")
        metric = raw.get("metric")
        if not post_id:
            raise ValueError(f"events[{index}].post_id is empty")
        if prev_date >= date:
            raise ValueError(f"events[{index}] does not move forward by day")
        if metric not in {"조회수", "도달수"}:
            raise ValueError(f"events[{index}].metric is invalid")
        value = _positive_integer(raw.get("value"), f"events[{index}].value")
        prev = _positive_integer(raw.get("prev"), f"events[{index}].prev")
        if value >= prev:
            raise ValueError(f"events[{index}] is not a reverse")
        drop_ratio = round((prev - value) / prev, 3)
        # SQL applies the unrounded threshold. Recheck the unrounded ratio so an
        # under-threshold row can never enter optimized alerts through bad RPC data.
        if (prev - value) / prev < threshold:
            raise ValueError(f"events[{index}] is below threshold")
        row = {
            "post_id": post_id,
            "url": str(raw.get("url") or "(URL 없음)"),
            "account_name": str(raw.get("account_name") or ""),
            "date": date,
            "metric": metric,
            "value": value,
            "prev": prev,
            "prev_date": prev_date,
            "suspect_value": prev,
            "suspect_date": prev_date,
            "drop_ratio": drop_ratio,
        }
        identity = _reverse_identity(row)
        if identity in identities:
            raise ValueError(f"events[{index}] duplicates an earlier event")
        identities.add(identity)
        out.append(row)
    return out


def load_optimized_reverses(url: str, key: str, threshold: float) -> list[dict]:
    payload = _sb_rpc(url, key, RPC_NAME, {"p_threshold": threshold})
    return decode_reverse_event_bundle(payload, threshold)


def load_legacy_reverses(
    url: str,
    key: str,
    threshold: float,
    recent_days: int,
    now: datetime,
) -> list[dict]:
    """Existing full-history + direct recent-window scan, unchanged in meaning."""
    scan_start = recent_scan_start(recent_days, now)
    posts_rows = _sb_get(url, key, "sponsored_posts?select=id,url,account_name,channel_type,posted_at")
    posts = {p["id"]: p for p in posts_rows}
    select = "id,post_id,measured_at,play_count,reach_count,created_at"
    stats = _sb_get(url, key, f"post_daily_stats?select={select}")

    # A direct recent scan remains authoritative in legacy mode. It protects
    # against a missing page in the long offset-paginated history scan.
    recent_stats = _sb_get(
        url,
        key,
        f"post_daily_stats?select={select}&measured_at=gte.{scan_start}",
    )
    full_recent_ids = {
        _stat_identity(row)
        for row in stats
        if str(row.get("measured_at") or "")[:10] >= scan_start
    }
    direct_recent_ids = {_stat_identity(row) for row in recent_stats}
    if full_recent_ids != direct_recent_ids:
        print(
            "[reverse-watchdog] [WARN] 전수/최근창 입력 범위 불일치 — "
            f"전수내최근={len(full_recent_ids)}, 직접최근={len(direct_recent_ids)}, "
            f"전수누락={len(direct_recent_ids - full_recent_ids)}, "
            f"직접누락={len(full_recent_ids - direct_recent_ids)}"
        )
    else:
        print(
            "[reverse-watchdog] 입력 범위 확인 — "
            f"전수={len(stats)}, 최근창({scan_start}~)={len(recent_stats)}, 불일치=0"
        )

    full_reverses = detect_reverses(stats, posts, threshold)
    recent_reverses = detect_reverses(recent_stats, posts, threshold)
    return merge_reverse_events(full_reverses, recent_reverses)


def select_reverse_events(
    mode: str,
    url: str,
    key: str,
    threshold: float,
    recent_days: int,
    now: datetime,
) -> tuple[list[dict], str]:
    """Select rollout path; every optimized error falls back to legacy."""
    if mode == "legacy":
        return load_legacy_reverses(url, key, threshold, recent_days, now), "legacy"

    if mode == "optimized":
        try:
            events = load_optimized_reverses(url, key, threshold)
            print(f"[reverse-watchdog] mode=optimized events={len(events)}")
            return events, "optimized"
        # This is an optimization boundary, not a correctness boundary. Any RPC,
        # decoder, or unexpected optimized-path error must preserve the proven job.
        except Exception as exc:
            print(f"[reverse-watchdog] [WARN] optimized RPC 실패/무효 — legacy 폴백: {exc}")
            return load_legacy_reverses(url, key, threshold, recent_days, now), "optimized-fallback"

    # shadow always returns the proven legacy result. Both the complete event
    # list and rendered alert must match before optimized can be promoted.
    legacy = load_legacy_reverses(url, key, threshold, recent_days, now)
    try:
        optimized = load_optimized_reverses(url, key, threshold)
    except Exception as exc:
        print(f"[reverse-watchdog] [WARN] shadow RPC 실패/무효 — legacy 유지: {exc}")
        return legacy, "shadow-fallback"

    event_parity = optimized == legacy
    alert_parity = build_alert(optimized, recent_days, now) == build_alert(legacy, recent_days, now)
    if event_parity and alert_parity:
        print(f"[reverse-watchdog] shadow parity ok — events={len(legacy)}, alert=exact")
        return legacy, "shadow"
    print(
        "[reverse-watchdog] [WARN] shadow mismatch — legacy 유지: "
        f"events={event_parity}, alert={alert_parity}, "
        f"legacy_count={len(legacy)}, optimized_count={len(optimized)}"
    )
    return legacy, "shadow-mismatch"


def notify(text: str) -> None:
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("STATUS_USER") or os.environ.get("SLACK_CHANNEL")
    if not token or not channel:
        print("[reverse-watchdog] Slack 미설정 — 콘솔 출력만\n" + text)
        return
    body = json.dumps({"channel": channel, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            resp = json.loads(res.read().decode("utf-8"))
        if not resp.get("ok"):
            print(f"[reverse-watchdog] Slack 실패: {resp.get('error')}")
    except urllib.error.URLError as e:
        print(f"[reverse-watchdog] Slack 예외: {e}")


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    dry = os.environ.get("DRY_RUN") == "1"
    if not url or not key:
        print("[reverse-watchdog] SUPABASE_URL/SERVICE_ROLE_KEY 없음")
        return 1

    now = kst_now()
    requested_mode = resolve_mode(os.environ.get(MODE_ENV))
    reverses, effective_mode = select_reverse_events(
        requested_mode,
        url,
        key,
        THRESHOLD,
        RECENT_DAYS,
        now,
    )
    print(
        "[reverse-watchdog] rollout — "
        f"requested={requested_mode}, effective={effective_mode}, events={len(reverses)}"
    )
    text = build_alert(reverses, RECENT_DAYS, now)

    if text is None:
        print(f"[reverse-watchdog] ✅ 최근 {RECENT_DAYS}일 역행 0건 (전체 이력 {len(reverses)}건). 알림 없음.")
        return 0

    print(text)
    if not dry:
        notify(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
