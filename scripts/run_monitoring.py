#!/usr/bin/env python3
# 협찬 모니터링 Instagram 데이터 수집 및 통계 생성
import os
import re
import json
import time
from datetime import date, datetime
from functools import wraps
from db import get_client
from url_utils import normalize_url


def retry_on_network_error(max_retries=3, delay=5):
    """네트워크 에러 시 자동 재시도 데코레이터"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    error_str = str(e).lower()
                    # 네트워크 에러만 재시도 (DNS, 연결 실패 등)
                    if "name or service not known" in error_str or "connect" in error_str:
                        if attempt < max_retries - 1:
                            print(f"[WARN] 네트워크 에러 발생. {delay}초 후 재시도... ({attempt + 1}/{max_retries})")
                            time.sleep(delay)
                            continue
                    # 네트워크 에러가 아니면 즉시 실패
                    raise
            # 모든 재시도 실패
            raise last_error
        return wrapper
    return decorator

APIFY_IG_ACTOR = os.getenv("APIFY_IG_ACTOR_ID", "apify/instagram-scraper")
TODAY = os.getenv("MONITORING_DATE") or date.today().isoformat()


def _ig_shortcode(url: str) -> str | None:
    """Instagram URL에서 숏코드 추출 (/p/, /reel/, /tv/ 모두 처리)"""
    m = re.search(r'/(?:p|reel|tv)/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _stats_key(url: str) -> str:
    """매칭 키: 인스타그램이면 숏코드, 아니면 정규화된 URL"""
    sc = _ig_shortcode(url)
    if sc:
        return sc
    return normalize_url(url)  # url_utils에서 import


def _yt_id(url: str):
    """유튜브 영상 ID 추출 (shorts/watch/youtu.be)"""
    m = re.search(r'(?:shorts/|watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})', url or "")
    return m.group(1) if m else None


def _fetch_youtube(urls: list) -> dict:
    """유튜브 영상 조회수 수집 (streamers/youtube-scraper). 반환: {video_id: {views,likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    run = client.actor("streamers/youtube-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
        "maxResults": 1,
        "maxResultStreams": 0,
        "maxResultsShorts": 0,
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        vid = _yt_id(it.get("url") or "")
        if vid:
            out[vid] = {
                "views": it.get("viewCount"),
                "likes": it.get("likes"),
                "comments": it.get("commentsCount"),
            }
    return out


def run():
    print("[DEBUG] === 협찬 모니터링 시작 ===")
    print(f"[DEBUG] 환경변수 확인:")
    print(f"  - SUPABASE_URL: {'설정됨' if os.getenv('SUPABASE_URL') else '❌ 미설정'}")
    print(f"  - SUPABASE_SERVICE_ROLE_KEY: {'설정됨' if os.getenv('SUPABASE_SERVICE_ROLE_KEY') else '❌ 미설정'}")
    print(f"  - APIFY_API_TOKEN: {'설정됨' if os.getenv('APIFY_API_TOKEN') else '❌ 미설정'}")
    print(f"  - SKIP_APIFY: {os.getenv('SKIP_APIFY', '0')}")
    print(f"  - JOB_PAYLOAD: {os.getenv('JOB_PAYLOAD', '{}')}\n")

    # 네트워크 연결 테스트
    print("[DEBUG] 네트워크 연결 테스트...")
    try:
        import socket
        socket.gethostbyname("supabase.co")
        print("[DEBUG] ✅ DNS 해석 성공: supabase.co")
    except socket.gaierror as e:
        print(f"[DEBUG] ❌ DNS 해석 실패: {e}")
    except Exception as e:
        print(f"[DEBUG] ❌ 네트워크 테스트 실패: {e}")

    # JOB_PAYLOAD 환경변수 처리 (None, "null", 비어있음 모두 처리)
    job_payload_str = os.getenv("JOB_PAYLOAD", "{}")

    # null 문자열이거나 비어있으면 {}로 기본값 설정
    if not job_payload_str or job_payload_str.strip() in ("null", "None", ""):
        job_payload_str = "{}"

    try:
        payload = json.loads(job_payload_str)
    except (json.JSONDecodeError, TypeError, ValueError):
        payload = {}

    # json.loads("null")은 None을 반환하므로 명시적으로 체크
    if payload is None:
        payload = {}
    # payload가 dict가 아니면 기본값
    elif not isinstance(payload, dict):
        payload = {}

    job_id = payload.get("job_id")

    db = get_client()

    if job_id:
        db.table("jobs").update({"status": "running"}).eq("id", job_id).execute()

    try:
        print(f"[LOG] 협찬 모니터링 시작 - 날짜: {TODAY}")
        res = db.table("sponsored_posts").select("id, url, posted_at, account_name, influencer_id").execute()
        posts = res.data or []
        print(f"[LOG] 추적 게시물: {len(posts)}개")

        if not posts:
            print("[WARN] 추적 중인 게시물이 없습니다.")
            if job_id:
                db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()
            return

        # Apify 호출 여부 제어 (SKIP_APIFY=1이면 스킵, 기본값: 호출)
        # SKIP_APIFY=1일 때는 기존 데이터만 사용 (Apify 호출 없이 진행)
        skip_apify = os.getenv("SKIP_APIFY", "0").lower() in ("1", "true", "yes")

        stats_by_key = {}
        if skip_apify:
            print(f"[LOG] ⏭️ Apify 데이터 수집 스킵 (SKIP_APIFY=1) - 기존 데이터만 사용")
        else:
            print(f"[LOG] Apify 데이터 수집 시작...")
            stats = _fetch_stats([p["url"] for p in posts])
            stats_by_key = {_stats_key(s["url"]): s for s in stats}
            print(f"[LOG] Apify 수집 결과: {len(stats)}건 / {len(posts)}개 요청")

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

            # 기존 데이터 조회 (누적값 검증)
            existing_res = db.table("post_daily_stats").select("play_count, likes_count, comments_count").eq("post_id", post["id"]).order("measured_at", ascending=False).limit(1).execute()
            existing = existing_res.data[0] if existing_res.data else {}

            play_count = s.get("play_count")

            # 조회수 검증
            if play_count is None:
                # Apify가 조회수를 반환하지 않음 (게시물 타입상 조회수 없을 수 있음)
                print(f"  ⚠️  조회수 없음: {post['url']} (account={s.get('account_name')})")
                play_count = None
            elif existing.get("play_count") is not None and play_count < existing.get("play_count"):
                # 누적값인데 줄어들었다 = 오류
                print(f"  ❌ 오류: 조회수 역행 {post['url']} ({existing.get('play_count')} → {play_count})")
                play_count = None  # 오류값이므로 NULL로 표시

            rows.append({
                "post_id": post["id"],
                "measured_at": TODAY,
                "play_count": play_count,
                "likes_count": s.get("likes_count") or existing.get("likes_count"),
                "comments_count": s.get("comments_count") or existing.get("comments_count"),
            })

        # YouTube 수집 (인스타 액터로는 불가 → 전용 액터). IG 루프에서 매칭 실패로 건너뛴 유튜브 글을 채움
        yt_posts = [p for p in posts if ("youtube.com" in (p.get("url") or "") or "youtu.be" in (p.get("url") or ""))]
        if yt_posts and not skip_apify:
            try:
                yt_stats = _fetch_youtube([p["url"] for p in yt_posts])
                print(f"[LOG] 유튜브 수집: {len(yt_stats)}건 / {len(yt_posts)}개 요청")
                for post in yt_posts:
                    s = yt_stats.get(_yt_id(post["url"]))
                    if not s:
                        continue
                    existing_res = db.table("post_daily_stats").select("play_count, likes_count, comments_count").eq("post_id", post["id"]).order("measured_at", ascending=False).limit(1).execute()
                    existing = existing_res.data[0] if existing_res.data else {}
                    play = s.get("views")
                    if play is not None and existing.get("play_count") is not None and play < existing.get("play_count"):
                        print(f"  ❌ 유튜브 조회수 역행 {post['url']} → NULL 처리")
                        play = None
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": play,
                        "likes_count": s.get("likes") or existing.get("likes_count"),
                        "comments_count": s.get("comments") or existing.get("comments_count"),
                    })
            except Exception as e:
                print(f"[WARN] 유튜브 수집 실패: {e}")

        if rows:
            print(f"[LOG] 데이터 저장 시작: {len(rows)}건")
            result = db.table("post_daily_stats").upsert(rows, on_conflict="post_id,measured_at").execute()
            print(f"[LOG] ✅ 데이터 저장 완료: {len(rows)}건")
        else:
            print(f"[WARN] 저장할 데이터가 없습니다 (매칭 실패 또는 조회수 오류)")

        print(f"[SUCCESS] 모니터링 완료: {len(rows)}건 저장")

        if job_id:
            db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()

    except Exception as e:
        print(f"[ERROR] 모니터링 실패: {str(e)}")
        import traceback
        print(f"[ERROR] Traceback:\n{traceback.format_exc()}")
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


@retry_on_network_error(max_retries=3, delay=10)
def _fetch_stats(urls: list) -> list:
    from apify_client import ApifyClient

    # ⚠️ Apify API 토큰 확인
    apify_token = os.getenv("APIFY_API_TOKEN")
    if not apify_token:
        raise RuntimeError("[ERROR] APIFY_API_TOKEN 환경변수가 설정되지 않았습니다")

    print(f"[LOG] Apify 액터 호출: {APIFY_IG_ACTOR}")
    print(f"[LOG] 수집 대상 URL: {len(urls)}개")

    try:
        client = ApifyClient(apify_token)
        run = client.actor(APIFY_IG_ACTOR).call(run_input={
            "directUrls": urls,
            "resultsType": "posts",
            "resultsLimit": len(urls),
            "maxRequestRetries": 3,
            # 데이터센터 IP는 인스타에 차단됨 → 레지덴셜 프록시로 릴스 조회수 수집
            "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
        })
    except Exception as e:
        raise RuntimeError(f"[ERROR] Apify 액터 호출 실패: {str(e)}")

    print(f"[LOG] Apify 실행 ID: {run.get('id')}")

    items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    print(f"[LOG] Apify 응답 아이템: {len(items)}개")

    result = []
    for idx, item in enumerate(items):
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

        # 조회수 추출 (필드별 우선순위)
        # - 릴스: videoPlayCount, videoViewCount
        # - 일반 포스트: impressions (Instagram 인사이트)
        # - 폴백: views (legacy field)
        play_count = (
            item.get("videoPlayCount")
            or item.get("videoViewCount")
            or item.get("impressions")  # 일반 포스트의 임프레션 (조회수)
            or item.get("views")
            or item.get("count")  # 일부 버전의 조회수 필드
            or None
        )

        # 📊 상세 로깅: 조회수 필드 분석
        available_count_fields = {
            "videoPlayCount": item.get("videoPlayCount"),
            "videoViewCount": item.get("videoViewCount"),
            "impressions": item.get("impressions"),
            "views": item.get("views"),
            "count": item.get("count"),
        }
        non_none_fields = {k: v for k, v in available_count_fields.items() if v is not None}

        # 조회수가 없는 게시물 기록
        if not play_count:
            post_type_indicators = []
            if item.get("videoPlayCount") or item.get("videoViewCount"):
                post_type_indicators.append("Reel/Video")
            else:
                post_type_indicators.append("Post")

            if idx < 3:  # 처음 3개만 상세 로깅
                print(f"[DEBUG] 조회수 미제공 ({post_type_indicators[0]}): {url}")
                print(f"        계정: {account_name}")
                print(f"        가능한 조회수 필드: {non_none_fields or 'NONE'}")
                print(f"        모든 필드 키: {list(item.keys())}\n")

        result.append({
            "url": url,
            "play_count": play_count,
            "likes_count": item.get("likesCount") or item.get("likes"),
            "comments_count": item.get("commentsCount") or item.get("comments"),
            "posted_at": posted_at,
            "account_name": account_name,
            "owner_username": owner_username,
        })

    return result


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        import traceback
        print(f"\n❌ [ERROR] 모니터링 실패!")
        print(f"오류: {str(e)}")
        print(f"\n스택 트레이스:")
        traceback.print_exc()
        exit(1)
