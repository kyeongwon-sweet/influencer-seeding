#!/usr/bin/env python3
"""'가격미매핑' 워치독 회귀 테스트.

2026-09-07 사고: 09-03 `6682119e` 가 판정 범위를 유상채널 전체로 넓히자 **미러링 23건이
전부 오탐**이 됐는데 총량을 세는 곳이 없어 4일간 아무도 몰랐다(사람이 눈으로 발견).
아래 테스트는 ① 미러링을 다시 미매핑으로 세지 않는지 ② 무상 제외 건수를 함께 보고하는지
(규칙 붕괴 감지) ③ 종료글·유상글을 끌어들이지 않는지 를 고정한다.
"""
from __future__ import annotations

from cost_mapping_guard import STALE_DAYS, unmapped_cost_actives, unmapped_cost_line

TODAY = "2026-09-07"


def _post(**kw):
    base = {"account_name": "테스트", "channel_type": "협찬 (인플루언서)", "cost": 0,
            "posted_at": "2026-09-05", "ended_at": None, "url": "https://x/1"}
    base.update(kw)
    return base


def test_mirror_is_not_counted_as_unmapped():
    """🚨 미러링 0원은 정상(원본에 비용) — 미매핑으로 세면 09-03~09-07 오탐 재발."""
    agg = unmapped_cost_actives([_post(account_name="오하루(틱톡/미러링)")], TODAY)
    assert agg["unmapped"] == []
    assert agg["mirror"] == 1 and agg["free_ch"] == 0
    assert unmapped_cost_line(agg, TODAY) is None


def test_free_channels_are_not_counted():
    posts = [_post(channel_type="위성채널"), _post(channel_type="온드미디어"),
             _post(channel_type="무상시딩 (영상)")]
    agg = unmapped_cost_actives(posts, TODAY)
    assert agg["unmapped"] == [] and agg["free_ch"] == 3 and agg["mirror"] == 0


def test_paid_zero_cost_is_reported_with_url():
    """알림엔 계정명만이 아니라 URL 을 넣는다(계정 하나에 글 여러 개)."""
    agg = unmapped_cost_actives([_post(account_name="힐링하고 가세요", url="https://ig/abc")], TODAY)
    assert len(agg["unmapped"]) == 1
    line = unmapped_cost_line(agg, TODAY)
    assert "가격미매핑 활성 1건" in line and "https://ig/abc" in line


def test_ended_and_paid_posts_are_excluded():
    posts = [_post(ended_at="2026-09-01"), _post(cost=500000)]
    assert unmapped_cost_actives(posts, TODAY)["unmapped"] == []


def test_mirror_and_free_channel_counts_are_reported_separately():
    """🚨 미러링을 무상채널과 합치면 위성 수백 건에 묻혀 규칙 붕괴가 안 보인다 — 분리 보고 고정."""
    posts = [_post(account_name="힐링하고 가세요"), _post(account_name="이나 (틱톡/미러링)"),
             _post(channel_type="위성채널"), _post(channel_type="위성채널")]
    line = unmapped_cost_line(unmapped_cost_actives(posts, TODAY), TODAY)
    assert "미러링 1건" in line and "무상채널 2건" in line


def test_stale_count_uses_threshold():
    old = _post(account_name="옛건", posted_at="2026-08-01")     # 37일
    new = _post(account_name="새건", posted_at="2026-09-06")     # 1일
    line = unmapped_cost_line(unmapped_cost_actives([new, old], TODAY), TODAY)
    assert f"{STALE_DAYS}일+ 방치 1건" in line
    assert line.index("옛건") < line.index("새건")               # 오래된 것부터


def test_bad_posted_at_does_not_crash():
    line = unmapped_cost_line(unmapped_cost_actives([_post(posted_at=None)], TODAY), TODAY)
    assert "가격미매핑 활성 1건" in line
