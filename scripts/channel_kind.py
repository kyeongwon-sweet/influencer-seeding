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
    if "배너" in text or "banner" in text.lower():
        return True
    if "매거진" not in text:
        return False
    posted = str(posted_at or "")[:10]
    return len(posted) == 10 and posted >= MAGAZINE_BANNER_FROM


# ── 비용 0이 '정상'인 게시물 판정 ────────────────────────────────────────
# 왜 필요한가(2026-09-07 사용자 지시 — 오하루(틱톡/미러링) +16,600이 '가격미매핑'으로 떴다):
#   `sponsored_posts.cost` 는 **NULL이 한 행도 없다**(실측 3,534행 전부 NOT NULL, 0=799행).
#   즉 "미기입(NULL)"과 "무상 확정(0)"을 컬럼값으로는 가를 수 없다 → 라벨로 가른다.
#   미러링(같은 콘텐츠를 다른 플랫폼에 복제 게시)은 **원본 게시물에 비용이 붙어 있고**
#   복제분은 0원이 정상이다(이중계상 방지). 실측: 오하루 IG 원본 3,000,000원 ·
#   틱톡/유튜브 미러링 0원. 이걸 '미매핑'으로 경고하면 매일 오탐이 뜬다.
#   ⚠️ 판정은 **account_name 만** 본다. project_name/asset_name 에는 위성채널 139건이
#      '미러링'을 품고 있어 신호가 오염된다(실측). cost>0 인 미러링 20건은 그대로 CPV 계산.
FREE_CH = ("온드미디어", "위성채널", "무상시딩")
MIRROR_MARK = "미러링"


def is_mirror_label(account_name: Any) -> bool:
    """계정 라벨이 미러링(원본을 다른 플랫폼에 복제 게시)인가.

    ⚠️ 호출부에서 `"미러링" in name` 을 직접 쓰지 말 것 — is_banner_channel 이 Python 10곳·
    TS 20곳에 흩어져 규칙이 어긋났던 것과 같은 함정이다(계약 테스트로 금지).
    """
    return MIRROR_MARK in str(account_name or "")


def is_free_by_design(channel_type: Any, account_name: Any = None) -> bool:
    """cost=0 이 정상인 게시물인가(True=무상, False=가격미매핑으로 확인 필요).

    무상 채널(온드/위성/무상시딩)이거나, 계정 라벨이 미러링이면 무상이다.
    """
    if any(x in str(channel_type or "") for x in FREE_CH):
        return True
    return is_mirror_label(account_name)
