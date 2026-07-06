#!/usr/bin/env python3
# 협찬 데이터 수집 상태(정상/실패+사유) → 황경원 DM(여믄봇).
# cron-daily-collect.yml의 수집 직후 always() 단계에서 실행 — 수집 성공/실패 무관하게 발송.
import os
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from db import get_client

SLACK_API = "https://slack.com/api/chat.postMessage"
# 발송 대상: SLACK_CHANNEL(채널/스레드 답글) 우선, 없으면 STATUS_USER(황경원 DM).
# SLACK_THREAD_TS 있으면 그 메시지의 '댓글(스레드 답글)'로 게시.


def _platform(url: str) -> str:
    u = (url or "").lower()
    if "instagram.com" in u: return "IG"
    if "youtube.com" in u or "youtu.be" in u: return "YT"
    if "tiktok.com" in u: return "틱톡"
    if "x.com" in u or "twitter.com" in u or "t.co/" in u: return "X"
    if "facebook.com" in u: return "페북"
    if "threads.com" in u or "threads.net" in u: return "스레드"
    if "kakao.com" in u: return "카카오"
    if "naver.com" in u: return "네이버"
    return "기타"


def _chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def _urlkey(u: str) -> str:
    # 같은 게시물을 가리키는 URL 변형(/reel/↔/p/, /<계정>/p/<code>, 끝슬래시 등)을 한 키로 접음.
    # IG shortcode는 대소문자 구분이라 원문에서 추출.
    u = (u or "").strip()
    m = re.search(r"instagram\.com/(?:[^/]+/)?(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)", u, re.I)
    if m:
        return "ig:" + m.group(1)
    v = re.sub(r"^https?://(?:www\.)?", "", u, flags=re.I).split("?")[0].split("#")[0].rstrip("/")
    host, _, path = v.partition("/")
    return (host.lower() + "/" + path) if path else host.lower()


def _canon_url(u: str) -> str:
    """web/lib/url-utils.ts normalizeUrl의 파이썬 이식 — DB URL이 이 표준형과 다르면
    다음 시트 동기화 때 onConflict 미스매치로 중복 삽입될 잠복 위험(2026-07-06 YT www 17건 재발 사례).
    로직 변경 시 반드시 TS 쪽과 함께 바꿀 것."""
    u = (u or "").strip()
    m = re.search(r"(?:instagram\.com|instagr\.am)/(?:[^/]+/)?(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)", u, re.I)
    if m:
        return f"https://www.instagram.com/p/{m.group(1)}/"
    hm = re.match(r"https?://([^/]+)(/[^?#]*)?(\?[^#]*)?", u, re.I)
    if not hm:
        return u
    host = hm.group(1).lower()
    path = hm.group(2) or "/"
    if host == "youtu.be" or host.endswith("youtube.com"):
        ms = re.search(r"/shorts/([A-Za-z0-9_-]{6,})", path)
        if ms:
            return f"https://www.youtube.com/shorts/{ms.group(1)}/"
        vid = None
        if host == "youtu.be":
            seg = [s for s in path.split("/") if s]
            vid = seg[0] if seg else None
        else:
            mp = re.search(r"/(?:embed|live|v)/([A-Za-z0-9_-]{6,})", path)
            if mp:
                vid = mp.group(1)
            elif path.rstrip("/") == "/watch":
                mv = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", hm.group(3) or "")
                vid = mv.group(1) if mv else None
        if vid:
            return f"https://www.youtube.com/watch?v={vid}"
    # 일반: 선행 www. 제거(m.blog.naver.com 등 유의미 서브도메인 보존) + // 축약 + trailing slash
    host = re.sub(r"^www\.", "", host)
    path = re.sub(r"/{2,}", "/", path)
    if not path.endswith("/"):
        path += "/"
    return f"https://{host}{path}"


