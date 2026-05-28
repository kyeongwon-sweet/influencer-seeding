from __future__ import annotations
from datetime import datetime, timezone, timedelta
from config import SCREENING_DAYS


_AD_KEYWORDS = {"광고", "협찬", "ad", "sponsored"}


def _is_reel(post: dict) -> bool:
    return post.get("productType") == "clips"


def _is_short(post: dict) -> bool:
    return "/shorts/" in (post.get("url") or "")


def _is_ad(post: dict) -> bool:
    hashtags = [h.lower() for h in (post.get("hashtags") or [])]
    return any(kw in hashtags for kw in _AD_KEYWORDS)


def calc_all_metrics(profile: dict, posts: list) -> dict:
    followers = profile.get("followers", 0)
    cutoff = datetime.now(timezone.utc) - timedelta(days=SCREENING_DAYS)

    recent_posts = [
        p for p in posts
        if _parse_ts(p.get("timestamp")) >= cutoff
    ]
    ad_posts      = [p for p in recent_posts if _is_ad(p)]
    general_posts = [p for p in recent_posts if not _is_ad(p)]

    return {
        "팔로워 수":              followers,
        "팔로워 대비 평균 조회수":  _views_per_follower(recent_posts, followers),
        "100만뷰 이상 개수":       _count_1m(recent_posts),
        "총 게시물":              len(recent_posts),
        "일반 게시물":            len(general_posts),
        "광고 게시물":            len(ad_posts),
        "총 평균 도달수":          _avg(recent_posts, "videoViewCount"),
        "일반 평균 도달수":         _avg(general_posts, "videoViewCount"),
        "광고 평균 도달수":         _avg(ad_posts, "videoViewCount"),
        "총 평균 조회수":          _avg(recent_posts, "videoPlayCount"),
        "일반 평균 조회수":         _avg(general_posts, "videoPlayCount"),
        "광고 평균 조회수":         _avg(ad_posts, "videoPlayCount"),
        "총 Like 비율":           _ratio_avg(recent_posts, "likesCount", "videoPlayCount", 4),
        "일반 Like 비율":          _ratio_avg(general_posts, "likesCount", "videoPlayCount", 4),
        "광고 Like 비율":          _ratio_avg(ad_posts, "likesCount", "videoPlayCount", 4),
        "총 Comments 비율":       _ratio_avg(recent_posts, "commentsCount", "videoPlayCount", 4),
        "일반 Comments 비율":      _ratio_avg(general_posts, "commentsCount", "videoPlayCount", 4),
        "광고 Comments 비율":      _ratio_avg(ad_posts, "commentsCount", "videoPlayCount", 4),
        "광고 최고 조회수":         _best(ad_posts, "videoPlayCount"),
        "광고 최고 게시물 URL":     _best_url(ad_posts),
        "평균 영상 길이(초)":       _avg(recent_posts, "videoDuration", 1),
    }


# ── 내부 헬퍼 ──────────────────────────────────────────────

def _avg(reels: list, field: str, ndigits: int = 0) -> float | str:
    vals = [p[field] for p in reels if p.get(field) is not None]
    if not vals:
        return "-"
    result = sum(vals) / len(vals)
    return round(result, ndigits) if ndigits else round(result)


def _ratio_avg(reels: list, numerator: str, denominator: str, ndigits: int = 4) -> float | str:
    ratios = []
    for p in reels:
        n = p.get(numerator)
        d = p.get(denominator)
        if n is not None and d and d > 0:
            ratios.append(n / d * 100)
    if not ratios:
        return "-"
    return round(sum(ratios) / len(ratios), ndigits)


def _best(reels: list, field: str) -> int | str:
    vals = [p[field] for p in reels if p.get(field) is not None]
    return max(vals) if vals else "-"


def _best_url(reels: list) -> str:
    if not reels:
        return "-"
    best = max(reels, key=lambda p: p.get("videoPlayCount") or 0)
    return best.get("url") or "-"


def _views_per_follower(reels: list, followers: int) -> float | str:
    avg = _avg(reels, "videoPlayCount")
    if avg == "-" or not followers:
        return "-"
    return round(avg / followers, 2)


def _count_1m(recent_reels: list) -> int:
    return sum(1 for p in recent_reels if (p.get("videoPlayCount") or 0) >= 1_000_000)


def _parse_ts(ts_str: str | None) -> datetime:
    if not ts_str:
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))


def calc_type_metrics(profile: dict, posts: list, platform: str) -> dict:
    """플랫폼별 게시물 유형(릴스/피드, 롱폼/숏폼)으로 분리해 지표 계산."""
    result = {}
    if platform == "instagram":
        reels = [p for p in posts if _is_reel(p)]
        feed  = [p for p in posts if not _is_reel(p)]
        if reels:
            result["reels"] = calc_all_metrics(profile, reels)
        if feed:
            result["feed"] = calc_all_metrics(profile, feed)
    elif platform == "youtube":
        longform = [p for p in posts if not _is_short(p)]
        shorts   = [p for p in posts if _is_short(p)]
        if longform:
            result["longform"] = calc_all_metrics(profile, longform)
        if shorts:
            result["shorts"] = calc_all_metrics(profile, shorts)
    return result


if __name__ == "__main__":
    import json, os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "data/output/raw_sample.json"), encoding="utf-8") as f:
        data = json.load(f)

    result = calc_all_metrics(data["profile"], data["posts"])
    print(f"=== 계정별 최종 지표 ({data['profile'].get('username')}) ===")
    for k, v in result.items():
        print(f"  {k:<28} {v}")
