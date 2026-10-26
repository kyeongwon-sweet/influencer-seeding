#!/usr/bin/env python3
"""Read-only live parity check for the monitoring history-summary RPCs."""

from __future__ import annotations

import argparse
from datetime import date

from db import get_client
import run_monitoring as monitoring


PAGE = 1000


def _post_ids(db) -> tuple[list[str], list[str]]:
    all_ids: list[str] = []
    active_ids: list[str] = []
    offset = 0
    while True:
        page = (
            db.table("sponsored_posts")
            .select("id,ended_at")
            .order("id")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
            or []
        )
        for row in page:
            post_id = str(row.get("id") or "")
            if not post_id:
                continue
            all_ids.append(post_id)
            if not row.get("ended_at"):
                active_ids.append(post_id)
        if len(page) < PAGE:
            break
        offset += PAGE
    return all_ids, active_ids


def _component_summary(label: str, legacy, optimized) -> list[str]:
    if legacy == optimized:
        return []
    if isinstance(legacy, dict) and isinstance(optimized, dict):
        keys = set(legacy) | set(optimized)
        mismatched = [key for key in sorted(keys) if legacy.get(key) != optimized.get(key)]
        return [f"{label}: mismatched={len(mismatched)} sample={mismatched[:10]}"]
    if isinstance(legacy, set) and isinstance(optimized, set):
        return [
            f"{label}: legacy_only={len(legacy - optimized)} "
            f"optimized_only={len(optimized - legacy)}"
        ]
    return [f"{label}: legacy={legacy!r} optimized={optimized!r}"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Explicit KST business date (YYYY-MM-DD)")
    args = parser.parse_args()
    target = date.fromisoformat(args.date).isoformat()

    db = get_client()
    all_ids, active_ids = _post_ids(db)
    monitoring.TODAY = target

    legacy_active = monitoring._active_stats_summary(db, active_ids)
    optimized_active = monitoring._active_stats_summary_rpc(db, active_ids, target)
    active_labels = (
        "last",
        "max_metric",
        "manual_tracked",
        "last_valid_metric_date",
        "had_positive_play",
        "last_manual_at",
    )
    issues: list[str] = []
    for label, legacy, optimized in zip(active_labels, legacy_active, optimized_active):
        issues.extend(_component_summary(label, legacy, optimized))

    legacy_snapshot = monitoring._snapshot_totals(db, all_ids, target)
    optimized_snapshot = monitoring._snapshot_totals_rpc(db, all_ids, target)
    issues.extend(_component_summary("snapshot", legacy_snapshot, optimized_snapshot))

    if issues:
        print("[MONITORING_SUMMARY_PARITY] mismatch")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print(
        "[MONITORING_SUMMARY_PARITY] exact "
        f"date={target} active_posts={len(active_ids)} all_posts={len(all_ids)} "
        f"snapshot={legacy_snapshot}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
