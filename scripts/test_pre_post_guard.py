"""pre-post 가드 회귀 테스트 (2026-08-06).

게시일 이전 measured_at 행이 raw post_daily_stats에 잠복해 정합성 알림을 울린 사고
(Ufo__green·dolkki_daily·moduhappy 08-04게시·08-03이력 등)의 재발방지.
수집기가 upsert 직전 게시일 이전 행을 저장 대상에서 제외하는지 잠근다.
"""

from run_monitoring import _drop_pre_post_rows


POSTS = [
    {"id": "p_new", "posted_at": "2026-08-04"},
    {"id": "p_old", "posted_at": "2026-06-13"},
    {"id": "p_nodate", "posted_at": None},
]


def test_drops_row_measured_before_posted():
    rows = [{"post_id": "p_new", "measured_at": "2026-08-03", "play_count": 7101}]
    kept, dropped = _drop_pre_post_rows(rows, POSTS)
    assert kept == []
    assert len(dropped) == 1


def test_keeps_row_on_posted_day_and_after():
    rows = [
        {"post_id": "p_new", "measured_at": "2026-08-04", "play_count": 21000},
        {"post_id": "p_new", "measured_at": "2026-08-05", "play_count": 41000},
    ]
    kept, dropped = _drop_pre_post_rows(rows, POSTS)
    assert len(kept) == 2
    assert dropped == []


def test_drops_multi_day_pre_post():
    rows = [{"post_id": "p_old", "measured_at": "2026-06-10", "play_count": 500}]
    kept, dropped = _drop_pre_post_rows(rows, POSTS)
    assert kept == []
    assert len(dropped) == 1


def test_keeps_when_posted_at_unknown():
    # posted_at 없으면 판단하지 않는다(값 지어내지 않음 = 함부로 버리지도 않음)
    rows = [{"post_id": "p_nodate", "measured_at": "2026-01-01", "play_count": 10}]
    kept, dropped = _drop_pre_post_rows(rows, POSTS)
    assert len(kept) == 1
    assert dropped == []


def test_mixed_batch_partitions_correctly():
    rows = [
        {"post_id": "p_new", "measured_at": "2026-08-03", "play_count": 1},   # drop
        {"post_id": "p_new", "measured_at": "2026-08-04", "play_count": 2},   # keep
        {"post_id": "p_old", "measured_at": "2026-06-10", "play_count": 3},   # drop
        {"post_id": "p_nodate", "measured_at": "2020-01-01", "play_count": 4},# keep
    ]
    kept, dropped = _drop_pre_post_rows(rows, POSTS)
    assert sorted(r["measured_at"] for r in kept) == ["2020-01-01", "2026-08-04"]
    assert sorted(r["measured_at"] for r in dropped) == ["2026-06-10", "2026-08-03"]
