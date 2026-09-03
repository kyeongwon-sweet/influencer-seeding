#!/usr/bin/env python3
"""조회수 교차오염 감사 단위 테스트 — 2026-08-26~09-01 사고를 회귀 케이스로 고정.

사고: 시트 교차오염으로 먹리니·먹또먹·이짓매거진 값이 위성채널 행으로 흘러들어갔고,
수집기가 매일 그 값을 다시 써서 6일간 고착됐다. 정리 후 사후감사가 '알려진 값·날짜'만
확인해 candidates=0으로 닫는 바람에 전파분 4건(19행)을 놓쳤다.
지상 진실: YouTube GBWxY0RlRqA 실제 1,558회 vs DB 149,000 (96배).

아래 수치는 전부 2026-08-12~31 실측에서 가져온 실제 값이다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from audit_metric_contamination import (  # noqa: E402
    audit_dates_with_baseline,
    detect_spike_freeze,
    detect_value_collisions,
    is_round_value,
)


def test_audit_window_includes_one_baseline_day():
    query_days, audit_days = audit_dates_with_baseline(
        __import__("datetime").date(2026, 9, 1), 14
    )
    assert query_days[0] == "2026-08-17"
    assert audit_days[0] == "2026-08-18"
    assert audit_days[-1] == "2026-08-31"
    assert len(query_days) == len(audit_days) + 1


def series(*pairs):
    return [("2026-08-%02d" % d, v) for d, v in pairs]


# ───────── Rule A: 급등 후 동결 ─────────

def test_real_contamination_is_detected():
    """이슈뜨기(틱톡) video 7677969398061141255 — 실측."""
    s = series((25, 50), (26, 116853), (27, 116853), (28, 116853),
               (29, 116853), (30, 116853), (31, 116853))
    hit = detect_spike_freeze(s)
    assert hit is not None
    assert hit["from_value"] == 50
    assert hit["to_value"] == 116853
    assert hit["frozen_days"] == 6


def test_mid_multiple_frozen_spike_is_detected_with_minimum_increase():
    s = series((25, 35_000), (26, 116_853), (27, 116_853), (28, 116_853))
    hit = detect_spike_freeze(s)
    assert hit is not None and hit["to_value"] == 116_853


def test_small_threefold_frozen_spike_is_ignored():
    s = series((25, 1_000), (26, 3_000), (27, 3_000), (28, 3_000))
    assert detect_spike_freeze(s) is None


def test_real_viral_spike_is_not_flagged():
    """Ufo__ORANGE·smile_miso_s2·moduhappy — 급등했지만 계속 증가하는 정상 바이럴(실측).

    이 구분이 이 감사의 핵심이다. 급등 자체를 신호로 삼으면 정상 바이럴을 죽인다.
    """
    for s in (
        series((29, 7410), (30, 93697), (31, 94218)),
        series((29, 1593), (30, 45248), (31, 45453)),
        series((29, 3537), (30, 36492), (31, 37121)),
    ):
        assert detect_spike_freeze(s, freeze_days=2) is None, s


def test_steady_growth_is_not_flagged():
    s = series((25, 2017), (26, 2019), (27, 2020), (28, 2022), (29, 2024))
    assert detect_spike_freeze(s) is None


def test_flat_low_traffic_post_is_not_flagged():
    """조회수가 멈춘 오래된 글은 동결이지만 급등이 없으므로 대상 아님."""
    s = series((25, 822), (26, 822), (27, 822), (28, 822), (29, 822))
    assert detect_spike_freeze(s) is None


def test_tiny_base_is_ignored():
    """1 → 30 같은 미세 구간은 배율이 커도 의미 없다(min_prev 미만)."""
    s = series((25, 1), (26, 30), (27, 30), (28, 30), (29, 30))
    assert detect_spike_freeze(s) is None


def test_freeze_must_be_long_enough():
    s = series((25, 50), (26, 116853), (27, 116853))
    assert detect_spike_freeze(s, freeze_days=3) is None
    assert detect_spike_freeze(s, freeze_days=2) is not None


def test_missing_days_do_not_break_detection():
    """측정 없는 날(None)이 섞여도 값이 있는 날들로만 판정한다."""
    s = [("2026-08-25", 50), ("2026-08-26", None), ("2026-08-27", 116853),
         ("2026-08-28", 116853), ("2026-08-29", 116853)]
    assert detect_spike_freeze(s) is not None


# ───────── Rule B: 값 충돌 ─────────

def test_round_value_helper():
    assert is_round_value(50_000) is True
    assert is_round_value(97_000) is True
    assert is_round_value(13_300) is True
    assert is_round_value(466_637) is False
    assert is_round_value(97_643) is False


def test_real_collision_is_detected():
    """썰박스(틱톡)에 먹리니 값 466,637이 흘러든 실측 케이스 — Rule A가 못 잡은 건."""
    day = {"mokrini": 466_637, "ssulbox": 466_637, "other": 12_345}
    prev = {"mokrini": None, "ssulbox": None, "other": 12_000}
    out = detect_value_collisions(day, prev)
    assert sorted(x["post_id"] for x in out) == ["mokrini", "ssulbox"]


def test_round_collisions_are_ignored():
    """50,000·97,000 같은 라운드 값은 사람이 반올림 입력해 우연히 겹친다(실측 오탐 원인)."""
    day = {"a": 50_000, "b": 50_000, "c": 97_000, "d": 97_000}
    prev = {"a": None, "b": None, "c": None, "d": None}
    assert detect_value_collisions(day, prev) == []


def test_collision_consistent_with_own_history_is_ignored():
    """값이 겹쳐도 자기 추이와 어긋나지 않으면 우연이다."""
    day = {"a": 45_211, "b": 45_211}
    prev = {"a": 44_800, "b": 44_950}      # 둘 다 자연스러운 증가
    assert detect_value_collisions(day, prev) == []


def test_single_post_value_is_not_a_collision():
    assert detect_value_collisions({"a": 466_637}, {"a": None}) == []


def test_small_values_are_ignored():
    """작은 값은 우연한 일치가 흔하다(실측: 임계 1,000이면 20일간 243종)."""
    day = {"a": 1_063, "b": 1_063, "c": 1_063}
    prev = {"a": None, "b": None, "c": None}
    assert detect_value_collisions(day, prev) == []


def test_only_the_anomalous_side_is_reported_when_history_differs():
    """한쪽만 자기 이력과 어긋나면 그쪽만 보고한다."""
    day = {"victim": 97_643, "source": 97_643}
    prev = {"victim": 1_367, "source": 96_000}   # source는 자연 증가
    out = detect_value_collisions(day, prev)
    assert [x["post_id"] for x in out] == ["victim"]
    assert out[0]["others"] == ["source"]


def test_mid_multiple_value_collision_is_detected_by_default():
    day = {"victim": 116_853, "source": 116_853}
    prev = {"victim": 35_000, "source": 115_000}
    out = detect_value_collisions(day, prev)
    assert [x["post_id"] for x in out] == ["victim"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("[OK] test_audit_metric_contamination 통과 "
          "(기간경계 1종 + RuleA 7종: 사고재현/정상바이럴/완만증가/평탄/미세구간/동결길이/결측 + "
          "RuleB 6종: 라운드/충돌/이력정합/단독/소값/한쪽만)")
