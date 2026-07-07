#!/usr/bin/env python3
# 진단(발송없음): 저장된 increment 합산 — 리포트/대시보드가 읽는 단일 소스 값 확인.
from collections import defaultdict
from db import get_client

DATES = ["2026-07-05", "2026-07-06"]


def main():
    db = get_client()
    meta = {}
    off = 0
    while True:
        r = db.table("sponsored_posts").select("id, channel_type").range(off, off + 999).execute()
        rows = r.data or []
        for p in rows:
            meta[p["id"]] = (p.get("channel_type") or "미분류").strip()
        if len(rows) < 1000:
            break
        off += 1000

    for D in DATES:
        tot = 0
        bych = defaultdict(int)
        cnt = 0
        st = 0
        while True:
            r = (db.table("post_daily_stats").select("post_id, increment")
                 .eq("measured_at", D).gt("increment", 0).range(st, st + 999).execute())
            rows = r.data or []
            for s in rows:
                inc = s.get("increment") or 0
                tot += inc
                bych[meta.get(s["post_id"], "미분류")] += inc
                cnt += 1
            if len(rows) < 1000:
                break
            st += 1000
        print(f"\n=== {D}  저장 increment 합계: +{tot:,}  ({cnt}건) ===")
        for c, v in sorted(bych.items(), key=lambda x: -x[1]):
            print(f"    {c:26} +{v:,}")


if __name__ == "__main__":
    main()
