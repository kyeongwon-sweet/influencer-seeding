#!/usr/bin/env python3
# 진단: 07-06 저장 increment 합 vs 대시보드 방식(단조보정 차분) 비교 — 불일치 원인.
import datetime
from collections import defaultdict
from db import get_client

D = "2026-07-06"


def main():
    db = get_client()
    print("서버 UTC:", datetime.datetime.now(datetime.timezone.utc).strftime("%F %T"))

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

    def is_banner(pid):
        return "배너" in meta.get(pid, "")

    # 전체 이력 로드 (metric = 배너 reach, else play) + 저장 increment(07-06)
    metric = defaultdict(dict)
    stored = {}
    off = 0
    while True:
        r = (db.table("post_daily_stats").select("post_id, measured_at, play_count, reach_count, increment")
             .order("id").range(off, off + 999).execute())
        rows = r.data or []
        for s in rows:
            pid = s.get("post_id")
            if not pid:
                continue
            m = s.get("reach_count") if is_banner(pid) else s.get("play_count")
            if m is not None:
                metric[pid][s["measured_at"]] = m
            if s["measured_at"] == D and s.get("increment") is not None:
                stored[pid] = s["increment"]
        if len(rows) < 1000:
            break
        off += 1000

    all_dates = sorted({d for sm in metric.values() for d in sm})
    i = all_dates.index(D) if D in all_dates else -1
    pd = all_dates[i - 1] if i > 0 else None

    def clamped(pid, upto):
        best = None
        for dd in sorted(metric[pid]):
            if dd <= upto:
                v = metric[pid][dd]
                best = v if best is None else max(best, v)
        return best or 0

    stored_sum = sum(v for v in stored.values() if v > 0)
    clamp_by = defaultdict(int)
    stored_by = defaultdict(int)
    clamp_sum = 0
    diffs = []
    for pid in set(list(metric.keys()) + list(stored.keys())):
        c = clamped(pid, D) - (clamped(pid, pd) if pd else 0)
        if c > 0:
            clamp_sum += c
            clamp_by[meta.get(pid, "미분류")] += c
        sv = stored.get(pid, 0)
        if sv > 0:
            stored_by[meta.get(pid, "미분류")] += sv
        if abs((sv if sv > 0 else 0) - (c if c > 0 else 0)) > 5000:
            diffs.append((abs(sv - c), pid, sv, c))

    print(f"\n=== {D} (전일 {pd}) ===")
    print(f"저장 increment 합(리포트): +{stored_sum:,}")
    print(f"단조보정 차분 합(대시보드식): +{clamp_sum:,}")
    print(f"차이: {stored_sum - clamp_sum:+,}")
    print("\n[채널분류별  저장 vs 단조차분]")
    for c in sorted(set(clamp_by) | set(stored_by), key=lambda x: -stored_by.get(x, 0)):
        mk = "" if stored_by.get(c, 0) == clamp_by.get(c, 0) else "  ⚠️"
        print(f"    {c:24} 저장 +{stored_by.get(c,0):>10,}  단조 +{clamp_by.get(c,0):>10,}{mk}")
    print("\n[게시물별 큰 차이 상위 15]")
    for d, pid, sv, c in sorted(diffs, reverse=True)[:15]:
        print(f"    저장 +{sv:>9,}  단조 +{c:>9,}  [{meta.get(pid)}] {pid}")


if __name__ == "__main__":
    main()
