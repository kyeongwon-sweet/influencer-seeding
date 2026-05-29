import os
import json
import re
from urllib.parse import urlparse
from datetime import datetime, timezone
from db import get_client


def normalize_youtube_url(url: str) -> str | None:
    """YouTube URL을 https:// + trailing slash 형태로 정규화"""
    if not url:
        return None
    try:
        if not url.startswith("http"):
            url = "https://" + url
        u = urlparse(url)
        if "youtube.com" not in u.netloc:
            return None
        path = re.sub(r"/(shorts|videos|featured|community|about)(/.*)?\$?", "", u.path)
        path = path.rstrip("/")
        if not path:
            path = ""
        return f"https://www.youtube.com{path}/"
    except Exception:
        return None

APIFY_HASHTAG_ACTOR = os.getenv("APIFY_HASHTAG_ACTOR_ID", "apify/instagram-hashtag-scraper")
APIFY_YOUTUBE_ACTOR = os.getenv("APIFY_YOUTUBE_ACTOR_ID", "streamers/youtube-scraper")
RESULTS_PER_KEYWORD = int(os.getenv("LISTUP_RESULTS_PER_KEYWORD", "100"))


def run():
    payload = json.loads(os.getenv("JOB_PAYLOAD", "{}"))
    job_id = payload.get("job_id")

    db = get_client()

    if job_id:
        db.table("jobs").update({"status": "running"}).eq("id", job_id).execute()

    try:
        kw_res = db.table("search_keywords").select("*").execute()
        keywords = kw_res.data or []

        ig_keywords = [k["keyword"] for k in keywords if k["platform"] in ("instagram", "both")]
        yt_keywords = [k["keyword"] for k in keywords if k["platform"] in ("youtube", "both")]

        added = 0
        if ig_keywords:
            added += _run_instagram(db, ig_keywords)
        if yt_keywords:
            added += _run_youtube(db, yt_keywords)

        if job_id:
            db.table("jobs").update({"status": "done", "payload": {"added": added}}).eq("id", job_id).execute()

        print(f"리스트업 완료: {added}개 계정 추가")

    except Exception as e:
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


def _run_instagram(db, keywords: list) -> int:
    from apify_client import ApifyClient

    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))

    # 키워드별로 개별 실행하여 발굴 키워드 추적
    accounts: dict = {}
    for keyword in keywords:
        run = client.actor(APIFY_HASHTAG_ACTOR).call(run_input={
            "hashtags": [keyword],
            "resultsLimit": RESULTS_PER_KEYWORD,
            "type": "recent",  # 최신순
        })

        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

        for item in items:
            username = (
                item.get("ownerUsername")
                or (item.get("owner") or {}).get("username")
                or item.get("username")
            )
            name = (
                item.get("ownerFullName")
                or (item.get("owner") or {}).get("fullName")
                or username
            )
            if not username or username in accounts:
                continue

            post_url = (
                item.get("url")
                or (item.get("shortCode") and f"https://www.instagram.com/p/{item['shortCode']}/")
            )
            product_type = item.get("productType", "")
            is_video = item.get("isVideo", False)
            media_type = item.get("type", "")
            if product_type == "clips" or media_type == "GraphVideo" or is_video:
                post_type = "릴스"
            else:
                post_type = "피드"

            raw_ts = item.get("timestamp") or item.get("takenAtTimestamp")
            if isinstance(raw_ts, (int, float)):
                post_uploaded_at = datetime.fromtimestamp(raw_ts, tz=timezone.utc).isoformat()
            else:
                post_uploaded_at = raw_ts or None

            accounts[username] = {
                "name": name or username,
                "url": f"https://www.instagram.com/{username}/",
                "platform": "instagram",
                "status": "pending",
                "source": "listup",
                "keyword": keyword,
                "sample_post_url": post_url,
                "post_type": post_type,
                "post_uploaded_at": post_uploaded_at,
            }

    existing = db.table("influencers").select("url").execute()
    existing_urls = {r["url"] for r in (existing.data or [])}

    new_accounts = [a for a in accounts.values() if a["url"] not in existing_urls]
    if new_accounts:
        db.table("influencers").insert(new_accounts).execute()

    return len(new_accounts)


def _run_youtube(db, keywords: list) -> int:
    from apify_client import ApifyClient

    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))

    channels: dict = {}
    for keyword in keywords:
        run = client.actor(APIFY_YOUTUBE_ACTOR).call(run_input={
            "searchQueries": [keyword],
            "maxResultsShorts": RESULTS_PER_KEYWORD,
            "sortingOrder": "views",
        })

        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

        for item in items:
            channel_url = (
                item.get("channelUrl")
                or item.get("authorUrl")
                or (item.get("channelId") and f"https://www.youtube.com/channel/{item['channelId']}")
            )
            channel_name = (
                item.get("channelName")
                or item.get("channelTitle")
                or item.get("author")
            )
            if not channel_url or not channel_name:
                continue

            # 채널 base URL 정규화 (https 강제)
            normalized_url = normalize_youtube_url(channel_url)
            if not normalized_url:
                continue
            base_url = normalized_url.rstrip("/")

            if base_url not in channels:
                video_url = item.get("url")
                duration = item.get("duration") or 0
                if isinstance(duration, str):
                    parts = duration.split(":")
                    try:
                        duration = sum(int(p) * 60 ** i for i, p in enumerate(reversed(parts)))
                    except ValueError:
                        duration = 0
                is_short = item.get("isShort") or "/shorts/" in (video_url or "") or int(duration) <= 60
                post_type = "숏폼" if is_short else "롱폼"

                raw_ts = item.get("date") or item.get("publishedAt") or item.get("uploadDate")
                if isinstance(raw_ts, (int, float)):
                    post_uploaded_at = datetime.fromtimestamp(raw_ts, tz=timezone.utc).isoformat()
                else:
                    post_uploaded_at = raw_ts or None

                channels[base_url] = {
                    "name": channel_name,
                    "url": normalized_url,
                    "platform": "youtube",
                    "status": "pending",
                    "source": "listup",
                    "keyword": keyword,
                    "sample_post_url": video_url,
                    "post_type": post_type,
                    "post_uploaded_at": post_uploaded_at,
                }

    existing = db.table("influencers").select("url").execute()
    existing_urls = {r["url"] for r in (existing.data or [])}

    new_channels = [c for c in channels.values() if c["url"] not in existing_urls]
    if new_channels:
        db.table("influencers").insert(new_channels).execute()

    return len(new_channels)


if __name__ == "__main__":
    run()
