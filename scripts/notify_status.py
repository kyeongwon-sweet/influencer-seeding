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
    active, off = [], 0
    while True:
        res = db.table("sponsored_posts").select("id, url, account_name, created_at, ended_at").range(off, off + 999).execute()
        chunk = res.data or []
        active.extend(chunk)
        if len(chunk) < 1000:
            break
        off += 1000
    active = [a for a in active if not a.get("ended_at")]
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

    ch = os.getenv("SLACK_CHANNEL") or os.getenv("STATUS_USER")
    if not ch:
        raise SystemExit("SLACK_CHANNEL 또는 STATUS_USER 필요")
    payload = {"channel": ch, "text": text}
    tts = os.getenv("SLACK_THREAD_TS")
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
