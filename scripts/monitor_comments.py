#!/usr/bin/env python3
# 협찬 게시물 부정 댓글 감시 → 슬랙(#통합_dm댓글승인관리, 여믄봇) 알림.
# comment-alerts.yml(매일 09:00 KST)에서 실행.
#
# 흐름:
#   1) 활성(미종료) 협찬 게시물(인스타/유튜브/틱톡) 로드
#   2) 일일 수집이 쌓아둔 post_daily_stats.comments_count 최신값 vs post_comment_checks.last_count 비교
#      → '댓글 수가 늘어난 게시물만' Apify 댓글 액터로 수집 (비용 절감 핵심)
#   3) post_comments에 없는 신규 댓글만 분류(ANTHROPIC_API_KEY 있으면 Claude, 없으면 키워드 폴백)
#   4) 부정(negative)/이슈(issue)만 슬랙 채널에 알림, 전체 신규 댓글은 DB 저장(중복 알림 방지)
#
# 환경변수:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_API_TOKEN, SLACK_BOT_TOKEN  (필수)
#   ANTHROPIC_API_KEY  (권장 — 없으면 키워드 폴백, 정확도 낮음)
#   SLACK_CHANNEL      (기본 C0B9RR4E8NR=#통합_dm댓글승인관리. DM 미리보기 시 user id 주입)
#   DRY_RUN=1          (슬랙 발송·DB 쓰기 없이 결과만 출력. Apify 수집은 수행됨)
#   LIMIT_POSTS=N      (스크레이프 대상 게시물 수 상한 — 프로브/테스트용)
import os
import re
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from db import get_client

SLACK_API = "https://slack.com/api/chat.postMessage"
CHANNEL = os.getenv("SLACK_CHANNEL") or "C0B9RR4E8NR"  # #통합_dm댓글승인관리
KST = timezone(timedelta(hours=9))

FIRST_LIMIT = int(os.getenv("FIRST_LIMIT", "15"))        # 첫 확인 게시물: 최신 N개만
DELTA_CAP = int(os.getenv("DELTA_CAP", "80"))            # 증가분 게시물: 최대 N개
RECHECK_DAYS = 7                                         # 댓글수 스냅샷 없는 게시물 재확인 주기
MAX_ALERTS = int(os.getenv("MAX_ALERTS", "30"))          # 1회 실행당 개별 알림 상한(초과분은 요약)
OWNED_CH = ("온드미디어", "위성채널")                      # 보유 계정 채널분류 → 직접 숨김/삭제 가능

# ── URL → 플랫폼/키 (run_monitoring.py의 추출 규칙과 동일) ──────────────────

def _ig_shortcode(url: str):
    m = re.search(r'/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)', url or "")
    return m.group(1) if m else None


def _yt_id(url: str):
    m = re.search(r'(?:shorts/|watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})', url or "")
    return m.group(1) if m else None


def _tt_id(url: str):
    m = re.search(r'/video/(\d+)', url or "")
    return m.group(1) if m else None


def _platform(url: str):
    u = (url or "").lower()
    if "instagram.com" in u:
        return "instagram"
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    if "tiktok.com" in u:
        return "tiktok"
    return None


def _post_key(platform: str, url: str):
    """플랫폼별 게시물 매칭 키 (액터 응답 URL ↔ DB URL 대조용)."""
    if platform == "instagram":
        return _ig_shortcode(url)
    if platform == "youtube":
        return _yt_id(url)
    if platform == "tiktok":
        return _tt_id(url)
    return None


def _pick(it: dict, *keys):
    for k in keys:
        v = it.get(k)
        if v not in (None, ""):
            return v
    return None


# ── 데이터 로드 ──────────────────────────────────────────────────────────────

def _load_active_posts(db):
    posts, start = [], 0
    while True:
        res = (db.table("sponsored_posts")
               .select("id, url, account_name, channel_type, product_name")
               .is_("ended_at", "null").order("id").range(start, start + 999).execute())
        rows = res.data or []
        posts += rows
        if len(rows) < 1000:
            break
        start += 1000
    out = []
    for p in posts:
        pf = _platform(p.get("url"))
        if pf and _post_key(pf, p["url"]):
            p["platform"] = pf
            out.append(p)
    return out


