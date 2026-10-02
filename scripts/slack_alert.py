"""Small Slack bot delivery helper for operational alerts."""

from __future__ import annotations

import json
import urllib.request
from collections.abc import Callable


SLACK_API_BASE = "https://slack.com/api"


def _post_json(token: str, method: str, payload: dict, timeout: int) -> dict:
    request = urllib.request.Request(
        f"{SLACK_API_BASE}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def send_bot_message(
    token: str,
    destination: str,
    text: str,
    *,
    timeout: int = 10,
    log: Callable[[str], None] = print,
) -> bool:
    """Post an alert, resolving a Slack user id to its DM conversation first.

    Slack accepts several destination id types for ``chat.postMessage``, but a
    ``U...`` user id is not an auditable guarantee that the message lands in
    the bot DM surface the operator checks. Resolve it to a ``D...`` channel so
    delivery semantics are explicit and failures such as ``missing_scope`` are
    visible in the workflow log.
    """
    try:
        resolved = destination
        delivery_kind = "channel"
        if destination.startswith("U"):
            opened = _post_json(
                token,
                "conversations.open",
                {"users": destination, "return_im": True},
                timeout,
            )
            if not opened.get("ok"):
                log(f"[WARN] Slack DM open failed: {opened.get('error') or 'unknown_error'}")
                return False
            resolved = str((opened.get("channel") or {}).get("id") or "")
            if not resolved.startswith("D"):
                log("[WARN] Slack DM open failed: missing_dm_channel")
                return False
            delivery_kind = "direct_message"

        posted = _post_json(token, "chat.postMessage", {"channel": resolved, "text": text}, timeout)
        if not posted.get("ok"):
            log(f"[WARN] Slack bot alert failed: {posted.get('error') or 'unknown_error'}")
            return False
        log(f"[SLACK_ALERT] delivered kind={delivery_kind}")
        return True
    except Exception as exc:
        log(f"[WARN] Slack bot alert delivery failed: {exc}")
        return False
