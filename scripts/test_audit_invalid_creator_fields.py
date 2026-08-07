"""제작자/기획자 이상값 감사의 판정 규칙 회귀 테스트.

배경(2026-08-07 실측):
  · 소재명 앞 장식 문자(⠿ 등)를 못 벗기면 정상 소재명을 "파싱 불가"로 오판해
    **올바른 담당자 값을 이상값으로 잡는다**. 장식 문자를 하나씩 추가해 온 방식이라
    새 글자가 나오면 같은 사고가 반복된다 → 유니코드 카테고리로 일반화했다.
  · "비광고성_외부영상_미러링_…"은 **소재명에 담당자를 적지 않는 규칙**이라
    애초에 판정 대상이 아니다(실측 50건, 전부 위성채널·비용 0).
  · 사용자 지시: **수동 입력한 제작자/기획자는 유지**한다 → --apply 대상에서 제외.
"""
from __future__ import annotations

import audit_invalid_creator_fields as mod


AD_ASSET = "[26.07]F_V_JD멜_바이럴_쫀득바출시_바이럴형_렉카형_main.렉카_끝없이.X_2P_이재원_260711_빙과_최재헌"


def _row(**kw):
    base = {"id": "x", "url": "u", "account_name": "a", "channel_type": "바이럴 (영상)",
            "asset_name": None, "project_name": None, "planner": None, "creator": None, "manual_fields": []}
    base.update(kw)
    return base


def test_plain_ad_asset_is_not_an_issue():
    assert mod.build_issue(_row(asset_name=AD_ASSET, planner="이재원")) is None


def test_decorative_prefix_is_stripped():
    # ⠿(U+283F 점자) 드래그 핸들이 붙어도 정상 소재명으로 인식해야 한다.
    assert mod.build_issue(_row(asset_name="⠿" + AD_ASSET, planner="이재원")) is None
    # 목록에 없던 새 장식 문자도 카테고리 기반으로 처리된다(하드코딩 추가 없이).
    for deco in ("★", "▪", "→", "…", "​", "· "):
        assert mod.build_issue(_row(asset_name=deco + AD_ASSET, planner="이재원")) is None, deco


def test_bracket_is_never_stripped():
    # '['는 규칙의 시작 문자라 벗기면 안 된다.
    assert mod.creator_source_text("⠿" + AD_ASSET).startswith("[")


def test_non_ad_mirroring_is_exempt():
    # 비광고성 미러링은 담당자를 소재명에 안 적는 유형 → 이상 아님.
    for name in ("비광고성_외부영상_미러링_이나연_슈퍼카",
                 "비광고성_외부_영상_미러링_에스파_잘_먹는_여돌_1위",
                 "⠿비광고성_외부영상_미러링_카리나_가지먹방"):
        assert mod.build_issue(_row(asset_name=name, planner="이세진", channel_type="위성채널")) is None, name


def test_real_issue_is_still_caught():
    # 규칙도 안 따르고 비광고성도 아닌데 담당자가 있으면 여전히 잡아야 한다.
    issue = mod.build_issue(_row(asset_name="아무렇게나 적은 소재명", planner="홍길동"))
    assert issue is not None
    assert issue["clear_planner"] is True


def test_manual_entries_are_reported_but_never_cleared():
    """🚨 사용자 지시: 수동 입력한 제작자/기획자는 유지한다."""
    issue = mod.build_issue(_row(asset_name="규칙없음", planner="홍길동", creator="김철수",
                                 manual_fields=["planner", "creator"]))
    assert issue is not None, "보고에는 남아야 한다"
    assert issue["manual_planner"] is True and issue["manual_creator"] is True
    assert issue["clear_planner"] is False and issue["clear_creator"] is False
    assert mod.select_for_update([issue], "both") == [], "수동 입력분은 삭제 대상이 되면 안 된다"


def test_mixed_manual_clears_only_the_auto_field():
    issue = mod.build_issue(_row(asset_name="규칙없음", planner="홍길동", creator="김철수",
                                 manual_fields=["planner"]))
    assert issue["clear_planner"] is False
    assert issue["clear_creator"] is True
    assert mod.select_for_update([issue], "planner") == []
    assert len(mod.select_for_update([issue], "creator")) == 1


def test_empty_fields_are_not_issues():
    assert mod.build_issue(_row(asset_name="규칙없음")) is None
    assert mod.build_issue(_row(asset_name="규칙없음", planner="   ")) is None


def test_project_name_is_used_when_asset_name_missing():
    # 구 데이터 호환: asset_name이 없으면 project_name을 소재명으로 본다.
    assert mod.build_issue(_row(project_name=AD_ASSET, planner="이재원")) is None
