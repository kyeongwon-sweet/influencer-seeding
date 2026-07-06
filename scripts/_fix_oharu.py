#!/usr/bin/env python3
# 오하루TT의 bogus 0행 제거 (백업 출력 후 삭제, 186500은 보존). CONFIRM=1일 때만 삭제.
import os, json
from db import get_client

VIDEO = "7655695057189719304"


def main():
    db = get_client()
    # post 찾기
    res = db.table("sponsored_posts").select("id, account_name, url").ilike("url", f"%{VIDEO}%").execute()
    posts = res.data or []
    if not posts:
        print("오하루 post 없음"); return
    for p in posts:
        pid = p["id"]
        print(f"\n=== {p['account_name']} {p['url']} (id={pid}) ===")
        rows = db.table("post_daily_stats").select("id, measured_at, play_count, likes_count, comments_count, manual").eq("post_id", pid).order("measured_at").execute().data or []
        print("[백업] 현재 전체 행:")
        print(json.dumps(rows, ensure_ascii=False, default=str, indent=2))
        zero_ids = [r["id"] for r in rows if (r.get("play_count") == 0)]
        print(f"[대상] play_count=0 행 {len(zero_ids)}개: {[ (r['measured_at']) for r in rows if r.get('play_count')==0 ]}")
        if os.getenv("CONFIRM") == "1" and zero_ids:
            db.table("post_daily_stats").delete().in_("id", zero_ids).execute()
            after = db.table("post_daily_stats").select("measured_at, play_count").eq("post_id", pid).order("measured_at").execute().data or []
            print(f"[삭제 완료] {len(zero_ids)}개 제거. 남은 행: {[(r['measured_at'], r['play_count']) for r in after]}")
        else:
            print("[DRY] CONFIRM!=1 → 삭제 안 함")


if __name__ == "__main__":
    main()
