from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any


CAPTION_END_KEYWORDS = ("삭제", "보관", "종료")
AUTO_END_EXCLUDED_TERMS = ("위성채널", "온드미디어")
HIGH_METRIC_THRESHOLD = 500_000  # 누적 50만 이상 = 고성과 → 나이(게시+N일)로 자동종료 안 함(트래킹 유지, 사용자 결정 2026-07-15 복원)


@dataclass(frozen=True)
class AutoEndDecision:
    should_end: bool
    reason: str
    age_days: int | None
    threshold_days: int | None
    metric: int


def text_of(value: Any) -> str:
    return str(value or "")


def is_short_lived_type(channel_type: Any) -> bool:
    text = text_of(channel_type)
    return any(term in text for term in ("배너", "피드", "캐러셀"))


def is_auto_end_excluded(post: dict[str, Any]) -> bool:
    haystack = " ".join(
        text_of(post.get(field))
        for field in ("channel_type", "project_name", "product_name")
    )
    return any(term in haystack for term in AUTO_END_EXCLUDED_TERMS)


def has_caption_end_keyword(post: dict[str, Any]) -> bool:
    caption = text_of(post.get("content_summary"))
    return any(keyword in caption for keyword in CAPTION_END_KEYWORDS)


def row_metric(row: dict[str, Any]) -> int:
    values = []
    for field in ("play_count", "reach_count"):
        value = row.get(field)
        if isinstance(value, (int, float)) and value > 0:
            values.append(int(value))
    return max(values, default=0)


def classify_auto_end(
    post: dict[str, Any],
    *,
    target_date: str,
    max_metric: int = 0,
) -> AutoEndDecision:
    if has_caption_end_keyword(post):
        return AutoEndDecision(True, "caption_keyword", None, None, int(max_metric or 0))

    if is_auto_end_excluded(post):
        return AutoEndDecision(False, "excluded_channel_project", None, None, int(max_metric or 0))

    metric = int(max_metric or 0)
    if metric >= HIGH_METRIC_THRESHOLD:
        return AutoEndDecision(False, "high_metric_500k", None, None, metric)

    posted_at = post.get("posted_at")
    if not posted_at:
        return AutoEndDecision(False, "missing_posted_at", None, None, metric)

    try:
        age_days = (date.fromisoformat(target_date) - date.fromisoformat(str(posted_at)[:10])).days
    except ValueError:
        return AutoEndDecision(False, "invalid_posted_at", None, None, metric)

    if age_days < 0:
        return AutoEndDecision(False, "pre_posted", age_days, None, metric)

    threshold_days = 7 if is_short_lived_type(post.get("channel_type")) else 14
    if age_days > threshold_days:
        return AutoEndDecision(True, f"age_after_{threshold_days}", age_days, threshold_days, metric)

    return AutoEndDecision(False, "not_due", age_days, threshold_days, metric)
