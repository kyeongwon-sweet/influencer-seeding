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
    """Instagram URL에서 숏코드 추출 (/p/, /reel/, /reels/, /tv/ 모두 처리)"""
    m = re.search(r'/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)', url or "")
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


def _tt_id(url: str):
    """틱톡 영상 ID 추출"""
    m = re.search(r'/video/(\d+)', url or "")
    return m.group(1) if m else None


def _tt_canonical(url: str) -> str:
    """틱톡 단축/비표준 URL(vt.tiktok.com 등)을 /video/ID 표준 URL로 해석. 이미 표준이면 그대로.
    리다이렉트 Location 헤더만 따라가 본문 요청·차단을 피한다. 실패 시 원본 반환."""
    if not url or _tt_id(url):
        return url
    import urllib.request, urllib.error, urllib.parse

    class _NoFollow(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(_NoFollow)
    cur = url
    for _ in range(5):
        try:
            req = urllib.request.Request(cur, method="HEAD",
                                         headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            opener.open(req, timeout=10)
            break  # 2xx 도달 — 더 이상 리다이렉트 없음
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location")
            if not loc:
                break
            cur = urllib.parse.urljoin(cur, loc)
            if _tt_id(cur):
                return cur
        except Exception as e:
            print(f"  [WARN] 틱톡 단축 URL 해석 실패 {url}: {e}")
            return url
    return cur if _tt_id(cur) else url


def _fetch_tiktok(urls: list) -> dict:
    """틱톡 영상 조회수 수집 (clockworks/tiktok-scraper). 반환: {video_id: {views,likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    run = client.actor("clockworks/tiktok-scraper").call(run_input={
        "postURLs": urls,
        "resultsPerPage": 1,
        "shouldDownloadVideos": False,
        "shouldDownloadCovers": False,
        "shouldDownloadSubtitles": False,
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        vid = _tt_id(it.get("webVideoUrl") or it.get("submittedVideoUrl") or "")
        if vid:
            out[vid] = {
                "views": it.get("playCount"),
                "likes": it.get("diggCount"),
                "comments": it.get("commentCount"),
            }
    return out


def _th_code(url: str):
    """스레드 게시물 코드 추출 (/post/CODE)"""
    m = re.search(r'/post/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _fetch_threads(urls: list) -> dict:
    """스레드 좋아요/답글 수집 (logical_scrapers/threads-post-scraper). 조회수 없음. 반환: {code: {likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    run = client.actor("logical_scrapers/threads-post-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        th = it.get("thread") or {}
        code = th.get("code") or _th_code(th.get("url") or "")
        if code:
            out[code] = {"likes": th.get("like_count"), "comments": th.get("reply_count")}
    return out


def _fb_key(url: str):
    """페이스북 게시물 식별자 (pfbid 또는 숫자 id)"""
    m = re.search(r'pfbid[0-9A-Za-z]+', url or "")
    if m:
        return m.group(0)
    m = re.search(r'/(?:posts|videos)/(\d+)', url or "")
    return m.group(1) if m else None


def _fetch_facebook(urls: list) -> dict:
    """페이스북 좋아요/공유 수집 (apify/facebook-posts-scraper). 일반 게시물은 조회수 없음(영상만). 반환: {key: {likes,comments}}"""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    run = client.actor("apify/facebook-posts-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
        "resultsLimit": max(len(urls), 5),
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        # facebookUrl이 입력 pfbid를 보존(url 필드는 FB가 다른 pfbid로 재생성하므로 매칭 실패)
        key = _fb_key(it.get("facebookUrl") or it.get("url") or "") or it.get("postId")
        if key:
            out[key] = {"likes": it.get("likes"), "comments": it.get("comments")}
    return out


def _tw_id(url: str):
    """트윗 status ID 추출 (x.com·twitter.com 공통). 호스트 앵커로 vox.com 등 오매칭 방지."""
    m = re.search(r'https?://(?:[\w-]+\.)?(?:twitter|x)\.com/[^/]+/status/(\d+)', url or "", re.I)
    return m.group(1) if m else None


def _tw_norm(url: str):
    """트위터 status URL 정규화 → 'https://x.com/<handle>/status/<id>' 표준형.
    ⚠️ twitter-scraper-lite는 끝 슬래시('.../status/123/')·쿼리가 붙은 URL을 'Unsupported URL'로 거부해 0건 반환한다(2026-06-29 확인). 표준형으로 잘라서 넘긴다."""
    m = re.search(r'(https?://(?:[\w-]+\.)?(?:twitter|x)\.com/[^/]+/status/\d+)', url or "", re.I)
    return m.group(1) if m else (url or "").split("?")[0].split("#")[0].rstrip("/")


def _fetch_twitter(urls: list) -> dict:
    """트위터(X) 조회수 수집 (apidojo/twitter-scraper-lite). 반환: {tweet_id: {views,likes,comments}}.
    ⚠️ apidojo/tweet-scraper는 이 트윗들에 noResults만 반환 → twitter-scraper-lite로 교체(2026-06-29 검증, viewCount O).
    ⚠️ startUrls는 끝 슬래시/쿼리를 떼고 표준형으로 넘겨야 한다(_tw_norm) — 안 그러면 'Unsupported URL'로 0건.
    X가 조회수(impressions)를 제한적으로 노출 → 없으면 views=None(그날치 건너뜀)."""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    clean = [_tw_norm(u) for u in urls]
    run = client.actor("apidojo/twitter-scraper-lite").call(run_input={
        "startUrls": clean,
        "maxItems": max(len(clean), 1),
    })
    out = {}
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        tid = _tw_id(it.get("url") or it.get("twitterUrl") or it.get("tweetUrl") or "")
        if tid:
            out[tid] = {
                "views": it.get("viewCount") or it.get("views") or it.get("viewsCount"),
                "likes": it.get("likeCount") or it.get("favoriteCount"),
                "comments": it.get("replyCount"),
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
        # 전체 게시물 로딩 — PostgREST 기본 1000행 제한을 페이지네이션으로 우회.
        # (게시물이 1000개를 넘어도 초과분이 조용히 누락되지 않도록 전부 수집)
        all_posts = []
        _start, _PAGE = 0, 1000
        while True:
            _res = db.table("sponsored_posts").select(
                "id, url, posted_at, account_name, influencer_id, ended_at, content_summary"
            ).range(_start, _start + _PAGE - 1).execute()
            _chunk = _res.data or []
            all_posts.extend(_chunk)
            if len(_chunk) < _PAGE:
                break
            _start += _PAGE
        # 종료(ended_at) 처리된 글은 스크랩 제외 — Apify 사용량 절감(한도 재초과 방지), Vercel 라우트와 동일
        posts = [p for p in all_posts if not p.get("ended_at")]
        print(f"[LOG] 추적 게시물: {len(posts)}개 (종료 제외 {len(all_posts) - len(posts)}개)")

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
            # 인스타 액터에는 instagram.com URL만 전달 (유튜브/틱톡이 섞이면 액터가 입력 검증 실패 → 호출 전체 실패)
            # ⚠️ shortcode 없는 프로필형 URL(예: .../username/reels/)은 제외 — 액터가 그 계정 게시물을
            #    resultsLimit만큼 통째로 긁어 과수집(건당 비용 폭증)됨. 매칭도 shortcode 기준이라 어차피 불가.
            ig_all = [p["url"] for p in posts if "instagram.com" in (p.get("url") or "")]
            ig_urls = [u for u in ig_all if _ig_shortcode(u)]
            skipped = [u for u in ig_all if not _ig_shortcode(u)]
            if skipped:
                print(f"[WARN] shortcode 없는 IG URL {len(skipped)}개 제외(프로필형 과수집 방지): {skipped}")
            stats = _fetch_stats(ig_urls)
            stats_by_key = {_stats_key(s["url"]): s for s in stats}
            print(f"[LOG] Apify 수집 결과: {len(stats)}건 / {len(ig_urls)}개 요청(인스타)")

            # 🛟 IG 폴백: 인스타가 기본 액터(apify/instagram-scraper) 요청을 차단하면 no_items만 와서 조회수가 대량 누락된다.
            # 릴스/tv는 정상 시 거의 항상 play_count가 있으므로, 릴스 조회수가 대량 누락이면 '차단'으로 보고 막힌 건만 data-slayer로 재시도.
            reels = [u for u in ig_urls if re.search(r'/(?:reel|reels|tv)/', u)]
            reel_missing = [u for u in reels if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
            if reels and len(reel_missing) / len(reels) >= 0.4:
                missing = [u for u in ig_urls if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
                print(f"[WARN] IG 릴스 조회수 누락 {len(reel_missing)}/{len(reels)} → 기본 액터 차단 추정, data-slayer 폴백 {len(missing)}건 호출")
                fb = _fetch_ig_fallback(missing)
                merged = 0
                for u in missing:
                    m = fb.get(_ig_shortcode(u) or "")
                    if not m:
                        continue
                    key = _stats_key(u)
                    cur = stats_by_key.get(key) or {"url": u}
                    if m.get("play_count") is not None:
                        cur["play_count"] = m["play_count"]
                        merged += 1
                    if m.get("likes_count") is not None:
                        cur["likes_count"] = m["likes_count"]
                    if m.get("comments_count") is not None:
                        cur["comments_count"] = m["comments_count"]
                    stats_by_key[key] = cur
                print(f"[LOG] data-slayer 폴백 보강 완료: 조회수 {merged}건 채움")

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
            # 시트에 캡션이 없으면 스크랩한 캡션으로 채움(비어 있을 때만 — 수동/시트 캡션 보존). webhook과 동일.
            if not post.get("content_summary") and s.get("content_summary"):
                updates["content_summary"] = s["content_summary"]

            # influencer_id 자동 연결 (스크리닝 지표 표시용)
            if not post.get("influencer_id") and s.get("owner_username"):
                profile_url = f"https://www.instagram.com/{s['owner_username']}/"
                inf_res = db.table("influencers").select("id").eq("url", profile_url).limit(1).execute()
                if inf_res.data:
                    updates["influencer_id"] = inf_res.data[0]["id"]

            if updates:
                db.table("sponsored_posts").update(updates).eq("id", post["id"]).execute()

            # 기존 데이터 조회 (누적값 검증)
            existing_res = db.table("post_daily_stats").select("play_count, likes_count, comments_count").eq("post_id", post["id"]).order("measured_at", desc=True).limit(1).execute()
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
        yt_failed = False
        if yt_posts and not skip_apify:
            try:
                yt_stats = _fetch_youtube([p["url"] for p in yt_posts])
                print(f"[LOG] 유튜브 수집: {len(yt_stats)}건 / {len(yt_posts)}개 요청")
                # 직전(오늘 이전) 누적값을 일괄 조회 (게시물별 개별 쿼리 대신 한 번에)
                prev_res = db.table("post_daily_stats").select("post_id, play_count, likes_count, comments_count, measured_at").in_("post_id", [p["id"] for p in yt_posts]).lt("measured_at", TODAY).order("measured_at", desc=True).execute()
                last_stat = {}
                for r in (prev_res.data or []):
                    last_stat.setdefault(r["post_id"], r)
                for post in yt_posts:
                    s = yt_stats.get(_yt_id(post["url"]))
                    if not s:
                        continue
                    existing = last_stat.get(post["id"], {})
                    play = s.get("views")
                    if play is not None and existing.get("play_count") is not None and play < existing.get("play_count"):
                        print(f"  ❌ 유튜브 조회수 역행 {post['url']} → NULL 처리")
                        play = None
                    likes, comments = s.get("likes"), s.get("comments")
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": play,
                        # 실제 0을 stale 값으로 덮어쓰지 않도록 None일 때만 폴백
                        "likes_count": likes if likes is not None else existing.get("likes_count"),
                        "comments_count": comments if comments is not None else existing.get("comments_count"),
                    })
            except Exception as e:
                # 무음 실패 방지: 에러를 명시하고 아래에서 작업을 실패로 표시(IG는 정상 저장됨)
                print(f"[ERROR] 유튜브 수집 실패: {e}")
                yt_failed = True

        # TikTok 수집 (전용 액터). playCount 0 = 접근불가(삭제/비공개/지역제한)로 보고 저장 안 함(직전 값 유지)
        tt_posts = [p for p in posts if "tiktok.com" in (p.get("url") or "")]
        tt_failed = False
        if tt_posts and not skip_apify:
            try:
                # 단축/비표준 URL(vt.tiktok.com 등)을 /video/ID 표준형으로 해석 → 결과 매칭 실패 방지
                tt_canon = {p["url"]: _tt_canonical(p["url"]) for p in tt_posts}
                tt_stats = _fetch_tiktok([tt_canon[p["url"]] for p in tt_posts])
                got = sum(1 for s in tt_stats.values() if (s.get("views") or 0) > 0)
                print(f"[LOG] 틱톡 수집: 실값 {got}건 / {len(tt_posts)}개 요청")
                prev_res = db.table("post_daily_stats").select("post_id, play_count, likes_count, comments_count, measured_at").in_("post_id", [p["id"] for p in tt_posts]).lt("measured_at", TODAY).order("measured_at", desc=True).execute()
                last_stat = {}
                for r in (prev_res.data or []):
                    last_stat.setdefault(r["post_id"], r)
                for post in tt_posts:
                    s = tt_stats.get(_tt_id(tt_canon[post["url"]]))
                    play = s.get("views") if s else None
                    # 🛡️ 0/미반환은 접근불가 → 저장 안 함(0으로 덮어쓰면 누적 붕괴, 직전 값 유지)
                    if not play or play <= 0:
                        continue
                    existing = last_stat.get(post["id"], {})
                    if existing.get("play_count") is not None and play < existing.get("play_count"):
                        print(f"  ❌ 틱톡 조회수 역행 {post['url']} → NULL 처리")
                        play = None
                    likes, comments = s.get("likes"), s.get("comments")
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": play,
                        "likes_count": likes if likes is not None else existing.get("likes_count"),
                        "comments_count": comments if comments is not None else existing.get("comments_count"),
                    })
            except Exception as e:
                print(f"[ERROR] 틱톡 수집 실패: {e}")
                tt_failed = True

        # Threads 수집 (전용 액터). 조회수 없음 → 좋아요/답글만 (play_count는 미설정)
        th_posts = [p for p in posts if ("threads.com" in (p.get("url") or "") or "threads.net" in (p.get("url") or ""))]
        th_failed = False
        if th_posts and not skip_apify:
            try:
                th_stats = _fetch_threads([p["url"] for p in th_posts])
                print(f"[LOG] 스레드 수집: {len(th_stats)}건 / {len(th_posts)}개 요청")
                prev_res = db.table("post_daily_stats").select("post_id, likes_count, comments_count, measured_at").in_("post_id", [p["id"] for p in th_posts]).lt("measured_at", TODAY).order("measured_at", desc=True).execute()
                last_stat = {}
                for r in (prev_res.data or []):
                    last_stat.setdefault(r["post_id"], r)
                for post in th_posts:
                    s = th_stats.get(_th_code(post["url"]))
                    if not s:
                        continue
                    existing = last_stat.get(post["id"], {})
                    likes, comments = s.get("likes"), s.get("comments")
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": None,  # 스레드는 조회수 미제공
                        # 액터가 필드 누락 시 None으로 덮어쓰지 않도록 직전값 폴백
                        "likes_count": likes if likes is not None else existing.get("likes_count"),
                        "comments_count": comments if comments is not None else existing.get("comments_count"),
                    })
            except Exception as e:
                print(f"[ERROR] 스레드 수집 실패: {e}")
                th_failed = True

        # Facebook 수집 (전용 액터). 일반 게시물은 조회수 없음(영상만) → 좋아요만 (댓글 미반환)
        fb_posts = [p for p in posts if "facebook.com" in (p.get("url") or "")]
        fb_failed = False
        if fb_posts and not skip_apify:
            try:
                fb_stats = _fetch_facebook([p["url"] for p in fb_posts])
                print(f"[LOG] 페이스북 수집: {len(fb_stats)}건 / {len(fb_posts)}개 요청")
                prev_res = db.table("post_daily_stats").select("post_id, likes_count, comments_count, measured_at").in_("post_id", [p["id"] for p in fb_posts]).lt("measured_at", TODAY).order("measured_at", desc=True).execute()
                last_stat = {}
                for r in (prev_res.data or []):
                    last_stat.setdefault(r["post_id"], r)
                for post in fb_posts:
                    s = fb_stats.get(_fb_key(post["url"]))
                    if not s:
                        continue
                    existing = last_stat.get(post["id"], {})
                    likes, comments = s.get("likes"), s.get("comments")
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": None,  # 일반 게시물은 조회수 없음
                        # 액터가 필드 누락 시 None으로 덮어쓰지 않도록 직전값 폴백
                        "likes_count": likes if likes is not None else existing.get("likes_count"),
                        "comments_count": comments if comments is not None else existing.get("comments_count"),
                    })
            except Exception as e:
                print(f"[ERROR] 페이스북 수집 실패: {e}")
                fb_failed = True

        # 트위터(X) 수집 (apidojo/tweet-scraper). 조회수 있음 → 틱톡과 동일 처리(역행 가드 포함).
        tw_posts = [p for p in posts if _tw_id(p.get("url") or "")]
        tw_failed = False
        if tw_posts and not skip_apify:
            try:
                tw_stats = _fetch_twitter([p["url"] for p in tw_posts])
                got = sum(1 for s in tw_stats.values() if (s.get("views") or 0) > 0)
                print(f"[LOG] 트위터 수집: 실값 {got}건 / {len(tw_posts)}개 요청")
                prev_res = db.table("post_daily_stats").select("post_id, play_count, likes_count, comments_count, measured_at").in_("post_id", [p["id"] for p in tw_posts]).lt("measured_at", TODAY).order("measured_at", desc=True).execute()
                last_stat = {}
                for r in (prev_res.data or []):
                    last_stat.setdefault(r["post_id"], r)
                for post in tw_posts:
                    s = tw_stats.get(_tw_id(post["url"]))
                    play = s.get("views") if s else None
                    # 🛡️ 0/미반환(X 조회수 미노출)은 접근불가 → 저장 안 함(직전 값 유지)
                    if not play or play <= 0:
                        continue
                    existing = last_stat.get(post["id"], {})
                    if existing.get("play_count") is not None and play < existing.get("play_count"):
                        print(f"  ❌ 트위터 조회수 역행 {post['url']} → NULL 처리")
                        play = None
                    likes, comments = s.get("likes"), s.get("comments")
                    rows.append({
                        "post_id": post["id"],
                        "measured_at": TODAY,
                        "play_count": play,
                        "likes_count": likes if likes is not None else existing.get("likes_count"),
                        "comments_count": comments if comments is not None else existing.get("comments_count"),
                    })
            except Exception as e:
                print(f"[ERROR] 트위터 수집 실패: {e}")
                tw_failed = True

        if rows:
            # 🛡️ 수집 도중 삭제된 게시물 행 제거 — 없는 post_id가 섞이면 FK 위반으로 upsert 전체가 실패한다.
            row_pids = list({r["post_id"] for r in rows})
            valid = set()
            for i in range(0, len(row_pids), 200):
                vr = db.table("sponsored_posts").select("id").in_("id", row_pids[i:i + 200]).execute()
                for x in (vr.data or []):
                    valid.add(x["id"])
            before = len(rows)
            rows = [r for r in rows if r["post_id"] in valid]
            if len(rows) < before:
                print(f"[WARN] 수집 중 삭제된 게시물 행 {before - len(rows)}건 제외(FK 보호)")
        if rows:
            print(f"[LOG] 데이터 저장 시작: {len(rows)}건")
            result = db.table("post_daily_stats").upsert(rows, on_conflict="post_id,measured_at").execute()
            print(f"[LOG] ✅ 데이터 저장 완료: {len(rows)}건")
        else:
            print(f"[WARN] 저장할 데이터가 없습니다 (매칭 실패 또는 조회수 오류)")

        print(f"[SUCCESS] 모니터링 완료: {len(rows)}건 저장")

        if job_id:
            db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()

        # 부가 플랫폼 수집이 실패하면 작업을 실패로 표시해 알림이 오게 한다(알람은 끄지 않는다).
        # 실패의 실제 원인(예: Apify 월 한도 초과)을 보고 근본 해결하기 위함.
        # (IG 데이터는 위에서 이미 저장됨. status='missing'이면 11/14/17시 재수집이 복구.)
        if yt_failed or tt_failed or fb_failed or th_failed or tw_failed:
            raise RuntimeError(f"수집 일부 실패(유튜브={yt_failed}, 틱톡={tt_failed}, 페북={fb_failed}, 스레드={th_failed}, 트위터={tw_failed}) — 원인 확인 필요")

    except Exception as e:
        print(f"[ERROR] 모니터링 실패: {str(e)}")
        import traceback
        print(f"[ERROR] Traceback:\n{traceback.format_exc()}")
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


def _fetch_ig_fallback(urls: list) -> dict:
    """기본 IG 액터(apify/instagram-scraper)가 인스타 차단으로 no_items만 반환할 때, data-slayer/instagram-post-details로 조회수 보강.
    반환: {shortcode: {play_count, likes_count, comments_count}}.
    ⚠️ metrics.play_count는 기존 videoPlayCount 시리즈와 연속됨(2026-06-29 실측 비율 1.000). 비용↑(~2.7배)이라 차단 감지 시에만 호출한다."""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    out = {}
    for i in range(0, len(urls), 40):
        chunk = urls[i:i + 40]
        try:
            run = client.actor("data-slayer/instagram-post-details").call(run_input={"postUrls": chunk})
            for it in client.dataset(run["defaultDatasetId"]).iterate_items():
                code = it.get("code") or it.get("shortcode") or it.get("shortCode")
                if not code:
                    continue
                m = it.get("metrics") or {}
                out[code] = {
                    "play_count": m.get("play_count"),
                    "likes_count": m.get("like_count"),
                    "comments_count": m.get("comment_count"),
                }
        except Exception as e:
            print(f"  [WARN] data-slayer 폴백 배치 실패: {e}")
    return out


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
            "content_summary": (item.get("caption") or "")[:300] or None,
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
