#!/usr/bin/env python3
# 진단(발송 없음): 날짜별 play_count 커버리지 — 총행/non-null/>0/=0/NULL. 부분수집 알림 원인 규명.
from collections import defaultdict
from db import get_client

DATES = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"]


def main():
    db = get_client()
    agg = {d: {"rows": 0, "nonnull": 0, "pos": 0, "zero": 0, "null": 0} for d in DATES}
    off = 0
    while True:
        r = (db.table("post_daily_stats").select("measured_at, play_count")
             .gte("measured_at", "2026-07-01").lte("measured_at", "2026-07-06")
             .order("id").range(off, off + 999).execute())
        rows = r.data or []
        for s in rows:
            d = s["measured_at"]
            if d not in agg:
                continue
            a = agg[d]
            a["rows"] += 1
            pc = s.get("play_count")
            if pc is None:
                a["null"] += 1
            else:
                a["nonnull"] += 1
                if pc > 0:
                    a["pos"] += 1
                else:
                    a["zero"] += 1
        if len(rows) < 1000:
            break
        off += 1000

    print(f"{'날짜':12} {'총행':>6} {'non-null':>9} {'>0':>6} {'=0':>6} {'NULL':>6}")
    for d in DATES:
        a = agg[d]
        print(f"{d:12} {a['rows']:>6} {a['nonnull']:>9} {a['pos']:>6} {a['zero']:>6} {a['null']:>6}")
    nn = [agg[d]["nonnull"] for d in DATES if agg[d]["rows"] > 0]
    nn.sort()
    if nn:
        print(f"\nnon-null 중앙값(기준선): {nn[len(nn)//2]}")


if __name__ == "__main__":
    main()
