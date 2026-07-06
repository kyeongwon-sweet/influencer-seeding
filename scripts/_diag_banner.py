#!/usr/bin/env python3
# 진단(발송 없음): 배너 게시물의 play_count vs reach_count 실측 확인.
import os
from db import get_client


def main():
    db = get_client()
    # reach_count 컬럼 존재 여부
    has_reach = True
    try:
        db.table("post_daily_stats").select("reach_count").limit(1).execute()
    except Exception as e:
        has_reach = False
        print("[diag] post_daily_stats.reach_count 컬럼 없음:", e)
    print("[diag] reach_count 컬럼 존재:", has_reach)

    # 배너 게시물 id
    bp = db.table("sponsored_posts").select("id, account_name, channel_type, ended_at").ilike("channel_type", "%배너%").execute()
    banners = bp.data or []
    print(f"\n[diag] 배너 게시물 {len(banners)}개")
    ids = [b["id"] for b in banners]
    name = {b["id"]: b["account_name"] for b in banners}

    # 각 배너의 최근 stats
    sel = "post_id, measured_at, play_count" + (", reach_count" if has_reach else "")
    pc_nonnull = 0
    rc_nonnull = 0
    for i in range(0, len(ids), 50):
        chunk = ids[i:i+50]
        res = db.table("post_daily_stats").select(sel).in_("post_id", chunk).gte("measured_at", "2026-07-01").order("measured_at").execute()
        for r in (res.data or []):
            pc = r.get("play_count")
            rc = r.get("reach_count") if has_reach else None
            if pc is not None: pc_nonnull += 1
            if rc is not None: rc_nonnull += 1
            print(f"  {r['measured_at']}  play={pc}  reach={rc}  {name.get(r['post_id'],'?')}")
    print(f"\n[요약] 배너 stats(7/1~) 중 play_count非NULL={pc_nonnull}  reach_count非NULL={rc_nonnull}")


if __name__ == "__main__":
    main()
