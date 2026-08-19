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


def instagram_request_url(url: str | None) -> str | None:
    """Apify에 **요청할 때만** 쓰는 IG URL — 게시물은 `/reel/` 형태로 통일한다.

    🚨 2026-08-19 실측: `apify/instagram-scraper`는 같은 게시물이라도 `/p/`로 요청하면
    `videoPlayCount`를 아예 반환하지 않고, `/reel/`로 요청하면 반환한다.
    (5건 전부 회수: 1,739 / 2,190 / 141 / 1,137 / 2,203. 브라우저 릴스 탭 실측값과 일치)
    이 때문에 DB에 `/p/`로 저장된 릴스가 '좋아요만 있고 조회수 없음' 상태로 쌓였고,
    큐가 이를 `no_public_view_metric`으로 분류해 재시도를 영구 중단할 뻔했다.

    사진·캐러셀 글에 `/reel/`로 요청해도 **오류나 오값이 없다**(4건 실측: 조회수 필드만 비고
    좋아요·게시물 데이터는 정상). 그래서 게시물 URL은 형태 구분 없이 통일해도 안전하다.

    ⚠️ **DB·시트에 저장된 URL은 절대 바꾸지 않는다** — 요청 시점에만 변환한다(정본 불변).
    ⚠️ 프로필 URL(`instagram.com/<handle>/`)에는 쓰지 말 것. shortcode가 없으면 원본을 그대로 돌려준다.
    """
    if not url:
        return url
    m = re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", str(url))
    if not m:
        return url
    return f"https://www.instagram.com/reel/{m.group(1)}/"
