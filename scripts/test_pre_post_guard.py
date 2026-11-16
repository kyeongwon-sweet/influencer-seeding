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


def test_drops_row_before_registration_when_posted_at_unknown():
    """2026-11-16: 게시일이 빈 신규 글(11-06 등록)을 11-06 오후 재수집이 11-05로 적던 경로 차단."""
    posts = [{"id": "p_late", "posted_at": None, "created_at": "2026-11-06T08:38:33+00:00"}]   # 11-06 17:38 KST 등록
    kept, dropped = _drop_pre_post_rows(
        [{"post_id": "p_late", "measured_at": "2026-11-05", "play_count": 6627},
         {"post_id": "p_late", "measured_at": "2026-11-06", "play_count": 13770}], posts)
    assert [r["measured_at"] for r in kept] == ["2026-11-06"]
    assert [r["measured_at"] for r in dropped] == ["2026-11-05"]


def test_registration_bound_uses_kst_date():
    """등록 시각이 KST 새벽(UTC 전날)이어도 KST 날짜로 판정한다."""
    posts = [{"id": "p_dawn", "posted_at": None, "created_at": "2026-11-05T16:30:00+00:00"}]   # 11-06 01:30 KST
    kept, dropped = _drop_pre_post_rows([{"post_id": "p_dawn", "measured_at": "2026-11-05", "play_count": 5}], posts)
    assert kept == [] and len(dropped) == 1


def test_posted_at_wins_over_registration_date():
    """게시일이 있으면 등록일은 보지 않는다(기존 정책 유지 — 늦게 등록한 글 귀속은 별도 결정)."""
    posts = [{"id": "p_known", "posted_at": "2026-11-05", "created_at": "2026-11-06T03:27:00+00:00"}]
    kept, dropped = _drop_pre_post_rows([{"post_id": "p_known", "measured_at": "2026-11-05", "play_count": 10678}], posts)
    assert len(kept) == 1 and dropped == []
