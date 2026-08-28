#!/usr/bin/env python3
"""계정 단위 수집 전멸 감시 — '한 계정의 활성 게시물이 며칠 연속 100% 미적재'를 알린다.

재발방지(2026-08-28 사고): 유머박스(틱톡) 활성 56건이 08-19부터 9일 연속 0건이었는데
알림이 한 번도 없었고 사람이 눈으로 발견했다. 원인은 감시가 not_found에만 걸려 있던 것 —
틱톡 삭제/비공개가 수집기에서 collector_error(응답에 값 없음, null)로 떨어지면
not_found_streak가 0으로 남아 삭제 감지·자동종료·특이사항 자동기입 경로를 전부 비켜간다.
게다가 자정수집 리포트는 위성/온드를 '측정 제외'로 빼기 때문에 그 스코프로도 안 잡힌다.

그래서 사유(not_found/collector_error)에 의존하지 않고 결과만 본다:
행이 있으면 수집된 것, 없으면 안 된 것. 개별 게시물 실패는 흔하지만
계정 전체가 며칠씩 0%인 것은 정상이 아니다.

읽기 전용(Supabase 조회 + Slack DM). DB·시트 쓰기 없음.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

NL = chr(10)   # 이스케이프 사고 방지용 명시 개행

ENV_PATHS = [
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local",
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\scripts\.env",
]

# 임계값은 실측 백테스트로 정했다(감으로 정하면 매일 오탐이 된다).
# 2026-07-25~08-27(34일) 전 계정 백테스트: streak>=1에서도 알림 대상은 유머박스(틱톡)
# 단 하나였고 정확히 끊긴 날(08-19)부터 잡혔다. 오탐 0건이라 1일로 둔다 —
# 9일을 못 잡은 대가가 DM 한 통보다 훨씬 크다.
STREAK_DAYS = int(os.environ.get("ACCOUNT_WATCHDOG_STREAK", "1"))
MIN_POSTS = int(os.environ.get("ACCOUNT_WATCHDOG_MIN_POSTS", "3"))
LOOKBACK_DAYS = 40
# 미해결 상태에서 매일 반복하면 소음이 된다(유머박스는 9일 연속이었다).
# 첫 감지일 + 이후 7일마다만 알린다.
ALERT_EVERY_DAYS = 7
# 수집 자체가 전멸한 날엔 모든 계정이 0%가 된다. 그건 계정 문제가 아니라 수집 문제이므로
# 계정을 나열하지 않고 한 줄로 보고한다(수집 실패 자체는 notify_status가 담당).
GLOBAL_FAILURE_RATIO = 0.5


def load_env() -> dict:
    env = dict(os.environ)
    for path in ENV_PATHS:
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return env


def eligible_on(post: dict, day: str) -> bool:
    """그 날짜에 '수집돼야 했던' 게시물인가 — 게시 후이고 아직 종료 전."""
    posted = post.get("posted_at") or ""
    if not posted or posted > day:
        return False
    ended = post.get("ended_at") or ""
    if ended and ended[:10] < day:
        return False
    return True


def find_dead_accounts(posts, rows_by_day, days, streak_days=None, min_posts=None):
    """계정별 '최근 연속 0% 적재' 일수를 재고 임계 이상만 돌려준다. 순수 함수 — 테스트 대상.

    days: 최신순 날짜 리스트(오늘 제외 — 오늘 수집은 내일 새벽에 들어온다).
    rows_by_day: {날짜: set(post_id)} — 그 날짜에 post_daily_stats 행이 존재하는 post_id.
    """
    streak_days = STREAK_DAYS if streak_days is None else streak_days
    min_posts = MIN_POSTS if min_posts is None else min_posts
    by_acct: dict[str, list[dict]] = {}
    for post in posts:
        if post.get("ended_at"):
            continue
        by_acct.setdefault(post.get("account_name") or "(이름없음)", []).append(post)

    out = []
    for acct, items in by_acct.items():
        streak = 0
        first_dead = None
        last_alive = None
        for day in days:                        # 최신 → 과거
            elig = [p for p in items if eligible_on(p, day)]
            if len(elig) < min_posts:
                break                           # 표본 부족 구간이면 판정 중단
            have = sum(1 for p in elig if p["id"] in rows_by_day.get(day, ()))
            if have == 0:
                streak += 1
                first_dead = day
            else:
                last_alive = day
                break
        if streak >= streak_days:
            elig_now = [p for p in items if eligible_on(p, days[0])]
            out.append({
                "account": acct,
                "streak": streak,
                "posts": len(elig_now),
                "since": first_dead,
                "last_ok": last_alive,
                "sample_urls": [p.get("url") for p in elig_now[:3]],
            })
    out.sort(key=lambda x: (-x["streak"], -x["posts"]))
    return out


def should_alert(streak, threshold=None, every=None) -> bool:
    """첫 감지일과 이후 7일마다만 알린다. 순수 함수 — 테스트 대상.

    임계 미만은 알리지 않고, 임계를 처음 넘은 날 알린 뒤에는 7일 간격으로만 반복한다.
    (유머박스는 9일 연속이었다 — 매일 알리면 DM 9통이 되어 오히려 무시된다.)
    """
    threshold = STREAK_DAYS if threshold is None else threshold
    every = ALERT_EVERY_DAYS if every is None else every
    if streak < threshold:
        return False
    return (streak - threshold) % every == 0


def is_global_failure(dead_count, total_accounts, ratio=None) -> bool:
    """계정 문제가 아니라 수집 자체가 안 돈 날인가. 순수 함수 — 테스트 대상."""
    ratio = GLOBAL_FAILURE_RATIO if ratio is None else ratio
    if total_accounts <= 0:
        return False
    return dead_count / total_accounts >= ratio


def format_alert(dead, today) -> str:
    lines = ["🔴 [계정 단위 수집 전멸] " + str(today) + " 기준 " + str(len(dead)) + "개 계정"]
    for item in dead:
        lines.append(
            "• *" + item["account"] + "* — 활성 " + str(item["posts"]) + "건이 *"
            + str(item["streak"]) + "일 연속 0건* 적재 (마지막 정상 "
            + (item["last_ok"] or "기록 없음") + ", " + str(item["since"]) + "부터 끊김)"
        )
        for url in item["sample_urls"]:
            lines.append("    " + str(url))
    lines.append("")
    lines.append("계정 비공개·삭제라면 종료 처리 대상입니다. 살아 있으면 스크래퍼 문제입니다.")
    lines.append("⚠️ 사유가 not_found가 아니라 collector_error면 삭제 감지·자동종료가 동작하지 않습니다.")
    return NL.join(lines)


def _fetch(url, key, path, params):
    """Supabase offset 페이지네이션. order=id.asc 필수(경계 중복·누락 방지)."""
    rows, offset = [], 0
    while True:
        query = dict(params)
        query["limit"] = 1000
        query["offset"] = offset
        req = urllib.request.Request(
            url + "/rest/v1/" + path + "?" + urllib.parse.urlencode(query),
            headers={"apikey": key, "Authorization": "Bearer " + key})
        with urllib.request.urlopen(req, timeout=120) as res:
            page = json.loads(res.read().decode("utf-8"))
        rows += page
        if len(page) < 1000:
            return rows
        offset += 1000


def notify(text, env):
    token = env.get("INJIBOT_SLACK_TOKEN") or env.get("SLACK_BOT_TOKEN")
    target = env.get("STATUS_USER") or "U0B2Y0ZC8QZ"
    if not token:
        print("[account-watchdog] Slack 토큰 없음 — 콘솔 출력만")
        print(text)
        return
    body = json.dumps({"channel": target, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage", data=body,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=20) as res:
        resp = json.loads(res.read().decode("utf-8"))
    if not resp.get("ok"):
        print("[account-watchdog] Slack 실패: " + str(resp.get("error")))


def main() -> int:
    args = sys.argv[1:]
    do_send = "--send" in args
    backtest = "--backtest" in args
    env = load_env()
    url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        print("[account-watchdog] Supabase 환경변수 없음")
        return 1

    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    today = now_kst.date()
    # 오늘치는 내일 새벽에 들어오므로 '어제'부터 과거로 본다.
    days = [(today - datetime.timedelta(days=i)).isoformat()
            for i in range(1, LOOKBACK_DAYS + 1)]

    posts = _fetch(url, key, "sponsored_posts", {
        "select": "id,account_name,channel_type,url,posted_at,ended_at",
        "order": "id.asc"})
    stats = _fetch(url, key, "post_daily_stats", {
        "select": "post_id,measured_at",
        "measured_at": "gte." + days[-1],
        "order": "id.asc"})
    rows_by_day: dict[str, set] = {}
    for row in stats:
        rows_by_day.setdefault(str(row["measured_at"])[:10], set()).add(row["post_id"])
    print("[account-watchdog] 게시물 " + str(len(posts)) + "건 · 측정행 "
          + str(len(stats)) + "건 · 기준일 " + days[0])

    if backtest:
        print("")
        print("=== 백테스트: 임계값별 알림 대상 계정 수 ===")
        for streak in (1, 2, 3, 4, 5):
            for min_posts in (3, 5):
                dead = find_dead_accounts(posts, rows_by_day, days, streak, min_posts)
                names = ", ".join(d["account"] + "(" + str(d["streak"]) + "일)"
                                  for d in dead[:6])
                print("  streak>=" + str(streak) + " minPosts>=" + str(min_posts)
                      + ": " + str(len(dead)) + "개  " + names)
        return 0

    dead = find_dead_accounts(posts, rows_by_day, days)
    total_accounts = len({p.get("account_name") or "(이름없음)" for p in posts
                          if not p.get("ended_at") and eligible_on(p, days[0])})
    if is_global_failure(len(dead), total_accounts):
        text = NL.join([
            "🔴 [수집 전멸 의심] " + days[0] + " — 활성 계정 " + str(total_accounts)
            + "개 중 " + str(len(dead)) + "개가 0건 적재. 계정별 문제가 아니라 "
            + "*수집이 안 돌았을 가능성*이 큽니다.",
            "계정별 나열은 생략합니다. 수집 실행 여부를 먼저 확인하세요.",
        ])
        print(text)
        if do_send:
            notify(text, env)
        return 0

    dead = [d for d in dead if should_alert(d["streak"])]
    if not dead:
        print("[account-watchdog] ✅ 보고할 것 없음 (임계 " + str(STREAK_DAYS)
              + "일, " + str(ALERT_EVERY_DAYS) + "일 간격 재알림 규칙)")
        return 0
    text = format_alert(dead, days[0])
    print(text)
    if do_send:
        notify(text, env)
    else:
        print("")
        print("[dry-run] 발송 안 함. 실제 발송은 --send")
    return 0


if __name__ == "__main__":
    sys.exit(main())
