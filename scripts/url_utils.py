#!/usr/bin/env python3
"""
URL 정규화 유틸 - 쿼리 파라미터, 해시, trailing slash 제거
다양한 모듈에서 재사용 가능한 공통 함수
"""
import re


def normalize_url(url: str) -> str:
    """
    URL 정규화: 쿼리 파라미터(?...), 해시(#...) 제거, trailing slash 제거

    Args:
        url: 정규화할 URL 문자열

    Returns:
        정규화된 URL (쿼리 파라미터 및 해시 제거, trailing slash 제거)

    Examples:
        >>> normalize_url("https://instagram.com/p/ABC/?utm_x=1#comments")
        'https://instagram.com/p/ABC'
        >>> normalize_url("https://youtube.com/shorts/XYZ?si=abc/")
        'https://youtube.com/shorts/XYZ'
    """
    # 쿼리 파라미터와 해시 제거 (? 또는 # 이후 모두 제거)
    normalized = re.sub(r'[?#].*$', '', url)
    return normalized.rstrip("/")


def tt_video_id(url: str):
    """틱톡 영상 ID 추출 (/video/ID). photo도 tt_canonical_form으로 표준화하면 /video/ 형태라 여기서 잡힘."""
    m = re.search(r'/video/(\d+)', url or "")
    return m.group(1) if m else None


def tt_canonical_form(url: str) -> str:
    """틱톡 photo(슬라이드쇼) URL을 /video/ID 표준형으로 정규화. photo가 아니면 원본 그대로.

    Apify clockworks 액터의 postURLs 모드는 /photo/ URL을 못 읽고 /video/ID로만 조회 가능(실측).
    슬라이드쇼도 id는 /video/와 동일하므로 치환하면 조회수·좋아요가 정상 수집된다.
    ⚠️ 이 치환이 빠지면 위성채널·바이럴 배너 슬라이드쇼 소재의 조회수가 매일 조용히 누락된다.

    Examples:
        >>> tt_canonical_form("https://www.tiktok.com/@issuetteugi/photo/7667152002266287378/")
        'https://www.tiktok.com/@issuetteugi/video/7667152002266287378'
        >>> tt_canonical_form("https://www.tiktok.com/@foo/video/123")
        'https://www.tiktok.com/@foo/video/123'
    """
    if not url:
        return url
    m = re.search(r'(/@[^/]+)/photo/(\d+)', url)
    if m:
        return "https://www.tiktok.com" + m.group(1) + "/video/" + m.group(2)
    return url
