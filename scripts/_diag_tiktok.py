#!/usr/bin/env python3
# 진단: 틱톡 수집이 07-02~06에 실제로 됐는지 (오하루TT + 전체 틱톡 현황)
from collections import defaultdict
from db import get_client

DATES = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"]


def main():
    db = get_client()
    # 틱톡 게시물
    tt = []
    start = 0
    while True:
        res = db.table("sponsored_posts").select("id, account_name, url, created_at, ended_at").ilike("url", "%tiktok.com%").range(start, start+999).execute()
        rows = res.data or []
        tt += rows
        if len(rows) < 1000: break
        start += 1000
    ids = [t["id"] for t in tt]
    name = {t["id"]: t["account_name"] for t in tt}
    print(f"[diag] 틱톡 게시물 {len(tt)}개")

    # 각 틱톡의 날짜별 play_count
    hist = defaultdict(dict)
    for i in range(0, len(ids), 50):
        chunk = ids[i:i+50]
        res = db.table("post_daily_stats").select("post_id, measured_at, play_count").in_("post_id", chunk).gte("measured_at", "2026-07-01").execute()
        for r in (res.data or []):
            hist[r["post_id"]][r["measured_at"]] = r["play_count"]

    # 날짜별 집계: 실측(>0) / 0 / 무행(None)
    print("\n=== 날짜별 틱톡 수집 현황 (전체 %d개 중) ===" % len(tt))
    print(f"{'날짜':12} {'실측>0':>7} {'0기록':>7} {'무행':>7}")
    for d in DATES:
        pos = zero = norow = 0
        for pid in ids:
            v = hist[pid].get(d, "NOROW")
            if v == "NOROW" or v is None: norow += 1
            elif v > 0: pos += 1
            else: zero += 1
        print(f"{d:12} {pos:>7} {zero:>7} {norow:>7}")

    # 오하루TT 상세
    print("\n=== 오하루TT 이력 ===")
    for t in tt:
        if "7655695057189719304" in (t["url"] or ""):
            h = hist[t["id"]]
            print(f"  {t['account_name']} created={str(t['created_at'])[:10]} ended={t['ended_at']}")
            print(f"  {t['url']}")
            print(f"  이력: " + ", ".join(f"{d}={h[d]}" for d in sorted(h)))

    # 0으로 기록된 틱톡 예시(07-02~05 중 0인 것)
    print("\n=== 07-02~05에 0으로 기록된 틱톡 (상위 15) ===")
    n = 0
    for pid in ids:
        zdays = [d for d in ["2026-07-02","2026-07-03","2026-07-04","2026-07-05"] if hist[pid].get(d) == 0]
        if zdays:
            print(f"  {name.get(pid)}: 0인날={zdays}  전체={ {d:hist[pid][d] for d in sorted(hist[pid])} }")
            n += 1
            if n >= 15: break
    print(f"\n[요약] 07-02~05 중 하루라도 0으로 기록된 틱톡: (위 목록)")


if __name__ == "__main__":
    main()
