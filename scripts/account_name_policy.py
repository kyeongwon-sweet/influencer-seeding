from __future__ import annotations


def collected_account_name_update(post: dict, collected: dict) -> str | None:
    """Return an account_name update, preferring the handle for viral channels."""
    current = str(post.get("account_name") or "").strip()
    channel_type = str(post.get("channel_type") or "")

    if "바이럴" in channel_type:
        handle = str(collected.get("owner_username") or "").strip().lstrip("@")
        if handle and handle != current:
            return handle

    if not current:
        display = str(collected.get("account_name") or "").strip()
        return display or None
    return None
