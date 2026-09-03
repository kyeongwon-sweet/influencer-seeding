#!/usr/bin/env python3
"""조회수 교차오염 감사 — 다른 게시물의 값이 흘러들어와 고착된 행을 찾는다.

배경(2026-08-26~09-01 사고): 연동시트 교차오염으로 먹리니·먹또먹·이짓매거진의 값이
위성채널 행으로 흘러들어갔고, 수집기가 매일 그 값을 그대로 다시 써서 6일간 고착됐다.
정리 작업 뒤의 사후감사가 '알려진 값·날짜'만 확인해 `candidates=0`으로 닫는 바람에
전파분 4건(19행)을 놓쳤다. 지상 진실 확인: YouTube GBWxY0RlRqA 실제 1,558회인데
DB는 149,000 (96배).

그래서 값·날짜를 미리 알지 못해도 **패턴**으로 찾는다. 두 규칙 모두 실측으로 보정했다
(감으로 임계를 정하면 매일 오탐이 된다 — 2026-08-12~31 20일 전수 대조).

  Rule A  급등 후 동결 : 하루 만에 SPIKE_RATIO배·SPIKE_MIN_INCREASE 이상 뛴 뒤
          FREEZE_DAYS일 이상 완전 동결.
          실측 6건 중 오염 3건을 잡고 정상 바이럴 3건(Ufo__ORANGE·smile_miso_s2·
          moduhappy — 급등 후에도 계속 증가)은 걸러냈다. 오탐 0.
          ⚠️ '급등' 자체는 오염 신호가 아니다. 급등 **후 완전 동결**이 신호다.

  Rule B  값 충돌 : 같은 날 서로 다른 게시물이 **정확히 같은 값**을 갖고, 그 값이 자기
          이력 대비 이상(직전 없음 또는 3배 이상 점프)일 때.
          ⚠️ 값 충돌 단독은 못 쓴다 — 임계 50,000에서도 20일간 12건이 나온다(실측).
             라운드 값(100의 배수)은 사람이 반올림 입력해 우연히 겹치는 경우가 많아
             제외한다. 이 조건을 붙이면 11건 → 3종으로 줄고, 놓쳤던 썰박스 466,637을 잡는다.

읽기 전용(Supabase 조회 + Slack DM). DB·시트 쓰기 없음.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

if os.name == "nt" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NL = chr(10)

ENV_PATHS = [
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local",
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\scripts\.env",
]

LOOKBACK_DAYS = int(os.environ.get("CONTAMINATION_LOOKBACK_DAYS", "14"))
# Rule A
SPIKE_RATIO = int(os.environ.get("CONTAMINATION_SPIKE_RATIO", "3"))
SPIKE_MIN_PREV = int(os.environ.get("CONTAMINATION_MIN_PREV", "50"))
SPIKE_MIN_INCREASE = int(os.environ.get("CONTAMINATION_MIN_INCREASE", "20000"))
FREEZE_DAYS = int(os.environ.get("CONTAMINATION_FREEZE_DAYS", "3"))
# Rule B
COLLISION_MIN_VALUE = int(os.environ.get("CONTAMINATION_MIN_VALUE", "10000"))
COLLISION_JUMP_RATIO = int(os.environ.get("CONTAMINATION_JUMP_RATIO", "3"))
ROUND_UNIT = 100


def audit_dates_with_baseline(today: datetime.date, lookback_days: int):
    """Return one baseline day plus the actual audit window.

    Rule B needs the day immediately before the window. Without it, every post
    observed on the first audit day looks like it has no history and ordinary
    same-value crossings become false positives.
    """
    audit_days = [
        (today - datetime.timedelta(days=i)).isoformat()
        for i in range(lookback_days, 0, -1)
    ]
    baseline = (today - datetime.timedelta(days=lookback_days + 1)).isoformat()
    return [baseline] + audit_days, audit_days


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


def is_round_value(value: int, unit: int = ROUND_UNIT) -> bool:
    """사람이 반올림해 입력한 값인가. 라운드 값은 우연한 충돌이 잦아 Rule B에서 뺀다."""
    return unit > 0 and value % unit == 0


def detect_spike_freeze(
    series,
    spike_ratio=None,
    min_prev=None,
    min_increase=None,
    freeze_days=None,
):
    """Rule A — 급등 후 동결. 순수 함수 — 테스트 대상.

    series: [(date, value)] 날짜 오름차순. value가 None인 날은 측정 없음.
    반환: {"from_date","from_value","to_date","to_value","frozen_days"} 또는 None.
    급등 후에도 값이 계속 변하면(정상 바이럴) None을 돌려준다.
    """
    spike_ratio = SPIKE_RATIO if spike_ratio is None else spike_ratio
    min_prev = SPIKE_MIN_PREV if min_prev is None else min_prev
    min_increase = SPIKE_MIN_INCREASE if min_increase is None else min_increase
    freeze_days = FREEZE_DAYS if freeze_days is None else freeze_days
    points = [(d, v) for d, v in series if isinstance(v, int)]
    for i in range(1, len(points)):
        prev_d, prev_v = points[i - 1]
        cur_d, cur_v = points[i]
        if (prev_v < min_prev or cur_v < prev_v * spike_ratio
                or cur_v - prev_v < min_increase):
            continue
        tail = [v for _, v in points[i:]]
        if len(tail) >= freeze_days and len(set(tail)) == 1:
            return {
                "from_date": prev_d, "from_value": prev_v,
                "to_date": cur_d, "to_value": cur_v,
                "frozen_days": len(tail),
            }
        return None      # 급등했지만 이후 변동 있음 = 정상 바이럴
    return None


def detect_value_collisions(day_values, prev_by_post, min_value=None,
                            jump_ratio=None, round_unit=ROUND_UNIT):
    """Rule B — 같은 날 서로 다른 게시물의 정확한 값 충돌. 순수 함수 — 테스트 대상.

    day_values: {post_id: value} 그 날짜의 값
    prev_by_post: {post_id: 직전 유효값 or None}
    반환: [{"post_id","value","prev","others"}] — 자기 이력 대비 이상한 쪽만.
    """
    min_value = COLLISION_MIN_VALUE if min_value is None else min_value
    jump_ratio = COLLISION_JUMP_RATIO if jump_ratio is None else jump_ratio
    buckets: dict[int, list[str]] = {}
    for pid, value in day_values.items():
        if isinstance(value, int) and value >= min_value and not is_round_value(value, round_unit):
            buckets.setdefault(value, []).append(pid)

    out = []
    for value, pids in buckets.items():
        if len(pids) < 2:
            continue
        for pid in pids:
            prev = prev_by_post.get(pid)
            anomalous = prev is None or (prev > 0 and value >= prev * jump_ratio)
            if anomalous:
                out.append({
                    "post_id": pid, "value": value, "prev": prev,
                    "others": [x for x in pids if x != pid],
                })
    return out


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


def format_report(findings, today) -> str:
    lines = ["🔴 [조회수 교차오염 의심] " + str(today) + " 기준 " + str(len(findings)) + "건"]
    for f in findings:
        lines.append("• *" + f["account"] + "* [" + str(f["channel_type"]) + "] — " + f["reason"])
        lines.append("    " + str(f["url"]))
    lines.append("")
    lines.append("다른 게시물의 값이 흘러들어왔을 수 있습니다. 플랫폼 실물 조회수와 대조하세요.")
    lines.append("⚠️ 급등 자체는 정상 바이럴일 수 있습니다 — 급등 후 완전 동결만 의심 대상입니다.")
    return NL.join(lines)


def notify(text, env):
    token = env.get("INJIBOT_SLACK_TOKEN") or env.get("SLACK_BOT_TOKEN")
    target = env.get("STATUS_USER") or "U0B2Y0ZC8QZ"
    if not token:
        print("[contamination] Slack 토큰 없음 — 콘솔 출력만")
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
        print("[contamination] Slack 실패: " + str(resp.get("error")))


def main() -> int:
    do_send = "--send" in sys.argv[1:]
    env = load_env()
    url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        print("[contamination] Supabase 환경변수 없음")
        return 1

    now_kst = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    today = now_kst.date()
    query_days, days = audit_dates_with_baseline(today, LOOKBACK_DAYS)

    posts = _fetch(url, key, "sponsored_posts", {
        "select": "id,account_name,channel_type,url,posted_at,ended_at", "order": "id.asc"})
    by_id = {p["id"]: p for p in posts}
    by_day: dict[str, dict] = {}
    for day in query_days:
        by_day[day] = {r["post_id"]: r.get("play_count") for r in _fetch(
            url, key, "post_daily_stats",
            {"select": "post_id,play_count", "measured_at": "eq." + day, "order": "id.asc"})}
    print("[contamination] 게시물 " + str(len(posts)) + "건 · 기간 "
          + days[0] + "~" + days[-1])

    findings: dict[str, dict] = {}

    # Rule A — 급등 후 동결
    for pid, post in by_id.items():
        if post.get("ended_at"):
            continue
        hit = detect_spike_freeze([(d, by_day[d].get(pid)) for d in days])
        if not hit:
            continue
        findings[pid] = {
            "account": post.get("account_name") or "?",
            "channel_type": post.get("channel_type"),
            "url": post.get("url"),
            "reason": ("급등 후 동결 — " + hit["from_date"][5:] + " "
                       + format(hit["from_value"], ",") + " → " + hit["to_date"][5:] + " "
                       + format(hit["to_value"], ",") + " ("
                       + str(round(hit["to_value"] / max(hit["from_value"], 1))) + "배) 이후 "
                       + str(hit["frozen_days"]) + "일 동일값"),
        }

    # Rule B — 값 충돌
    baseline_day = query_days[0]
    prev_by_post: dict[str, int] = {
        pid: value for pid, value in by_day[baseline_day].items()
        if isinstance(value, int)
    }
    for day in days:
        collisions = detect_value_collisions(by_day[day], prev_by_post)
        for c in collisions:
            post = by_id.get(c["post_id"])
            if not post or post.get("ended_at") or c["post_id"] in findings:
                continue
            others = ", ".join((by_id.get(o) or {}).get("account_name") or "?"
                               for o in c["others"])
            findings[c["post_id"]] = {
                "account": post.get("account_name") or "?",
                "channel_type": post.get("channel_type"),
                "url": post.get("url"),
                "reason": ("값 충돌 — " + day[5:] + " " + format(c["value"], ",")
                           + " (직전 " + (format(c["prev"], ",") if c["prev"] else "없음")
                           + ") 를 [" + others + "] 도 같은 값으로 보유"),
            }
        for pid, value in by_day[day].items():
            if isinstance(value, int):
                prev_by_post[pid] = value

    if not findings:
        print("[contamination] ✅ 의심 0건")
        return 0
    text = format_report(list(findings.values()), days[-1])
    print(text)
    if do_send:
        notify(text, env)
    else:
        print("")
        print("[dry-run] 발송 안 함. 실제 발송은 --send")
    return 0


if __name__ == "__main__":
    sys.exit(main())
