from __future__ import annotations
import json
import os
import re
from datetime import datetime
from apify_client import ApifyClient
from config import APIFY_API_TOKEN, APIFY_ACTOR_ID, APIFY_YOUTUBE_ACTOR_ID, APIFY_RESULTS_LIMIT, OUTPUT_DIR

CACHE_DIR = os.path.join(OUTPUT_DIR, ".cache")


def detect_platform(url: str) -> str:
    url_lower = url.lower()
    if "youtube.com" in url_lower or "youtu.be" in url_lower:
        return "youtube"
    if "instagram.com" in url_lower:
        return "instagram"
    return "unknown"


def fetch_all(influencers: list[dict]) -> list[dict]:
    """
    인플루언서 목록을 받아 Apify를 실행 후 계정별 데이터 반환.
    당일 캐시가 있는 계정은 Apify 호출 없이 재사용.
    URL을 보고 플랫폼(인스타그램/유튜브)을 자동 감지.
    반환: [{"name": ..., "url": ..., "profile": ..., "posts": [...]}, ...]
    """
    os.makedirs(CACHE_DIR, exist_ok=True)

    to_fetch_ig = []
    to_fetch_yt = []
    cached = {}

    for inf in influencers:
        cache_path = _cache_path(inf["url"])
        if os.path.exists(cache_path):
            with open(cache_path, encoding="utf-8") as f:
                cached[inf["url"]] = json.load(f)
            print(f"  [캐시] {inf['name']}")
        else:
            platform = detect_platform(inf["url"])
            if platform == "youtube":
                to_fetch_yt.append(inf)
            elif platform == "instagram":
                to_fetch_ig.append(inf)
            else:
                print(f"  [스킵] {inf['name']} - URL이 유효하지 않음: {inf['url']}")

    fetched = {}

    if to_fetch_ig:
        print(f"\nApify 수집 시작 - Instagram ({len(to_fetch_ig)}명 한 번에 요청)...")
        urls = [inf["url"] for inf in to_fetch_ig]
        raw = _apify_run_instagram(urls)

        grouped: dict[str, list] = {}
        for item in raw:
            key = item.get("inputUrl", "").rstrip("/")
            grouped.setdefault(key, []).append(item)

        for inf in to_fetch_ig:
            key = inf["url"].rstrip("/")
            posts = grouped.get(key, [])
            profile = _extract_ig_profile(posts)
            data = {"profile": profile, "posts": posts}
            fetched[inf["url"]] = data
            _save_cache(inf["url"], data)

    if to_fetch_yt:
        print(f"\nApify 수집 시작 - YouTube ({len(to_fetch_yt)}명)...")
        for inf in to_fetch_yt:
            print(f"  {inf['name']} 수집 중...")
            raw = _apify_run_youtube(inf["url"])
            posts = [_normalize_youtube_item(p, inf["url"]) for p in raw]
            profile = _extract_yt_profile(raw)
            data = {"profile": profile, "posts": posts}
            fetched[inf["url"]] = data
            _save_cache(inf["url"], data)

    results = []
    for inf in influencers:
        if detect_platform(inf["url"]) == "unknown":
            continue
        data = cached.get(inf["url"]) or fetched.get(inf["url"], {"profile": {}, "posts": []})
        results.append({"name": inf["name"], "url": inf["url"], "row": inf.get("row"), **data})

    return results


# ── Instagram ──────────────────────────────────────────────────────────────

def _apify_run_instagram(urls: list[str]) -> list:
    client = ApifyClient(APIFY_API_TOKEN)
    run_input = {
        "directUrls": urls,
        "resultsType": "posts",
        "resultsLimit": APIFY_RESULTS_LIMIT,
        "addParentData": True,
        "maxRequestRetries": 1,
    }
    run = client.actor(APIFY_ACTOR_ID).call(run_input=run_input)
    return list(client.dataset(run["defaultDatasetId"]).iterate_items())


def _extract_ig_profile(posts: list) -> dict:
    for item in posts:
        if "ownerUsername" in item:
            return {
                "username": item.get("ownerUsername", ""),
                "full_name": item.get("ownerFullName", ""),
                "followers": item.get("followersCount", 0),
            }
    return {}


# ── YouTube ────────────────────────────────────────────────────────────────

def _to_shorts_url(channel_url: str) -> str:
    """채널 기본 URL에서 Shorts 탭 URL을 자동 생성."""
    base = channel_url.rstrip("/")
    if base.endswith("/shorts"):
        return base
    return base + "/shorts"


def _apify_run_youtube(channel_url: str) -> list:
    client = ApifyClient(APIFY_API_TOKEN)
    run_input = {
        "startUrls": [{"url": channel_url}],
        "maxResults": APIFY_RESULTS_LIMIT,
        "maxResultsShorts": APIFY_RESULTS_LIMIT,
    }
    run = client.actor(APIFY_YOUTUBE_ACTOR_ID).call(run_input=run_input)
    return list(client.dataset(run["defaultDatasetId"]).iterate_items())


def _normalize_youtube_item(item: dict, channel_url: str) -> dict:
    """YouTube 아이템을 Instagram과 동일한 필드 구조로 변환."""
    views = item.get("viewCount") or item.get("views") or 0
    likes = item.get("likes") or item.get("likeCount") or 0
    comments = (
        item.get("commentsCount")
        or item.get("commentCount")
        or item.get("numberOfComments")
        or 0
    )
    hashtags = item.get("hashtags") or _extract_tags_from_text(
        (item.get("text") or "") + " " + (item.get("description") or "")
    )
    return {
        "inputUrl": channel_url,
        "type": "Video",
        "timestamp": item.get("date"),
        "videoPlayCount": views,
        "videoViewCount": None,
        "likesCount": likes,
        "commentsCount": comments,
        "videoDuration": _parse_yt_duration(item.get("duration")),
        "hashtags": hashtags,
        "url": item.get("url"),
    }


def _extract_yt_profile(items: list) -> dict:
    for item in items:
        subscribers = (
            item.get("channelSubscriberCount")
            or item.get("numberOfSubscribers")
            or item.get("subscriberCount")
        )
        if subscribers is not None:
            return {
                "username": item.get("channelName", ""),
                "full_name": item.get("channelName", ""),
                "followers": subscribers,
            }
    return {}


def _parse_yt_duration(duration) -> int | None:
    """'HH:MM:SS', 'MM:SS', 초 단위 숫자 → 정수(초) 변환."""
    if duration is None:
        return None
    if isinstance(duration, (int, float)):
        return int(duration)
    parts = str(duration).strip().split(":")
    try:
        seconds = 0
        for part in parts:
            seconds = seconds * 60 + int(part)
        return seconds
    except (ValueError, AttributeError):
        return None


def _extract_tags_from_text(text: str) -> list[str]:
    return re.findall(r"#(\w+)", text)


# ── 공통 ───────────────────────────────────────────────────────────────────

def _cache_path(url: str) -> str:
    username = url.rstrip("/").split("/")[-1]
    today = datetime.now().strftime("%Y%m%d")
    return os.path.join(CACHE_DIR, f"{username}_{today}.json")


def _save_cache(url: str, data: dict) -> None:
    with open(_cache_path(url), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
