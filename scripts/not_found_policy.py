from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone


NOT_FOUND_REVIEW_THRESHOLD = 3
_INSTAGRAM_POST_RE = re.compile(
    r"instagram\.com/(?:[^/?#]+/)*(?:p|reels|reel|tv)/[A-Za-z0-9_-]+",
    re.IGNORECASE,
)


def is_not_found_review_eligible(url: str) -> bool:
    """Only Instagram post URLs participate. TikTok not_found is never actionable."""
    return bool(_INSTAGRAM_POST_RE.search(str(url or "")))


def next_not_found_state(post: dict, detected: bool, observed_at: str) -> tuple[dict, bool]:
    """Return DB-only review state and whether this observation needs a new alert."""
    if not detected:
        dirty = (
            int(post.get("not_found_streak") or 0) != 0
            or post.get("not_found_last_at") is not None
            or post.get("review_requested_at") is not None
        )
        return ({
            "not_found_streak": 0,
            "not_found_last_at": None,
            "review_requested_at": None,
        } if dirty else {}), False

    observed = date.fromisoformat(observed_at)
    last_raw = str(post.get("not_found_last_at") or "")[:10]
    if last_raw == observed_at:
        return {}, False

    previous = max(0, int(post.get("not_found_streak") or 0))
    try:
        last = date.fromisoformat(last_raw)
    except ValueError:
        last = None
    # "3일 연속" 정책: 직전 KST 날짜가 아니면 새 streak로 다시 시작한다.
    if last != observed - timedelta(days=1):
        previous = 0

    streak = previous + 1
    needs_alert = streak >= NOT_FOUND_REVIEW_THRESHOLD and not post.get("review_requested_at")
    updates = {
        "not_found_streak": streak,
        "not_found_last_at": observed_at,
    }
    if needs_alert:
        updates["review_requested_at"] = datetime.now(timezone.utc).isoformat()
    return updates, needs_alert
