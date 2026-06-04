#!/usr/bin/env python3
"""
sponsored_posts의 URL을 정규화하는 스크립트
쿼리 파라미터(?...) 및 해시(#...) 제거
"""
import re
import os
from dotenv import load_dotenv
from db import get_client

load_dotenv()
db = get_client()


def normalize_url(url: str) -> str:
    """URL 정규화: 쿼리 파라미터, 해시 제거, trailing slash 제거"""
    normalized = re.sub(r'[?#].*$', '', url)
    return normalized.rstrip("/")


def main():
    print("[LOG] sponsored_posts URL 정규화 시작\n")

    # 모든 게시물 조회
    res = db.table("sponsored_posts").select("id, url").execute()
    posts = res.data or []

    print(f"[LOG] 총 {len(posts)}개 게시물\n")

    updated_count = 0
    changes = []

    for post in posts:
        old_url = post["url"]
        new_url = normalize_url(old_url)

        if old_url != new_url:
            changes.append((old_url, new_url))
            updated_count += 1

            # 데이터베이스 업데이트
            db.table("sponsored_posts").update({"url": new_url}).eq("id", post["id"]).execute()

            if updated_count <= 5:  # 처음 5개만 로깅
                print(f"✅ 수정됨:")
                print(f"   전: {old_url}")
                print(f"   후: {new_url}\n")

    print(f"\n[SUCCESS] {updated_count}개 URL 정규화 완료")

    if updated_count > 5:
        print(f"           (처음 5개만 표시, 총 {updated_count}개 수정)")


if __name__ == "__main__":
    main()
