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

# 온드미디어·위성채널 = 무상 채널: 광고비·업체명이 없어야 함(사용자 지시).
#   입력돼 있어도 리포트 CPV엔 무시(0 취급)하고, 있으면 리포트에 ⚠️ 오류로 경고한다.
NO_COST_CH = ("온드미디어", "위성채널")


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


def _ad_cpv(cost, views) -> str:
    """인지 광고 CPV = 광고비 / 조회수. 조회수 0/없음이면 생략, 광고비 0이면 'CPV -'."""
    if not views:
        return ""
    if not cost:
        return "CPV -"
    return f"CPV {cost / views:,.1f}원"


def _fetch_awareness_ads(target: str):
    """마케팅T [인지_쫀득바] 시트의 그날 인지광고(메타/틱톡/유튜브) '일별' 조회수·광고비.
    값이 DB에 없고 시트에만 있어(팀 수동입력) 웹 라우트(/api/awareness-ads, Vercel 서비스계정)로 읽는다.
    APP_URL/CRON_SECRET 없거나·조회 실패·해당일 행 없음이면 None → 인지광고 섹션만 생략(리포트 본문은 정상)."""
    base = (os.getenv("APP_URL") or "").rstrip("/")
    secret = os.getenv("CRON_SECRET")
    if not base or not secret:
        print("[notify] APP_URL/CRON_SECRET 없음 → 인지광고 섹션 생략")
        return None
    try:
        req = urllib.request.Request(
            f"{base}/api/awareness-ads?date={urllib.parse.quote(target)}",
            headers={"Authorization": "Bearer " + secret})
        d = json.load(urllib.request.urlopen(req, timeout=30))
    except Exception as e:
        print("[notify] 인지광고 조회 실패(섹션 생략):", e)
        return None
    if not d.get("found"):
        print(f"[notify] 인지광고 {target} 시트 행 없음 → 섹션 생략")
        return None
    return d


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


