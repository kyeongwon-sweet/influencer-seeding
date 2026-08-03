#!/usr/bin/env python3
"""Read-only regression audit for the linked content sheet metric display.

This authenticated value audit cannot see formulas. It catches value-level regressions
such as #REF!, an all-blank increment column, or a sudden jump in rows where
H has a cumulative value but I is blank. Formula-presence auditing is handled
inside Apps Script by auditLinkedSheetFormulas().
"""

from __future__ import annotations

import argparse
import json
from linked_sheet_reader import fetch_linked_sheet_rows


def fetch_rows() -> list[list[str]]:
    return fetch_linked_sheet_rows()


def run(max_h_value_i_blank: int) -> dict[str, object]:
    rows = fetch_rows()
    result: dict[str, object] = {
        "url_rows": 0,
        "h_nonblank": 0,
        "i_nonblank": 0,
        "h_ref": 0,
        "i_ref": 0,
        "h_value_i_blank": 0,
        "samples": [],
    }
    samples: list[dict[str, str | int]] = []
    for row_num, row in enumerate(rows[1:], start=2):
        if len(row) < 9:
            continue
        url = row[1].strip()
        if not url:
            continue
        result["url_rows"] = int(result["url_rows"]) + 1
        h = row[7].strip()
        inc = row[8].strip()
        if h:
            result["h_nonblank"] = int(result["h_nonblank"]) + 1
        if inc:
            result["i_nonblank"] = int(result["i_nonblank"]) + 1
        if "#REF" in h:
            result["h_ref"] = int(result["h_ref"]) + 1
        if "#REF" in inc:
            result["i_ref"] = int(result["i_ref"]) + 1
        if h and not inc:
            result["h_value_i_blank"] = int(result["h_value_i_blank"]) + 1
            if len(samples) < 8:
                samples.append({"row": row_num, "url": url, "h": h, "i": inc})

    result["samples"] = samples
    print("[SHEET_FORMULA_AUDIT] " + json.dumps(result, ensure_ascii=False))

    failures = []
    if int(result["h_ref"]) or int(result["i_ref"]):
        failures.append("H/I contains #REF")
    if int(result["h_nonblank"]) > 0 and int(result["i_nonblank"]) == 0:
        failures.append("increment column is fully blank while cumulative has values")
    if int(result["h_value_i_blank"]) > max_h_value_i_blank:
        failures.append(
            f"H has value but I blank rows exceed threshold: {result['h_value_i_blank']} > {max_h_value_i_blank}"
        )
    if failures:
        raise SystemExit("; ".join(failures))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    # DB-aware formula-audit separately validates every row. This value-only fallback
    # cannot distinguish legitimate >7-day backlog blanks, currently 13 rows.
    parser.add_argument("--max-h-value-i-blank", type=int, default=20)
    args = parser.parse_args()
    run(args.max_h_value_i_blank)
