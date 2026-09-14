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


def is_reach_only_manual_channel(
    channel_type: Any, *, has_reach_ever: bool, has_auto_play_ever: bool
) -> bool:
    """도달수만 수기로 관리하는 글인가 — **게시일 경계가 아니라 실제 지표 형태로** 판정한다.

    왜 필요한가(2026-09-14 실측, '오늘의 메뉴' https://www.instagram.com/p/DbutARtkWS8/):
      매거진을 '배너=도달수 수기'로 빼는 기준이 위 `is_banner_channel()` 의 게시일 경계
      (`MAGAZINE_BANNER_FROM`=2026-08-18)였다. 이 글은 08-07 게시라 경계 밖이라 제외되지 않아
      **매일 재시도 큐에 담기고 매일 '활성인데 미수집' 경고**가 떴다. 실물은 Apify
      `type=Sidecar` / childPosts 7개 전부 `Image` — 영상이 아니라 조회수 자체가 없다.

    ⚠️ `is_banner_channel()` 의 경계일은 건드리지 않는다. 그건 리포트의 배너 도달수 계산 규약이라
       바꾸면 08-18 이전 매거진의 과거 리포트 숫자가 달라진다. 여기서는 '미수집이 정상인가'만 본다.

    ⚠️ `has_auto_play_ever` 는 **자동수집된** play_count 만 세야 한다. 수기 행은 사람이 도달수를
       어느 칸에 적었는지의 문제라 증거력이 없다 — 실측('오늘의 메뉴' 2026-08-10)에
       play_count=45,795 / reach_count=45,795 로 같은 도달수가 두 칸에 복사된 수기 행이 있다.

    판정(셋 다 만족해야 한다 — 좁게 잡아 오제외를 막는다):
      · 도달수 채널 계열(매거진·배너)이다 — 다른 채널로 번지지 않게 한정
      · 자동수집 조회수가 이력에 한 번도 없다
      · 도달수는 실제로 있다 — 지표가 아예 없는 글은 수집 실패일 수 있으므로 제외하지 않는다

    self-heal: 자동 조회수가 한 번이라도 들어오면 조건이 깨져 다시 감시 대상으로 돌아온다.
    """
    text = str(channel_type or "")
    if "매거진" not in text and "배너" not in text:
        return False
    return bool(has_reach_ever) and not has_auto_play_ever


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
# 계정 라벨 '(플랫폼/서비스)' = 유상 계약에 서비스로 얹어준 추가 게시물 → 0원이 정상.
#   실측(2026-09-07): account_name 에 '서비스' 가 든 7건 전부 cost=0(닥터후 6·돈되는정보 1),
#   cost>0 은 0건. ⚠️ '/' 를 요구하고 **account_name 만** 본다 — 소재명(asset_name)에는
#   "팬서비스로 커뮤에서 난리난" 같은 문구가 실제로 있어(2건) 그대로 훑으면 오판정한다.
SERVICE_MARK = "/서비스"
# 프로젝트/소재명이 '무상협찬' = 팀이 무상으로 명시한 협찬 → 0원이 정상.
#   실측: 이 문구가 든 3건(투데이단·한입혜원·오부심) 전부 cost=0. ⚠️ 바로 '무상' 으로
#   넓히지 않는다 — '트위터 무상시딩' 2건은 cost=14,408(>0)이라 성격이 다르다.
FREE_PROJECT_MARK = "무상협찬"


def is_mirror_label(account_name: Any) -> bool:
    """계정 라벨이 미러링(원본을 다른 플랫폼에 복제 게시)인가.

    ⚠️ 호출부에서 `"미러링" in name` 을 직접 쓰지 말 것 — is_banner_channel 이 Python 10곳·
    TS 20곳에 흩어져 규칙이 어긋났던 것과 같은 함정이다(계약 테스트로 금지).
    """
    return MIRROR_MARK in str(account_name or "")


def is_service_label(account_name: Any) -> bool:
    """계정 라벨이 '(플랫폼/서비스)'(무상 제공 추가 게시)인가.

    ⚠️ account_name 전용. asset_name/project_name 에 쓰면 '팬서비스' 같은 소재 문구에 걸린다.
    """
    return SERVICE_MARK in str(account_name or "")


def free_reason(channel_type: Any, account_name: Any = None,
                project_name: Any = None, asset_name: Any = None) -> str | None:
    """cost=0 이 정상인 이유. 정상이 아니면 None(='가격미매핑'으로 확인 필요).

    사유를 문자열로 돌려주는 이유 — 감시가 사유별로 세야 규칙이 깨진 것을 알아챌 수 있다
    (합쳐 세면 위성채널 수백 건에 묻힌다). 사용자 승인 2026-09-07: 미러링·서비스·무상협찬.
    """
    if any(x in str(channel_type or "") for x in FREE_CH):
        return "무상채널"
    if is_mirror_label(account_name):
        return "미러링"
    if is_service_label(account_name):
        return "서비스"
    if any(FREE_PROJECT_MARK in str(x or "") for x in (project_name, asset_name)):
        return FREE_PROJECT_MARK
    return None


# 리포트 CPV 라벨에 사유를 덧붙일 사유들. '무상채널'·'무상협찬'은 덧붙이면 중복이라 뺀다.
LABELED_REASONS = (MIRROR_MARK, "서비스")


def free_cpv_label(reason: Any) -> str:
    """무상 사유 → 리포트 표기('무상(미러링)' / '무상(서비스)' / '무상').

    ⚠️ 라벨 판단도 여기 둔다 — 호출부에서 `reason == "미러링"` 을 쓰면 판정이 다시 흩어진다.
    """
    return f"무상({reason})" if reason in LABELED_REASONS else "무상"


def is_free_by_design(channel_type: Any, account_name: Any = None,
                      project_name: Any = None, asset_name: Any = None) -> bool:
    """cost=0 이 정상인 게시물인가(True=무상, False=가격미매핑으로 확인 필요)."""
    return free_reason(channel_type, account_name, project_name, asset_name) is not None
