#!/usr/bin/env python3
"""역행(누적 지표 감소) 감지 워치독 — DB 기준으로 매일 검사해 Slack DM으로 알린다.

배경(2026-08-06): 시트 유효성 검사(날짜열 단조증가)가 행 삽입/삭제로 파편화·#REF!가 되어
오탐/미탐이 반복됐다. 단조(역행) 검사를 **시트 수식에서 DB 워치독으로 이관**한다.
DB는 편집과 무관하게 안정적이고, 이미 배너 reach 정리 때 쓴 역행 로직을 그대로 쓴다.

역행 = 누적 지표(배너는 reach_count, 그 외는 play_count)가 **그 게시물의 이전 최댓값보다
낮아진 것**(누적이라 불가능 = 확실한 오류). 스냅샷 복붙·수집 글리치·오배정의 시그니처.

cry-wolf 방지(2026-08-05 교훈):
  - 삭제 신호(0/null)는 제외(게시물 비공개/삭제는 별도 태깅 대상).
  - 미세 감소(스크래퍼 노이즈)는 제외 — 이전 peak 대비 THRESHOLD(기본 5%) 이상 하락만.
  - **알림은 최근 RECENT_DAYS(기본 2일) 측정분만**(오늘·어제 새로 생긴 역행 = 조치 대상).
    전체 이력 역행 수는 참고로만 로그. → 평소엔 0건이라 알림이 안 뜬다(조용한 정상).

읽기 전용(Supabase 조회 + Slack 발송). 의존성 없음(stdlib).
"""

from __future__ import annotations

from channel_kind import is_banner_channel

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

THRESHOLD = float(os.environ.get("REVERSE_THRESHOLD", "0.05"))  # 이전 peak 대비 하락 비율 하한
RECENT_DAYS = int(os.environ.get("REVERSE_RECENT_DAYS", "2"))    # 알림 대상 최근 일수


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
        rows.sort(key=lambda r: str(r["measured_at"]))
        prev = None  # 직전(마지막 유효) 측정값. 규칙: 누적은 '전날보다' 크거나 같아야(day-over-day).
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
                    "drop_ratio": round((prev - v) / prev, 3),
                })
            prev = v  # 하락 이벤트 후엔 그 값이 새 기준(스파이크가 영구 오탐을 내지 않게)
    return out


def build_alert(reverses: list[dict], recent_days: int, today: datetime) -> str | None:
    """최근 recent_days 내 역행이 있으면 Slack 메시지 문자열, 없으면 None. 순수 함수 — 테스트 대상."""
    cutoff = (today.date() - timedelta(days=recent_days)).isoformat()
    recent = [r for r in reverses if r["date"] >= cutoff]
    if not recent:
        return None
    recent.sort(key=lambda r: r["drop_ratio"], reverse=True)
    lines = [
        f"🔴 [역행 감지 워치독] 최근 {recent_days}일 내 누적 지표 역행 {len(recent)}건 "
        f"(전체 이력 {len(reverses)}건)",
        "누적(조회수/도달수)이 전날보다 떨어진 게시물 — 수집 글리치·복붙·오배정 의심.",
    ]
    for r in recent[:15]:
        lines.append(
            f"• {r['date']} {r['account_name'][:16]} {r['metric']} "
            f"{r['value']:,} (전날 {r['prev']:,}, -{int(r['drop_ratio']*100)}%) {r['url']}"
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

    posts_rows = _sb_get(url, key, "sponsored_posts?select=id,url,account_name,channel_type,posted_at")
    posts = {p["id"]: p for p in posts_rows}
    stats = _sb_get(url, key, "post_daily_stats?select=post_id,measured_at,play_count,reach_count")

    reverses = detect_reverses(stats, posts, THRESHOLD)
    now = datetime.now(timezone.utc) + timedelta(hours=9)  # KST
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
