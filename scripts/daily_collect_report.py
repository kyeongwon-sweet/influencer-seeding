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
from channel_kind import is_banner_channel

CHANNEL = "C0B659HEYDV"
ENV_PATHS = [
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local",
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\scripts\.env",
]


def load_auto_end_watchdog(report_path, outcome="success"):
    """독립 자동종료 검사 결과를 Slack 리포트용으로 정규화한다."""
    if outcome and outcome != "success":
        return {
            "ok": False,
            "count": None,
            "line": "🚨 자동종료 워치독 검사 실패 — 종료 누락 여부를 확인할 수 없습니다.",
            "items": [],
        }
    try:
        with open(report_path, encoding="utf-8") as f:
            report = json.load(f)
        items = report.get("to_end") or []
        count = int((report.get("summary") or {}).get("to_end", len(items)))
    except Exception as exc:
        return {
            "ok": False,
            "count": None,
            "line": "🚨 자동종료 워치독 결과 없음 — 종료 누락 여부를 확인할 수 없습니다.",
            "items": [],
            "error": type(exc).__name__,
        }
    if count > 0:
        return {
            "ok": False,
            "count": count,
            "line": f"🚨 자동종료 누락 {count}건 — 일일 종료 작업 실패·지연 확인 필요",
            "items": items,
        }
    return {"ok": True, "count": 0, "line": "자동종료 누락 0건", "items": []}

COLLECT_WORKFLOW = "cron-daily-collect.yml"


def collection_ran_for_date(runs, target_date):
    """대상일 수집이 실제로 돌았는가. 순수 함수 — 테스트 대상.

    재발방지(2026-08-28 사고): 리포트가 수집보다 **먼저** 나가 "값 확보 24%·확인필요 319건"이라는
    오탐이 채널에 발송됐다(리포트 09:33 → 수집 09:35 시작·09:45 완료). GitHub 크론이 9시간 밀려
    수집이 리포트 슬롯(06:38·07:38·08:38)을 모두 지나 도착한 날이었다. 게다가 idempotency가
    "오늘 리포트 이미 있음"으로 이후 슬롯을 스킵해 **틀린 리포트가 그날의 최종본으로 고정**됐다.

    판정은 곁가지 특징(확보율이 낮다)이 아니라 **실제 상태**(수집 워크플로가 대상일로 성공했는가)로 한다.
    cron-daily-collect는 실행 시점 KST 날짜의 '어제'를 MONITORING_DATE로 쓰므로
    (`date -d 'yesterday'`), 대상일 D의 수집 = **KST 날짜 D+1에 생성된 성공 실행**이다.
    ⚠️ 'Decide collect'가 누락 0이라 수집을 건너뛴 성공 실행도 완료로 본다(채울 게 없던 것).

    runs: GitHub Actions API의 workflow_runs 형식 [{created_at, conclusion}, ...]
    """
    try:
        target = datetime.date.fromisoformat(str(target_date))
    except ValueError:
        return False
    want = (target + datetime.timedelta(days=1)).isoformat()
    for r in runs or []:
        if (r.get("conclusion") or "") != "success":
            continue
        ts = str(r.get("created_at") or "")
        try:
            created = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            continue
        if (created + datetime.timedelta(hours=9)).date().isoformat() == want:
            return True
    return False


