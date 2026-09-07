#!/usr/bin/env python3
"""notify_status 5-b 복사값 알림의 의도적 값 공유 제외 규칙."""
from __future__ import annotations

from notify_status import _shares_values_by_design


def test_account_only_mirror_is_excluded_from_copy_alert():
    """실제 구멍: 오하루는 account_name 에만 미러링 라벨이 있다."""
    assert _shares_values_by_design({
        "account_name": "오하루(틱톡/미러링)",
        "asset_name": "일반 소재",
        "project_name": "일반 프로젝트",
        "channel_type": "협찬 (인플루언서)",
    })


def test_legacy_asset_or_project_mirror_labels_are_still_excluded():
    assert _shares_values_by_design({"asset_name": "비광고성_외부영상_미러링", "channel_type": "협찬"})
    # asset_name 이 있어도 project_name 의 미러링 표기를 놓치지 않는다.
    assert _shares_values_by_design({
        "asset_name": "일반 소재",
        "project_name": "미러링 프로젝트",
        "channel_type": "협찬",
    })


def test_internal_channels_are_still_excluded():
    assert _shares_values_by_design({"account_name": "일반 계정", "channel_type": "위성채널"})
    assert _shares_values_by_design({"account_name": "일반 계정", "channel_type": "온드미디어"})


def test_free_labels_alone_do_not_suppress_copy_alerts():
    """서비스·무상협찬은 무상 근거이지 동일값 공유 근거가 아니다."""
    assert not _shares_values_by_design({
        "account_name": "닥터후 (틱톡/서비스)",
        "project_name": "일반 프로젝트",
        "channel_type": "협찬 (인플루언서)",
    })
    assert not _shares_values_by_design({
        "account_name": "일반 계정",
        "project_name": "무상협찬",
        "channel_type": "협찬 (인플루언서)",
    })
