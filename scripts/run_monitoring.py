#!/usr/bin/env python3
# 협찬 모니터링 Instagram 데이터 수집 및 통계 생성
import os
import re
import json
import time
from datetime import date, datetime, timedelta, timezone
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
                    # 네트워크 에러만 재시도 (DNS·연결 실패·타임아웃 등). "connect" 단독 매칭은
                    # "cannot connect actor input" 같은 비네트워크 에러까지 잡아 오탐 → 구체 문구로 한정.
                    _net = ("name or service not known", "connection reset", "connection refused",
                            "connection aborted", "connection timed out", "timed out",
                            "temporarily unavailable", "max retries exceeded", "connection error")
                    if any(p in error_str for p in _net):
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
# GHA는 MONITORING_DATE(KST)를 항상 주입. 폴백(로컬 실행)도 러너 로컬시각 대신 KST로 계산 — UTC 러너에서 하루 밀림 방지.
TODAY = os.getenv("MONITORING_DATE") or (datetime.now(timezone.utc) + timedelta(hours=9)).date().isoformat()


def _ig_shortcode(url: str) -> str | None:
    """Instagram URL에서 숏코드 추출 (/p/, /reel/, /reels/, /tv/ 모두 처리)"""
    m = re.search(r'/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _prev_stats(db, post_ids):
    """게시물들의 '오늘 이전' 최신 통계를 {post_id: row} 로 반환 (mono가드 기준값).

    - post_id를 100개씩 청크로 나눠 .in_ 쿼리 URL 길이 한도 회피
    - measured_at desc + created_at desc(같은 날 다중행을 결정적으로 최신 선택) 정렬
    - .range() 페이지네이션으로 PostgREST 기본 1000행 상한을 넘겨도 각 post의 최신행 유실 방지
    """
    last: dict = {}
    ids = [i for i in post_ids if i]
    PAGE = 1000
    for c in range(0, len(ids), 100):
        chunk = ids[c:c + 100]
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, play_count, likes_count, comments_count, measured_at")
                   .in_("post_id", chunk)
                   .lt("measured_at", TODAY)
                   .order("measured_at", desc=True)
                   .order("created_at", desc=True)
                   .order("id", desc=True)   # 고유키 tiebreaker — range() 경계 행 누락 방지(직전값 오판 방지)
                   .range(frm, frm + PAGE - 1)
                   .execute())
            page = res.data or []
            for r in page:
                last.setdefault(r["post_id"], r)
            if len(page) < PAGE:
                break
            frm += PAGE
    return last


def _store_aux_rows(db, rows, posts, stats, key_fn, label, *, views="clamp", caption_field=None, caption_limit=None):
    """보조 플랫폼(YT/틱톡/스레드/FB/X) 공통 저장 루프 — 5개 블록의 복붙을 단일 구현으로.

    views:
      - "clamp":    0/미반환은 접근불가로 보고 행 자체를 저장 안 함(직전 값 유지) + 역행 clamp. (틱톡·X)
      - "optional": 조회수 None이어도 행 저장(좋아요 등 유지) + 값 있으면 역행 clamp. (유튜브)
      - "none":     플랫폼이 조회수 미제공 → play_count는 항상 None. (스레드·FB)
    caption_field: 비어 있는 content_summary만 stats의 이 필드로 자동 채움(시트/수동 캡션 보존).
    """
    last_stat = _prev_stats(db, [p["id"] for p in posts])
    for post in posts:
        s = stats.get(key_fn(post))
        # 캡션 자동채움 — 조회수 유무와 무관, 비어 있을 때만
        if s and caption_field and not post.get("content_summary") and s.get(caption_field):
            cap = s[caption_field][:caption_limit] if caption_limit else s[caption_field]
            db.table("sponsored_posts").update({"content_summary": cap}).eq("id", post["id"]).execute()
        if not s:
            continue
        existing = last_stat.get(post["id"], {})
        play = None if views == "none" else s.get("views")
        if views == "clamp" and (not play or play <= 0):
            continue  # 🛡️ 0/미반환은 접근불가 → 저장 안 함(0으로 덮어쓰면 누적 붕괴)
        if play is not None and existing.get("play_count") is not None and play < existing.get("play_count"):
            # 미세 감소는 정상 지터 → NULL 대신 직전 최대값 유지(clamp)
            print(f"  ⚠️  {label} 조회수 역행 clamp {post['url']} ({play} → {existing.get('play_count')} 유지)")
            play = existing.get("play_count")
        likes, comments = s.get("likes"), s.get("comments")
        rows.append({
            "post_id": post["id"],
            "measured_at": TODAY,
            "play_count": play,
            # 액터가 필드 누락 시 None으로 덮어쓰지 않도록 직전값 폴백 (실제 0은 그대로 저장)
            "likes_count": likes if likes is not None else existing.get("likes_count"),
            "comments_count": comments if comments is not None else existing.get("comments_count"),
        })