def _chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def _latest_comment_counts(db, post_ids):
    """게시물별 최신 comments_count (최근 14일 내 측정분만). {post_id: (count, measured_at)}"""
    since = (datetime.now(KST) - timedelta(days=14)).date().isoformat()
    out = {}
    for chunk in _chunks(post_ids, 100):
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, comments_count, measured_at")
                   .in_("post_id", chunk).gte("measured_at", since)
                   .not_.is_("comments_count", "null")
                   .order("id").range(frm, frm + 999).execute())
            rows = res.data or []
            for r in rows:
                prev = out.get(r["post_id"])
                if not prev or r["measured_at"] >= prev[1]:
                    out[r["post_id"]] = (r["comments_count"], r["measured_at"])
            if len(rows) < 1000:
                break
            frm += 1000
    return out


def _load_checks(db, post_ids):
    out = {}
    for chunk in _chunks(post_ids, 100):
        res = db.table("post_comment_checks").select("*").in_("post_id", chunk).execute()
        for r in (res.data or []):
            out[r["post_id"]] = r
    return out


def _known_comment_ids(db, post_ids):
    out = set()
    for chunk in _chunks(post_ids, 100):
        frm = 0
        while True:
            res = (db.table("post_comments").select("post_id, comment_id")
                   .in_("post_id", chunk).order("id").range(frm, frm + 999).execute())
            rows = res.data or []
            out |= {(r["post_id"], r["comment_id"]) for r in rows}
            if len(rows) < 1000:
                break
            frm += 1000
    return out


# ── Apify 댓글 수집 ──────────────────────────────────────────────────────────

def _apify():
    from apify_client import ApifyClient
    return ApifyClient(os.getenv("APIFY_API_TOKEN"))


def _fetch_ig_comments(urls: list, limit: int) -> list:
    """apify/instagram-comment-scraper. 반환: [{key, comment_id, author, text, commented_at}]"""
    client = _apify()
    run = client.actor("apify/instagram-comment-scraper").call(run_input={
        "directUrls": urls,
        "resultsLimit": limit,
    })
    out = []
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        if it.get("error"):
            continue
        key = _ig_shortcode(_pick(it, "postUrl", "post_url", "url") or "")
        cid = _pick(it, "id", "commentId")
        if not key or not cid:
            continue
        out.append({
            "key": key,
            "comment_id": str(cid),
            "author": _pick(it, "ownerUsername", "owner_username", "username"),
            "text": (_pick(it, "text", "comment") or "")[:1000],
            "commented_at": _pick(it, "timestamp", "createdAt", "created_at"),
        })
    return out


def _fetch_yt_comments(urls: list, limit: int) -> list:
    """streamers/youtube-comments-scraper (NEWEST_FIRST). 반환 포맷은 IG와 동일."""
    client = _apify()
    run = client.actor("streamers/youtube-comments-scraper").call(run_input={
        "startUrls": [{"url": u} for u in urls],
        "maxComments": limit,
        "sortCommentsBy": "NEWEST_FIRST",
    })
    out = []
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        if it.get("error"):
            continue
        key = _yt_id(_pick(it, "videoUrl", "pageUrl", "url") or "") or _pick(it, "videoId")
        cid = _pick(it, "commentId", "cid", "id")
        if not key or not cid:
            continue
        out.append({
            "key": key,
            "comment_id": str(cid),
            "author": _pick(it, "author", "authorText", "channelName"),
            "text": (_pick(it, "comment", "text", "commentText") or "")[:1000],
            "commented_at": _pick(it, "publishedAt", "date", "publishedTimeText"),
        })
    return out


