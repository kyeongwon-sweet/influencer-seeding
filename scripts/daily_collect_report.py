# -*- coding: utf-8 -*-
"""
자정 수집 요약 → 인지봇(injibot) → Slack C0B659HEYDV (결정론적).
SKILL.md 형식을 코드로 고정 — 예약 실행 Claude가 형식/숫자를 흔들지 못하게 함.

사용:
  PYTHONUTF8=1 python report.py            # dry-run (계산만 출력, 발송 안 함)
  PYTHONUTF8=1 python report.py --send      # 실제 발송(본문 + 실패 스레드)
  PYTHONUTF8=1 python report.py --date 2026-07-21 --send   # 특정 측정일로

배너 = channel_type에 '배너' 포함 → 격일 수집이라 값 없음이 정상 → 확보율에서 제외.
값 있음 = play_count 또는 reach_count가 not null.
"""
import sys, os, json, urllib.request, urllib.error, datetime

CHANNEL = "C0B659HEYDV"
ENV_PATHS = [
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local",
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\scripts\.env",
]

def load_env():
    # os.environ 우선(GHA 시크릿) → 없으면 로컬 .env 파일(예약작업)
    env = dict(os.environ)
    for p in ENV_PATHS:
        if not os.path.exists(p):
            continue
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip(); v = v.strip().strip('"').strip("'")
            if k not in env:
                env[k] = v
    return env

def kst_now():
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)

def parse_iso(s):
    # supabase created_at like 2026-07-22T02:14:03.123+00:00 (UTC)
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(s)
    except Exception:
        try:
            return datetime.datetime.fromisoformat(s[:19] + "+00:00")
        except Exception:
            return None

def main():
    args = sys.argv[1:]
    do_send = "--send" in args
    date_override = None
    if "--date" in args:
        date_override = args[args.index("--date") + 1]

    env = load_env()
    SUPA = env.get("NEXT_PUBLIC_SUPABASE_URL") or env.get("SUPABASE_URL")
    KEY = env.get("SUPABASE_SERVICE_ROLE_KEY")
    TOK = env.get("INJIBOT_SLACK_TOKEN")
    if not (SUPA and KEY):
        print("ERROR: Supabase 환경변수 없음"); return 1

    H = {"apikey": KEY, "Authorization": "Bearer " + KEY}
    def get(path):
        req = urllib.request.Request(SUPA + path, headers=H)
        return json.load(urllib.request.urlopen(req, timeout=30))

    now = kst_now()
    today = now.date().isoformat()
    yday = date_override or (now.date() - datetime.timedelta(days=1)).isoformat()

    # 전체 게시물 메타
    posts = []; frm = 0
    while True:
        pg = get("/rest/v1/sponsored_posts?select=id,account_name,channel_type,url&limit=1000&offset=%d" % frm)
        posts += pg
        if len(pg) < 1000: break
        frm += 1000
    pmap = {p["id"]: p for p in posts}

    # 측정일 스탯
    rows = []; frm = 0
    while True:
        pg = get("/rest/v1/post_daily_stats?select=post_id,play_count,reach_count,created_at&measured_at=eq.%s&limit=1000&offset=%d" % (yday, frm))
        rows += pg
        if len(pg) < 1000: break
        frm += 1000

    nb_tot = nb_val = b_tot = 0
    failnb = []
    new_times = []
    cutoff = now - datetime.timedelta(hours=20)  # 수집 사이클(자정~새벽) 포착
    for r in rows:
        p = pmap.get(r["post_id"]) or {}
        ct = p.get("channel_type") or ""
        is_banner = "배너" in ct
        has_val = (r.get("play_count") is not None) or (r.get("reach_count") is not None)
        ca = parse_iso(r.get("created_at"))
        if ca is not None and ca.tzinfo is not None:
            ca_kst = ca.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
            if ca_kst >= cutoff:
                new_times.append(ca_kst)
        if is_banner:
            b_tot += 1
        else:
            nb_tot += 1
            if has_val:
                nb_val += 1
            else:
                failnb.append({"account_name": p.get("account_name"), "channel_type": ct, "url": p.get("url")})

    P = round(100 * nb_val / nb_tot) if nb_tot else 0
    newN = len(new_times)
    first = min(new_times).strftime("%H:%M") if new_times else "--:--"
    success = newN >= 100

    if not success:
        note = "신규 적재 %d건뿐 — GHA 로그 확인" % newN
    elif failnb:
        note = "수집 실패 %d건(상세 스레드 참고)" % len(failnb)
    else:
        note = "없음"

    status_word = "성공" if success else "실패"
    status_icon = "✅ 성공" if success else "⚠️ 실패"

    body = (
        "📊 자정 수집 %s 알림 (%s)\n\n"
        "• %s  %s 수집\n"
        "• 측정 대상(배너 제외): %d건 중 값 확보 %d건(%d%%) · 미확보 %d건\n"
        "• 배너: %d건 (격일 수집, 확보율 제외)\n"
        "• 특이사항: %s"
    ) % (status_word, today, status_icon, first, nb_tot, nb_val, P, len(failnb), b_tot, note)

    thread = None
    if failnb:
        lines = ["⚠️ 수집 실패 상세 (%s 측정) — 배너 제외 %d건\n" % (yday, len(failnb))]
        for i, f in enumerate(failnb, 1):
            lines.append("%d. %s · %s\n   %s" % (i, f.get("account_name") or "계정명 미등록", f.get("channel_type") or "-", f.get("url") or "-"))
        thread = "\n".join(lines)

    print("===== 본문 =====")
    print(body)
    if thread:
        print("\n===== 실패 스레드 =====")
        print(thread)
    print("\n(measured_at=%s, 전체행 %d, newN=%d, send=%s)" % (yday, len(rows), newN, do_send))

    if not do_send:
        print("\n[dry-run] 발송 안 함. 실제 발송하려면 --send")
        return 0

    if not TOK:
        print("ERROR: INJIBOT_SLACK_TOKEN 없음 → 발송 스킵")
        return 1

    def post(payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "https://slack.com/api/chat.postMessage", data=data,
            headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json; charset=utf-8"})
        return json.load(urllib.request.urlopen(req, timeout=20))

    r1 = post({"channel": CHANNEL, "text": body})
    print("\n본문 발송:", {k: r1.get(k) for k in ("ok", "error", "ts")})
    if r1.get("ok") and thread:
        r2 = post({"channel": CHANNEL, "thread_ts": r1["ts"], "text": thread})
        print("스레드 발송:", {k: r2.get(k) for k in ("ok", "error", "ts")})
    return 0

if __name__ == "__main__":
    sys.exit(main())
