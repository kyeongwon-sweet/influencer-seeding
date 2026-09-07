"""배너 판정 회귀 테스트 — 2026-08-18 매거진 경계 규칙."""
from __future__ import annotations

from channel_kind import MAGAZINE_BANNER_FROM, is_banner_channel, is_free_by_design


def test_name_contains_banner_is_always_banner():
    assert is_banner_channel("바이럴 (배너)")
    assert is_banner_channel("위성채널 (배너)", "2020-01-01")
    assert is_banner_channel("협찬 (파워채널/매거진 배너)", "2026-08-07")
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


# ── is_free_by_design (cost=0 정상 판정) ─────────────────────────────────
def test_free_channels_are_free():
    for ct in ("온드미디어", "위성채널", "위성채널 (배너)", "무상시딩 (영상)"):
        assert is_free_by_design(ct)


def test_mirror_label_is_free_by_design():
    """🚨 미러링은 원본에 비용이 붙어 있어 복제분 0원이 정상 — '가격미매핑' 오탐 금지.
    (2026-09-07 오하루(틱톡/미러링) 사건. 실측 23건이 이 상태였다.)"""
    for name in ("오하루(틱톡/미러링)", "이나 (유튜브/미러링)", "foxzzal(스레드/미러링)",
                 "제주여행 (페이스북/미러링))", "이평(틱톡 미러링)"):
        assert is_free_by_design("협찬 (인플루언서)", name)
        assert is_free_by_design("바이럴 (배너)", name)


def test_paid_channel_without_mirror_stays_unmapped():
    """미러링이 아닌 유상채널 cost=0 은 계속 '가격미매핑'으로 남아야 한다(팀 입력 대기)."""
    for name in ("힐링하고 가세요", "맨투맨 스튜디오", "닥터후 (틱톡/서비스)", "오하루", None, ""):
        assert not is_free_by_design("바이럴 (배너)", name)
        assert not is_free_by_design("협찬 (인플루언서)", name)


def test_free_by_design_ignores_project_asset_fields():
    """account_name 만 본다 — project/asset 에는 위성채널 139건이 '미러링'을 품어 신호가 오염된다."""
    assert not is_free_by_design("협찬 (인플루언서)", "이슈박스(유튜브)")
