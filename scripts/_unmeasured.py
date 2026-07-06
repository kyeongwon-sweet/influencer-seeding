#!/usr/bin/env python3
# 진단(발송없음): 07-05 미측정 활성 게시물이 무슨 소재인지 + 07-06엔 잡혔는지(일시적/지속).
from collections import defaultdict
from db import get_client

TARGET = "2026-07-05"
NEXT = "2026-07-06"


def _platform(u):
    u = (u or "").lower()
    if "instagram.com" in u: return "인스타"
    if "youtube.com" in u or "youtu.be" in u: return "유튜브"
    if "tiktok.com" in u: return "틱톡"
    if "x.com" in u or "twitter.com" in u: return "X"
    if "facebook.com" in u: return "페북"
    if "threads" in u: return "스레드"
    if "naver.com" in u: return "네이버"
    if "kakao" in u: return "카카오"
    return "기타"


def main():
    db = get_client()
    posts, off = [], 0
    while True:
        r = db.table("sponsored_posts").select("id, account_name, channel_type, url, ended_at, created_at").range(off, off + 999).execute()
        rows = r.data or []
        posts += rows
        if len(rows) < 1000:
            break
        off += 1000
    active = [p for p in posts if not p.get("ended_at")]
    ids = [p["id"] for p in active]

    play = defaultdict(dict)
    for i in range(0, len(ids), 80):
        chunk = ids[i:i + 80]
        r = db.table("post_daily_stats").select("post_id, measured_at, play_count").in_("post_id", chunk).in_("measured_at", [TARGET, NEXT]).execute()
        for s in (r.data or []):
            play[s["post_id"]][s["measured_at"]] = s.get("play_count")

    def measured(pid, d):
        return play.get(pid, {}).get(d) is not None  # non-null = 측정됨

    unmeasured = [p for p in active if not measured(p["id"], TARGET)]
    bych = defaultdict(int)
    byplat = defaultdict(int)
    next_ok = 0
    persistent = []
    for p in unmeasured:
        bych[(p.get("channel_type") or "미분류").strip()] += 1
        byplat[_platform(p.get("url"))] += 1
        if measured(p["id"], NEXT):
            next_ok += 1
        else:
            persistent.append(p)

    print(f"=== 07-05 미측정 활성: {len(unmeasured)}건 / 활성 총 {len(active)}건 ===")
    print(f"  07-06엔 측정됨(일시적): {next_ok}건 | 07-06에도 미측정(지속): {len(persistent)}건")
    print("\n  [채널분류별]")
    for c, n in sorted(bych.items(), key=lambda x: -x[1]):
        print(f"    {c:26} {n}")
    print("  [플랫폼별]")
    for c, n in sorted(byplat.items(), key=lambda x: -x[1]):
        print(f"    {c:8} {n}")
    print(f"\n  [07-06에도 미측정(지속·진짜 문제 후보) {len(persistent)}건 — 상위 30]")
    for p in persistent[:30]:
        print(f"    [{_platform(p.get('url'))}] [{(p.get('channel_type') or '?')}] {p.get('account_name')}  created={str(p.get('created_at'))[:10]}  {p.get('url')}")


if __name__ == "__main__":
    main()
