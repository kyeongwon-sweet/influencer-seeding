#!/usr/bin/env python3
"""Read-only C15 cost audit against the linked sheet and pricing map."""

from __future__ import annotations

import json
import re
from typing import Any

from linked_sheet_reader import fetch_linked_sheet_payload
from reconcile_sheet_stat_mismatches import link_key


TARGETS = [
    ("힐링하고 가세요", "https://www.tiktok.com/@healing0315/photo/7675271025176661269/"),
    ("wikitrip", "https://www.instagram.com/p/DcQQ2npCWJL/"),
    ("happy__pyeong", "https://www.instagram.com/p/DcakMZokd2s/"),
    ("음식덕후", "https://www.tiktok.com/@mhduchu/photo/7678986191189937416/"),
    ("맨투맨 스튜디오(틱톡)", "https://www.tiktok.com/@man2man_studio/photo/7681587607020506389/"),
    ("shoushou.mgz 08-28", "https://www.instagram.com/p/Dcm6_35k8fT/"),
    ("shoushou.mgz 09-02", "https://www.instagram.com/p/DcyGTvHSm5a/"),
    ("김쏘콩", "https://www.instagram.com/p/DdLeIVWJ7u5/"),
    ("후루룹", "https://www.instagram.com/p/DdOwP2pz8dQ/"),
    ("챱챱쓰", "https://www.instagram.com/p/DdOqhr6hrEc/"),
    ("빵야", "https://www.instagram.com/p/DdOe1TxJz2k/"),
]


def normalized_header(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def header_index(headers: list[Any], name: str) -> int:
    wanted = normalized_header(name)
    for index, header in enumerate(headers):
        if normalized_header(header) == wanted:
            return index
    raise RuntimeError(f"Missing linked-sheet header: {name}")


def cell(row: list[Any], index: int) -> Any:
    return row[index] if index < len(row) else ""


def parse_cost(value: Any) -> int | None:
    if value is None or value == "":
        return None
    cleaned = re.sub(r"[^0-9.-]", "", str(value))
    if not cleaned:
        return None
    return round(float(cleaned))


def price_key(value: Any) -> str:
    return re.sub(r"_+", "_", re.sub(r"\s+", "", str(value or "").strip().lower()))


def loose_key(value: Any) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", str(value or "").strip().lower())


def profile_key(value: Any) -> str:
    text = str(value or "").strip().lower()
    for pattern in (
        r"instagram\.com/([^/?#]+)",
        r"tiktok\.com/@([^/?#]+)",
        r"youtube\.com/@([^/?#]+)",
    ):
        match = re.search(pattern, text, re.I)
        if match and match.group(1) not in {"p", "reel", "reels", "tv", "shorts", "watch"}:
            return loose_key(match.group(1))
    return ""


def expected_format(channel_type: Any) -> str:
    value = str(channel_type or "")
    if "배너" in value:
        return "배너"
    if any(token in value for token in ("영상", "릴스", "숏폼", "먹스타", "인플루언서")):
        return "릴스"
    return ""


def main() -> None:
    payload = fetch_linked_sheet_payload()
    rows = payload.get("values")
    pricing_rows = payload.get("pricing_values")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("Linked-sheet API returned no main rows")
    if not isinstance(pricing_rows, list) or not pricing_rows:
        raise RuntimeError("Linked-sheet API returned no pricing rows")

    headers = rows[0]
    cols = {
        "posted_at": header_index(headers, "업로드일"),
        "url": header_index(headers, "게시물URL"),
        "account_name": header_index(headers, "채널명"),
        "company_name": header_index(headers, "업체명"),
        "channel_type": header_index(headers, "채널분류"),
        "cost": header_index(headers, "비용"),
    }
    targets_by_key = {link_key(url): (label, url) for label, url in TARGETS}
    found: dict[str, list[dict[str, Any]]] = {key: [] for key in targets_by_key}
    account_cost_history: dict[str, list[dict[str, Any]]] = {}
    loose_account_cost_history: dict[str, list[dict[str, Any]]] = {}
    for row_number, row in enumerate(rows[1:], start=2):
        key = link_key(str(cell(row, cols["url"])))
        account_name = cell(row, cols["account_name"])
        sheet_cost = parse_cost(cell(row, cols["cost"]))
        row_data = {
            "sheet_row": row_number,
            "url": cell(row, cols["url"]),
            "account_name": account_name,
            "company_name": cell(row, cols["company_name"]),
            "channel_type": cell(row, cols["channel_type"]),
            "posted_at": cell(row, cols["posted_at"]),
            "sheet_cost": sheet_cost,
            "sheet_cost_raw": cell(row, cols["cost"]),
        }
        if key in found:
            found[key].append(row_data)
        if sheet_cost is not None and sheet_cost > 0:
            account_cost_history.setdefault(price_key(account_name), []).append(row_data)
            loose_account_cost_history.setdefault(loose_key(account_name), []).append(row_data)

    pricing_headers = pricing_rows[0]
    pricing = []
    for row_number, row in enumerate(pricing_rows[1:], start=2):
        pricing.append({
            "pricing_row": row_number,
            "account_name": cell(row, 0),
            "company_name": cell(row, 1),
            "format": cell(row, 2),
            "cost": parse_cost(cell(row, 3)),
            "channel_url": cell(row, 6),
        })

    results = []
    for key, (label, requested_url) in targets_by_key.items():
        matches = found[key]
        if len(matches) != 1:
            results.append({"label": label, "key": key, "requested_url": requested_url, "matches": matches})
            continue
        item = matches[0]
        account_key = price_key(item["account_name"])
        candidates = [row for row in pricing if price_key(row["account_name"]) == account_key]
        account_loose_key = loose_key(item["account_name"])
        pricing_loose = [
            row for row in pricing
            if loose_key(row["account_name"]) == account_loose_key
            or profile_key(row["channel_url"]) == account_loose_key
        ]
        requested_profile_key = profile_key(requested_url)
        pricing_profile = [
            row for row in pricing
            if requested_profile_key and profile_key(row["channel_url"]) == requested_profile_key
        ]
        fmt = expected_format(item["channel_type"])
        exact = [row for row in candidates if not fmt or str(row["format"]).strip() == fmt]
        results.append({
            "label": label,
            "key": key,
            **item,
            "expected_format": fmt,
            "pricing_exact": exact,
            "pricing_all_for_account": candidates,
            "sheet_account_cost_history": account_cost_history.get(account_key, []),
            "pricing_loose": pricing_loose,
            "pricing_profile": pricing_profile,
            "sheet_loose_account_cost_history": loose_account_cost_history.get(account_loose_key, []),
        })

    summary = {
        "main_range": payload.get("range"),
        "main_rows": len(rows),
        "pricing_range": payload.get("pricing_range"),
        "pricing_rows": len(pricing_rows),
        "pricing_headers": pricing_headers,
        "unique_matches": sum(1 for rows_for_key in found.values() if len(rows_for_key) == 1),
        "sheet_positive_cost": sum(1 for result in results if (result.get("sheet_cost") or 0) > 0),
        "sheet_zero_or_blank": sum(1 for result in results if (result.get("sheet_cost") or 0) <= 0),
    }
    print("[C15_COST_AUDIT] " + json.dumps({"summary": summary, "rows": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
