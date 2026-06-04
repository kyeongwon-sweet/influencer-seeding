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
