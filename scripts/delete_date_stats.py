#!/usr/bin/env python3
"""특정 날짜의 post_daily_stats 데이터 삭제"""
import sys
from datetime import datetime
from db import get_client

if len(sys.argv) < 2:
    print("사용법: python delete_date_stats.py YYYY-MM-DD")
    print("예: python delete_date_stats.py 2026-06-02")
    sys.exit(1)

date_str = sys.argv[1]

# 날짜 형식 검증
try:
    datetime.strptime(date_str, "%Y-%m-%d")
except ValueError:
    print(f"❌ 잘못된 날짜 형식: {date_str} (YYYY-MM-DD 형식으로 입력해주세요)")
    sys.exit(1)

db = get_client()

# 삭제 전 확인
print(f"🔍 {date_str} 데이터 확인 중...")
res = db.table("post_daily_stats").select("id, post_id, measured_at, play_count").eq("measured_at", date_str).execute()
data = res.data or []

if not data:
    print(f"⚠️ {date_str}에 해당하는 데이터가 없습니다.")
    sys.exit(0)

print(f"\n삭제될 데이터:")
print(f"  - 총 {len(data)}건")
print(f"  - 합계 조회수: {sum(d.get('play_count', 0) for d in data if d.get('play_count')):,}")
print()

# 삭제 확인
confirm = input(f"정말 {date_str} 데이터를 삭제하시겠습니까? (yes/no): ")
if confirm.lower() != "yes":
    print("❌ 취소되었습니다.")
    sys.exit(1)

# 삭제 실행
print(f"\n🗑️ {date_str} 데이터 삭제 중...")
delete_res = db.table("post_daily_stats").delete().eq("measured_at", date_str).execute()

print(f"✅ 완료! {len(data)}건 삭제됨")
