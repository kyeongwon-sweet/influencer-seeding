"""채널분류 → 지표 성격 판정. 배너 판정의 단일 진실(Python 측).

TS 측 정본은 `web/app/monitoring/lib.ts`의 `isBannerChannel`이며 규칙이 같아야 한다.

사용자 결정(2026-08-18): "파워채널/매거진 = 배너(이미지)"이지만 **앞으로 등록되는 건만** 배너로 다룬다.
기존 매거진 41건에는 조회수 실측 621행이 쌓여 있고 도달수는 0행이라, 소급 전환하면 그 실적이
화면·리포트에서 사라진다. 경계일 이전 게시물은 지금까지처럼 조회수로 유지한다.
도입 시점 매거진 최신 게시일이 2026-06-30이라 기존 41건은 하나도 분류가 바뀌지 않는다.

⚠️ `"배너" in channel_type`을 호출부에 흩어 쓰지 말 것. 매거진처럼 이름에 "배너"가 없는데 배너인
분류가 생기면 호출부마다 규칙이 어긋난다(실측: Python 10곳·TS 20곳에 흩어져 있었다).
"""
from __future__ import annotations

from typing import Any

MAGAZINE_BANNER_FROM = "2026-08-18"


def is_banner_channel(channel_type: Any, posted_at: Any = None) -> bool:
    """배너(도달수 지표) 게시물인가.

    posted_at이 없으면 경계를 판정할 수 없으므로 매거진은 배너로 보지 않는다(기존 동작 유지).
    """
    text = str(channel_type or "")
    if "배너" in text:
        return True
    if "매거진" not in text:
        return False
    posted = str(posted_at or "")[:10]
    return len(posted) == 10 and posted >= MAGAZINE_BANNER_FROM
