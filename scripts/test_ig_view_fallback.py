"""새 영상·한 번 실패한 영상도 보조 수집기(data-slayer)로 다시 묻는지 고정한다.

🚨 2026-11-24 실사고: p.25_d.y `p/DgAd6JuTEBX`(바치케 무상시딩 영상, 프로필 2,408회).
   기본 액터는 Video·clips·좋아요 10·댓글 2로 답하면서 조회수 키를 빼먹었고,
   선택 폴백은 '직전 측정에 조회수가 있던 글'만 다시 물어서 이 새 영상은 영구히 대상 밖이었다.
"""
from pathlib import Path

import run_monitoring as rm
from collector_reasons import reason_text
from ig_view_fallback import (
    FALLBACK_PLAY_SOURCE,
    IG_SELECTIVE_FALLBACK_CAP,
    is_ig_video,
    selective_fallback_targets,
    video_missing_without_previous_play,
)

SOURCE = Path(__file__).with_name("run_monitoring.py").read_text(encoding="utf-8")

REEL = "https://www.instagram.com/p/DgAd6JuTEBX/"
POST = {"id": "d8714cae", "url": REEL, "channel_type": "무상시딩 (영상)"}
# 실제 11/23 기본 액터 응답 모양(조회수 키 없음)
REEL_WITHOUT_PLAY = {
    "url": REEL, "play_count": None, "play_count_source": None,
    "likes_count": 10, "comments_count": 2,
    "media_type": "Video", "product_type": "clips", "deleted": False, "error_code": None,
}


def _missing(stat, last_stat=None, post=POST):
    stats_by_key = {REEL: stat} if stat is not None else {}
    return video_missing_without_previous_play([post], {REEL}, stats_by_key, last_stat or {}, lambda u: u)


# ── 영상 판정 ────────────────────────────────────────────────────────────────
def test_액터_형식이_있으면_그것을_믿는다():
    assert is_ig_video({"media_type": "Video", "product_type": "clips"}, None)
    assert is_ig_video({"product_type": "clips"}, None)
    assert not is_ig_video({"media_type": "Image"}, "무상시딩 (영상)"), "액터가 사진이라면 사진이다"
    assert not is_ig_video({"media_type": "Sidecar"}, "무상시딩 (영상)")


def test_형식이_없을_때만_채널분류의_영상_표기를_본다():
    assert is_ig_video({}, "무상시딩 (영상)")
    assert not is_ig_video({}, "무상시딩 (피드)")
    assert not is_ig_video(None, None)


# ── 대상 고르기 ──────────────────────────────────────────────────────────────
def test_사고재현_새_영상이_조회수_없이_오면_보조수집_대상():
    assert _missing(REEL_WITHOUT_PLAY) == [REEL]


def test_한번_실패해_직전행에_조회수가_빈_영상도_대상():
    # 직전 행이 좋아요·댓글만 있는 경우 — 예전엔 다음날부터 영원히 대상 밖이었다
    assert _missing(REEL_WITHOUT_PLAY, {"d8714cae": {"play_count": None, "likes_count": 10}}) == [REEL]


def test_직전값_보유_글은_기존_경로가_맡는다():
    assert _missing(REEL_WITHOUT_PLAY, {"d8714cae": {"play_count": 1200}}) == []


def test_사진은_원래_조회수가_없으니_대상_아님():
    assert _missing(dict(REEL_WITHOUT_PLAY, media_type="Image", product_type="feed")) == []


def test_응답이_아예_없으면_대상_아님__게시일_가드를_못_거친다():
    assert _missing(None) == []


def test_삭제_확정_응답은_not_found_경로가_맡는다():
    assert _missing(dict(REEL_WITHOUT_PLAY, deleted=True)) == []


def test_조회수가_이미_있으면_대상_아님():
    assert _missing(dict(REEL_WITHOUT_PLAY, play_count=2192)) == []


def test_보조수집_목록은_직전값_보유_우선_중복제거_상한():
    assert selective_fallback_targets(["a", "b"], ["b", "c"]) == ["a", "b", "c"]
    prev = [f"p{i}" for i in range(15)]
    new = [f"n{i}" for i in range(10)]
    got = selective_fallback_targets(prev, new)
    assert len(got) == IG_SELECTIVE_FALLBACK_CAP == 20
    assert got[:15] == prev and got[15:] == new[:5]
    assert selective_fallback_targets([f"p{i}" for i in range(30)], ["n"]) == [f"p{i}" for i in range(20)]


# ── 보조 수집값이 다시 버려지지 않게 ─────────────────────────────────────────
def test_보조수집_조회수는_비율추정_가드에_걸리지_않는다():
    # 무상시딩 댓글 이벤트 모양: 댓글 50, 조회수 900 (≤ 댓글×20) — 출처 미상이면 버려지던 값
    assert rm._looks_like_engagement_count_as_views(900, None, 50, None, had_play_before=False, source=None)
    assert not rm._looks_like_engagement_count_as_views(
        900, None, 50, None, had_play_before=False, source=FALLBACK_PLAY_SOURCE
    )


def test_보조수집이라도_숫자가_좋아요수_모양이면_여전히_거른다():
    assert rm._looks_like_engagement_count_as_views(10, 10, 2, None, had_play_before=False, source=FALLBACK_PLAY_SOURCE)


# ── 수집기 본체 배선(계약) ───────────────────────────────────────────────────
def test_수집기가_새_규칙을_실제로_쓴다():
    assert "video_missing = video_missing_without_previous_play(" in SOURCE
    assert 'if not is_banner_channel(p.get("channel_type"), p.get("posted_at"))],' in SOURCE, (
        "배너는 저장 루프가 조회수를 버리므로 보조 수집 대상에서 빠져야 한다"
    )
    assert "ig_url_set, stats_by_key, prev_ig, _stats_key," in SOURCE
    assert "elif exp_missing or video_missing:" in SOURCE
    assert "missing = selective_fallback_targets(exp_missing, video_missing)" in SOURCE
    assert "missing = exp_missing[:20]" not in SOURCE, "옛 '직전값 보유만' 선택 폴백이 되살아났다"


def test_두_폴백_경로_모두_조회수_출처를_남긴다():
    assert SOURCE.count('cur["play_count_source"] = FALLBACK_PLAY_SOURCE') == 2


def test_기본_액터_결과에_글_형식이_실린다():
    assert '"media_type": item.get("type")' in SOURCE
    assert '"product_type": item.get("productType")' in SOURCE


def test_조회수_미반환_사유는_사진과_영상을_구별해_안내한다():
    assert "보조 수집기" in reason_text({"reason": "missing_play_count", "media_type": "Video"})
    assert "사진·캐러셀" in reason_text({"reason": "missing_play_count", "media_type": "Image"})
    assert "보조 수집기" in reason_text({"reason": "missing_play_count"})
