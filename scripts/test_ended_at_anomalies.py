#!/usr/bin/env python3
"""종료일 이상 감지 단위 테스트 — 2026-09-03 무디 배너 사건을 회귀 케이스로 고정.

아래 값은 전부 2026-09-03 실측(게시물 3,473건 전수 조회)에서 가져온 것이다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ended_at_anomalies import (  # noqa: E402
    created_kst_date,
    ended_at_anomaly_lines,
    find_ended_at_anomalies,
)

TODAY = "2026-09-03"

# 실측: 무디 배너 — 종료(9/1) 다음날 등록돼 도달수가 0행이었다.
MOODY = {
    "url": "https://www.instagram.com/p/DcL9yZ3EpaS/",
    "account_name": "glinda_yoon",
    "channel_type": "바이럴 (배너)",
    "posted_at": "2026-08-19",
    "ended_at": "2026-09-01",
    "created_at": "2026-09-02T10:00:27.933319+00:00",
}
# 실측: 2026-06-12 게시분 9건 중 하나 — 종료일(6/8)이 게시일(6/12)보다 앞선다.
PRE_ENDED = {
    "url": "https://www.instagram.com/p/DZe0iIVko2A/",
    "account_name": "dolkki_daily",
    "channel_type": "바이럴 (배너)",
    "posted_at": "2026-06-12",
    "ended_at": "2026-06-08",
    "created_at": "2026-06-18T02:30:00+00:00",
}
# 실측: 같은 8/19 게시 정상 배너(도달수 12개 적재됨)
HEALTHY = {
    "url": "https://www.instagram.com/p/DcNormal1/",
    "account_name": "Ufo__blue",
    "channel_type": "바이럴 (배너)",
    "posted_at": "2026-08-19",
    "ended_at": "2026-08-27",
    "created_at": "2026-08-19T05:00:00+00:00",
}


def test_moody_case_is_born_ended():
    out = find_ended_at_anomalies([MOODY], TODAY)
    assert out["ended_before_posted"] == []
    assert len(out["born_ended"]) == 1
    assert out["born_ended"][0]["recent"] is True
    assert out["born_ended"][0]["created_kst"] == "2026-09-02"


def test_ended_before_posted_is_not_double_counted():
    """①에 걸린 건은 ②로 또 세지 않는다(같은 게시물이 두 줄로 알림되는 것 방지)."""
    out = find_ended_at_anomalies([PRE_ENDED], TODAY)
    assert len(out["ended_before_posted"]) == 1
    assert out["born_ended"] == []
    assert out["ended_before_posted"][0]["recent"] is False   # 2026-06 등록 = 과거분


def test_healthy_post_is_not_flagged():
    assert find_ended_at_anomalies([HEALTHY], TODAY) == {"ended_before_posted": [], "born_ended": []}


def test_active_post_without_ended_at_is_skipped():
    active = dict(HEALTHY, ended_at=None)
    assert find_ended_at_anomalies([active], TODAY) == {"ended_before_posted": [], "born_ended": []}


def test_registered_on_end_date_is_not_flagged():
    """종료 처리 당일 등록은 정상 운영 흐름 — strict > 로만 잡는다."""
    same = dict(HEALTHY, created_at="2026-08-27T01:00:00+00:00", ended_at="2026-08-27")
    assert find_ended_at_anomalies([same], TODAY)["born_ended"] == []


def test_kst_boundary_is_respected():
    """UTC 09-01T16:00 = KST 09-02. UTC 날짜로 보면 종료일과 같은 날이라 놓친다."""
    assert created_kst_date("2026-09-01T16:00:00+00:00") == "2026-09-02"
    boundary = dict(HEALTHY, posted_at="2026-08-19", ended_at="2026-09-01",
                    created_at="2026-09-01T16:00:00+00:00")
    assert len(find_ended_at_anomalies([boundary], TODAY)["born_ended"]) == 1


def test_missing_posted_at_still_checks_born_ended():
    no_posted = dict(MOODY, posted_at=None)
    out = find_ended_at_anomalies([no_posted], TODAY)
    assert out["ended_before_posted"] == []
    assert len(out["born_ended"]) == 1


def test_recent_window_boundary():
    """TODAY 2026-09-03, recent_days 14 → 경계는 등록일(KST) 2026-08-20."""
    base = dict(MOODY, posted_at="2026-08-10", ended_at="2026-08-18")
    on_edge = dict(base, created_at="2026-08-20T00:00:00+00:00")     # KST 08-20 = 경계 포함
    assert find_ended_at_anomalies([on_edge], TODAY)["born_ended"][0]["recent"] is True
    older = dict(base, created_at="2026-08-19T00:00:00+00:00")       # KST 08-19 = 과거분
    assert find_ended_at_anomalies([older], TODAY)["born_ended"][0]["recent"] is False


def test_no_anomaly_means_no_lines():
    assert ended_at_anomaly_lines([HEALTHY], TODAY) == []


def test_lines_pinpoint_url_for_recent_and_count_older():
    """계정명만으론 게시물을 특정할 수 없다(한 계정에 글 여러 개) → 최근분은 URL 포함."""
    lines = ended_at_anomaly_lines([MOODY, PRE_ENDED] + [dict(MOODY, url="u%d" % i) for i in range(4)], TODAY)
    born = [l for l in lines if "등록 시점 이미 종료" in l][0]
    assert "DcL9yZ3EpaS" in born
    assert "5건" in born and "외 2건" in born      # 최근 5건 중 3건만 상세
    pre = [l for l in lines if "종료일<게시일" in l][0]
    assert "과거 등록분 1건" in pre                # 최근분 없으면 건수만


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("[OK] test_ended_at_anomalies 통과 (10종: 사건재현/중복계상/정상글/진행중/"
          "종료당일등록/KST경계/게시일결측/최근윈도우경계/무이상/URL명시+과거집계)")
