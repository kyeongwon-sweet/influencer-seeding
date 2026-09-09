#!/usr/bin/env python3
"""유튜브 액터 아이템 → 영상 ID 추출 회귀 테스트.

🚨 2026-09-08 사고 재발방지: `streamers/youtube-scraper` 가 Shorts 아이템의 `url` 을
영상 ID가 잘린 `"https://www.youtube.com/shorts/"` 로, `id` 를 빈 문자열로 바꿔 반환하기
시작했다. 조회수는 정상이었는데 매칭 키를 못 만들어 **아이템이 통째로 버려졌고** 로그엔
'미반환'으로 찍혀 스크래퍼 장애로 오진했다. 활성 유튜브 275건 중 268건 미수집(3회 실행 전부).
"""
from __future__ import annotations

import run_monitoring as rm

# 2026-09-09 실측 프로브(Apify run GGn2Q3JOKT4K9ZLRK)에서 그대로 가져온 응답 형태.
BROKEN_SHORTS_ITEM = {
    "url": "https://www.youtube.com/shorts/",
    "id": "",
    "input": "https://www.youtube.com/shorts/NOHDq2GRe1w/",
    "thumbnailUrl": "https://i.ytimg.com/vi/NOHDq2GRe1w/maxresdefault.jpg?sqp=-oaymwEm",
    "viewCount": 101938,
    "title": "복숭아 쫀득바",
}


def test_broken_shorts_item_still_resolves():
    """🚨 이 케이스가 깨지면 유튜브가 통째로 미수집된다."""
    assert rm._yt_item_id(BROKEN_SHORTS_ITEM) == "NOHDq2GRe1w"


def test_thumbnail_only_resolves():
    """url·id 가 비어도 썸네일의 /vi/<id>/ 로 복구된다(반환된 영상 자체를 가리킴)."""
    assert rm._yt_item_id({"url": "", "id": "", "thumbnailUrl":
                           "https://i.ytimg.com/vi/fLCmAAPJ56c/hq720.jpg"}) == "fLCmAAPJ56c"


def test_input_echo_is_last_resort():
    assert rm._yt_item_id({"input": "https://www.youtube.com/shorts/CzfCfb6ya5I/"}) == "CzfCfb6ya5I"


def test_legacy_full_url_still_wins():
    """예전 정상 응답(전체 url) 은 그대로 동작해야 한다 — input 과 어긋나도 url 우선."""
    assert rm._yt_item_id({"url": "https://www.youtube.com/watch?v=WyENTKJK4lE",
                           "input": "https://www.youtube.com/shorts/OTHER123xyz/"}) == "WyENTKJK4lE"
    assert rm._yt_item_id({"url": "https://www.youtube.com/shorts/8ZKR7HRpf_c/"}) == "8ZKR7HRpf_c"


def test_bare_id_field_resolves():
    assert rm._yt_item_id({"url": "", "id": "NOHDq2GRe1w"}) == "NOHDq2GRe1w"


def test_unresolvable_item_returns_none():
    """전부 실패하면 None — 호출부가 세어서 '스키마 변경 의심' 경고를 낸다(무음 금지)."""
    assert rm._yt_item_id({"url": "https://www.youtube.com/shorts/", "id": "", "input": ""}) is None
    assert rm._yt_item_id({}) is None
