"""인스타 조회수 보조 수집(data-slayer) 대상 고르기 — 순수 함수만 둔다(테스트 대상).

기본 액터(apify/instagram-scraper)가 글은 돌려주면서 조회수 키만 빼는 경우가 있다.
예전 선택 폴백은 '직전 측정에 조회수가 있던 글'만 보조 수집기로 다시 물었다. 그래서
  ① 처음부터 조회수를 한 번도 못 받은 새 영상
  ② 한 번 실패해 직전 행에 조회수가 빈 영상(그날 좋아요·댓글만 저장되면 다음날부터 대상 밖)
은 보조 수집기 대상에서 영원히 빠졌다.

🚨 2026-11-24 실사고: p.25_d.y `p/DgAd6JuTEBX`(바치케 무상시딩 영상, 프로필 그리드 2,408회).
   기본 액터 응답 = Video·clips, 좋아요 10·댓글 2인데 `videoPlayCount`/`videoViewCount` 키가 없었다.
   data-slayer = play 2,409(ig 2,192 + fb 217). 11/22·11/23 이틀 내리 조회수가 비었다.
"""
from __future__ import annotations

from typing import Callable, Iterable

# 선택 폴백 1회 상한 — 기존 '일일 20건 상한'과 같은 값. data-slayer는 기본 액터의 ~2.7배 비용.
IG_SELECTIVE_FALLBACK_CAP = 20

# 보조 수집기에서 온 조회수 표시. data-slayer metrics의 명시적 조회수 키(ig_play_count/play_count)라
# 좋아요·댓글 수가 섞여 들어올 경로가 없다 → 기본 액터의 videoPlayCount와 같은 '신뢰 출처'로 본다.
# (출처를 비워 두면 새 글의 첫 조회수가 비율 추정 가드에 걸려 다시 버려질 수 있다 —
#  무상시딩 글은 댓글 이벤트로 댓글이 많은 게 정상이라 2026-10-13 neighbor.mia 오탐과 같은 모양.)
FALLBACK_PLAY_SOURCE = "data-slayer"

_VIDEO_MEDIA_TYPES = frozenset({"video"})
_VIDEO_PRODUCT_TYPES = frozenset({"clips", "igtv"})


def is_ig_video(stat: dict | None, channel_type: str | None) -> bool:
    """이 글이 조회수가 나와야 정상인 영상인가.

    기본 액터 응답의 형식(type/productType)이 있으면 그것을 믿는다 — 사진·캐러셀은 원래 조회수가 없다.
    응답에 형식이 없을 때만 시트 채널분류의 '영상' 표기로 판단한다."""
    s = stat or {}
    media = str(s.get("media_type") or "").strip().lower()
    product = str(s.get("product_type") or "").strip().lower()
    if media or product:
        return media in _VIDEO_MEDIA_TYPES or product in _VIDEO_PRODUCT_TYPES
    return "영상" in str(channel_type or "")


def video_missing_without_previous_play(
    posts: Iterable[dict],
    ig_url_set: set,
    stats_by_key: dict,
    last_stat: dict,
    key_fn: Callable[[str], str],
) -> list[str]:
    """직전 행에 조회수가 없는데(새 글·한 번 실패한 글) 이번 기본 액터 응답에도 조회수가 없는 영상 URL.

    - 기본 액터가 글 자체를 돌려준 경우만 담는다. 응답이 아예 없으면(삭제·비공개·다른 링크일 수 있음)
      보조 수집값에 게시일이 없어 저장 루프의 게시일 가드를 거치지 못하므로 제외한다.
    - 삭제 확정(deleted) 응답은 not_found 경로가 맡으므로 제외한다.
    - 직전 행에 조회수가 있던 글은 기존 '직전값 보유' 경로(exp_missing)가 맡는다."""
    out: list[str] = []
    for p in posts:
        url = p.get("url") or ""
        if url not in ig_url_set:
            continue
        if (last_stat.get(p.get("id")) or {}).get("play_count") is not None:
            continue
        s = stats_by_key.get(key_fn(url))
        if not s or s.get("play_count") or s.get("deleted"):
            continue
        if not is_ig_video(s, p.get("channel_type")):
            continue
        out.append(url)
    return out


def selective_fallback_targets(
    previous_missing: Iterable[str],
    video_missing: Iterable[str],
    cap: int = IG_SELECTIVE_FALLBACK_CAP,
) -> list[str]:
    """보조 수집기에 물을 URL 목록.

    직전값이 있던 글(이어지던 추이가 끊긴 글)을 먼저, 그다음 조회수 없는 영상. 중복은 빼고 상한까지만."""
    out: list[str] = []
    seen: set = set()
    for url in list(previous_missing) + list(video_missing):
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= cap:
            break
    return out
