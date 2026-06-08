#!/usr/bin/env python3
"""
현재 post_daily_stats 테이블 상태 확인
"""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not url or not key:
    print("❌ 환경변수 누락: SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY")
    exit(1)

supabase = create_client(url, key)

print("🔍 현재 DB 상태 확인 중...\n")

# 6/5, 6/6, 6/7, 6/8 데이터 조회
response = supabase.table("post_daily_stats").select(
    "post_id, measured_at, play_count, likes_count, comments_count"
).in_("measured_at", ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"]).execute()

data = response.data

# 날짜별 개수
dates = ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08"]
counts = {d: len([x for x in data if x["measured_at"] == d]) for d in dates}

print("📊 날짜별 레코드 개수:")
for date, count in counts.items():
    print(f"  {date}: {count} 개")

print("\n⚠️  6/6, 6/7, 6/8 데이터 존재 여부:")
for date in ["2026-06-06", "2026-06-07", "2026-06-08"]:
    exists = "✅ 있음" if counts[date] > 0 else "❌ 없음"
    print(f"  {date}: {exists} ({counts[date]} 개)")

# 6/6 샘플 데이터 (처음 5개)
sample_606 = [x for x in data if x["measured_at"] == "2026-06-06"][:5]
if sample_606:
    print("\n📋 6/6 샘플 데이터 (처음 5개):")
    for i, row in enumerate(sample_606, 1):
        print(f"  {i}. post_id={row['post_id'][:8]}..., views={row['play_count']}, likes={row['likes_count']}, comments={row['comments_count']}")
else:
    print("\n📋 6/6 샘플 데이터: 없음")

print(f"\n📈 총 {len(data)} 개 레코드")
