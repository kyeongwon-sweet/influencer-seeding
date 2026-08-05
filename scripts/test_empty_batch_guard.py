"""빈 배치 가드 회귀 테스트.

2026-08-05 사고: 백업 재시도가 재시도 대상 URL 0개일 때 resultsLimit=len(urls)=0으로
Apify 액터를 호출해 "Field input.resultsLimit must be >= 1"로 실패 → 황경원 실패 DM 오알림.
(데이터 손실은 없었음 — 메인이 전부 수집. '할 일 없음'이 에러로 둔갑한 것.)

모든 _fetch_* Apify 수집 함수는 urls가 비면 Apify를 호출하지 않고 즉시 빈 결과를
반환해야 한다. 이 테스트가 그 가드를 CI로 잠근다(가드가 사라지면 빌드 실패).
"""
import os

import pytest

# CI(requirements.txt)엔 설치돼 있음. 로컬에 없으면 skip(오탐 방지).
pytest.importorskip("apify_client")
# 토큰 없이도 ApifyClient() 인스턴스화는 오프라인이므로, 더미 토큰만 채워 import 안정화.
os.environ.setdefault("APIFY_API_TOKEN", "test-dummy")

import run_monitoring as rm  # noqa: E402


def test_empty_urls_skip_apify_and_return_empty():
    # dict 반환 함수들
    assert rm._fetch_youtube([]) == {}
    assert rm._fetch_tiktok([]) == {}
    assert rm._fetch_threads([]) == {}
    assert rm._fetch_facebook([]) == {}
    assert rm._fetch_twitter([]) == {}
    assert rm._fetch_ig_fallback([]) == {}
    # list 반환 함수
    assert rm._fetch_stats([]) == []
