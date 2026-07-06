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


def _already_posted(token: str, channel: str, target: str) -> bool:
    """채널에 오늘(target) 리포트가 이미 있으면 True (백업 창 중복 발송 방지).
    조회 실패/스코프 없으면 False(발송 진행) — 막지 않음."""
    try:
        req = urllib.request.Request(
            f"https://slack.com/api/conversations.history?channel={channel}&limit=20",
            headers={"Authorization": "Bearer " + token})
        d = json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        print("[notify] 중복조회 실패(발송 진행):", e)
        return False
    if not d.get("ok"):
        print("[notify] 중복조회 ok=False(발송 진행):", d.get("error"))
        return False
    for m in d.get("messages", []):
        t = m.get("text", "")
        if "일일 증분" in t and f"({target})" in t:
            return True
    return False


def _find_report_ts(token: str, channel: str, target: str) -> list:
    """채널에서 오늘(target) 증분 리포트 메시지들의 ts 목록(정정 재발송용 삭제 대상)."""
    try:
        req = urllib.request.Request(
            f"https://slack.com/api/conversations.history?channel={channel}&limit=30",
            headers={"Authorization": "Bearer " + token})
        d = json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        print("[notify] 기존 리포트 조회 실패:", e)
        return []
    out = []
    for m in d.get("messages", []):
        t = m.get("text", "")
        if "일일 증분" in t and f"({target})" in t and m.get("ts"):
            out.append(m["ts"])
    return out