def _tt_norm(url: str) -> str:
    """틱톡 URL 정규화: www 붙이고 끝슬래시 제거.
    실측: 'https://tiktok.com/...'(www 없음)은 액터가 0건 반환 → www.tiktok.com 필수."""
    u = (url or "").rstrip("/")
    return u.replace("https://tiktok.com/", "https://www.tiktok.com/", 1)


def _fetch_tt_comments(urls: list, limit: int) -> list:
    """clockworks/tiktok-comments-scraper. 반환 포맷은 IG와 동일."""
    client = _apify()
    run = client.actor("clockworks/tiktok-comments-scraper").call(run_input={
        "postURLs": [_tt_norm(u) for u in urls],
        "commentsPerPost": limit,
        "maxRepliesPerComment": 0,
    })
    out = []
    for it in client.dataset(run["defaultDatasetId"]).iterate_items():
        if it.get("error"):
            continue
        key = _tt_id(_pick(it, "videoWebUrl", "submittedVideoUrl", "postUrl", "url") or "")
        cid = _pick(it, "cid", "commentId", "id")
        if not key or not cid:
            continue
        out.append({
            "key": key,
            "comment_id": str(cid),
            "author": _pick(it, "uniqueId", "username", "user"),
            "text": (_pick(it, "text", "comment") or "")[:1000],
            "commented_at": _pick(it, "createTimeISO", "createTime"),
        })
    return out


FETCHERS = {"instagram": _fetch_ig_comments, "youtube": _fetch_yt_comments, "tiktok": _fetch_tt_comments}


# ── 분류: Claude(권장) 또는 키워드 폴백 ─────────────────────────────────────

# 폴백용 부정/이슈 신호 키워드 (LLM 키 없을 때만 사용 — 정확도 낮음, 참고용)
NEG_KEYWORDS = (
    "맛없", "노맛", "별로", "실망", "최악", "비추", "돈아깝", "돈 아깝", "사지마", "사지 마",
    "사먹지", "과대광고", "뒷광고", "허위", "사기", "장사기술", "가격이 미쳤", "비싸", "바가지",
    "양이 너무 적", "양 적", "환불", "이물", "머리카락", "벌레", "곰팡이", "배탈", "설사", "토했",
    "상했", "녹아서 왔", "불량", "누락", "배송이 안", "고객센터", "문의했는데", "답이 없",
)


def _classify_fallback(comments: list) -> list:
    out = []
    for c in comments:
        t = (c.get("text") or "").replace(" ", "")
        hit = next((k for k in NEG_KEYWORDS if k.replace(" ", "") in t), None)
        out.append({"label": "negative" if hit else "normal",
                    "reason": f"키워드 '{hit}'" if hit else None})
    return out


def _classify_claude(comments: list) -> list | None:
    """Claude로 일괄 분류. 실패 시 None(→폴백). 반환: [{label, reason}] (입력 순서 유지)"""
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
    results = []
    for chunk in _chunks(comments, 25):
        numbered = "\n".join(f"{i}. {(c.get('text') or '')[:300]}" for i, c in enumerate(chunk))
        prompt = (
            "당신은 '라라스윗'(저당 아이스크림·간식 브랜드) 마케팅팀의 SNS 댓글 검토 어시스턴트입니다.\n"
            "협찬/광고 게시물에 달린 아래 댓글들을 하나씩 분류하세요.\n\n"
            "라벨 기준:\n"
            "- negative: 제품·브랜드에 대한 부정 평가(맛·품질·양·가격 혹평, 구매 만류, 성분·효능 의혹 제기, 비방, 조롱)\n"
            "- issue: 고객 클레임·CS 이슈(배송 문제, 이물·변질, 환불 요구, 문의 무응답 등 대응이 필요한 문제 제기)\n"
            "- normal: 그 외 전부(긍정, 중립, 단순 질문, 태그, 이모지 등)\n"
            "주의: 제품과 무관한 잡담·유머는 normal. 반어/비꼼(예: '이걸 돈 주고 산다고?')은 negative.\n\n"
            f"댓글 목록:\n{numbered}\n\n"
            '각 댓글에 대해 JSON 배열로만 답하세요: [{"i": 번호, "label": "negative|issue|normal", "reason": "한줄 근거(normal이면 빈 문자열)"}]'
        )
        body = json.dumps({
            "model": model,
            "max_tokens": 2000,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=120))
            txt = "".join(b.get("text", "") for b in d.get("content", []))
            m = re.search(r"\[.*\]", txt, re.S)
            arr = json.loads(m.group(0)) if m else []
            by_i = {int(a["i"]): a for a in arr if isinstance(a, dict) and "i" in a}
            for i in range(len(chunk)):
                a = by_i.get(i) or {}
                label = a.get("label") if a.get("label") in ("negative", "issue", "normal") else "normal"
                results.append({"label": label, "reason": (a.get("reason") or "").strip()[:200] or None})
        except Exception as e:
            print(f"[comments] Claude 분류 실패(폴백 전환): {e}")
            return None
    return results


