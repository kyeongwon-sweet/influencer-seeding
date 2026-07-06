#!/usr/bin/env python3
# 진단(발송 없음): target일에 '직전값 없음→전체누적'으로 잡힌 게시물이 있는지,
# 그 중 과거 실측이 있는데도 신규취급된 게 있는지 점검.
import os
from collections import defaultdict
from db import get_client

TARGET = os.getenv("MONITORING_DATE", "2026-07-06")


def load_all_stats(db):
    out = defaultdict(dict)
    start = 0
    while True:
        res = db.table("post_daily_stats").select("post_id, measured_at, play_count").order("id").range(start, start + 999).execute()
        rows = res.data or []
        for r in rows:
            if r.get("play_count") is not None and r.get("post_id"):
                out[r["post_id"]][r["measured_at"]] = r["play_count"]
        if len(rows) < 1000:
            break
        start += 1000
    return out


def main():
    db = get_client()
    st = load_all_stats(db)
    total = 0
    new_full = 0          # 직전값(>0) 없어 전체누적으로 잡힌 합
    new_cnt = 0
    new_but_hasearlier = []   # 신규취급됐지만 과거 측정(0포함)이 있던 케이스
    for pid, sm in st.items():
        if TARGET not in sm:
            continue
        tv = sm[TARGET]
        prev = None
        for d in sorted((x for x in sm if x < TARGET), reverse=True):
            if sm[d] > 0:
                prev = sm[d]
                break
        inc = tv - prev if prev is not None else tv
        if inc <= 0:
            continue
        total += inc
        if prev is None:
            new_cnt += 1
            new_full += inc
            earlier = sorted(x for x in sm if x < TARGET)
            if earlier:  # 과거 측정이 있었는데 전부 0이라 신규취급된 것
                new_but_hasearlier.append((tv, pid, earlier[-1], sm[earlier[-1]]))

    print(f"\n=== {TARGET} prev 로직 점검 ===")
    print(f"총 증분(리포트방식): +{total:,}")
    print(f"신규취급(직전>0 없음) 게시물 수: {new_cnt}  / 그 합(전체누적): +{new_full:,}  ({new_full*100//max(total,1)}% of 총)")
    print(f"신규취급인데 과거 측정이력 있던(전부 0) 케이스: {len(new_but_hasearlier)}")
    for tv, pid, ld, lv in sorted(new_but_hasearlier, reverse=True)[:20]:
        print(f"    tv={tv:,}  마지막이전측정 {ld}={lv}  {pid}")


if __name__ == "__main__":
    main()
