#!/usr/bin/env python3
# 검증(발송 없음): 대시보드 일자별 표 방식 총증분 계산(참조값).
# metric = 배너면 reach_count, 아니면 play_count. 단조보정+forward-fill 후 총합의 전일 차분.
# 실제 리포트 DRY 총액과 이 값을 비교해 정합 확인.
from collections import defaultdict
from db import get_client

DATES = ["2026-07-04", "2026-07-05"]


def main():
    db = get_client()
    meta = {}
    off = 0
    while True:
        r = db.table("sponsored_posts").select("id, channel_type").range(off, off + 999).execute()
        rows = r.data or []
        for p in rows:
            meta[p["id"]] = p
        if len(rows) < 1000:
            break
        off += 1000

    def is_banner(pid):
        return "배너" in (meta.get(pid, {}).get("channel_type") or "")

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
            print(f"{D}: 데이터 없음"); continue
        pd = prevd(D)
        tot = sum(clamped(pid, D) - (clamped(pid, pd) if pd else 0) for pid in metric)
        print(f"[대시보드 방식] {D} (전일 {pd}) 총증분: +{tot:,}")


if __name__ == "__main__":
    main()
