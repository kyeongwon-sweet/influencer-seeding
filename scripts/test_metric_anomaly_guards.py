"""Regression tests for spike-then-frozen metric alerts."""
from metric_anomaly_guards import frozen_spike_suspects


def rows(values):
    return [(day, value, manual) for day, value, manual in values]


def test_finds_tiktok_cross_post_value_frozen_by_monotonic_floor():
    history = rows([
        ("2026-08-25", 2_017, False),
        ("2026-08-26", 97_643, False),
        ("2026-08-27", 97_643, False),
        ("2026-08-28", 97_643, False),
        ("2026-08-29", 97_643, False),
    ])
    hit = frozen_spike_suspects(history)
    assert hit == [("2026-08-26", "2026-08-26", 97_643, 2_017, 4, "spike_then_frozen")]


def test_allows_one_settling_day_before_youtube_plateau():
    history = rows([
        ("2026-08-25", 1_367, False),
        ("2026-08-26", 97_643, True),
        ("2026-08-27", 149_000, True),
        ("2026-08-28", 149_000, False),
        ("2026-08-29", 149_000, False),
        ("2026-08-30", 149_000, False),
    ])
    hit = frozen_spike_suspects(history)
    assert hit[0][0:5] == ("2026-08-26", "2026-08-27", 149_000, 1_367, 4)


def test_copied_first_value_needs_another_same_day_owner():
    history = rows([
        ("2026-08-26", 116_853, False),
        ("2026-08-27", 116_853, False),
        ("2026-08-28", 116_853, False),
        ("2026-08-29", 116_853, False),
    ])
    assert frozen_spike_suspects(history) == []
    owners = {("2026-08-26", 116_853): {"target", "source"}}
    hit = frozen_spike_suspects(history, owners, post_id="target")
    assert hit[0][-1] == "copied_first_value_frozen"


def test_real_viral_growth_is_not_flagged():
    for history in (
        [("2026-08-30", 93_697, False), ("2026-08-31", 94_218, False)],
        [("2026-08-30", 45_248, False), ("2026-08-31", 45_453, False)],
        [("2026-08-30", 36_492, False), ("2026-08-31", 37_121, False)],
    ):
        assert frozen_spike_suspects(rows(history)) == []


def test_three_equal_dates_total_is_not_three_days_after_the_jump():
    history = rows([
        ("2026-08-25", 1_000, False),
        ("2026-08-26", 20_000, False),
        ("2026-08-27", 20_000, False),
        ("2026-08-28", 20_000, False),
    ])
    assert frozen_spike_suspects(history) == []
