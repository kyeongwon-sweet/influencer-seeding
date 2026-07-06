#!/usr/bin/env python3
# 진단 전용(발송 없음): 리포트 방식 vs 대시보드 방식(단조보정+forward-fill+sum-diff)의
# 일 증분 총합을 날짜별로 비교하고, 07-06 과대계상 게시물 TOP을 출력한다.
import os
from collections import defaultdict
from db import get_client

DATES = ["2026-07-04", "2026-07-05", "2026-07-06"]


def load_all_stats(db):
    """{post_id: {measured_at: play_count}}  (play_count None 제외)"""
    out = defaultdict(dict)
    start = 0
    n = 0
    while True:
        res = (db.table("post_daily_stats")
               .select("post_id, measured_at, play_count")
               .order("id")
               .range(start, start + 999).execute())
        rows = res.data or []
        for r in rows:
            if r.get("play_count") is not None and r.get("post_id"):
                out[r["post_id"]][r["measured_at"]] = r["play_count"]
        n += len(rows)
        if len(rows) < 1000:
            break
        start += 1000
    print(f"[diag] loaded {n} stat rows, {len(out)} posts")
    return out


def load_meta(db, ids):
    meta = {}
    ids = list(ids)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        res = db.table("sponsored_posts").select("id, url, account_name, channel_type, ended_at").in_("id", chunk).execute()
        for r in (res.data or []):
            meta[r["id"]] = r
    return meta


def dashboard_totals(all_stats, all_dates):
    """대시보드 dailyTotals 재현: 게시물별 단조보정+forward-fill 후 날짜별 총합."""
    totals = {d: 0 for d in all_dates}
    per_post_on_date = defaultdict(dict)  # post -> date -> clamped value (for attribution)
    for pid, sm in all_stats.items():
        last = None
        for d in all_dates:
            if d in sm:
                v = sm[d]
                last = v if last is None else max(last, v)
            totals[d] += (last or 0)
            per_post_on_date[pid][d] = (last or 0)
    return totals, per_post_on_date


def report_incs(all_stats, target):
    """리포트 방식: 직전값(>0, target 이전 최근) 없으면 전체값, 양(+)만."""
    incs = {}
    for pid, sm in all_stats.items():
        if target not in sm:
            continue
        tv = sm[target]
        prev = None
        for d in sorted((x for x in sm if x < target), reverse=True):
            if sm[d] > 0:
                prev = sm[d]
                break
        inc = tv - prev if prev is not None else tv
        if inc > 0:
            incs[pid] = inc
    return incs


def main():
    db = get_client()
    all_stats = load_all_stats(db)
    all_dates = sorted({d for sm in all_stats.values() for d in sm})
    meta = load_meta(db, all_stats.keys())

    dtot, ppod = dashboard_totals(all_stats, all_dates)

    def prev_date(d):
        i = all_dates.index(d)
        return all_dates[i - 1] if i > 0 else None

    print("\n=== 날짜별 총 증분: 리포트방식 vs 대시보드방식 ===")
    for d in DATES:
        if d not in all_dates:
            print(f"{d}: (측정 없음)")
            continue
        r = sum(report_incs(all_stats, d).values())
        pd = prev_date(d)
        dash = dtot[d] - dtot[pd] if pd else dtot[d]
        print(f"{d}:  리포트 +{r:,}   |   대시보드 +{dash:,}   (차이 {r - dash:+,})")

    # 07-06 과대계상 상위: 리포트 per-post inc - 대시보드 per-post 기여(당일-전일 clamped)
    target = "2026-07-06"
    if target in all_dates:
        pdte = prev_date(target)
        r_inc = report_incs(all_stats, target)
        rows = []
        for pid, ri in r_inc.items():
            dcontrib = ppod[pid][target] - (ppod[pid][pdte] if pdte else 0)
            gap = ri - dcontrib
            rows.append((gap, ri, dcontrib, pid))
        rows.sort(reverse=True)
        print(f"\n=== 07-06 과대계상 TOP 20 (리포트 - 대시보드 기여) ===")
        for gap, ri, dc, pid in rows[:20]:
            m = meta.get(pid, {})
            print(f"  gap +{gap:,}  리포트+{ri:,} 대시+{dc:,}  [{m.get('channel_type')}] {m.get('account_name')} {m.get('url')}  ended={m.get('ended_at')}")


if __name__ == "__main__":
    main()
