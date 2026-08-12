from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone


NOT_FOUND_REVIEW_THRESHOLD = 3
NOT_FOUND_OUTAGE_MIN_COUNT = 20
NOT_FOUND_OUTAGE_RATE_THRESHOLD = 0.30
_INSTAGRAM_POST_RE = re.compile(
    r"instagram\.com/(?:[^/?#]+/)*(?:p|reels|reel|tv)/[A-Za-z0-9_-]+",
    re.IGNORECASE,
)
_INSTAGRAM_HANDLE_RE = re.compile(r"^[A-Za-z0-9._]+$")


def is_not_found_review_eligible(url: str) -> bool:
    """Only Instagram post URLs participate. TikTok not_found is never actionable."""
    return bool(_INSTAGRAM_POST_RE.search(str(url or "")))


def normalize_instagram_handle(value: str | None) -> str | None:
    """Return a profile-safe Instagram handle from an account-name field."""
    handle = str(value or "").strip().lstrip("@").strip()
    if not handle or not _INSTAGRAM_HANDLE_RE.fullmatch(handle):
        return None
    return handle.lower()


def is_platform_not_found_outage(
    requested_count: int,
    not_found_count: int,
    *,
    min_count: int = NOT_FOUND_OUTAGE_MIN_COUNT,
    rate_threshold: float = NOT_FOUND_OUTAGE_RATE_THRESHOLD,
) -> bool:
    """Quarantine batch-wide Instagram failures from per-post deletion streaks.

    A small batch can legitimately contain only deleted posts, so both a minimum
    count and a rate threshold are required. This guard does not reset existing
    streaks; it simply prevents a platform incident from advancing them.
    """
    requested = max(0, int(requested_count or 0))
    not_found = max(0, int(not_found_count or 0))
    if requested <= 0 or not_found < max(1, int(min_count)):
        return False
    return (not_found / requested) >= float(rate_threshold)


def next_not_found_state(
    post: dict,
    detected: bool,
    observed_at: str,
    *,
    confirmed: bool = False,
) -> tuple[dict, bool]:
    """Return DB-only review state and whether this observation needs a new alert.

    A live owner profile plus an explicit post-level ``not_found`` is stronger
    evidence than a bare scraper response. It can request human review on the
    first observation, but the streak still advances by exactly one day and
    this function never writes ``ended_at``.
    """
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
    needs_alert = (
        confirmed or streak >= NOT_FOUND_REVIEW_THRESHOLD
    ) and not post.get("review_requested_at")
    updates = {
        "not_found_streak": streak,
        "not_found_last_at": observed_at,
    }
    if needs_alert:
        updates["review_requested_at"] = datetime.now(timezone.utc).isoformat()
    return updates, needs_alert