def _thread_reply_ts(token: str, channel: str, parent_ts: str) -> list:
    """리포트(parent_ts)에 달린 스레드 답글 ts 목록(부모 제외) — 정정 재발송 시 댓글(상태 알럿 등)도 함께 지우기 위함."""
    try:
        req = urllib.request.Request(
            f"https://slack.com/api/conversations.replies?channel={channel}&ts={parent_ts}&limit=100",
            headers={"Authorization": "Bearer " + token})
        d = json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        print("[notify] 스레드 답글 조회 실패:", e)
        return []
    return [m["ts"] for m in d.get("messages", []) if m.get("ts") and m.get("ts") != parent_ts]


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
    # STRICT_DATE=1(예약 발송)이면 그 날짜만 — 데이터 없으면 생략(어제값 재발송 방지).
    # ⚠️ 증분은 저장값(오염 가능)을 쓰지 않고, 대시보드 safeIncrement와 '동일 규칙'으로 여기서 재계산한다:
    #   증분 = 오늘값 − 직전 '유효(>0)' 측정값. 직전 유효값 없으면(첫 측정) 증분 아님(제외). 배너=도달수 우선.
    #   → 수집 실패(0 저장)가 다음날 누적 전체로 폭발하던 과집계를 리포트에서도 원천 차단.
    def _measured_on(tgt):
        """target일에 측정된 {post_id: row} — 증분 계산 후보."""
        out, st = {}, 0
        while True:
            res = (db.table("post_daily_stats").select("post_id, play_count, reach_count")
                   .eq("measured_at", tgt).range(st, st + 999).execute())
            rs = res.data or []
            for r in rs:
                out[r["post_id"]] = r
            if len(rs) < 1000:
                break
            st += 1000
        return out

    target = os.getenv("MONITORING_DATE") or None
    strict = os.getenv("STRICT_DATE") == "1"
    dayrows = _measured_on(target) if target else {}
    if not dayrows and not strict:
        target = _latest_date(db)
        if target:
            dayrows = _measured_on(target)
    if not dayrows:
        print(f"[notify] {target} 측정 데이터 없음 → 발송 생략 (strict={strict})")
        return

    # 정정 재발송(REPLACE=1): 오늘 기존 리포트를 삭제한 뒤 새로 발송(잘못 나간 리포트 교체).
    if os.getenv("REPLACE") == "1" and CHANNEL[:1] in ("C", "G"):
        for ts in _find_report_ts(token, CHANNEL, target):
            # 리포트에 달린 댓글(상태 알럿 등)을 먼저 지우고(부모 삭제 후엔 조회 불가) 부모를 삭제.
            for rts in _thread_reply_ts(token, CHANNEL, ts):
                _delete_msg(token, CHANNEL, rts)
            _delete_msg(token, CHANNEL, ts)
    # 중복 방지: 채널 발송 + DEDUP=1인데 오늘 리포트가 이미 있으면 생략(백업 창 대비). REPLACE면 위에서 지웠으니 통과.
    elif os.getenv("DEDUP") == "1" and CHANNEL[:1] in ("C", "G") and _already_posted(token, CHANNEL, target):
        print(f"[notify] {target} 리포트 이미 게시됨 → 중복 방지 생략")
        return

    post_ids = list(dayrows.keys())
    # 게시물 메타(이름/플랫폼/상품군/업로드일/채널분류)
    meta = {}
    for chunk in _chunks(post_ids, 100):
        res = db.table("sponsored_posts").select("id, url, account_name, product_name, posted_at, channel_type, cost, ended_at").in_("id", chunk).execute()
        for r in (res.data or []):
            meta[r["id"]] = r

    # 🎯 쫀득바(JD)만: 각 게시물의 ≤target 시리즈를 가져와 안전 증분 + CPV용 누적(이력 최댓값)을 계산.
    jd_pids = [pid for pid in dayrows if "jd" in ((meta.get(pid) or {}).get("product_name") or "").lower()]
    series = {}
    for chunk in _chunks(jd_pids, 100):
        frm = 0
        while True:
            cr = (db.table("post_daily_stats").select("post_id, measured_at, play_count, reach_count")
                  .in_("post_id", chunk).lte("measured_at", target).order("id").range(frm, frm + 999).execute())
            cg = cr.data or []
            for r in cg:
                series.setdefault(r["post_id"], []).append(r)
            if len(cg) < 1000:
                break
            frm += 1000

    def _metric(r, isb):
        if isb:
            rc = r.get("reach_count")
            return rc if rc is not None else r.get("play_count")
        return r.get("play_count")

    def _safe_inc(rows, isb, posted_at=None):
        """대시보드 safeIncrement와 동일: 오늘값 − 직전 '유효(>0)' 값. 첫 유효측정=그날 전체, 오늘0/None=None.
        단 첫 유효측정은 '게시 후 7일 이내'만 전액 — 게시 한참 뒤 첫 측정(백로그)은 스파이크 방지로 제외."""
        cur, base, has = None, 0, False
        for r in rows:
            v = _metric(r, isb)
            if r["measured_at"] == target:
                cur = v
            elif r["measured_at"] < target and v is not None and v > 0:
                has = True
                if v > base:
                    base = v
        if cur is None or cur <= 0:
            return None            # 오늘 측정 없음/실패
        if not has:
            if posted_at:          # 백로그(게시 7일 초과 뒤 첫 측정)는 그날 전액 아님 → 제외
                try:
                    if (date.fromisoformat(target) - date.fromisoformat(str(posted_at)[:10])).days > 7:
                        return None
                except Exception:
                    pass
            return cur             # 첫 유효 측정(게시 7일 이내) = 그날 값 전체(업로드날 성과)
        return max(0, cur - base)

    # items: 안전 규칙으로 재계산(저장 increment 무시). 첫 측정/0 baseline은 증분 아님 → 제외(과집계 차단).
    items = []
    for pid in jd_pids:
        m = meta.get(pid, {})
        # 🛑 종료(ended_at) 게시물 제외 — target일 이전에 이미 종료된 글은 급상승/증분 리포트에서 뺀다.
        #    종료 후 남은 carry-forward·오염 행(다른 글 값 복사 등)이 가짜 증분으로 TOP에 오르는 것 방지.
        #    (종료일이 target 당일/이후면 그날까지는 실측이므로 포함.)
        end = m.get("ended_at")
        if end and str(end)[:10] < target:
            continue
        ct = (m.get("channel_type") or "").strip()
        isb = "배너" in ct
        rows = series.get(pid, [])
        inc = _safe_inc(rows, isb, m.get("posted_at"))
        if not inc or inc <= 0:
            continue
        url = (m.get("url") or "").strip()
        cum = max([(_metric(r, isb) or 0) for r in rows] or [0])  # CPV용 누적 = 이력 최댓값
        items.append({
            "inc": inc,
            "name": (m.get("account_name") or "").strip() or url.rstrip("/").split("/")[-1] or "?",
            "platform": _platform(url),
            "url": url,
            "product": (m.get("product_name") or "").strip(),
            "posted_at": str(m.get("posted_at"))[:10] if m.get("posted_at") else "",
            "channel_type": ct or "미분류",
            "is_new": False,
            "cost": m.get("cost") or 0,
            "cum": cum,
        })

    # 배너 라인은 증분 없어도 항상 노출 — 활성 JD 배너 채널분류 수집(증분 0인 날도 '미수집' 표기용).
    banner_cts = set()
    try:
        boff = 0
        while True:
            bres = (db.table("sponsored_posts").select("channel_type, ended_at, product_name")
                    .ilike("channel_type", "%배너%").range(boff, boff + 999).execute())
            bchunk = bres.data or []
            for b in bchunk:
                # 쫀득바(JD)만: 상품명에 JD 없는 배너 채널은 라인 노출 안 함(사용자 지시).
                if not b.get("ended_at") and b.get("channel_type") and "jd" in (b.get("product_name") or "").lower():
                    banner_cts.add((b.get("channel_type") or "").strip())
            if len(bchunk) < 1000:
                break
            boff += 1000
    except Exception as e:
        print("[notify] 배너 채널분류 조회 실패(무시):", e)

    if not items:
        print(f"[notify] {target} 증가분 없음 → 발송 생략")
        return

    total = sum(it["inc"] for it in items)

    # 인지 광고(시트값, 대시보드와 별개): 메타/틱톡/유튜브 그날 조회수를 총 증분에 합산.
    #   빈칸(미입력)은 합산하지 않음(빈칸≠0). 아래 채널분류 섹션 맨 위에 라인으로도 노출.
    ads = _fetch_awareness_ads(target)
    if ads:
        for _k in ("meta", "tiktok", "youtube"):
            _v = (ads.get(_k) or {}).get("views")
            if isinstance(_v, (int, float)) and _v > 0:
                total += _v

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

    # CPV(누적 조회당 비용): 채널별 Σ비용 / Σ누적조회수 (증분 있는 게시물 기준)
    #   온드미디어·위성채널은 무상 채널 → 광고비가 있어도 0으로 무시(사용자 지시).
    cost_by_ch, cumviews_by_ch = {}, {}
    for it in items:
        ct = _norm_ch(it["channel_type"])
        c = 0 if ct in NO_COST_CH else (it["cost"] or 0)
        cost_by_ch[ct] = cost_by_ch.get(ct, 0) + c
        cumviews_by_ch[ct] = cumviews_by_ch.get(ct, 0) + (it["cum"] or 0)

    # ⚠️ 온드/위성 데이터 위생 검사: 광고비(cost>0)·업체명(company_name)이 있으면 오입력 → 경고 수집.
    nocost_bad = []
    try:
        vr = (db.table("sponsored_posts")
              .select("account_name, url, channel_type, cost, company_name, product_name")
              .in_("channel_type", list(NO_COST_CH)).is_("ended_at", "null").execute())
        for r in (vr.data or []):
            if "jd" not in (r.get("product_name") or "").lower():
                continue
            bad = []
            if (r.get("cost") or 0) > 0:
                bad.append(f"광고비 {int(r['cost']):,}원")
            if (r.get("company_name") or "").strip():
                bad.append(f"업체명 '{r['company_name'].strip()}'")
            if bad:
                nm = (r.get("account_name") or "").strip() or (r.get("url") or "").rstrip("/").split("/")[-1] or "?"
                nocost_bad.append(f"{nm} ({(r.get('channel_type') or '').strip()}): {' · '.join(bad)}")
    except Exception as e:
        print("[notify] 온드/위성 위생검사 실패(무시):", e)

    items.sort(key=lambda x: x["inc"], reverse=True)

    def f(n): return f"{n:,}"

    def _cpv(cost, views, ct):
        # 배너는 views 자리에 도달수(reach 누적)가 들어옴 → CPV = 비용/도달수 = '도달당비용'(사용자 지시).
        # 그 외는 비용/누적조회수 = 조회당비용. 라벨은 공통 'CPV'.
        if not cost:
            return "무상"                # 무상시딩·비용 0
        if not views:
            return "CPV -"
        return f"CPV {cost / views:,.1f}원"

    DIV = "──────────────────────────────"
    lines = [
        f"📈 *쫀득바 인지 조회수 일일 증분* `({target})`",
        f"오늘 총 증분 *+{f(total)}*",
        "", DIV, "",
        "◾ *채널분류별*",
        "",
    ]
    # 인지 광고(시트값) — 채널분류 맨 위. 조회수는 위에서 total에 이미 합산됨.
    #   조회수 0·미입력(빈칸) 채널 줄은 숨김(사용자 지시). 셋 다 없으면 섹션 자체 생략.
    if ads:
        ad_lines = []
        for _k, _lab in (("meta", "메타"), ("tiktok", "틱톡"), ("youtube", "유튜브")):
            a = ads.get(_k) or {}
            v, c = a.get("views"), a.get("cost")
            if isinstance(v, (int, float)) and v > 0:
                ad_lines.append(f"    {_lab} *+{f(v)}*  {_ad_cpv(c or 0, v)}".rstrip())
        if ad_lines:
            lines.append("• *인지 광고*  `CPV는 일일 기준`")   # 광고 CPV = 그날 광고비 ÷ 그날 조회수(일일)
            lines.extend(ad_lines)
            lines.append("")
    # 아래 DB 채널들의 CPV는 누적 기준(누적비용÷누적조회수) — 인지광고(일일)와 구분해 별도 표기.
    lines.append("`CPV는 누적 기준`")
    lines.append("")
    for ct, s in sorted(by_channel.items(), key=lambda x: x[1], reverse=True):
        if "배너" in ct:
            # 배너값은 '증분'만 쓴다(사용자 지시 — 누적 아님). 배너는 매일이 아니라 며칠 간격 수집이라
            #   그날 수집이 없으면 증분 0 → '당일 미수집'으로 표기(값이 0이 아니라 수집이 없던 날).
            if s > 0:
                lines.append(f"• {_ital_paren(ct)} *+{f(s)}* (도달수)  {_cpv(cost_by_ch.get(ct, 0), cumviews_by_ch.get(ct, 0), ct)}")
            else:
                lines.append(f"• {_ital_paren(ct)}  (당일 배너 미수집)")
        else:
            lines.append(f"• {_ital_paren(ct)} *+{f(s)}*  {_cpv(cost_by_ch.get(ct, 0), cumviews_by_ch.get(ct, 0), ct)}")
    # ⚠️ 미분류 경고 — 시트엔 분류돼 있어도 DB channel_type이 아직 동기화 안 되면 여기로 몰림.
    #    조용히 '미분류'로 넘어가지 않게 표면화(시트→DB 분류 동기화 지연 감지용).
    unclassified_cnt = sum(1 for it in items if _norm_ch(it["channel_type"]) == "미분류")
    unclassified_inc = by_channel.get("미분류", 0)
    if unclassified_inc > 0:
        lines.append("")
        lines.append(f"⚠️ *미분류 {unclassified_cnt}건 (+{f(unclassified_inc)})* — 시트 채널분류가 DB에 아직 반영 안 됨(시트→DB 동기화 지연). 시트에서 `♻️ 전체 다시 추가`(syncAll) 실행 후 재발송하면 각 채널로 분류됩니다.")
    if nocost_bad:
        lines.append("")
        lines.append(f"⚠️ *온드/위성 오입력 {len(nocost_bad)}건* — 온드미디어·위성채널은 광고비·업체명이 없어야 합니다(리포트 CPV엔 무시). 시트에서 해당 값 삭제 필요:")
        for b in nocost_bad[:10]:
            lines.append(f"    • {b}")
    lines += ["", DIV, "", "◾ *급상승 TOP 10* 🔥  `CPV는 누적 기준`", ""]
    # 배너는 도달수를 '조회수'로 취급해 TOP에도 섞어 노출(사용자 지시). 배너 CPV = 비용/도달수(도달당비용).
    # 리포트는 이미 쫀득바만 필터돼 있어 줄마다 [JD멜] 상품태그는 중복 → 표시에서 제거(사용자 지시).
    for rank, it in enumerate(items[:10], 1):
        label = f"<{it['url']}|{_esc(it['name'])}>" if it["url"] else _esc(it["name"])
        date = it["posted_at"] or "업로드일 미상"
        lines.append(f"{rank}. {label} _({it['platform']})_ *+{f(it['inc'])}*  {_cpv(it['cost'], it['cum'], it['channel_type'])}  `{date}`")
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