def _integrity_lines(db, posts):
    # 데이터 정합성 특이 감시 — 증분 리포트를 왜곡하는 조용한 오염을 상태 댓글에서 바로 드러낸다.
    lines = []

    # 1) 같은 링크 중복 집계 (레거시 /reel/↔/p/ 중복 삽입 사고(2026-07-03, 275건) 재발 감시)
    groups = {}
    for p in posts:
        k = _urlkey(p.get("url"))
        if k:
            groups.setdefault(k, []).append(p)
    dups = {k: v for k, v in groups.items() if len(v) > 1}
    if dups:
        ex = " / ".join(f"{k.split(':')[-1].split('/')[-1]}({'·'.join((x.get('account_name') or '?') for x in v[:3])})"
                        for k, v in list(dups.items())[:4])
        line = f"같은 링크 중복 {len(dups)}그룹 — 증분 이중계산 위험: {ex}"
        if len(dups) > 4:
            line += f" … 외 {len(dups) - 4}그룹"
        lines.append(line)

    # 2) 게시일 이전 조회수 이력 (게시일 오기 또는 시트 백필 열 어긋남 신호)
    posted = {p["id"]: str(p["posted_at"])[:10] for p in posts if p.get("posted_at")}
    first = {}
    off = 0
    while True:
        res = db.table("post_daily_stats").select("post_id, measured_at").range(off, off + 999).execute()
        chunk = res.data or []
        for r in chunk:
            m = r["measured_at"]
            if r["post_id"] not in first or m < first[r["post_id"]]:
                first[r["post_id"]] = m
        if len(chunk) < 1000:
            break
        off += 1000
    name_of = {p["id"]: (p.get("account_name") or "?") for p in posts}
    early = sorted((pid for pid in posted if pid in first and first[pid] < posted[pid]),
                   key=lambda pid: first[pid])
    if early:
        ex = ", ".join(f"{name_of.get(pid, '?')}({posted[pid][5:]}게시·이력 {first[pid][5:]}~)" for pid in early[:4])
        line = f"게시일 이전 조회수 이력 {len(early)}건 — 게시일 오기/백필 어긋남 의심: {ex}"
        if len(early) > 4:
            line += f" … 외 {len(early) - 4}건"
        lines.append(line)

    # 3) URL 표준형 불일치 — 중복이 '생기기 전' 사전 감지(중복 감시 1)은 생긴 후에야 잡음).
    #    DB URL이 normalizeUrl 표준형과 다르면 다음 동기화 때 같은 게시물이 새 행으로 삽입된다.
    mism = [p for p in posts if (p.get("url") or "").strip() and _canon_url(p["url"]) != (p.get("url") or "").strip()]
    if mism:
        ex = ", ".join(f"{(p.get('account_name') or '?')}({(p.get('url') or '')[-24:]})" for p in mism[:4])
        line = f"URL 표준형 불일치 {len(mism)}건 — 다음 동기화 때 중복 삽입 위험(소급 정규화 필요): {ex}"
        if len(mism) > 4:
            line += f" … 외 {len(mism) - 4}건"
        lines.append(line)

    # 4) 부분수집 감지 — 특정일 실측(non-null play)수가 최근 기준선의 60% 미만이면 그날 증분이 실제보다 과소.
    #    (2026-07-03~05 주말: 350개 중 ~140개만 수집 → 증분 반토막, 성장이 월요일로 몰림. 재시도 강화의 백스톱.)
    from datetime import timedelta, datetime, timezone
    kst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    cutoff = (kst_today - timedelta(days=7)).isoformat()
    day_cnt = {}
    off = 0
    while True:
        res = db.table("post_daily_stats").select("measured_at, play_count").gte("measured_at", cutoff).range(off, off + 999).execute()
        chunk = res.data or []
        for r in chunk:
            if r["play_count"] is not None:
                day_cnt[r["measured_at"]] = day_cnt.get(r["measured_at"], 0) + 1
        if len(chunk) < 1000:
            break
        off += 1000
    # 오늘(KST)은 수집 중이라 제외하고 완료된 날만 판정. 기준선=중앙값(주말 저점·단일 결측에 안 끌림).
    done = {d: c for d, c in day_cnt.items() if d < kst_today.isoformat()}
    if len(done) >= 4:
        vals = sorted(done.values())
        median = vals[len(vals) // 2]
        low = sorted(d for d, c in done.items() if median > 0 and c < 0.6 * median)
        if low:
            ex = ", ".join(f"{d[5:]}({done[d]}/{median})" for d in low[:5])
            line = f"부분수집 감지 {len(low)}일 — 실측수가 기준선({median})의 60% 미만이라 그날 증분 과소(재수집 권장): {ex}"
            if len(low) > 5:
                line += f" … 외 {len(low) - 5}일"
            lines.append(line)
    return lines


def main():
    token = os.environ["SLACK_BOT_TOKEN"]
    target = os.getenv("MONITORING_DATE") or date.today().isoformat()
    outcome = (os.getenv("COLLECT_OUTCOME") or "").lower()  # success | failure | ""
    db = get_client()

    # 오늘 적재된 stats 집계
    rows, start = [], 0
    while True:
        res = db.table("post_daily_stats").select("post_id, play_count").eq("measured_at", target).range(start, start + 999).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    total = len(rows)
    with_play = sum(1 for r in rows if r.get("play_count") is not None)

    # 플랫폼별 건수
    pids = [r["post_id"] for r in rows]
    meta = {}
    for c in _chunks(pids, 100):
        res = db.table("sponsored_posts").select("id, url").in_("id", c).execute()
        for m in (res.data or []):
            meta[m["id"]] = m.get("url")
    by_plat = {}
    for r in rows:
        p = _platform(meta.get(r["post_id"]))
        by_plat[p] = by_plat.get(p, 0) + 1
    plat_str = " · ".join(f"{k} {v}" for k, v in sorted(by_plat.items(), key=lambda x: -x[1])) or "-"

    ok = (outcome == "success") and total > 0
    if os.getenv("ONLY_ON_FAILURE") == "1" and ok:
        # 정상 수집이면 발송 안 함(상태는 리포트 댓글로만). 실패일 때만 즉시 알림.
        print("[status] 정상 수집 → ONLY_ON_FAILURE 모드라 발송 생략")
        return
    if ok:
        text = (f"*✅ 협찬 데이터 정상 수집* ({target} KST)\n"
                f"총 {total:,}건 적재 · 조회수 {with_play:,}건\n"
                f"플랫폼: {plat_str}")
    else:
        reason = ""
        logf = os.getenv("COLLECT_LOG")
        if logf and os.path.exists(logf):
            try:
                tail = open(logf, encoding="utf-8", errors="replace").read().strip().splitlines()[-12:]
                reason = "\n".join(tail)
            except Exception:
                pass
        if not reason:
            reason = f"수집 단계 결과={outcome or '알수없음'}, 오늘 적재 {total}건"
        text = (f"*❌ 협찬 데이터 수집 실패/이상* ({target} KST)\n"
                f"오늘 적재: {total:,}건 · 조회수 {with_play:,}건\n"
                f"사유(수집 로그 끝부분):\n```{reason[:1500]}```")

    # 활성인데 오늘 미측정 게시물 점검 (수집 누락·잘못된 URL 조기 발견)
    today_ids = {r["post_id"] for r in rows}
    posts, off = [], 0
    while True:
        res = db.table("sponsored_posts").select("id, url, account_name, created_at, ended_at, content_summary, posted_at").range(off, off + 999).execute()
        chunk = res.data or []
        posts.extend(chunk)
        if len(chunk) < 1000:
            break
        off += 1000
    active = [a for a in posts if not a.get("ended_at")]
    waiting = uncollectable = 0
    check = []  # (account, 사유, url)
    for a in active:
        if a["id"] in today_ids:
            continue
        u = (a.get("url") or "").lower()
        if str(a.get("created_at"))[:10] == target:
            waiting += 1            # 오늘 등록 → 다음 수집에서 측정(정상)
        elif ("threads." in u or "facebook.com" in u       # 조회수 없는 플랫폼
              or "naver.com" in u or "kakao.com" in u):     # 전용 수집기 없음(수동 입력)
            uncollectable += 1      # 수집 불가(정상 — 신경 안 써도 됨)
        elif "instagram.com" in u and not re.search(r"/(?:p|reels|reel|tv)/[A-Za-z0-9_-]+", u):
            check.append((a.get("account_name"), "URL오류(게시물 링크 아님)", a.get("url")))
        else:
            check.append((a.get("account_name"), "미측정", a.get("url")))
    unmeasured = waiting + uncollectable + len(check)
    if unmeasured:
        text += f"\n\n⚠️ 오늘 미측정 활성 {unmeasured}건 (신규대기 {waiting} · 수집불가 {uncollectable} · 점검 {len(check)})"
        for nm, reason, url in check[:8]:
            tail = (url or "").rstrip("/").split("/")[-1]
            text += f"\n  · {nm} [{reason}] {tail}"
        if len(check) > 8:
            text += f"\n  … 외 {len(check) - 8}건"

    # 캡션 미충전 감시 — 자동 보강(backfill_captions)이 안 돌면 빈 캡션이 쌓임(2026-07-02 사고: 77건 누적).
    # 매일 이 수치가 보이면, 다시 안 채워지기 시작할 때 즉시 알아챌 수 있다(조용한 실패 → 시끄러운 실패).
    empty_cap = sum(1 for a in active
                    if "instagram.com" in (a.get("url") or "").lower()
                    and re.search(r"/(?:p|reels|reel|tv)/[A-Za-z0-9_-]+", (a.get("url") or ""))
                    and not (a.get("content_summary") or "").strip())
    if empty_cap:
        text += f"\n\n📝 캡션 없는 활성 IG {empty_cap}건 — 자동 보강이 채우는 중(내일도 이 수치면 backfill 미작동 의심)"

    # 데이터 정합성 특이 — 이상 있을 때만 섹션 추가. 점검 자체가 죽어도 상태 발송은 유지하되 티는 낸다(조용한 실패 방지).
    try:
        integ = _integrity_lines(db, posts)
        if integ:
            text += "\n\n🧪 데이터 정합성 특이 — 수집과 별개로 데이터 손질 필요:\n" + "\n".join("  · " + l for l in integ)
    except Exception as e:
        text += f"\n\n🧪 정합성 점검 실패({type(e).__name__}) — notify_status 로그 확인 필요"

    ch = os.getenv("SLACK_CHANNEL") or os.getenv("STATUS_USER")
    if not ch:
        raise SystemExit("SLACK_CHANNEL 또는 STATUS_USER 필요")
    tts = os.getenv("SLACK_THREAD_TS")
    if ch[:1] in ("C", "G") and not tts:
        # 채널(C/G) 대상인데 답글 대상(thread_ts) 없음 → top-level 채널 게시가 되므로 발송 생략.
        print("[status] 채널+thread_ts 없음 → top-level 방지 위해 발송 생략")
        return
    payload = {"channel": ch, "text": text}
    if tts:
        payload["thread_ts"] = tts   # 리포트 메시지의 '댓글(스레드 답글)'로 게시
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    print("[status] ok=", r.get("ok"), "error=", r.get("error"), "ch=", ch, "thread=", tts, "outcome=", outcome, "total=", total)
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
