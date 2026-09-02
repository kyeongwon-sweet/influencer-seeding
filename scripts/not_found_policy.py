from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone


NOT_FOUND_REVIEW_THRESHOLD = 3
NOT_FOUND_OUTAGE_MIN_COUNT = 20
NOT_FOUND_OUTAGE_RATE_THRESHOLD = 0.30
CONFIRMED_DELETE_ERROR_DESCRIPTION = "Post does not exist"
_INSTAGRAM_POST_RE = re.compile(
    r"instagram\.com/(?:[^/?#]+/)*(?:p|reels|reel|tv)/[A-Za-z0-9_-]+",
    re.IGNORECASE,
)
_INSTAGRAM_HANDLE_RE = re.compile(r"^[A-Za-z0-9._]+$")


@dataclass(frozen=True)
class ConfirmedDeleteEndDecision:
    should_end: bool
    reason: str
    ended_at: str | None
    manual_fields: tuple[str, ...]


def classify_confirmed_deleted_end(
    post: dict,
    *,
    error_description: str | None,
    last_valid_measured_at: str | None,
    observed_at: str,
) -> ConfirmedDeleteEndDecision:
    """Decide the narrow auto-end override for a confirmed deleted IG post.

    This path deliberately does not reuse the age-based auto-end classifier:
    manual daily metrics must stay exempt from age expiry, while the exact
    Apify deletion signal can end the post only after the normal consecutive
    not-found threshold.  Ambiguous ``not_found``/private/rate-limit responses
    remain review-only.
    """
    manual = post.get("manual_fields") or []
    manual_fields = tuple(manual) if isinstance(manual, (list, tuple)) else ()

    if post.get("ended_at"):
        return ConfirmedDeleteEndDecision(False, "already_ended", None, manual_fields)
    # An explicit human reopen/pin remains stronger than this automation.
    if "ended_at" in manual_fields:
        return ConfirmedDeleteEndDecision(False, "manual_ended_at", None, manual_fields)
    if error_description != CONFIRMED_DELETE_ERROR_DESCRIPTION:
        return ConfirmedDeleteEndDecision(False, "not_exact_delete", None, manual_fields)
    if int(post.get("not_found_streak") or 0) < NOT_FOUND_REVIEW_THRESHOLD:
        return ConfirmedDeleteEndDecision(False, "below_threshold", None, manual_fields)
    if not last_valid_measured_at:
        return ConfirmedDeleteEndDecision(False, "missing_last_valid_metric", None, manual_fields)

    try:
        last_valid = date.fromisoformat(str(last_valid_measured_at)[:10])
        observed = date.fromisoformat(str(observed_at)[:10])
        posted_raw = str(post.get("posted_at") or "")[:10]
        posted = date.fromisoformat(posted_raw) if posted_raw else None
    except ValueError:
        return ConfirmedDeleteEndDecision(False, "invalid_date", None, manual_fields)

    ended = last_valid + timedelta(days=1)
    if ended > observed or (posted is not None and ended < posted):
        return ConfirmedDeleteEndDecision(False, "invalid_end_boundary", None, manual_fields)

    pinned = manual_fields if "ended_at" in manual_fields else (*manual_fields, "ended_at")
    return ConfirmedDeleteEndDecision(True, "confirmed_deleted", ended.isoformat(), pinned)


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
        # A later targeted retry can add stronger owner-profile evidence for the
        # same observation day. Keep the daily streak idempotent, but do not
        # discard that confirmation: promote the post to the review queue once.
        if confirmed and not post.get("review_requested_at"):
            return {"review_requested_at": datetime.now(timezone.utc).isoformat()}, True
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
