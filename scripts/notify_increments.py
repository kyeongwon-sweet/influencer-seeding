#!/usr/bin/env python3
# 일일 조회수 증분 → 슬랙(#빙과_마케팅_리포트, 여믄봇) 발송.
# cron-daily-collect.yml의 수집 직후 단계에서 실행. 수집과 분리(continue-on-error)라
# Slack 발송 실패가 수집 자체를 망치지 않는다.
#
# 증분 = (오늘 measured_at play_count) - (직전 측정일 play_count). 직전값 없으면 신규로 보고 오늘값 전체.
# 누적 역행 가드는 run_monitoring가 이미 처리(역행 시 NULL) → 여기선 양(+)의 증분만 합산/노출.
import os
import json
import urllib.parse
import urllib.request
from datetime import date
from db import get_client

CHANNEL = os.getenv("SLACK_CHANNEL") or "C0B4F7GBX17"  # 기본 #빙과_마케팅_리포트 (빈값이면 폴백). DM 미리보기 시 user id 주입
SLACK_API = "https://slack.com/api/chat.postMessage"


def _platform(url: str) -> str:
    u = (url or "").lower()
    if "instagram.com" in u: return "인스타"
    if "youtube.com" in u or "youtu.be" in u: return "유튜브"
    if "tiktok.com" in u: return "틱톡"
    if "x.com" in u or "twitter.com" in u or "t.co/" in u: return "X"
    if "facebook.com" in u: return "페북"
    if "threads.com" in u or "threads.net" in u: return "스레드"
    if "kakao.com" in u: return "카카오"
    if "naver.com" in u: return "네이버"
    return "기타"


def _chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def _esc(s: str) -> str:
    """Slack 링크 텍스트용 이스케이프(<url|text>의 text에 &<> 들어가면 깨짐)."""
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _ital_paren(s: str) -> str:
    """채널분류명의 끝 괄호부('협찬 (인플루언서)' → '협찬 _(인플루언서)_')를 기울임 처리."""
    i = (s or "").find("(")
    return s if i == -1 else f"{s[:i]}_{s[i:]}_"


def _fetch_day(db, target):
    """target일의 {post_id: play_count} (null 제외)."""
    out, start = {}, 0
    while True:
        res = db.table("post_daily_stats").select("post_id, play_count").eq("measured_at", target).range(start, start + 999).execute()
        rows = res.data or []
        for r in rows:
            if r.get("play_count") is not None:
                out[r["post_id"]] = r["play_count"]
        if len(rows) < 1000:
            break
        start += 1000
    return out


def _latest_date(db):
    res = db.table("post_daily_stats").select("measured_at").order("measured_at", desc=True).limit(1).execute()
    return res.data[0]["measured_at"] if res.data else None


def main():
    token = os.environ["SLACK_BOT_TOKEN"]
    db = get_client()

    # 대상 날짜: 수집 워크플로가 넘긴 MONITORING_DATE(KST).
    # STRICT_DATE=1(예약 9:30 발송)이면 그 날짜만 — 데이터 없으면 생략(어제값 재발송 방지).
    # 비-strict(수동 테스트)이면 데이터 없을 때 최신 측정일로 폴백.
    target = os.getenv("MONITORING_DATE") or None
    strict = os.getenv("STRICT_DATE") == "1"
    today = _fetch_day(db, target) if target else {}
    if not today and not strict:
        target = _latest_date(db)
        if target:
            today = _fetch_day(db, target)
    if not today:
        print(f"[notify] {target} 조회수 데이터 없음 → 발송 생략 (strict={strict})")
        return

    post_ids = list(today.keys())

    # 직전(target 이전) 측정값 — post별 가장 최근 1건
    prev = {}
    for chunk in _chunks(post_ids, 100):
        res = (db.table("post_daily_stats")
               .select("post_id, play_count, measured_at")
               .in_("post_id", chunk).lt("measured_at", target)
               .order("measured_at", desc=True).execute())
        for r in (res.data or []):
            if r["post_id"] not in prev and r.get("play_count") is not None:
                prev[r["post_id"]] = r["play_count"]

    # 게시물 메타(이름/플랫폼/상품군/업로드일/채널분류)
    meta = {}
    for chunk in _chunks(post_ids, 100):
        res = db.table("sponsored_posts").select("id, url, account_name, product_name, posted_at, channel_type").in_("id", chunk).execute()
        for r in (res.data or []):
            meta[r["id"]] = r

    # 증분 계산 — 양(+)의 증분만
    items = []
    for pid, tv in today.items():
        pv = prev.get(pid)
        inc = tv - pv if pv is not None else tv
        if inc <= 0:
            continue
        m = meta.get(pid, {})
        url = (m.get("url") or "").strip()
        items.append({
            "inc": inc,
            "name": (m.get("account_name") or "").strip() or url.rstrip("/").split("/")[-1] or "?",
            "platform": _platform(url),
            "url": url,
            "product": (m.get("product_name") or "").strip(),
            "posted_at": str(m.get("posted_at"))[:10] if m.get("posted_at") else "",
            "channel_type": (m.get("channel_type") or "").strip() or "미분류",
            "is_new": pv is None,
        })

    if not items:
        print(f"[notify] {target} 증가분 없음 → 발송 생략")
        return

    total = sum(it["inc"] for it in items)
    by_channel = {}
    for it in items:
        ct = it["channel_type"]
        if "무상시딩" in ct:  # 영상/피드 등 하위 구분을 하나로 합산
            ct = "무상시딩 (영상+피드)"
        by_channel[ct] = by_channel.get(ct, 0) + it["inc"]
    items.sort(key=lambda x: x["inc"], reverse=True)

    def f(n): return f"{n:,}"

    lines = [
        f"📈 *인지 조회수 일일 증분* `({target})`",
        f"오늘 총 증분 *+{f(total)}*",
        "",
        "◾ *채널분류별*",
        "",
    ]
    for ct, s in sorted(by_channel.items(), key=lambda x: x[1], reverse=True):
        lines.append(f"• {_ital_paren(ct)} *+{f(s)}*")
    lines += ["", "◾ *급상승 TOP 10*", ""]
    for rank, it in enumerate(items[:10], 1):
        prod = f"[{it['product']}] " if it["product"] else ""
        label = f"<{it['url']}|{_esc(it['name'])}>" if it["url"] else _esc(it["name"])
        date = it["posted_at"] or "업로드일 미상"
        lines.append(f"{rank}. {prod}{label} _({it['platform']})_ *+{f(it['inc'])}*  `{date}`")
    text = "\n".join(lines)

    data = urllib.parse.urlencode({"channel": CHANNEL, "text": text, "unfurl_links": "false"}).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    print("[notify] ok=", r.get("ok"), "error=", r.get("error"), "channel=", CHANNEL, "date=", target)
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
