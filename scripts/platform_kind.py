#!/usr/bin/env python3
"""URL(매체)로 하는 판정의 단일 정본 — '이 플랫폼이 조회수 지표를 주기는 하는가'.

왜 만들었나 (2026-09-15, 사흘 연속 같은 종류로 셋):
  자정 알림(`daily_collect_report`)이 재시도 큐(`build_view_missing_queue`)와 **따로** 판정해서,
  큐가 이미 '정상 미수집'으로 뺀 글이 알림에는 매일 그대로 떴다. 같은 뿌리로 셋이 나왔다.
    ① 인스타 제한(restricted_page) 2건  ② 배너 경계 밖 매거진 1건
    ③ 카카오 숏폼 1건 — 큐는 `is_view_capable` 로 이미 제외하는데 알림만 몰라서
       매일 `[미수집(원인 미상)]` 으로 떴다. 원인 미상이 아니라 **원래 값이 없는 매체**다
       (같은 카카오 글 `라밍` 의 notes: "카카오 숏폼은 자동 조회수 수집 미지원").
  판정을 한 곳에 두면 한쪽만 모르는 상태가 구조적으로 안 생긴다.

⚠️ `has_no_view_metric_host` 와 `is_view_capable` 을 헷갈리지 말 것:
   · `has_no_view_metric_host` = **이 매체는 조회수 지표가 없다**고 확정된 것(=미수집이 정상)
   · `is_view_capable` = 우리가 수집할 수 있는 매체인가(모르는 URL·오타도 False)
   알림에서 '미수집 정상'으로 빼는 데는 **앞의 것만** 써야 한다. 뒤의 것으로 빼면
   **주소가 깨진 글까지 조용히 사라진다** — 그건 고쳐야 할 진짜 문제다.
"""

from __future__ import annotations

from typing import Any

# 조회수(재생수) 지표를 애초에 제공하지 않는 매체. 미수집이 '정상'인 유일한 매체 사유다.
NO_VIEW_METRIC_HOSTS = ("threads.", "facebook.com", "naver.com", "kakao.com")

VIEW_PLATFORMS = {"instagram", "youtube", "tiktok", "x"}


def platform(url: str | None) -> str:
    value = (url or "").lower()
    if "instagram.com" in value:
        return "instagram"
    if "youtube.com" in value or "youtu.be" in value:
        return "youtube"
    if "tiktok.com" in value:
        return "tiktok"
    if "x.com" in value or "twitter.com" in value:
        return "x"
    return "other"


def has_no_view_metric_host(url: str | None) -> bool:
    """이 매체는 조회수 지표가 없다고 **확정**되는가(=값이 없는 게 정상)."""
    value = (url or "").lower()
    return any(host in value for host in NO_VIEW_METRIC_HOSTS)


def is_view_capable(post: dict[str, Any]) -> bool:
    """우리가 조회수를 수집할 수 있는 매체인가. 모르는 URL 은 False(수집 대상 아님)."""
    value = (post.get("url") or "").lower()
    if has_no_view_metric_host(value):
        return False
    return platform(value) in VIEW_PLATFORMS
