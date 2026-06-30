#!/usr/bin/env python3
# 협찬 데이터 수집 상태(정상/실패+사유) → 황경원 DM(여믄봇).
# cron-daily-collect.yml의 수집 직후 always() 단계에서 실행 — 수집 성공/실패 무관하게 발송.
import os
import json
import urllib.parse
import urllib.request
from datetime import date
from db import get_client

USER = os.environ["STATUS_USER"]   # 황경원 Slack user id (DM 대상)
SLACK_API = "https://slack.com/api/chat.postMessage"


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

    data = urllib.parse.urlencode({"channel": USER, "text": text}).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    print("[status] ok=", r.get("ok"), "error=", r.get("error"), "outcome=", outcome, "total=", total)
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