def _delete_msg(token: str, channel: str, ts: str) -> bool:
    data = urllib.parse.urlencode({"channel": channel, "ts": ts}).encode()
    req = urllib.request.Request("https://slack.com/api/chat.delete", data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=20))
        print("[notify] 기존 리포트 삭제 ts=", ts, "ok=", r.get("ok"), "err=", r.get("error"))
        return bool(r.get("ok"))
    except Exception as e:
        print("[notify] 삭제 실패 ts=", ts, e)
        return False


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

    # 정정 재발송(REPLACE=1): 오늘 기존 리포트를 삭제한 뒤 새로 발송(잘못 나간 리포트 교체).
    if os.getenv("REPLACE") == "1" and CHANNEL[:1] in ("C", "G"):
        for ts in _find_report_ts(token, CHANNEL, target):
            _delete_msg(token, CHANNEL, ts)
    # 중복 방지: 채널 발송 + DEDUP=1인데 오늘 리포트가 이미 있으면 생략(백업 창 대비). REPLACE면 위에서 지웠으니 통과.
    elif os.getenv("DEDUP") == "1" and CHANNEL[:1] in ("C", "G") and _already_posted(token, CHANNEL, target):
        print(f"[notify] {target} 리포트 이미 게시됨 → 중복 방지 생략")
        return

    post_ids = list(today.keys())

    # 직전(target 이전) 값 = post별 '이전까지의 최댓값'(단조보정 — 대시보드와 동일).
    #   조회수는 누적이라 감소 불가인데 수집이 삐끗해 낮게 잡히는 날이 있음. '가장 최근값'을 직전값으로 쓰면
    #   그 낮은 값 기준으로 다음날 증분이 부풀려짐 → 이전까지의 최댓값을 기준으로 삼아 방지.
    # ⚠️ .range() 페이지네이션 필수: 청크 전체 이력이 1000행 초과 시 잘려 '신규' 오인 → 뻥튀기.
    prev = {}
    PAGE = 1000
    for chunk in _chunks(post_ids, 100):
        frm = 0
        while True:
            res = (db.table("post_daily_stats")
                   .select("post_id, play_count, measured_at")
                   .in_("post_id", chunk).lt("measured_at", target)
                   .gt("play_count", 0)   # 0(글리치·미측정)은 최댓값 계산에서 제외
                   .range(frm, frm + PAGE - 1).execute())
            page = res.data or []
            for r in page:
                prev[r["post_id"]] = max(prev.get(r["post_id"], 0), r["play_count"])  # 단조보정: 이전까지 최댓값
            if len(page) < PAGE:
                break
            frm += PAGE

    # 게시물 메타(이름/플랫폼/상품군/업로드일/채널분류)
    meta = {}
    for chunk in _chunks(post_ids, 100):
        res = db.table("sponsored_posts").select("id, url, account_name, product_name, posted_at, channel_type, cost").in_("id", chunk).execute()
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
        if "배너" in (m.get("channel_type") or ""):
            continue  # 배너 조회수(play_count)는 증분에서 제외 — 배너는 도달수(reach_count)로만 집계(사용자 지시)
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
            "cost": m.get("cost") or 0,
            "cum": tv or 0,          # 누적 조회수(오늘 play_count)
        })

    # 배너: 조회수(play_count) 없음 → 도달수(reach_count) 일별 이력으로 '전일 대비 증분' 계산해 편입(사용자 지시).
    #   post_daily_stats.reach_count 시리즈에서: 오늘 - 직전(>0). 직전 없으면 첫 측정 → 오늘값 전체. 양수만.
    #   조회수와 동일하게 채널분류·총 증분·TOP에 반영.
    banner_cts = set()
    try:
        # 활성 배너 메타
        bmeta, boff = {}, 0
        while True:
            bres = (db.table("sponsored_posts")
                    .select("id, url, account_name, product_name, posted_at, channel_type, cost, ended_at")
                    .ilike("channel_type", "%배너%").range(boff, boff + 999).execute())
            bchunk = bres.data or []
            for b in bchunk:
                if not b.get("ended_at") and b.get("channel_type"):
                    bmeta[b["id"]] = b
                    banner_cts.add((b.get("channel_type") or "").strip())
            if len(bchunk) < 1000:
                break
            boff += 1000
        # 오늘 도달수
        reach_today = {}
        for chunk in _chunks(list(bmeta.keys()), 100):
            res = (db.table("post_daily_stats").select("post_id, reach_count")
                   .in_("post_id", chunk).eq("measured_at", target).execute())
            for r in (res.data or []):
                if r.get("reach_count") is not None:
                    reach_today[r["post_id"]] = r["reach_count"]
        # 직전 도달수 = 이전까지의 최댓값(단조보정 — 조회수와 동일 기준)
        reach_prev = {}
        for chunk in _chunks(list(reach_today.keys()), 100):
            res = (db.table("post_daily_stats").select("post_id, reach_count, measured_at")
                   .in_("post_id", chunk).lt("measured_at", target).gt("reach_count", 0).execute())
            for r in (res.data or []):
                if r.get("reach_count") is not None:
                    reach_prev[r["post_id"]] = max(reach_prev.get(r["post_id"], 0), r["reach_count"])
        # 전일 대비 도달수 증분 → items 편입
        for pid, tv in reach_today.items():
            pv = reach_prev.get(pid)
            inc = tv - pv if pv is not None else tv
            if inc <= 0:
                continue
            b = bmeta.get(pid, {})
            url = (b.get("url") or "").strip()
            items.append({
                "inc": inc,
                "name": (b.get("account_name") or "").strip() or url.rstrip("/").split("/")[-1] or "?",
                "platform": _platform(url),
                "url": url,
                "product": (b.get("product_name") or "").strip(),
                "posted_at": str(b.get("posted_at"))[:10] if b.get("posted_at") else "",
                "channel_type": (b.get("channel_type") or "").strip() or "미분류",
                "is_new": pv is None,
                "cost": b.get("cost") or 0,
                "cum": tv or 0,
            })
    except Exception as e:
        print("[notify] 배너 도달수 증분 집계 실패(무시):", e)

    if not items:
        print(f"[notify] {target} 증가분 없음 → 발송 생략")
        return

    total = sum(it["inc"] for it in items)

    def _norm_ch(ct):
        return "무상시딩 (영상+피드)" if "무상시딩" in (ct or "") else ((ct or "").strip() or "미분류")

    by_channel = {}
    for it in items:
        ct = _norm_ch(it["channel_type"])
        by_channel[ct] = by_channel.get(ct, 0) + it["inc"]

    # 배너 라인은 도달수 없어도 항상 노출(미집계 표기용). 도달수 자체는 위에서 items로 편입돼
    # by_channel·total·TOP에 이미 반영됨(여기선 중복 합산하지 않는다).
    for ct in banner_cts:
        by_channel.setdefault(_norm_ch(ct), 0)

    # CPV(누적 조회당 비용): 채널별 Σ비용 / Σ누적조회수 — 오늘 측정된 게시물 전체 기준(대시보드 조회당비용과 동일)
    cost_by_ch, cumviews_by_ch = {}, {}
    for pid, tv in today.items():
        m = meta.get(pid, {})
        ct = _norm_ch(m.get("channel_type"))
        cost_by_ch[ct] = cost_by_ch.get(ct, 0) + (m.get("cost") or 0)
        cumviews_by_ch[ct] = cumviews_by_ch.get(ct, 0) + (tv or 0)

    items.sort(key=lambda x: x["inc"], reverse=True)

    def f(n): return f"{n:,}"

    def _cpv(cost, views, ct):
        if "배너" in (ct or ""):
            return "(인사이트 요청 중)"   # 배너는 조회수 지표 별도 → CPV 미산정
        if not cost:
            return "무상"                # 무상시딩·비용 0
        if not views:
            return "CPV -"
        return f"CPV {cost / views:,.1f}원"

    DIV = "──────────────────────────────"
    lines = [
        f"📈 *인지 조회수 일일 증분* `({target})`",
        f"오늘 총 증분 *+{f(total)}*",
        "", DIV, "",
        "◾ *채널분류별*  `CPV는 누적 기준`",
        "",
    ]
    for ct, s in sorted(by_channel.items(), key=lambda x: x[1], reverse=True):
        if "배너" in ct:
            # 배너는 조회수가 없어 도달수(reach_count)를 '조회수'로 취급 → 채널합계·총 증분·TOP에 반영.
            # 도달수 입력이 없으면(주말/집계 전) 0 → '미집계' 표기.
            if s > 0:
                lines.append(f"• {_ital_paren(ct)} *+{f(s)}*  (도달수)")
            else:
                lines.append(f"• {_ital_paren(ct)}  (도달수 미집계·주말/집계 전)")
        else:
            lines.append(f"• {_ital_paren(ct)} *+{f(s)}*  {_cpv(cost_by_ch.get(ct, 0), cumviews_by_ch.get(ct, 0), ct)}")
    lines += ["", DIV, "", "◾ *급상승 TOP 10* 🔥  `CPV는 누적 기준`", ""]
    # 배너는 도달수를 '조회수'로 취급해 TOP에도 섞어 노출(사용자 지시). CPV 대신 '(인사이트 요청 중)' 표기됨.
    for rank, it in enumerate(items[:10], 1):
        prod = f"[{it['product']}] " if it["product"] else ""
        label = f"<{it['url']}|{_esc(it['name'])}>" if it["url"] else _esc(it["name"])
        date = it["posted_at"] or "업로드일 미상"
        lines.append(f"{rank}. {prod}{label} _({it['platform']})_ *+{f(it['inc'])}*  {_cpv(it['cost'], it['cum'], it['channel_type'])}  `{date}`")
    text = "\n".join(lines)

    if os.getenv("DRY_RUN"):   # 발송 없이 내용만 출력(검증용, Slack 토큰 불필요)
        print("=== DRY_RUN (발송 안 함) ===")
        print(text)
        return

    data = urllib.parse.urlencode({"channel": CHANNEL, "text": text, "unfurl_links": "false"}).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    ts = r.get("ts")
    ts_out = os.getenv("TS_OUT")          # 워크플로가 답글(thread_ts)용으로 ts를 읽어가는 파일
    if ts_out and ts:
        with open(ts_out, "w", encoding="utf-8") as fh:
            fh.write(ts)
    print("[notify] ok=", r.get("ok"), "error=", r.get("error"), "channel=", CHANNEL, "ts=", ts, "date=", target)
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