# ── 슬랙 발송 ────────────────────────────────────────────────────────────────

def _esc(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _kst_str(iso):
    if not iso:
        return "-"
    try:
        v = str(iso)
        if v.isdigit():                       # epoch(틱톡 createTime)
            dt = datetime.fromtimestamp(int(v), tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M KST")
    except Exception:
        return str(iso)


def _post_slack(token, channel, text):
    data = urllib.parse.urlencode({"channel": channel, "text": text, "unfurl_links": "false"}).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if not r.get("ok"):
        print(f"[comments] 슬랙 발송 실패: {r.get('error')} channel={channel}")
    return r


PF_KO = {"instagram": "인스타", "youtube": "유튜브", "tiktok": "틱톡"}
LABEL_KO = {"negative": "부정댓글 🚨", "issue": "고객이슈 ⚠️"}


def _alert_text(post, c):
    owned = (post.get("channel_type") or "").strip() in OWNED_CH
    own_txt = "보유 계정 → 직접 숨김/삭제 가능" if owned else "외부 계정 → 업체/인플루언서에 조치 요청 필요"
    name = (post.get("account_name") or "").strip() or post["url"].rstrip("/").split("/")[-1]
    lines = [
        f"{LABEL_KO.get(c['label'], c['label'])} — <{post['url']}|{_esc(name)}> ({PF_KO.get(post['platform'], post['platform'])})",
        f"*댓글:* {_esc(c.get('text') or '')}",
        f"*작성자:* {_esc(c.get('author') or '-')}  ·  *작성시간:* {_kst_str(c.get('commented_at'))}",
        f"*분류 근거:* {_esc(c.get('reason') or '-')}",
        f"*계정 구분:* {own_txt}",
    ]
    return "\n".join(lines)


# ── 메인 ────────────────────────────────────────────────────────────────────

def main():
    token = os.environ.get("SLACK_BOT_TOKEN", "")
    dry = os.getenv("DRY_RUN") == "1"
    if not dry and not token:
        raise RuntimeError("SLACK_BOT_TOKEN 필요 (미발송 테스트는 DRY_RUN=1)")
    # 연동 테스트: 대상 채널에 테스트 메시지 1건만 보내고 종료(수집·DB 무관).
    # 봇이 채널 미초대면 not_in_channel로 실패 → /invite @여믄봇 후 재실행.
    if os.getenv("SETUP_TEST") == "1":
        r = _post_slack(token, CHANNEL,
                        "✅ 여믄봇 부정 댓글 알림 연동 테스트 — 이 채널로 협찬 게시물 부정/이슈 댓글 알림이 발송됩니다. (매일 09:00 KST)")
        print(f"[comments] SETUP_TEST ok={r.get('ok')} error={r.get('error')} channel={CHANNEL}")
        assert r.get("ok"), r
        return
    db = get_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    posts = _load_active_posts(db)
    ids = [p["id"] for p in posts]
    counts = _latest_comment_counts(db, ids)
    checks = _load_checks(db, ids)
    print(f"[comments] 활성 게시물 {len(posts)}건, 댓글수 스냅샷 {len(counts)}건, 체크상태 {len(checks)}건")

    # 스크레이프 대상 선정
    targets = []   # (post, per-post limit)
    for p in posts:
        cur = counts.get(p["id"])
        chk = checks.get(p["id"])
        if not chk:
            targets.append((p, FIRST_LIMIT, "first"))
        elif cur is not None and (chk.get("last_count") or 0) < cur[0]:
            delta = cur[0] - (chk.get("last_count") or 0)
            targets.append((p, min(DELTA_CAP, delta + 10), "delta"))
        elif cur is None:
            last = chk.get("last_checked_at") or ""
            if last < (datetime.now(timezone.utc) - timedelta(days=RECHECK_DAYS)).isoformat():
                targets.append((p, FIRST_LIMIT, "stale"))

    limit_posts = int(os.getenv("LIMIT_POSTS") or 0)
    if limit_posts and len(targets) > limit_posts:
        print(f"[comments] LIMIT_POSTS={limit_posts} 적용 — 대상 {len(targets)}건 중 초과분 생략")
        targets = targets[:limit_posts]
    n_first = sum(1 for t in targets if t[2] == "first")
    print(f"[comments] 스크레이프 대상 {len(targets)}건 (첫확인 {n_first}, 증가/재확인 {len(targets) - n_first})")
    if not targets:
        print("[comments] 대상 없음 → 종료")
        return

    # 플랫폼×limit 그룹으로 액터 호출 (액터의 limit은 호출 단위라, limit이 큰 게시물끼리 묶는다)
    scraped = []
    for pf in ("instagram", "youtube", "tiktok"):
        group = [(p, lim) for (p, lim, _r) in targets if p["platform"] == pf]
        if not group:
            continue
        first_urls = [p["url"] for p, lim in group if lim <= FIRST_LIMIT]
        delta_pairs = [(p, lim) for p, lim in group if lim > FIRST_LIMIT]
        calls = []
        if first_urls:
            calls.append((first_urls, FIRST_LIMIT))
        if delta_pairs:
            calls.append(([p["url"] for p, _l in delta_pairs], max(l for _p, l in delta_pairs)))
        for urls, lim in calls:
            print(f"[comments] {pf} 댓글 수집: {len(urls)}개 게시물 × 최대 {lim}개")
            try:
                scraped += FETCHERS[pf](urls, lim)
            except Exception as e:
                print(f"[comments] {pf} 수집 실패(해당 그룹 생략): {e}")
    print(f"[comments] 수집 댓글 {len(scraped)}건")

    # 매칭: key → post
    by_key = {}
    for (p, _lim, _r) in targets:
        by_key[_post_key(p["platform"], p["url"])] = p

    target_ids = [p["id"] for (p, _l, _r) in targets]
    known = _known_comment_ids(db, target_ids)
    fresh = []   # (post, comment)
    unmatched = 0
    for c in scraped:
        p = by_key.get(c["key"])
        if not p:
            unmatched += 1
            continue
        if (p["id"], c["comment_id"]) in known:
            continue
        known.add((p["id"], c["comment_id"]))   # 응답 내 중복 방지
        fresh.append((p, c))
    print(f"[comments] 신규 댓글 {len(fresh)}건 (매칭실패 {unmatched}건)")

    # 분류
    if fresh:
        labels = _classify_claude([c for _p, c in fresh])
        engine = "claude"
        if labels is None:
            labels = _classify_fallback([c for _p, c in fresh])
            engine = "keyword-fallback"
            print("[comments] ⚠️ ANTHROPIC_API_KEY 없음/실패 → 키워드 폴백 분류(정확도 낮음)")
        for (_p, c), lab in zip(fresh, labels):
            c["label"], c["reason"] = lab["label"], lab.get("reason")
        print(f"[comments] 분류({engine}): " + ", ".join(
            f"{k}={sum(1 for _p, c in fresh if c['label'] == k)}" for k in ("negative", "issue", "normal")))

    bad = [(p, c) for p, c in fresh if c["label"] in ("negative", "issue")]

    if dry:
        for p, c in bad:
            print("---- DRY_RUN 알림 ----")
            print(_alert_text(p, c))
        print(f"[comments] DRY_RUN — 알림 {len(bad)}건·DB 쓰기 생략")
        return

    # DB 저장 (신규 전량, alerted_at은 '발송 성공 후'에만 기록) + 체크상태 갱신
    rows = []
    for p, c in fresh:
        rows.append({
            "post_id": p["id"], "platform": p["platform"], "comment_id": c["comment_id"],
            "author": c.get("author"), "text": c.get("text"),
            "commented_at": _iso_or_none(c.get("commented_at")),
            "classification": c["label"], "reason": c.get("reason"),
        })
    for chunk in _chunks(rows, 200):
        db.table("post_comments").upsert(chunk, on_conflict="post_id,comment_id", ignore_duplicates=True).execute()

    check_rows = []
    for (p, _lim, _r) in targets:
        cur = counts.get(p["id"])
        prev = checks.get(p["id"]) or {}
        check_rows.append({
            "post_id": p["id"],
            "last_count": cur[0] if cur else prev.get("last_count"),
            "last_checked_at": now_iso,
        })
    for chunk in _chunks(check_rows, 200):
        db.table("post_comment_checks").upsert(chunk, on_conflict="post_id").execute()

    # 슬랙 알림 — DB 기반: 미발송(alerted_at null) 부정/이슈 전체가 대상이라
    # 과거 발송 실패분(예: 봇 채널 미초대로 not_in_channel)도 다음 실행에서 자동 재시도된다.
    by_id = {p["id"]: p for p in posts}
    pending = []
    frm = 0
    while True:
        res = (db.table("post_comments").select("post_id, comment_id, author, text, commented_at, classification, reason")
               .is_("alerted_at", "null").in_("classification", ["negative", "issue"])
               .order("id").range(frm, frm + 999).execute())
        rs = res.data or []
        pending += [r for r in rs if r["post_id"] in by_id]   # 활성 게시물만
        if len(rs) < 1000:
            break
        frm += 1000

    def _mark_alerted(items):
        for r in items:
            (db.table("post_comments").update({"alerted_at": now_iso})
             .eq("post_id", r["post_id"]).eq("comment_id", r["comment_id"]).execute())

    sent = 0
    for r in pending[:MAX_ALERTS]:
        p = by_id[r["post_id"]]
        c = {"label": r["classification"], "text": r["text"], "author": r["author"],
             "commented_at": r["commented_at"], "reason": r["reason"]}
        resp = _post_slack(token, CHANNEL, _alert_text(p, c))
        if resp.get("ok"):
            sent += 1
            _mark_alerted([r])
        time.sleep(1)   # rate limit 여유
    rest = pending[MAX_ALERTS:]
    if rest and sent:   # 개별 발송이 되는 상태에서만 요약 발송·소진 처리
        summary = [f"…외 부정/이슈 댓글 *{len(rest)}건* (알림 상한 {MAX_ALERTS}건 초과분 — 대시보드 DB post_comments에 저장됨)"]
        for r in rest[:10]:
            p = by_id[r["post_id"]]
            nm = (p.get("account_name") or "").strip() or "?"
            summary.append(f"• <{p['url']}|{_esc(nm)}>: {_esc((r.get('text') or '')[:80])}")
        if _post_slack(token, CHANNEL, "\n".join(summary)).get("ok"):
            _mark_alerted(rest)
    print(f"[comments] 알림 발송 {sent}/{len(pending)}건 (channel={CHANNEL}, 요약처리 {len(rest) if rest and sent else 0}건)")


def _iso_or_none(v):
    if not v:
        return None
    try:
        v = str(v)
        if v.isdigit():
            return datetime.fromtimestamp(int(v), tz=timezone.utc).isoformat()
        return datetime.fromisoformat(v.replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


if __name__ == "__main__":
    main()
