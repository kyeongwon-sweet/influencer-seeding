#!/usr/bin/env python3
# 협찬 모니터링 Instagram 데이터 수집 및 통계 생성
import os
import re
import json
from datetime import date, datetime
from db import get_client

APIFY_IG_ACTOR = os.getenv("APIFY_IG_ACTOR_ID", "apify/instagram-scraper")
TODAY = date.today().isoformat()


def _ig_shortcode(url: str) -> str | None:
    """Instagram URL에서 숏코드 추출 (/p/, /reel/, /tv/ 모두 처리)"""
    m = re.search(r'/(?:p|reel|tv)/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _stats_key(url: str) -> str:
    """매칭 키: 인스타그램이면 숏코드, 아니면 trailing slash 제거한 URL"""
    sc = _ig_shortcode(url)
    return sc if sc else url.rstrip("/")


def run():
    try:
        payload = json.loads(os.getenv("JOB_PAYLOAD", "{}")) or {}
    except (json.JSONDecodeError, TypeError, ValueError):
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    job_id = payload.get("job_id")

    db = get_client()

    if job_id:
        db.table("jobs").update({"status": "running"}).eq("id", job_id).execute()

    try:
        res = db.table("sponsored_posts").select("id, url, posted_at, account_name, influencer_id").execute()
        posts = res.data or []

        if not posts:
            print("추적 중인 게시물이 없습니다.")
            if job_id:
                db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()
            return

        stats = _fetch_stats([p["url"] for p in posts])
        stats_by_key = {_stats_key(s["url"]): s for s in stats}

        print(f"Apify 수집 결과: {len(stats)}건")

        rows = []
        for post in posts:
            key = _stats_key(post["url"])
            s = stats_by_key.get(key)
            if not s:
                print(f"  매칭 실패: {post['url']} (key={key})")
                continue

            updates = {}
            if not post.get("posted_at") and s.get("posted_at"):
                updates["posted_at"] = s["posted_at"]
            if not post.get("account_name") and s.get("account_name"):
                updates["account_name"] = s["account_name"]

            # influencer_id 자동 연결 (스크리닝 지표 표시용)
            if not post.get("influencer_id") and s.get("owner_username"):
                profile_url = f"https://www.instagram.com/{s['owner_username']}/"
                inf_res = db.table("influencers").select("id").eq("url", profile_url).limit(1).execute()
                if inf_res.data:
                    updates["influencer_id"] = inf_res.data[0]["id"]

            if updates:
                db.table("sponsored_posts").update(updates).eq("id", post["id"]).execute()

            rows.append({
                "post_id": post["id"],
                "measured_at": TODAY,
                "play_count": s.get("play_count"),
                "likes_count": s.get("likes_count"),
                "comments_count": s.get("comments_count"),
            })

        if rows:
            db.table("post_daily_stats").upsert(rows, on_conflict="post_id,measured_at").execute()

        print(f"모니터링 완료: {len(rows)}건 저장")

        if job_id:
            db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()

    except Exception as e:
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


def _fetch_stats(urls: list) -> list:
    from apify_client import ApifyClient

    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    run = client.actor(APIFY_IG_ACTOR).call(run_input={
        "directUrls": urls,
        "resultsType": "posts",
        "resultsLimit": len(urls),
    })

    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())

    result = []
    for item in items:
        shortcode = item.get("shortCode") or item.get("shortcode")
        url = (
            item.get("url")
            or (shortcode and f"https://www.instagram.com/p/{shortcode}/")
        )
        if not url:
            continue

        # 게시일 추출
        posted_at = None
        ts = item.get("timestamp") or item.get("takenAt")
        if isinstance(ts, str):
            posted_at = ts[:10]
        elif isinstance(ts, (int, float)):
            posted_at = datetime.utcfromtimestamp(ts).date().isoformat()

        # 계정 정보 추출
        owner = item.get("owner") or {}
        owner_username = item.get("ownerUsername") or owner.get("username")
        account_name = (
            item.get("ownerFullName") or owner.get("fullName")
            or owner_username
        )

        result.append({
            "url": url,
            "play_count": item.get("videoPlayCount") or item.get("videoViewCount"),
            "likes_count": item.get("likesCount") or item.get("likes"),
            "comments_count": item.get("commentsCount") or item.get("comments"),
            "posted_at": posted_at,
            "account_name": account_name,
            "owner_username": owner_username,
        })

    return result


if __name__ == "__main__":
    run()
