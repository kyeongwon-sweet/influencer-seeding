import os
import json
from datetime import datetime
from db import get_client

db = get_client()

# 6/2 데이터 확인
res = db.table("post_daily_stats").select("*").eq("measured_at", "2026-06-02").execute()
stats = res.data or []

print(f"\n📊 6/2 일일 통계: {len(stats)}건")
print("=" * 80)

total_plays = sum(s.get("play_count", 0) for s in stats if s.get("play_count"))
print(f"총 조회수: {total_plays:,}")
print()

# 상위 10개 게시물
sorted_stats = sorted(stats, key=lambda s: s.get("play_count", 0), reverse=True)[:10]
for i, stat in enumerate(sorted_stats, 1):
    # 게시물 정보 조회
    post_res = db.table("sponsored_posts").select("*").eq("id", stat["post_id"]).execute()
    post = post_res.data[0] if post_res.data else {}
    
    print(f"{i}. {post.get('account_name', '?')} - {stat.get('play_count', 0):,} 조회")
    print(f"   URL: {post.get('url', '?')}")
    print()

# 다른 날짜 비교
print("\n📅 전체 기간 일별 조회수 합계:")
print("=" * 80)
for date in ["2026-05-31", "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]:
    res = db.table("post_daily_stats").select("play_count").eq("measured_at", date).execute()
    total = sum(s.get("play_count", 0) for s in (res.data or []) if s.get("play_count"))
    count = len([s for s in (res.data or []) if s.get("play_count")])
    print(f"{date}: {total:,} (건: {count})")
