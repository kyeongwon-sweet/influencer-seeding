#!/usr/bin/env python3
# 진단(발송 없음): 07-03/04 부분수집으로 조회수가 빠진 게시물 목록.
# 기준: 07-02(정상일)엔 play>0였는데 대상일엔 없음/0/NULL.
from collections import defaultdict
from db import get_client

REF = "2026-07-02"       # 정상 기준일
TARGETS = ["2026-07-03", "2026-07-04"]


def main():
    db = get_client()
    meta = {}
    off = 0
    while True:
        r = db.table("sponsored_posts").select("id, account_name, channel_type, url").range(off, off + 999).execute()
        rows = r.data or []
        for p in rows:
            meta[p["id"]] = p
        if len(rows) < 1000:
            break
        off += 1000

    # play per (post, date) for ref+targets
    days = [REF] + TARGETS
    play = defaultdict(dict)
    off = 0
    while True:
        r = (db.table("post_daily_stats").select("post_id, measured_at, play_count")
             .in_("measured_at", days).order("id").range(off, off + 999).execute())
        rows = r.data or []
        for s in rows:
            play[s["post_id"]][s["measured_at"]] = s.get("play_count")
        if len(rows) < 1000:
            break
        off += 1000

    for D in TARGETS:
        affected = []
        for pid, pm in play.items():
            ref_v = pm.get(REF)
            if ref_v is None or ref_v <= 0:
                continue  # 기준일에 값 없던 건 제외
            dv = pm.get(D, "NOROW")
            if dv == "NOROW" or dv is None or dv == 0:
                affected.append((ref_v, pid, "행없음" if dv == "NOROW" else ("NULL" if dv is None else "0")))
        bych = defaultdict(int)
        for ref_v, pid, st in affected:
            bych[(meta.get(pid, {}).get("channel_type") or "미분류").strip()] += 1
        print(f"\n===== {D}: 빠진 게시물 {len(affected)}개 (07-02엔 조회수 있었음) =====")
        print("  [채널분류별]")
        for c, n in sorted(bych.items(), key=lambda x: -x[1]):
            print(f"    {c:26} {n}개")
        print("  [상위 25개: 07-02값 → 대상일상태]")
        for ref_v, pid, st in sorted(affected, reverse=True)[:25]:
            m = meta.get(pid, {})
            print(f"    {ref_v:>10,} → {st:5}  [{(m.get('channel_type') or '?')}] {m.get('account_name')}  {m.get('url')}")


if __name__ == "__main__":
    main()