def fetch_collect_runs(repo, token, limit=30):
    """수집 워크플로의 최근 실행 목록. 조회 실패는 None(=판정 불가)로 구분해 돌려준다."""
    url = (f"https://api.github.com/repos/{repo}/actions/workflows/"
           f"{COLLECT_WORKFLOW}/runs?per_page={limit}")
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "injibot-report",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8")).get("workflow_runs", [])
    except Exception as exc:
        print(f"[collect-gate] 수집 실행 조회 실패({type(exc).__name__}) → 판정 불가")
        return None


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
    force = "--force" in args   # 중복방지(idempotency) 무시하고 강제 발송(정정 재발송용)
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
        pg = get("/rest/v1/sponsored_posts?select=id,account_name,channel_type,url,notes,ended_at,posted_at,created_at,not_found_streak,review_requested_at&order=id.asc&limit=1000&offset=%d" % frm)
        posts += pg
        if len(pg) < 1000: break
        frm += 1000
    pmap = {p["id"]: p for p in posts}

    # 측정일 스탯
    rows = []; frm = 0
    while True:
        pg = get("/rest/v1/post_daily_stats?select=post_id,play_count,reach_count,created_at&measured_at=eq.%s&order=id.asc&limit=1000&offset=%d" % (yday, frm))
        rows += pg
        if len(pg) < 1000: break
        frm += 1000

    def is_ended(p):
        # 삭제/비공개(종료) 판정: notes 자동감지 플래그 또는 ended_at 설정
        n = (p.get("notes") or "")
        if p.get("ended_at"):
            return True
        return ("삭제" in n) or ("비공개" in n) or ("not_found" in n)

    b_tot = 0
    feed_cnt = 0                   # 피드/사진 — play_count 지표 자체가 없음(확보율 제외)
    internal_cnt = 0               # 위성/온드(내부채널) — 불규칙 수집이라 미측정 정상(확보율 제외)
    active_nb = val_nb = 0          # 종료 제외 활성 비배너 / 그중 값 확보
    ended_miss = []                # 종료(삭제/비공개)인데 그날 값 없음 — 정상, 참고만
    real_miss = []                 # 활성인데 값 없음 — 진짜 확인 필요
    new_times = []
    cutoff = now - datetime.timedelta(hours=20)  # 수집 사이클(자정~새벽) 포착
    for r in rows:
        p = pmap.get(r["post_id"]) or {}
        ct = p.get("channel_type") or ""
        has_val = (r.get("play_count") is not None) or (r.get("reach_count") is not None)
        ca = parse_iso(r.get("created_at"))
        if ca is not None and ca.tzinfo is not None:
            ca_kst = ca.astimezone(datetime.timezone(datetime.timedelta(hours=9)))
            if ca_kst >= cutoff:
                new_times.append(ca_kst)
        if is_banner_channel(ct, p.get("posted_at")):
            b_tot += 1
            continue
        if any(k in ct for k in ("피드", "사진", "이미지")):
            feed_cnt += 1            # 사진/피드 — 조회수 지표 없음, 확보율 제외
            continue
        if any(k in ct for k in ("위성채널", "온드미디어")):
            internal_cnt += 1        # 내부채널(위성/온드) — 캠페인 아님·불규칙 수집 → 미측정 정상(2026-07-15 사용자 지시, notify_status와 동일 규칙)
            continue
        item = {"account_name": p.get("account_name"), "channel_type": ct, "url": p.get("url")}
        if is_ended(p):
            if not has_val:
                ended_miss.append(item)     # 종료 게시물 — 값 없음이 정상
            continue                         # 확보율 분모에서 제외
        active_nb += 1
        if has_val:
            val_nb += 1
        else:
            real_miss.append(item)           # 활성인데 미수집 — 진짜 문제

    # ⚠️ 2026-08-03 사고: 위 루프는 '어제 측정행이 있는 게시물'만 순회한다. Apify가 not_found를 주면
    #    행 자체가 안 생기므로 그런 게시물은 확인필요에도, 확보율 분모에도 안 들어가 통째로 사라졌다
    #    (IG 접근불가 74건이 4일 연속 "364건 중 364건(100%) · 확인필요 0"으로 보고됨).
    #    → 행이 아예 없는 활성 게시물도 미수집으로 집계한다.
    measured_ids = {r["post_id"] for r in rows}

    # 최근 7일 자동/수기 이력 — '수기로만 관리되는 게시물'을 접근실패로 오분류하지 않기 위해.
    # (예: 이나(인스타) 미러링 글은 값이 전부 수기 입력이라 자동 측정행이 원래 없다)
    week_ago = (datetime.date.fromisoformat(yday) - datetime.timedelta(days=6)).isoformat()
    auto_ids, manual_ids = set(), set()
    frm = 0
    while True:
        pg = get("/rest/v1/post_daily_stats?select=post_id,manual&measured_at=gte.%s&measured_at=lte.%s&order=id.asc&limit=1000&offset=%d" % (week_ago, yday, frm))
        for r in pg:
            (manual_ids if r.get("manual") else auto_ids).add(r["post_id"])
        if len(pg) < 1000: break
        frm += 1000

    norow_miss = []
    manual_only = []
    for p in posts:
        if p["id"] in measured_ids:
            continue
        ct = p.get("channel_type") or ""
        if is_banner_channel(ct, p.get("posted_at")) or any(k in ct for k in ("피드", "사진", "이미지", "위성채널", "온드미디어")):
            continue                      # 위 루프와 동일한 제외 규칙(조회수 지표 없음)
        if is_ended(p):
            continue                      # 종료글은 값 없음이 정상
        posted = (p.get("posted_at") or "")[:10]
        created = (p.get("created_at") or "")[:10]
        if not posted or posted > yday:
            continue                      # 아직 게시 전 → 미측정이 정상
        if created > yday:
            continue                      # 어제 이후 등록분 → 어제 수집 대상이 아님
        if p["id"] not in auto_ids and p["id"] in manual_ids:
            manual_only.append(p)         # 수기 관리 글 — 자동 측정행이 없는 게 정상, 확보율 제외
            continue
        streak = p.get("not_found_streak") or 0
        active_nb += 1
        norow_miss.append({"account_name": p.get("account_name"), "channel_type": ct, "url": p.get("url"),
                           "reason": ("접근 실패 not_found %d일" % streak) if streak else "미수집(원인 미상)"})
    real_miss += norow_miss

    # IG 접근불가 검토대상: 3일 연속 not_found로 검토 플래그가 찍힌 미종료 게시물(배너 포함).
    # 상태 기반이라 이미 쌓인 백로그도 매일 다시 보인다(이벤트 알림은 한 번 놓치면 영영 안 보임).
    nf_review = [p for p in posts
                 if (p.get("not_found_streak") or 0) >= 3 and not p.get("ended_at")]

    P = round(100 * val_nb / active_nb) if active_nb else 0
    newN = len(new_times)
    # 대표 '수집 시각'은 대량 배치(정기 자정수집)를 반영해야 함. min은 소수의 당일 조기 측정
    # (그날 새로 추가된 게시물의 저녁 첫 측정 등)에 끌려가 자정 전 시각으로 오표기됨 → 중앙값 사용.
    first = sorted(new_times)[len(new_times) // 2].strftime("%H:%M") if new_times else "--:--"
    success = newN >= 100

    if not success:
        note = "신규 적재 %d건뿐 — GHA 로그 확인" % newN
    elif real_miss or nf_review:
        parts = []
        if real_miss:
            parts.append("확인필요(미수집) %d건" % len(real_miss))
        if nf_review:
            parts.append("IG 접근불가 검토대상 %d건" % len(nf_review))
        note = " · ".join(parts) + " — 상세 스레드 참고"
    else:
        note = "없음"

    status_word = "성공" if success else "실패"
    status_icon = "✅ 성공" if success else "⚠️ 실패"

    watchdog = load_auto_end_watchdog(
        env.get("AUTO_END_WATCHDOG_REPORT", "data/output/auto-end-watchdog.json"),
        env.get("AUTO_END_WATCHDOG_OUTCOME", "success"),
    )

    body = (
        "📊 자정 수집 %s 알림 (%s)\n\n"
        "• %s  %s 수집\n\n"
        "• *측정 대상*: %d건 중 값 확보 %d건(%d%%) · 확인필요 %d건\n"
        "• *측정 제외* (조회수 지표 없음): 위성/온드 %d · 배너 %d · 종료 %d · 피드 %d · 수기 %d\n"
        "    ◦ IG 접근불가(3일↑ not_found·미종료): %d건\n"
        "• *특이사항*: %s\n"
        "    ◦ %s"
    ) % (status_word, today, status_icon, first, active_nb, val_nb, P, len(real_miss), internal_cnt, b_tot, len(ended_miss), feed_cnt, len(manual_only), len(nf_review), note, watchdog["line"])

    thread = None
    sections = []
    if watchdog.get("count"):
        lines = ["🚨 자동종료 누락 대상 %d건" % watchdog["count"]]
        for i, item in enumerate(watchdog.get("items", [])[:30], 1):
            lines.append("%d. %s · %s · 게시 %s · %s일 경과\n   %s" % (
                i,
                item.get("account_name") or "계정명 미등록",
                item.get("channel_type") or "-",
                item.get("posted_at") or "-",
                item.get("age_days") if item.get("age_days") is not None else "?",
                item.get("url") or "-",
            ))
        if watchdog["count"] > 30:
            lines.append("... 외 %d건" % (watchdog["count"] - 30))
        sections.append("\n".join(lines))
    if real_miss:
        lines = ["⚠️ 확인필요 — 활성 게시물인데 조회수 미수집 (%s 측정) %d건\n" % (yday, len(real_miss))]
        for i, f in enumerate(real_miss, 1):
            tail = "  [%s]" % f["reason"] if f.get("reason") else ""
            lines.append("%d. %s · %s%s\n   %s" % (i, f.get("account_name") or "계정명 미등록", f.get("channel_type") or "-", tail, f.get("url") or "-"))
        sections.append("\n".join(lines))
    if nf_review:
        lines = ["🚨 IG 접근불가 검토대상 %d건 — 3일 이상 not_found. 자동 종료하지 않았습니다.\n"
                 "   삭제/비공개면 종료 처리, 아니면 URL 확인이 필요합니다. (누적 조회수는 마지막 실측에서 정지)\n" % len(nf_review)]
        for i, p in enumerate(sorted(nf_review, key=lambda x: -(x.get("not_found_streak") or 0))[:30], 1):
            lines.append("%d. %s · %s · %d일 연속\n   %s" % (
                i, p.get("account_name") or "계정명 미등록", p.get("channel_type") or "-",
                p.get("not_found_streak") or 0, p.get("url") or "-"))
        if len(nf_review) > 30:
            lines.append("... 외 %d건" % (len(nf_review) - 30))
        sections.append("\n".join(lines))
    if sections:
        thread = "\n\n".join(sections)

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

    # 재발방지(2026-08-28): 대상일 수집이 끝나기 전에는 발송하지 않는다. 자세한 배경은
    #   collection_ran_for_date() 주석 참고. 보류돼도 리포트가 사라지지 않도록
    #   cron-daily-collect가 수집 완료 후(리포트 첫 슬롯 이후일 때만) 이 워크플로를 dispatch한다.
    #   ⚠️ 조회 실패(판정 불가)는 **발송**한다 — '누락 < 중복' 원칙, idempotency와 동일 정책.
    #   --force(정정 재발송)는 게이트도 건너뛴다.
    gh_token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if do_send and not force and gh_token:
        repo = os.environ.get("GITHUB_REPOSITORY", "kyeongwon-sweet/influencer-seeding")
        runs = fetch_collect_runs(repo, gh_token)
        if runs is not None and not collection_ran_for_date(runs, yday):
            print(f"[collect-gate] {yday} 수집 성공 실행 없음 → 발송 보류"
                  " (수집 완료 후 cron-daily-collect가 다시 dispatch합니다)")
            return 0

    # 재발방지(2026-08-27): 리포트를 여러 시각(06:38·07:38·08:38 KST 크론)에 중복 트리거해도
    #   하루 1회만 발송. 같은 날 제목("자정 수집 … 알림 (today)")이 채널에 이미 있으면 생략.
    #   조회 실패(스코프/네트워크) 시엔 '누락 < 중복' 원칙으로 그대로 발송한다. --force면 무시.
    if not force:
        try:
            hreq = urllib.request.Request(
                "https://slack.com/api/conversations.history?channel=%s&limit=100" % CHANNEL,
                headers={"Authorization": "Bearer " + TOK})
            hist = json.load(urllib.request.urlopen(hreq, timeout=20))
            if hist.get("ok"):
                mark = "(%s)" % today
                if any(("자정 수집" in (m.get("text") or "")) and (mark in (m.get("text") or ""))
                       for m in hist.get("messages", [])):
                    print("[idempotency] 오늘(%s) 리포트 이미 채널에 있음 → 발송 생략" % today)
                    return 0
            else:
                print("[idempotency] history 조회 실패(%s) → 발송 진행(누락<중복)" % hist.get("error"))
        except Exception as e:
            print("[idempotency] 예외(%s) → 발송 진행" % e)

    r1 = post({"channel": CHANNEL, "text": body})
    print("\n본문 발송:", {k: r1.get(k) for k in ("ok", "error", "ts")})
    if r1.get("ok") and thread:
        r2 = post({"channel": CHANNEL, "thread_ts": r1["ts"], "text": thread})
        print("스레드 발송:", {k: r2.get(k) for k in ("ok", "error", "ts")})
    return 0

if __name__ == "__main__":
    sys.exit(main())
