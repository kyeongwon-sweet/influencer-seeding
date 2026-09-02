#!/usr/bin/env python
"""수집 사각(silent blind spot) 결과 워치독.

목적: 조회수/도달수 수집 파이프라인(daily collect + view-missing retry)이 **한 번도
건드리지 않아 stats 0행으로 조용히 남은** 활성 게시물을 매일 잡아 Slack으로 알린다.

배경(2026-09-01): 25.5_mag `/reel/DclKlzuJof6/`(조회수 104,120)가 늦게·틀린 날짜로
등록된 뒤 daily collect·retry 큐 양쪽에서 빠져 stats 0행으로 방치됐다. 재시도 큐 로직상
자격이 있었는데도(missing_same_day_row·retryable) 큐 산출물에 들지 않은 사각이었다.
개별 큐 로직의 버그를 좇는 대신, **결과(=아무 행도 없음)를 직접 감시**해 사람이 정정하게 한다.

판정(보수적, 오탐 최소):
  · 활성(ended_at NULL) + 조회수형 플랫폼(IG/YT/TikTok) URL
  · 게시 후 GRACE_DAYS일 이상 경과(갓 올라온 글 제외)
  · DB 등록 후 하루 이상 경과(오늘 막 등록돼 다음 수집을 기다리는 정상 신규 제외)
  · post_daily_stats 행이 **정확히 0개**(이미지·캐러셀도 수집되면 reach/likes 행이 생기므로
    0행은 "수집이 아예 안 닿음"을 의미)
  · 이미 알려진 수집불가는 제외: notes에 '수집 불가'/'수동추적 제외', not_found_streak>0,
    review_requested_at 있음(이들은 별도 알림/큐가 이미 담당)
  · 프로필형/shortcode 없는 IG URL은 원래 수집 대상이 아니므로 별도 표기만.

읽기 전용. DB·시트 변경 없음. --send 없으면 콘솔 출력만.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

GRACE_DAYS = int(os.getenv("VIEW_WATCHDOG_GRACE_DAYS", "2"))
# 삭제 검토요청(review_requested_at)이 뜬 지 이 일수 이상 지났는데 아직 활성이면
# '확정삭제 방치'로 별도 경고. not_found는 자동종료를 안 하고 사람 손만 기다리므로
# 사람이 놓치면 삭제글이 무한 활성으로 남는 사각 방지.
REVIEW_STALE_DAYS = int(os.getenv("VIEW_WATCHDOG_REVIEW_STALE_DAYS", "3"))
KST = timezone(timedelta(hours=9))


def _env() -> dict[str, str]:
    env = dict(os.environ)
    for path in (
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "web", ".env.local"),
    ):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


ENV = _env()
SUPABASE_URL = ENV.get("SUPABASE_URL") or ENV.get("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY")
SLACK_TOKEN = ENV.get("INJIBOT_SLACK_TOKEN")
SLACK_CHANNEL = ENV.get("VIEW_WATCHDOG_SLACK_CHANNEL", "C0B659HEYDV")  # #빙과_마케팅_스틱바p


def _headers() -> dict[str, str]:
    return {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}


def _get(path: str, count: bool = False):
    headers = _headers()
    if count:
        headers = {**headers, "Prefer": "count=exact", "Range": "0-0"}
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/" + path, headers=headers)
    resp = urllib.request.urlopen(req, timeout=60)
    if count:
        cr = resp.headers.get("Content-Range") or "0/0"
        return int(cr.split("/")[-1])
    return json.load(resp)


def _q(params: dict) -> str:
    return urllib.parse.urlencode(params, safe="*.")


def is_view_capable(url: str) -> bool:
    u = (url or "").lower()
    if any(h in u for h in ("threads.", "facebook.com", "naver.com", "kakao.com")):
        return False
    return any(h in u for h in ("instagram.com", "youtube.com", "youtu.be", "tiktok.com"))


def is_uncollectable_url(url: str) -> bool:
    """수집 대상이 될 수 없는 프로필형/식별자 없는 URL(데이터 입력 오류)."""
    u = (url or "").lower().rstrip("/")
    if "instagram.com" in u and not re.search(r"/(p|reel|reels|tv)/[a-z0-9_-]+", u):
        return True
    if ("youtube.com" in u or "youtu.be" in u) and not re.search(
        r"(shorts/|watch\?v=|youtu\.be/|/v/)[a-z0-9_-]+", u
    ):
        return True
    if "tiktok.com" in u and not re.search(r"/(video|photo)/\d+", u):
        return True
    return False


def fetch_active_posts() -> list[dict]:
    posts: list[dict] = []
    start = 0
    while True:
        chunk = _get(
            "sponsored_posts?"
            + _q(
                {
                    "select": "id,account_name,channel_type,posted_at,created_at,url,"
                    "notes,not_found_streak,review_requested_at",
                    "ended_at": "is.null",
                    "order": "id.asc",
                }
            )
            + f"&limit=1000&offset={start}"
        )
        posts.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    return posts


def build(today: date) -> dict:
    posted_cutoff = (today - timedelta(days=GRACE_DAYS)).isoformat()
    created_cutoff = (today - timedelta(days=1)).isoformat()
    review_cutoff = (today - timedelta(days=REVIEW_STALE_DAYS)).isoformat()
    posts = fetch_active_posts()

    flagged: list[dict] = []
    bad_url: list[dict] = []
    review_stale: list[dict] = []
    skipped_known = 0
    for p in posts:
        # 확정삭제 방치: 삭제 검토요청(review_requested_at)이 뜬 지 오래인데 아직 활성.
        # not_found 처리는 자동종료를 안 하므로(run_monitoring), 사람이 놓치면 삭제글이 무한 활성.
        rr = (p.get("review_requested_at") or "")[:10]
        if rr and rr <= review_cutoff:
            review_stale.append({
                "post_id": p["id"],
                "account_name": p.get("account_name"),
                "channel_type": p.get("channel_type"),
                "posted_at": (p.get("posted_at") or "")[:10],
                "review_requested_at": rr,
                "not_found_streak": p.get("not_found_streak") or 0,
                "url": p.get("url") or "",
            })
        url = p.get("url") or ""
        if not is_view_capable(url):
            continue
        posted = (p.get("posted_at") or "")[:10]
        created = (p.get("created_at") or "")[:10]
        if not posted or posted > posted_cutoff:
            continue  # 갓 올라온 글은 아직 수집 정상 대기
        if created and created > created_cutoff:
            continue  # 오늘 막 등록 → 다음 수집 대기(정상)
        notes = str(p.get("notes") or "")
        if (
            "수집 불가" in notes
            or "수동추적 제외" in notes
            or (p.get("not_found_streak") or 0) > 0
            or p.get("review_requested_at")
        ):
            skipped_known += 1
            continue  # 이미 별도 알림/큐가 담당하는 알려진 수집불가
        total = _get(
            "post_daily_stats?" + _q({"select": "post_id", "post_id": f"eq.{p['id']}"}),
            count=True,
        )
        if total != 0:
            continue
        row = {
            "post_id": p["id"],
            "account_name": p.get("account_name"),
            "channel_type": p.get("channel_type"),
            "posted_at": posted,
            "created_at": created,
            "url": url,
        }
        (bad_url if is_uncollectable_url(url) else flagged).append(row)

    return {
        "date": today.isoformat(),
        "grace_days": GRACE_DAYS,
        "review_stale_days": REVIEW_STALE_DAYS,
        "flagged_count": len(flagged),
        "bad_url_count": len(bad_url),
        "review_stale_count": len(review_stale),
        "skipped_known_uncollectable": skipped_known,
        "flagged": sorted(flagged, key=lambda r: r["posted_at"]),
        "bad_url": sorted(bad_url, key=lambda r: r["posted_at"]),
        "review_stale": sorted(review_stale, key=lambda r: r["review_requested_at"]),
    }


def slack_lines(result: dict) -> str:
    n = result["flagged_count"]
    parts = [
        f"🚨 *수집 사각 감지* — 활성인데 게시 {result['grace_days']}일+ 지나도 "
        f"stats 0행(한 번도 수집 안 됨) *{n}건*",
    ]
    for r in result["flagged"][:20]:
        parts.append(f"• {r['posted_at']} `{r['channel_type']}` {r['account_name']} — {r['url']}")
    if n > 20:
        parts.append(f"  …외 {n - 20}건")
    if result["bad_url_count"]:
        parts.append(
            f"\n⚠️ 식별자 없는(수집 불가능) URL {result['bad_url_count']}건 — 주소 정정 필요:"
        )
        for r in result["bad_url"][:10]:
            parts.append(f"• {r['posted_at']} {r['account_name']} — {r['url']}")
    if result.get("review_stale_count"):
        parts.append(
            f"\n🛑 삭제 검토요청 {result['review_stale_days']}일+ 지났는데 활성 방치 "
            f"{result['review_stale_count']}건 — 삭제 확인 후 종료 처리 필요:"
        )
        for r in result["review_stale"][:15]:
            parts.append(
                f"• 검토요청 {r['review_requested_at']} · nf{r['not_found_streak']} "
                f"`{r['channel_type']}` {r['account_name']} — {r['url']}"
            )
    return "\n".join(parts)


def send_slack(text: str) -> None:
    if not SLACK_TOKEN:
        print("[WARN] INJIBOT_SLACK_TOKEN 없음 — 발송 스킵")
        return
    data = json.dumps({"channel": SLACK_CHANNEL, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=data,
        headers={
            "Authorization": f"Bearer {SLACK_TOKEN}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    resp = json.load(urllib.request.urlopen(req, timeout=30))
    print("[SLACK]", "ok" if resp.get("ok") else f"FAIL {resp.get('error')}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now(KST).date().isoformat())
    parser.add_argument("--send", action="store_true", help="Slack으로 결과 발송")
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    result = build(date.fromisoformat(args.date))
    print("[VIEW_WATCHDOG]", json.dumps(result, ensure_ascii=False))
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    if result["flagged_count"] or result["bad_url_count"] or result["review_stale_count"]:
        text = slack_lines(result)
        print(text)
        if args.send:
            send_slack(text)
    else:
        print("✅ 수집 사각 없음")
    return 0


if __name__ == "__main__":
    sys.exit(main())
