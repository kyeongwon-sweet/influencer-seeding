#!/usr/bin/env python3
"""
sponsored_posts의 URL을 정규화하고 검증하는 스크립트
- 쿼리 파라미터(?...) 및 해시(#...) 제거
- Apify 정규표현식과 맞지 않는 URL 삭제
"""
import os
import re
from dotenv import load_dotenv
from db import get_client
from url_utils import normalize_url

# db.py import 전에 load_dotenv 호출하여 환경변수 로드
load_dotenv()

# 🔍 환경변수 진단
print("[DEBUG] 환경변수 확인:")
print(f"  SUPABASE_URL length: {len(os.getenv('SUPABASE_URL', ''))} chars - {('✅ 설정' if os.getenv('SUPABASE_URL') else '❌ 미설정')}")
print(f"  SUPABASE_SERVICE_ROLE_KEY length: {len(os.getenv('SUPABASE_SERVICE_ROLE_KEY', ''))} chars - {('✅ 설정' if os.getenv('SUPABASE_SERVICE_ROLE_KEY') else '❌ 미설정')}")

url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
print(f"  SUPABASE_URL value: {url}")
print(f"  SUPABASE_SERVICE_ROLE_KEY starts with: {key[:20] if key else 'NONE'}...")
print()

db = get_client()

# Apify Instagram 정규표현식 (정확한 복사)
APIFY_IG_REGEX = r"^(https:\/\/)?(www\.)?instagram\.com\/[A-Za-z0-9_-]+(\/(\/.*)?)?$"


def is_valid_instagram_url(url: str) -> bool:
    """Apify 검증 규칙에 맞는 Instagram URL 확인"""
    if not url or not isinstance(url, str):
        return False
    url = url.strip()
    return bool(re.match(APIFY_IG_REGEX, url))


def main():
    print("[LOG] sponsored_posts URL 정규화 및 검증 시작\n")

    # 모든 게시물 조회
    res = db.table("sponsored_posts").select("id, url").execute()
    posts = res.data or []

    print(f"[LOG] 총 {len(posts)}개 게시물\n")

    updated_count = 0
    deleted_count = 0
    invalid_urls = []

    for idx, post in enumerate(posts):
        old_url = post["url"]

        # 1. 먼저 정규화 (쿼리파라미터 제거)
        new_url = normalize_url(old_url)

        # 2. 검증: Instagram URL이 맞는지 확인
        if not is_valid_instagram_url(new_url):
            invalid_urls.append((idx, old_url, new_url))

            # 잘못된 URL 삭제
            db.table("sponsored_posts").delete().eq("id", post["id"]).execute()
            deleted_count += 1

            print(f"❌ 삭제됨 (위치 {idx}): {old_url}")
            print(f"   이유: Apify 정규표현식과 불일치\n")
            continue

        # 3. URL이 변경되었으면 업데이트
        if old_url != new_url:
            updated_count += 1

            # 데이터베이스 업데이트
            db.table("sponsored_posts").update({"url": new_url}).eq("id", post["id"]).execute()

            if updated_count <= 5:  # 처음 5개만 로깅
                print(f"✅ 수정됨 (위치 {idx}):")
                print(f"   전: {old_url}")
                print(f"   후: {new_url}\n")

    print(f"\n[SUMMARY]")
    print(f"  정규화됨: {updated_count}개")
    print(f"  삭제됨 (유효하지 않음): {deleted_count}개")
    print(f"  유지됨: {len(posts) - updated_count - deleted_count}개")

    if deleted_count > 0:
        print(f"\n[DELETED URLs] (위치 표시)")
        for idx, old, new in invalid_urls[:10]:  # 처음 10개만 표시
            print(f"  [{idx}] {old}")


if __name__ == "__main__":
    main()