def _snapshot_totals(db, post_ids, upto):
    """게시물들의 upto(포함) 시점 누적 총합 스냅샷 — 일별 증분 락 저장용.
    - play: 각 post의 max(누적·mono) play_count(≤ upto). likes/comments: 각 post의 최신값.
    - 증분[D] = 스냅샷[D].total_play − 스냅샷[D-1].total_play (락되어 사후에 안 바뀜).
    표시 dailyTotals(전일 forward-fill + 단조보정)와 동일 정의(합=합의 차).
    """
    last: dict = {}      # post별 최신 행 (likes/comments용)
    maxplay: dict = {}   # post별 max play(누적)
    ids = [i for i in post_ids if i]
    PAGE = 1000
    for c in range(0, len(ids), 100):
        chunk = ids[c:c + 100]
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, play_count, likes_count, comments_count, measured_at")
                   .in_("post_id", chunk)
                   .lte("measured_at", upto)
                   .order("measured_at", desc=True)
                   .order("created_at", desc=True)
                   .order("id", desc=True)   # 고유키 tiebreaker — range() 경계 행 누락 방지(직전값 오판 방지)
                   .range(frm, frm + PAGE - 1)
                   .execute())
            page = res.data or []
            for r in page:
                pid = r["post_id"]
                last.setdefault(pid, r)  # desc 정렬 → 첫 = 최신
                pc = r.get("play_count")
                if pc is not None and pc > maxplay.get(pid, -1):
                    maxplay[pid] = pc
            if len(page) < PAGE:
                break
            frm += PAGE
    tp = sum(maxplay.values())
    tl = sum((v.get("likes_count") or 0) for v in last.values() if (v.get("likes_count") or 0) >= 0)
    tc = sum((v.get("comments_count") or 0) for v in last.values() if (v.get("comments_count") or 0) >= 0)
    return {"total_play": tp, "total_likes": tl, "total_comments": tc, "post_count": len(last)}


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
    """유튜브 영상 조회수 수집 (streamers/youtube-scraper). 반환: {video_id: {views,likes,comments,title}}.
    유튜브는 '캡션'이 따로 없어 영상 제목(title)을 캡션(content_summary)으로 쓴다."""
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
                "title": it.get("title"),
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
                # 틱톡 영상 설명 → 캡션(content_summary). 액터가 text로 반환(실측 확인). 300자 제한.
                "content_summary": (it.get("text") or "")[:300] or None,
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
        "resultsLimit": len(urls),  # 요청 URL 수만큼만(단건에 최대 5 요청하던 과수집 제거)
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
                # 트윗 본문 → 캡션(content_summary). 액터가 fullText/text로 반환(실측 확인). 300자 제한.
                "content_summary": (it.get("fullText") or it.get("text") or "")[:300] or None,
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
                "id, url, posted_at, account_name, influencer_id, ended_at, content_summary, notes, channel_type, project_name"
            ).range(_start, _start + _PAGE - 1).execute()
            _chunk = _res.data or []
            all_posts.extend(_chunk)
            if len(_chunk) < _PAGE:
                break
            _start += _PAGE

        # 🛑 자동 종료 정책 — ended_at 딱지 부여(삭제 아님, 데이터 보존). 온드미디어·위성채널 제외.
        #   규칙(OR): 배너 게시+7일 / 그외 게시+14일 / 7일 미반환(마지막 실측) / 캡션(content_summary) '종료·보관·삭제'
        try:
            active_ids = [p["id"] for p in all_posts if not p.get("ended_at")]
            last_meas = {}
            for _i in range(0, len(active_ids), 100):
                _c = active_ids[_i:_i + 100]
                _f = 0
                while True:
                    _r = (db.table("post_daily_stats").select("post_id, measured_at")
                          .in_("post_id", _c).gt("play_count", 0)
                          .order("measured_at", desc=True).range(_f, _f + 999).execute())
                    _pg = _r.data or []
                    for _x in _pg:
                        if _x["post_id"] not in last_meas:
                            last_meas[_x["post_id"]] = _x["measured_at"]
                    if len(_pg) < 1000:
                        break
                    _f += 1000
            today_d = date.fromisoformat(TODAY)
            KW = ("종료", "보관", "삭제")
            to_end = []
            for p in all_posts:
                if p.get("ended_at"):
                    continue
                ct = p.get("channel_type") or ""
                pn = p.get("project_name") or ""
                if "온드미디어" in ct or "위성채널" in pn or "온드미디어" in pn:
                    continue
                pa = p.get("posted_at")
                cap = p.get("content_summary") or ""
                age = (today_d - date.fromisoformat(str(pa)[:10])).days if pa else None
                lm = last_meas.get(p["id"])
                gap = (today_d - date.fromisoformat(lm)).days if lm else None
                if (("배너" in ct and age is not None and age >= 7)
                        or ("배너" not in ct and age is not None and age >= 14)
                        or (gap is not None and gap >= 7)
                        or any(k in cap for k in KW)):
                    to_end.append(p["id"])
            if to_end:
                for _i in range(0, len(to_end), 100):
                    db.table("sponsored_posts").update({"ended_at": TODAY}).in_("id", to_end[_i:_i + 100]).execute()
                ended_set = set(to_end)
                for p in all_posts:
                    if p["id"] in ended_set:
                        p["ended_at"] = TODAY  # 이번 수집에서도 제외되도록 반영
                print(f"[LOG] 🛑 자동 종료: {len(to_end)}건 (ended_at={TODAY})")
        except Exception as e:
            print(f"[WARN] 자동 종료 처리 실패(무시): {e}")

        # 종료(ended_at) 처리된 글과 측정일 기준 업로드 전 글은 스크랩 제외.
        # 업로드 전 조회수는 존재할 수 없으므로 DB/API에 들어오지 않게 입구에서 차단한다.
        posts = [
            p for p in all_posts
            if not p.get("ended_at")
            and (not p.get("posted_at") or str(p.get("posted_at"))[:10] <= TODAY)
        ]
        print(f"[LOG] 추적 게시물: {len(posts)}개 (종료/업로드전 제외 {len(all_posts) - len(posts)}개)")

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

            # 🛟 IG 폴백: 인스타가 기본 액터를 차단하거나 조회수 필드만 빼고 반환하면 play_count가 대량 누락된다.
            # ⚠️ 감지 기준 교체(2026-07-06): 예전 'URL에 /reel/ 포함' 기준은 IG URL 정준화(64234f3, 전부 /p/형)로
            #    릴스 표본이 0이 돼 영구 거짓 — 그래서 2026-07-03~05 부분수집(실측 159/182/219)을 폴백이 못 구제했다.
            #    이제 '직전 측정에서 play가 있던 게시물'(=조회수가 나와야 정상인 영상들) 중 이번 수집에서
            #    빠진 비율로 판정한다. 사진 포스트(원래 play 없음)는 분모에서 자연 제외돼 오탐도 줄어든다.
            ig_url_set = set(ig_urls)
            prev_ig = _prev_stats(db, [p["id"] for p in posts if (p.get("url") or "") in ig_url_set])
            expected = [p["url"] for p in posts
                        if (p.get("url") or "") in ig_url_set and (prev_ig.get(p["id"]) or {}).get("play_count") is not None]
            exp_missing = [u for u in expected if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
            # 최소 표본(5개↑) 확보 시에만 비율 판정 — 소표본 오탐으로 더 비싼 data-slayer 폴백이 트리거되는 것을 방지.
            if len(expected) >= 5 and len(exp_missing) / len(expected) >= 0.4:
                missing = [u for u in ig_urls if not (stats_by_key.get(_stats_key(u)) or {}).get("play_count")]
                print(f"[WARN] IG 조회수 누락 {len(exp_missing)}/{len(expected)}(직전값 보유 기준) → 차단/필드누락 추정, data-slayer 폴백 {len(missing)}건 호출")
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
                    if m.get("content_summary") and not cur.get("content_summary"):
                        cur["content_summary"] = m["content_summary"]
                    stats_by_key[key] = cur
                print(f"[LOG] data-slayer 폴백 보강 완료: 조회수 {merged}건 채움")

        rows = []
        # 직전(오늘 이전) 누적값 일괄 조회 — per-post 개별 쿼리(N+1) 제거.
        # .lt(TODAY)라서 같은 날 재수집 시 '오늘 행'을 기준값으로 삼지 않음(멱등) — 글리치로 부푼 값이 clamp로 고착되는 것 방지.
        last_stat = _prev_stats(db, [p["id"] for p in posts])
        for post in posts:
            key = _stats_key(post["url"])
            s = stats_by_key.get(key)
            if not s:
                print(f"  매칭 실패: {post['url']} (key={key})")
                continue

            # 🗑️ 삭제/비공개 자동 태깅 — Apify not_found 감지 시 특이사항(notes)에 기록.
            #    수동노트 보존: notes가 비어 있을 때만 기입(사람이 적어둔 특이사항은 절대 덮지 않음).
            if s.get("deleted") and not (post.get("notes") or "").strip():
                auto_note = f"게시물 삭제/비공개 감지(자동 {TODAY}, Apify not_found) — 조회수 최종값에서 정지, 확인 필요"
                db.table("sponsored_posts").update({"notes": auto_note}).eq("id", post["id"]).execute()
                print(f"  🗑️  삭제 감지 자동 태깅: {post['url']}")

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

            # 기존 데이터 조회 (누적값 검증) — 위에서 _prev_stats로 일괄 조회한 '오늘 이전' 최신값
            existing = last_stat.get(post["id"], {})

            play_count = s.get("play_count")

            # 조회수 검증
            if play_count is None:
                # Apify가 조회수를 반환하지 않음 (게시물 타입상 조회수 없을 수 있음)
                print(f"  ⚠️  조회수 없음: {post['url']} (account={s.get('account_name')})")
                play_count = None
            elif play_count <= 0:
                # 🛡️ 조회수 0 = 접근불가·수집 글리치(IG가 조회수를 0으로 반환). '수집 실패 ≠ 0' 원칙.
                #   0을 저장하면 ①다음날 증분이 pmax 대비 폭증(며칠치 몰림) ②수기 입력값을 0으로 덮음.
                #   직전값이 있으면 그 값으로 clamp(누적 유지), 없으면 이 행 자체를 스킵(0 미적재).
                if existing.get("play_count"):
                    print(f"  ⚠️  IG 조회수 0(글리치) → 직전값 유지 {post['url']} (→{existing.get('play_count')})")
                    play_count = existing.get("play_count")
                else:
                    print(f"  ⚠️  IG 조회수 0(글리치)·직전값 없음 → 미적재 {post['url']}")
                    continue
            elif existing.get("play_count") is not None and play_count < existing.get("play_count"):
                # 누적값인데 줄어들었다 = 오류(글리치) 또는 IG 정상 미세감소(중복/봇 필터링 지터).
                # NULL로 버리면 성숙 게시물에 톱니형 결측이 생기고 유효값이 사라지므로,
                # 직전 최대값으로 clamp(하향 무시) — 표시 레이어의 monotonic과 동일하게 누적 불변식 유지.
                print(f"  ⚠️  조회수 역행 clamp {post['url']} ({play_count} → {existing.get('play_count')} 유지)")
                play_count = existing.get("play_count")

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
                # 유튜브 캡션 = 영상 제목. 조회수 None이어도 행 저장(좋아요 유지) + 역행 clamp.
                _store_aux_rows(db, rows, yt_posts, yt_stats, lambda p: _yt_id(p["url"]), "유튜브",
                                views="optional", caption_field="title", caption_limit=300)
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
                # 액터가 간헐적으로 일부 영상만 미반환/0 (살아있는 영상인데 그날 수집 공백 발생,
                # 2026-07-08 시으니네 등 3/26건). 미반환분만 모아 1회 재시도.
                retry_urls = [tt_canon[p["url"]] for p in tt_posts
                              if (tt_stats.get(_tt_id(tt_canon[p["url"]])) or {}).get("views") in (None, 0)]
                if retry_urls:
                    print(f"[LOG] 틱톡 미반환 {len(retry_urls)}건 재시도")
                    for vid, s in _fetch_tiktok(retry_urls).items():
                        if (s.get("views") or 0) > 0:
                            tt_stats[vid] = s
                got = sum(1 for s in tt_stats.values() if (s.get("views") or 0) > 0)
                print(f"[LOG] 틱톡 수집: 실값 {got}건 / {len(tt_posts)}개 요청")
                _store_aux_rows(db, rows, tt_posts, tt_stats, lambda p: _tt_id(tt_canon[p["url"]]), "틱톡",
                                views="clamp", caption_field="content_summary")
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
                _store_aux_rows(db, rows, th_posts, th_stats, lambda p: _th_code(p["url"]), "스레드", views="none")
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
                _store_aux_rows(db, rows, fb_posts, fb_stats, lambda p: _fb_key(p["url"]), "페이스북", views="none")
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
                _store_aux_rows(db, rows, tw_posts, tw_stats, lambda p: _tw_id(p["url"]), "트위터",
                                views="clamp", caption_field="content_summary")
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

            # 🔁 역방향 자동 baseline: 이번에 '처음' 수집된(과거 stat이 전혀 없는) 게시물은
            #    전날(TODAY-1)에 play_count=0 baseline 행을 자동 추가한다.
            #    → 뒤늦게 대시보드에 추가된 게시물의 누적 조회수가 '첫 수집일(=추가한 날)'에
            #      전량 증분으로 잡히고, 홈 급상승(측정 2회 미만 제외)에도 걸리지 않는다.
            #      전날에 0을 넣는 것이라 과거 날짜 누적합/증분은 불변(그래프 소급 변화 없음).
            play_pids = list({r["post_id"] for r in rows if r.get("play_count") is not None})
            seen = set()
            for i in range(0, len(play_pids), 200):
                # ⚠️ LIMIT 없는 조회는 기본 1000행에서 잘림 → 이력 있는 게시물이 '처음 수집'으로 오판되어
                #    전날 행에 baseline 0 upsert가 실측을 파괴(2026-07-03~07, 7/7에만 79행 0 덮임). 전량 페이지네이션 필수.
                frm = 0
                while True:
                    pr = (db.table("post_daily_stats").select("post_id")
                          .in_("post_id", play_pids[i:i + 200]).lt("measured_at", TODAY)
                          .order("id").range(frm, frm + 999).execute())
                    pg = pr.data or []
                    for x in pg:
                        seen.add(x["post_id"])
                    if len(pg) < 1000:
                        break
                    frm += 1000
            yesterday = (date.fromisoformat(TODAY) - timedelta(days=1)).isoformat()
            baseline = [{"post_id": pid, "measured_at": yesterday, "play_count": 0}
                        for pid in play_pids if pid not in seen]
            if baseline:
                db.table("post_daily_stats").upsert(baseline, on_conflict="post_id,measured_at").execute()
                print(f"[LOG] 🔁 역방향 baseline 자동추가: {len(baseline)}건 (전날 {yesterday} play_count=0)")
        else:
            print(f"[WARN] 저장할 데이터가 없습니다 (매칭 실패 또는 조회수 오류)")

        print(f"[SUCCESS] 모니터링 완료: {len(rows)}건 저장")

        # 📸 배너 도달수(reach) 일별 스냅샷 — 배너는 조회수(play_count)가 없어 '도달수'로 증분 계산한다.
        #    활성 배너의 현재 reach_count(시트/대시보드 수동입력)를 오늘 post_daily_stats.reach_count로 기록
        #    → 도달수 일별 이력 생성 → viewIncrement/리포트가 '전일 대비 도달수 증분'을 산출.
        #    (첫 스냅샷일엔 이전 이력이 없어 도달수 전체가 신규 증분으로 잡힘 = 의도된 규칙)
        #    best-effort: 실패해도 수집 자체엔 영향 없음(경고만).
        try:
            banners, boff = [], 0
            while True:
                bres = (db.table("sponsored_posts").select("id, reach_count, ended_at")
                        .ilike("channel_type", "%배너%").range(boff, boff + 999).execute())
                bchunk = bres.data or []
                banners.extend(bchunk)
                if len(bchunk) < 1000:
                    break
                boff += 1000
            reach_rows = [{"post_id": b["id"], "measured_at": TODAY, "reach_count": b["reach_count"]}
                          for b in banners if not b.get("ended_at") and b.get("reach_count") is not None]
            if reach_rows:
                db.table("post_daily_stats").upsert(reach_rows, on_conflict="post_id,measured_at").execute()
                print(f"[LOG] 📸 배너 도달수 스냅샷: {len(reach_rows)}건 ({TODAY})")
        except Exception as e:
            print(f"[WARN] 배너 도달수 스냅샷 실패(무시): {e}")

        # 📈 증분(increment) 계산·저장 — 단일 소스(B): 리포트·대시보드가 이 값을 그대로 읽는다.
        #   게시물별 오늘값 − 이전까지 최댓값(단조보정, ≥0). 첫 측정=전체.
        #   배너=도달수(reach_count) 우선, 없으면 조회수(play_count, 시트 수동입력) 사용. 그 외=play_count.
        #   ⚠️ 이 로직은 scripts 백필(_backfill_increment.py)과 동일해야 함(리포트↔대시보드 일치 근거).
        def _inc_metric(x, is_banner):
            if is_banner:
                rc = x.get("reach_count")
                return rc if rc is not None else x.get("play_count")
            return x.get("play_count")
        try:
            tr = db.table("post_daily_stats").select("post_id, play_count, reach_count").eq("measured_at", TODAY).execute()
            today_pids = list({x["post_id"] for x in (tr.data or [])})
            isbanner = {}
            for i in range(0, len(today_pids), 200):
                cr = db.table("sponsored_posts").select("id, channel_type").in_("id", today_pids[i:i + 200]).execute()
                for x in (cr.data or []):
                    isbanner[x["id"]] = "배너" in (x.get("channel_type") or "")
            inc_rows = []
            for i in range(0, len(today_pids), 100):
                chunk = today_pids[i:i + 100]
                todayval = {}
                for x in (tr.data or []):
                    if x["post_id"] in chunk:
                        v = _inc_metric(x, isbanner.get(x["post_id"]))
                        if v is not None:
                            todayval[x["post_id"]] = v
                pmax = {}
                frm = 0
                while True:
                    pr = (db.table("post_daily_stats").select("post_id, play_count, reach_count, measured_at")
                          # ⚠️ 정렬키 없는 range() 페이지네이션은 경계 행 누락 → pmax가 낮아져 증분 폭증.
                          #    고유키 id로 결정적 페이지네이션(API sponsored-posts와 동일 수정).
                          .in_("post_id", chunk).lt("measured_at", TODAY).order("id").range(frm, frm + 999).execute())
                    pg = pr.data or []
                    for x in pg:
                        v = _inc_metric(x, isbanner.get(x["post_id"]))
                        if v is not None:
                            pmax[x["post_id"]] = max(pmax.get(x["post_id"], 0), v)
                    if len(pg) < 1000:
                        break
                    frm += 1000
                for pid, tv in todayval.items():
                    inc_rows.append({"post_id": pid, "measured_at": TODAY, "increment": max(0, tv - pmax.get(pid, 0))})
            if inc_rows:
                db.table("post_daily_stats").upsert(inc_rows, on_conflict="post_id,measured_at").execute()
                print(f"[LOG] 📈 증분 저장: {len(inc_rows)}건 ({TODAY})")
        except Exception as e:
            print(f"[WARN] 증분 계산 실패(무시): {e}")

        # 📸 일별 증분 스냅샷(락) — 오늘 시점 누적 총합을 daily_view_snapshot에 저장.
        #    이후 게시물이 늦게 추가돼도 과거 스냅샷은 안 바뀜 → '일자별 증감' 과거값 안정화.
        #    best-effort: 테이블 미생성 등 어떤 오류도 수집 자체엔 영향 주지 않음(경고만).
        try:
            snap = _snapshot_totals(db, [p["id"] for p in all_posts], TODAY)
            db.table("daily_view_snapshot").upsert({"date": TODAY, **snap}, on_conflict="date").execute()
            print(f"[LOG] 📸 일별 스냅샷 저장({TODAY}): {snap}")
        except Exception as e:
            print(f"[WARN] 일별 스냅샷 저장 실패(무시): {e}")

        if job_id:
            db.table("jobs").update({"status": "done"}).eq("id", job_id).execute()

        # 보조 플랫폼(유튜브/틱톡/페북/스레드/트위터) 일부 실패 처리:
        #  - 저장된 데이터가 있으면(주 수집 성공) 전체 run을 실패로 만들지 않고 경고만 남긴다.
        #    누락 aux 데이터는 status='missing' 재수집(02/05/08시)이 복구 → 매일 false '실패' 알림 방지.
        #  - 아무것도 저장 못 했으면(총 실패) 하드 실패로 raise해 알림/원인 확인.
        if yt_failed or tt_failed or fb_failed or th_failed or tw_failed:
            _aux = f"유튜브={yt_failed}, 틱톡={tt_failed}, 페북={fb_failed}, 스레드={th_failed}, 트위터={tw_failed}"
            if rows:
                print(f"[WARN] 보조 플랫폼 일부 실패({_aux}) — 주 수집 {len(rows)}건은 저장됨(부분성공). 누락분은 재수집으로 복구.")
            else:
                raise RuntimeError(f"수집 실패({_aux}) — 저장된 데이터 없음, 원인 확인 필요")

    except Exception as e:
        print(f"[ERROR] 모니터링 실패: {str(e)}")
        import traceback
        print(f"[ERROR] Traceback:\n{traceback.format_exc()}")
        if job_id:
            db.table("jobs").update({"status": "failed", "error": str(e)}).eq("id", job_id).execute()
        raise


def _fetch_ig_fallback(urls: list) -> dict:
    """기본 IG 액터(apify/instagram-scraper)가 인스타 차단으로 no_items만 반환할 때, data-slayer/instagram-post-details로 조회수 보강.
    반환: {shortcode: {play_count, likes_count, comments_count, content_summary}}.
    ⚠️ metrics.play_count는 기존 videoPlayCount 시리즈와 연속됨(2026-06-29 실측 비율 1.000). 비용↑(~2.7배)이라 차단 감지 시에만 호출한다.
    ⚠️ data-slayer의 caption은 객체({text,...}) — apify(문자열)와 형식이 달라 .text를 꺼낸다."""
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
                cap = it.get("caption")
                cap_text = cap.get("text") if isinstance(cap, dict) else (cap if isinstance(cap, str) else None)
                out[code] = {
                    "play_count": m.get("play_count"),
                    "likes_count": m.get("like_count"),
                    "comments_count": m.get("comment_count"),
                    "content_summary": (cap_text or "")[:300] or None,
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

        # 삭제/비공개 감지 — Apify가 not_found(게시물 없음)로 응답한 경우. (자동 특이사항 태깅용)
        deleted = (item.get("error") == "not_found") or ("does not exist" in str(item.get("errorDescription") or "").lower())

        result.append({
            "url": url,
            "play_count": play_count,
            "likes_count": item.get("likesCount") or item.get("likes"),
            "comments_count": item.get("commentsCount") or item.get("comments"),
            "posted_at": posted_at,
            "account_name": account_name,
            "owner_username": owner_username,
            "content_summary": (item.get("caption") or "")[:300] or None,
            "deleted": deleted,
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
