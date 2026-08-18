"""배너 판정 회귀 테스트 — 2026-08-18 매거진 경계 규칙."""
from __future__ import annotations

from channel_kind import MAGAZINE_BANNER_FROM, is_banner_channel


def test_name_contains_banner_is_always_banner():
    assert is_banner_channel("바이럴 (배너)")
    assert is_banner_channel("위성채널 (배너)", "2020-01-01")
    assert is_banner_channel("Viral Banner", "2020-01-01")


def test_magazine_before_cutoff_stays_view_metric():
    """🚨 기존 매거진 41건(최신 게시일 2026-06-30)은 조회수 실측 621행이 있다 — 배너로 뒤집지 않는다."""
    assert not is_banner_channel("협찬 (파워채널/매거진)", "2026-06-30")
    assert not is_banner_channel("협찬 (파워채널/매거진)", "2025-09-22")


def test_magazine_from_cutoff_is_banner():
    assert is_banner_channel("협찬 (파워채널/매거진)", MAGAZINE_BANNER_FROM)
    assert is_banner_channel("협찬 (파워채널/매거진)", "2026-09-01")


def test_magazine_without_posted_at_is_not_banner():
    """게시일을 모르면 경계 판정 불가 — 기존 동작(조회수)을 유지한다."""
    assert not is_banner_channel("협찬 (파워채널/매거진)")
    assert not is_banner_channel("협찬 (파워채널/매거진)", "")
    assert not is_banner_channel("협찬 (파워채널/매거진)", "2026-08")


def test_mukstar_is_reels_not_banner():
    """먹스타 = 릴스 → 조회수 지표. 경계일 이후라도 배너가 아니다."""
    assert not is_banner_channel("협찬 (파워채널/먹스타)", "2026-09-01")


def test_other_types_unchanged():
    for ct in ("바이럴 (영상)", "협찬 (인플루언서)", "위성채널", "온드미디어", "무상시딩 (영상)", None):
        assert not is_banner_channel(ct, "2026-09-01")
