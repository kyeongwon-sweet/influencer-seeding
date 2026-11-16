"""리포트 날짜 귀속 재발방지(2026-11-16).

① 게시일 이전 날짜의 측정행은 세지 않는다 — 11-05 리포트에 11-06 게시 글(여원맛집 6,627)이 들어갔다.
   값은 사라지지 않고 게시일 첫 유효측정에 함께 잡힌다(실측 22건 8,306회 이동·누락 0).
② 기록이 며칠 비었다가 들어온 글은 'N일치'로 표시 — 11-09 매거진 3건이 5일치 합산이었다.
"""
from notify_increments import increment_span_days, rows_on_or_after_posted

V = lambda r: r.get("play_count")


def test_pre_post_rows_are_not_counted():
    rows = [{"measured_at": "2026-11-05", "play_count": 6627}, {"measured_at": "2026-11-06", "play_count": 13770}]
    kept = rows_on_or_after_posted(rows, "2026-11-06")
    assert [r["measured_at"] for r in kept] == ["2026-11-06"]


def test_value_moves_to_posted_day_not_lost():
    """게시일 이전 행을 빼면 게시일 첫 측정이 '그날 전체'가 된다 — 이틀 합(13,770)이 그대로 남는다."""
    rows = rows_on_or_after_posted(
        [{"measured_at": "2026-11-05", "play_count": 6627}, {"measured_at": "2026-11-06", "play_count": 13770}], "2026-11-06")
    first = rows[0]["play_count"]          # 직전 유효 없음 → 첫 측정 = 그날 전체
    assert first == 13770


def test_unknown_posted_at_keeps_all_rows():
    rows = [{"measured_at": "2026-11-05", "play_count": 1}]
    assert rows_on_or_after_posted(rows, None) == rows


def test_span_one_day_when_previous_day_exists():
    rows = [{"measured_at": "2026-11-08", "play_count": 100}, {"measured_at": "2026-11-09", "play_count": 150}]
    assert increment_span_days(rows, "2026-11-04", "2026-11-09", V) == 1


def test_span_counts_gap_since_last_valid_measurement():
    """11-09 매거진: 11-04 수기 도달수 뒤 11-05~08 빈 칸 → 11-09 증분은 5일치."""
    rows = [{"measured_at": "2026-11-04", "play_count": 68621}] +            [{"measured_at": f"2026-11-0{d}", "play_count": None} for d in (5, 6, 7, 8)] +            [{"measured_at": "2026-11-09", "play_count": 104710}]
    assert increment_span_days(rows, "2026-11-04", "2026-11-09", V) == 5


def test_span_first_measurement_is_one_day():
    rows = [{"measured_at": "2026-11-09", "play_count": 500}]
    assert increment_span_days(rows, "2026-11-09", "2026-11-09", V) == 1


def test_span_ignores_pre_post_rows():
    """게시일 이전 행은 '직전 측정'으로도 쓰지 않는다."""
    rows = [{"measured_at": "2026-11-05", "play_count": 6627}, {"measured_at": "2026-11-06", "play_count": 13770}]
    assert increment_span_days(rows, "2026-11-06", "2026-11-06", V) == 1
