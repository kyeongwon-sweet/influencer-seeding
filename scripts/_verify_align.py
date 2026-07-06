#!/usr/bin/env python3
# 검증(발송 없음): 리포트 방식 총증분 vs 대시보드 일자별 표 방식 총증분 대조.
# metric = 배너면 reach_count, 아니면 play_count (대시보드 page.tsx:225와 동일).
from collections import defaultdict
from db import get_client

DATES = ["2026-07-04", "2026-07-05"]


def main():
    db = get_client()
    meta = {}
    off = 0
    while True:
        r = db.table("sponsored_posts").select("id, channel_type, ended_at").range(off, off + 999).execute()
        rows = r.data or []
        for p in rows:
            meta[p["id"]] = p
        if len(rows) < 1000:
            break
        off += 1000

    def is_banner(pid):
        return "배너" in (meta.get(pid, {}).get("channel_type") or "")

    def ch(pid):
        return (meta.get(pid, {}).get("channel_type") or "미분류").strip()

    metric = defaultdict(dict)
    off = 0
    while True:
        r = db.table("post_daily_stats").select("post_id, measured_at, play_count, reach_count").order("id").range(off, off + 999).execute()
        rows = r.data or []
        for s in rows:
            pid = s.get("post_id")
            if not pid:
                continue
            m = s.get("reach_count") if is_banner(pid) else s.get("play_count")
            if m is not None:
                metric[pid][s["measured_at"]] = m
        if len(rows) < 1000:
            break
        off += 1000

    all_dates = sorted({d for sm in metric.values() for d in sm})

    def prevd(d):
        i = all_dates.index(d)
        return all_dates[i - 1] if i > 0 else None

    def clamped(pid, upto):
        best = None
        for d in sorted(metric[pid]):
            if d <= upto:
                v = metric[pid][d]
                best = v if best is None else max(best, v)
        return best or 0

    for D in DATES:
        if D not in all_dates:
            print(f"\n{D}: 데이터 없음")
            continue
        pd = prevd(D)
        rep_total, rep_ch = 0, defaultdict(int)
        for pid, sm in metric.items():
            if D not in sm:
                continue
            tv = sm[D]
            pv = None
            for d in sorted((x for x in sm if x < D), reverse=True):
                if sm[d] > 0:
                    pv = sm[d]
                    break
            inc = tv - pv if pv is not None else tv
            if inc > 0:
                rep_total += inc
                rep_ch[ch(pid)] += inc
        dash_total, dash_ch = 0, defaultdict(int)
        for pid in metric:
            c = clamped(pid, D) - (clamped(pid, pd) if pd else 0)
            if c != 0:
                dash_total += c
                dash_ch[ch(pid)] += c
        print(f"\n=== {D} (전일 {pd}) ===")
        print(f"  리포트 방식  총: +{rep_total:,}")
        print(f"  대시보드 방식 총: +{dash_total:,}   차이 {rep_total - dash_total:+,}")
        for c in sorted(set(rep_ch) | set(dash_ch), key=lambda x: -(dash_ch.get(x, 0))):
            mark = "" if rep_ch.get(c, 0) == dash_ch.get(c, 0) else "  ⚠️"
            print(f"      {c:26} 리포트 +{rep_ch.get(c,0):>10,}  대시 +{dash_ch.get(c,0):>10,}{mark}")


if __name__ == "__main__":
    main()
