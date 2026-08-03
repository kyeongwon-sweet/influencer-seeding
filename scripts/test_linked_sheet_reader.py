from __future__ import annotations

import io
import json
import urllib.request

import pytest

from linked_sheet_reader import fetch_linked_sheet_rows


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def test_authenticated_fixed_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_URL", "https://example.test/")
    monkeypatch.setenv("CRON_SECRET", "secret-value")
    seen = {}

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        seen["url"] = request.full_url
        seen["auth"] = request.get_header("Authorization")
        seen["timeout"] = timeout
        body = json.dumps({"ok": True, "values": [["A", 123, None]]}).encode()
        return _Response(body)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    assert fetch_linked_sheet_rows(timeout=45) == [["A", "123", ""]]
    assert seen == {
        "url": "https://example.test/api/ops/linked-sheet-values",
        "auth": "Bearer secret-value",
        "timeout": 45,
    }


def test_missing_credentials_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_URL", raising=False)
    monkeypatch.delenv("CRON_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="APP_URL"):
        fetch_linked_sheet_rows()


def test_malformed_payload_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_URL", "https://example.test")
    monkeypatch.setenv("CRON_SECRET", "secret-value")
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _Response(json.dumps({"ok": True}).encode()),
    )
    with pytest.raises(RuntimeError, match="missing values"):
        fetch_linked_sheet_rows()
