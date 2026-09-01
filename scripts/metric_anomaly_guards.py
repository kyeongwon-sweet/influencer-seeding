"""Read-only guards for suspicious cumulative play-count plateaus."""
from __future__ import annotations

from datetime import date, timedelta


MIN_SPIKE_MULTIPLE = 10
MIN_SPIKE_VALUE = 10_000
MIN_FROZEN_DAYS = 3


def _daily_values(rows):
    values = {}
    for measured_at, value, _manual in sorted(rows, key=lambda row: row[0]):
        if value is not None and value > 0:
            values[str(measured_at)[:10]] = int(value)
    return sorted(values.items())


def _flat_run(daily, start):
    run = [daily[start]]
    for item in daily[start + 1:]:
        prior_date, prior_value = run[-1]
        if item[1] != prior_value:
            break
        if date.fromisoformat(item[0]) != date.fromisoformat(prior_date) + timedelta(days=1):
            break
        run.append(item)
    return run


def frozen_spike_suspects(rows, value_owners=None, *, post_id=None,
                          min_multiple=MIN_SPIKE_MULTIPLE,
                          min_value=MIN_SPIKE_VALUE,
                          min_frozen_days=MIN_FROZEN_DAYS):
    """Return spike-then-flat cumulative play-count runs for human review only.

    A normal viral jump keeps moving. Cross-post contamination instead tends to
    jump by an order of magnitude and then stay bit-identical because the
    monotonic guard rejects every lower real measurement. One settling day is
    allowed before the plateau (97,643 -> 149,000 -> 149,000...).

    When history begins at the plateau, an exact same-day owner fingerprint is
    required. This catches a copied first measurement without treating every
    naturally flat new post as suspicious.
    """
    daily = _daily_values(rows)
    hits = []
    minimum_run = min_frozen_days + 1

    for index in range(1, len(daily)):
        previous = daily[index - 1][1]
        observed = daily[index][1]
        if previous <= 0 or observed < min_value or observed < previous * min_multiple:
            continue
        for plateau_start in (index, index + 1):
            if plateau_start >= len(daily):
                continue
            run = _flat_run(daily, plateau_start)
            if len(run) >= minimum_run:
                hits.append((daily[index][0], run[0][0], run[0][1], previous, len(run), "spike_then_frozen"))
                break

    if not hits and daily:
        run = _flat_run(daily, 0)
        owners = (value_owners or {}).get(daily[0], set())
        copied_elsewhere = post_id is not None and any(owner != post_id for owner in owners)
        if daily[0][1] >= min_value and len(run) >= minimum_run and copied_elsewhere:
            hits.append((daily[0][0], run[0][0], run[0][1], None, len(run), "copied_first_value_frozen"))

    return hits
