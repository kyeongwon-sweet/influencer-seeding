from __future__ import annotations

import json
import urllib.request

import slack_alert


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


def test_user_id_is_resolved_to_dm_before_post(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        method = request.full_url.rsplit("/", 1)[-1]
        payload = json.loads(request.data.decode("utf-8"))
        calls.append((method, payload))
        if method == "conversations.open":
            return FakeResponse({"ok": True, "channel": {"id": "D123"}})
        return FakeResponse({"ok": True, "channel": "D123", "ts": "1.0"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    logs: list[str] = []

    assert slack_alert.send_bot_message("token", "U123", "hello", log=logs.append)
    assert calls == [
        ("conversations.open", {"users": "U123", "return_im": True}),
        ("chat.postMessage", {"channel": "D123", "text": "hello"}),
    ]
    assert logs == ["[SLACK_ALERT] delivered kind=direct_message"]


def test_channel_id_posts_without_dm_lookup(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        calls.append((request.full_url.rsplit("/", 1)[-1], json.loads(request.data.decode("utf-8"))))
        return FakeResponse({"ok": True, "channel": "C123", "ts": "1.0"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    assert slack_alert.send_bot_message("token", "C123", "hello")
    assert calls == [("chat.postMessage", {"channel": "C123", "text": "hello"})]


def test_dm_open_failure_is_visible_and_stops_delivery(monkeypatch):
    calls: list[str] = []

    def fake_urlopen(request: urllib.request.Request, timeout: int):
        calls.append(request.full_url)
        return FakeResponse({"ok": False, "error": "missing_scope"})

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    logs: list[str] = []

    assert not slack_alert.send_bot_message("token", "U123", "hello", log=logs.append)
    assert len(calls) == 1
    assert logs == ["[WARN] Slack DM open failed: missing_scope"]


def test_post_failure_is_visible(monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: FakeResponse({"ok": False, "error": "channel_not_found"}),
    )
    logs: list[str] = []

    assert not slack_alert.send_bot_message("token", "D123", "hello", log=logs.append)
    assert logs == ["[WARN] Slack bot alert failed: channel_not_found"]
