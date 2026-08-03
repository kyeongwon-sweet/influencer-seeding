"""Authenticated reader for the private linked Google Sheet.

The server route owns the Google service-account credential. GitHub jobs only
receive CRON_SECRET and cannot select another spreadsheet or range.
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def fetch_linked_sheet_rows(timeout: int = 120) -> list[list[str]]:
    app_url = _required_env("APP_URL").rstrip("/")
    secret = _required_env("CRON_SECRET")
    request = urllib.request.Request(
        f"{app_url}/api/ops/linked-sheet-values",
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload: Any = json.load(response)

    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise RuntimeError("Linked-sheet API returned an invalid response")
    values = payload.get("values")
    if not isinstance(values, list):
        raise RuntimeError("Linked-sheet API response is missing values")

    rows: list[list[str]] = []
    for row in values:
        if not isinstance(row, list):
            raise RuntimeError("Linked-sheet API returned a non-row value")
        rows.append(["" if cell is None else str(cell) for cell in row])
    return rows
