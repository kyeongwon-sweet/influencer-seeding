#!/usr/bin/env python3
"""
6/6, 6/7 미수집 데이터 복구 스크립트
조회수, 좋아요, 댓글 데이터를 재수집합니다.
"""

import os
import sys
import asyncio
from datetime import datetime, timedelta
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from monitoring import (
    get_supabase_client,
    fetch_post_stats,
    fetch_meta_ads,
    fetch_naver_trends,
    fetch_all_sponsored_posts,
)

async def recover_missing_dates(target_dates=None):
    """
    지정된 날짜들의 미수집 데이터를 복구합니다.

    Args:
        target_dates: 복구할 날짜 리스트 (기본값: ['2026-06-06', '2026-06-07'])
    """
    if target_dates is None:
        target_dates = ['2026-06-06', '2026-06-07']

    supabase = get_supabase_client()

    # 1. 복구 대상 포스트 목록 조회
    print(f"🔍 {', '.join(target_dates)} 데이터 복구 시작...")

    try:
        response = supabase.table("sponsored_posts").select("*").execute()
        all_posts = response.data if response.data else []

        # 이미 게시된 포스트만 필터링
        target_posts = [
            p for p in all_posts
            if p.get('posted_at') and p['posted_at'][:10] <= '2026-06-07'
        ]

        print(f"📊 복구 대상 포스트: {len(target_posts)}개")

        # 2. 각 날짜별로 데이터 수집
        recovered_count = 0

        for target_date in target_dates:
            print(f"\n⏰ {target_date} 데이터 수집 중...")

            # 해당 날짜의 기존 데이터 확인
            existing = supabase.table("daily_stats").select("*").eq(
                "measured_at", f"{target_date}T00:00:00"
            ).execute()
            existing_posts = set(s['post_id'] for s in (existing.data or []))

            # 미수집 포스트
            missing_posts = [p for p in target_posts if p['id'] not in existing_posts]
            print(f"   미수집 포스트: {len(missing_posts)}개")

            # 3. 각 포스트의 조회수 데이터 수집
            for post in missing_posts:
                try:
                    stats = await fetch_post_stats(post['url'], target_date)

                    if stats:
                        # Supabase에 저장
                        supabase.table("daily_stats").insert({
                            "post_id": post['id'],
                            "measured_at": f"{target_date}T00:00:00",
                            "play_count": stats.get('play_count'),
                            "likes_count": stats.get('likes_count'),
                            "comments_count": stats.get('comments_count'),
                        }).execute()

                        recovered_count += 1
                        print(f"   ✅ {post['id'][:8]}: {stats}")
                    else:
                        print(f"   ⚠️  {post['id'][:8]}: 데이터 조회 실패")

                except Exception as e:
                    print(f"   ❌ {post['id'][:8]}: {str(e)}")

        print(f"\n✅ 복구 완료: {recovered_count}개 레코드 추가됨")
        return recovered_count

    except Exception as e:
        print(f"❌ 복구 실패: {str(e)}")
        return 0


async def main():
    """메인 실행 함수"""
    print("=" * 60)
    print("🔧 협찬 모니터링 - 6/6, 6/7 데이터 복구")
    print("=" * 60)

    # 환경변수 검사
    required_vars = [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'APIFY_API_TOKEN',
    ]

    missing = [v for v in required_vars if not os.getenv(v)]
    if missing:
        print(f"❌ 환경변수 누락: {', '.join(missing)}")
        sys.exit(1)

    # 복구 실행
    result = await recover_missing_dates()

    if result > 0:
        print("\n✅ 6/6, 6/7 데이터 복구 성공!")
    else:
        print("\n⚠️  복구된 데이터가 없습니다.")


if __name__ == "__main__":
    asyncio.run(main())
