#!/usr/bin/env python3
# 협찬 데이터 수집 상태(정상/실패+사유) → 황경원 DM(여믄봇).
# cron-daily-collect.yml의 수집 직후 always() 단계에서 실행 — 수집 성공/실패 무관하게 발송.
import os
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from db import get_client
from channel_kind import is_banner_channel
from manual_entry_guards import copy_suspects, spike_suspects
from metric_anomaly_guards import frozen_spike_suspects

SLACK_API = "https://slack.com/api/chat.postMessage"
# 발송 대상: SLACK_CHANNEL(채널/스레드 답글) 우선, 없으면 STATUS_USER(황경원 DM).
# SLACK_THREAD_TS 있으면 그 메시지의 '댓글(스레드 답글)'로 게시.


def _platform(url: str) -> str:
    u = (url or "").lower()
    if "instagram.com" in u: return "IG"
    if "youtube.com" in u or "youtu.be" in u: return "YT"
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


def _urlkey(u: str) -> str:
    # 같은 게시물을 가리키는 URL 변형(/reel/↔/p/, /<계정>/p/<code>, 끝슬래시 등)을 한 키로 접음.
    # IG shortcode는 대소문자 구분이라 원문에서 추출.
    u = (u or "").strip()
    m = re.search(r"instagram\.com/(?:[^/]+/)?(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)", u, re.I)
    if m:
        return "ig:" + m.group(1)
    v = re.sub(r"^https?://(?:www\.)?", "", u, flags=re.I).split("?")[0].split("#")[0].rstrip("/")
    host, _, path = v.partition("/")
    return (host.lower() + "/" + path) if path else host.lower()


def _canon_url(u: str) -> str:
    """web/lib/url-utils.ts normalizeUrl의 파이썬 이식 — DB URL이 이 표준형과 다르면
    다음 시트 동기화 때 onConflict 미스매치로 중복 삽입될 잠복 위험(2026-07-06 YT www 17건 재발 사례).
    로직 변경 시 반드시 TS 쪽과 함께 바꿀 것."""
    u = (u or "").strip()
    m = re.search(r"(?:instagram\.com|instagr\.am)/(?:[^/]+/)?(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)", u, re.I)
    if m:
        return f"https://www.instagram.com/p/{m.group(1)}/"
    hm = re.match(r"https?://([^/]+)(/[^?#]*)?(\?[^#]*)?", u, re.I)
    if not hm:
        return u
    host = hm.group(1).lower()
    path = hm.group(2) or "/"
    if host == "youtu.be" or host.endswith("youtube.com"):
        ms = re.search(r"/shorts/([A-Za-z0-9_-]{6,})", path)
        if ms:
            return f"https://www.youtube.com/shorts/{ms.group(1)}/"
        vid = None
        if host == "youtu.be":
            seg = [s for s in path.split("/") if s]
            vid = seg[0] if seg else None
        else:
            mp = re.search(r"/(?:embed|live|v)/([A-Za-z0-9_-]{6,})", path)
            if mp:
                vid = mp.group(1)
            elif path.rstrip("/") == "/watch":
                mv = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", hm.group(3) or "")
                vid = mv.group(1) if mv else None
        if vid:
            return f"https://www.youtube.com/watch?v={vid}"
    # 일반: 선행 www. 제거(m.blog.naver.com 등 유의미 서브도메인 보존) + // 축약 + trailing slash
    host = re.sub(r"^www\.", "", host)
    path = re.sub(r"/{2,}", "/", path)
    if not path.endswith("/"):
        path += "/"
    if host == "tiktok.com":
        return f"https://www.tiktok.com{path}"
    return f"https://{host}{path}"


def _channel_type(post) -> str:
    return str(post.get("channel_type") or "")


def _is_banner(post) -> bool:
    return is_banner_channel(_channel_type(post), post.get("posted_at"))


def _is_internal_channel(post) -> bool:
    return any(t in _channel_type(post) for t in ("위성채널", "온드미디어"))


def _is_free_seed_manual(post) -> bool:
    return "무상시딩" in _channel_type(post)


def _is_uncollectable_play_platform(post) -> bool:
    u = (post.get("url") or "").lower()
    return (
        "threads." in u
        or "facebook.com" in u
        or "naver.com" in u
        or "kakao.com" in u
    )


def _is_view_collection_target(post) -> bool:
    """Posts that should normally produce a play_count from the collector."""
    if post.get("ended_at"):
        return False
    if _is_banner(post) or _is_internal_channel(post) or _is_free_seed_manual(post) or _is_uncollectable_play_platform(post):
        return False
    return True


def _integrity_lines(db, posts):
    # 데이터 정합성 특이 감시 — 증분 리포트를 왜곡하는 조용한 오염을 상태 댓글에서 바로 드러낸다.
    lines = []

    # 1) 같은 링크 중복 집계 (레거시 /reel/↔/p/ 중복 삽입 사고(2026-07-03, 275건) 재발 감시)
    groups = {}
    for p in posts:
        k = _urlkey(p.get("url"))
        if k:
            groups.setdefault(k, []).append(p)
    dups = {k: v for k, v in groups.items() if len(v) > 1}
    if dups:
        ex = " / ".join(f"{k.split(':')[-1].split('/')[-1]}({'·'.join((x.get('account_name') or '?') for x in v[:3])})"
                        for k, v in list(dups.items())[:4])
        line = f"같은 링크 중복 {len(dups)}그룹 — 증분 이중계산 위험: {ex}"
        if len(dups) > 4:
            line += f" … 외 {len(dups) - 4}그룹"
        lines.append(line)

    # ⚡ post_daily_stats 전수 순회는 **여기 한 번뿐**이다.
    #    예전엔 2)·4)·5)가 각각 통째로 페이지네이션하며 같은 테이블을 3번 긁었다(약 3만 행 × 3).
    #    셋의 '필터가 서로 달라' 결과를 재사용할 수 없었을 뿐, 원본 행은 같다 → 한 번 읽고 각자 조건으로 적재한다.
    #      · first    : 모든 행 (값 없는 행 포함) — 게시일 이전 이력 판정용
    #      · day_cnt  : 최근 7일 & play_count is not None (0도 실측으로 셈) — 부분수집 판정용
    #      · series   : 값>0 (play 우선, 없으면 reach) — 종료-후 복사 오염 판정용
    #      · pseries  : play_count>0 만 — 수기 오기·누적 하락 판정용(배너 reach 제외)
    #    ⚠️ 조건을 하나라도 바꾸면 해당 알림의 의미가 달라진다. 합치면서 조건은 그대로 옮겼다.
    from datetime import timedelta, datetime, timezone
    posted = {p["id"]: str(p["posted_at"])[:10] for p in posts if p.get("posted_at")}
    name_of = {p["id"]: (p.get("account_name") or "?") for p in posts}
    kst_today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    cutoff = (kst_today - timedelta(days=7)).isoformat()
    active_view_posts = [p for p in posts if _is_view_collection_target(p)]
    active_view_ids = {p["id"] for p in active_view_posts}

    first, day_cnt = {}, {}
    series, vidx, pseries, pvidx = {}, {}, {}, {}
    off = 0
    while True:
        res = db.table("post_daily_stats").select(
            "post_id, measured_at, play_count, reach_count, manual").order("id").range(off, off + 999).execute()
        chunk = res.data or []
        for r in chunk:
            pid, m = r["post_id"], r["measured_at"]
            if pid not in first or m < first[pid]:
                first[pid] = m
            if m >= cutoff and pid in active_view_ids and r["play_count"] is not None:
                day_cnt[m] = day_cnt.get(m, 0) + 1
            d = m[:10]
            man = bool(r.get("manual"))
            pv = r.get("play_count") or 0
            if pv > 0:
                pseries.setdefault(pid, []).append((d, pv, man))
                pvidx.setdefault((d, pv), set()).add(pid)
            v = pv or r.get("reach_count") or 0
            if v > 0:
                series.setdefault(pid, []).append((d, v, man))
                vidx.setdefault((d, v), set()).add(pid)
        if len(chunk) < 1000:
            break
        off += 1000

    # 2) 게시일 이전 조회수 이력 (게시일 오기 또는 시트 백필 열 어긋남 신호)
    early = sorted((pid for pid in posted if pid in first and first[pid] < posted[pid]),
                   key=lambda pid: first[pid])
    if early:
        ex = ", ".join(f"{name_of.get(pid, '?')}({posted[pid][5:]}게시·이력 {first[pid][5:]}~)" for pid in early[:4])
        line = f"게시일 이전 조회수 이력 {len(early)}건 — 게시일 오기/백필 어긋남 의심: {ex}"
        if len(early) > 4:
            line += f" … 외 {len(early) - 4}건"
        lines.append(line)

    # 3) URL 표준형 불일치 — 중복이 '생기기 전' 사전 감지(중복 감시 1)은 생긴 후에야 잡음).
    #    DB URL이 normalizeUrl 표준형과 다르면 다음 동기화 때 같은 게시물이 새 행으로 삽입된다.
    mism = [p for p in posts if (p.get("url") or "").strip() and _canon_url(p["url"]) != (p.get("url") or "").strip()]
    if mism:
        ex = ", ".join(f"{(p.get('account_name') or '?')}({(p.get('url') or '')[-24:]})" for p in mism[:4])
        line = f"URL 표준형 불일치 {len(mism)}건 — 다음 동기화 때 중복 삽입 위험(소급 정규화 필요): {ex}"
        if len(mism) > 4:
            line += f" … 외 {len(mism) - 4}건"
        lines.append(line)

    # 4) 부분수집 감지 — 특정일 실측(non-null play)수가 그날 활성 조회수대상 풀의 60% 미만이면
    #    그날 증분이 실제보다 과소. 예전에는 최근 중앙값을 기준선으로 썼지만, 자동종료로 활성 풀이
    #    정상 축소되면 정상 수집도 부분수집으로 오탐됐다(2026-07-16: active 347, measured 272).
    # (kst_today·cutoff·active_view_* 와 day_cnt 는 위 통합 스캔에서 이미 채웠다)
    # 오늘(KST)은 수집 중이라 제외하고 완료된 날만 판정.
    done = {d: c for d, c in day_cnt.items() if d < kst_today.isoformat()}
    if len(done) >= 4:
        expected_by_day = {}
        for d in done:
            expected_by_day[d] = sum(
                1 for p in active_view_posts
                if str(p.get("created_at") or "")[:10] <= d
                and (not p.get("posted_at") or str(p.get("posted_at"))[:10] <= d)
            )
        low = sorted(
            d for d, c in done.items()
            if expected_by_day.get(d, 0) > 0 and c < 0.6 * expected_by_day[d]
        )
        if low:
            ex = ", ".join(f"{d[5:]}({done[d]}/{expected_by_day[d]})" for d in low[:5])
            line = f"부분수집 감지 {len(low)}일 — 실측수가 활성 조회수대상 풀의 60% 미만이라 그날 증분 과소(재수집 권장): {ex}"
            if len(low) > 5:
                line += f" … 외 {len(low) - 5}일"
            lines.append(line)

    # (구 5번 'play=0 & increment>0' 제거 — increment 컬럼 폐기(2026-07-08)로 무의미.)

    # 5) 종료-후 복사 오염 감지 — 종료 게시물에 '다른 게시물의 시계열'이 복사돼 붙는 오염(2026-07-14 톡톡시아·뭐랭하맨·준맛 등).
    #    종료일 이후(measured_at>ended_at) 행이 '자기 carry-forward 값'이 아닌데 그 (날짜,값)이 다른 게시물에도
    #    존재하면 복사 신호(상향·하향 복사 모두). ⚠️ 강제 차단은 안 함(종료 후 알고리즘 유입으로 실제 상승 가능) —
    #    여기서 드러내 사람이 소스(시트/정정)를 바로잡게 한다. carry 값·단일 우연은 제외해 오탐 최소화.
    ended = {p["id"]: str(p["ended_at"])[:10] for p in posts if p.get("ended_at")}
    # ⚠️ series/vidx(값>0, play 우선 reach 대체)와 pseries/pvidx(play 전용)는 위 통합 스캔에서 채웠다.
    #    · series/vidx : 5번(종료-후 복사)과 5-b번(활성 수기 오기)이 함께 쓴다 —
    #      예전에 `if ended:` 안에서 만들어 활성 게시물 검사가 종료 게시물 유무에 묶였다(2026-08-12 교훈).
    #    · pseries/pvidx: **조회수만** 담는다. 배너 도달수는 시트 수기 입력이라 값이 며칠씩 유지되는 게
    #      정상이고 같은 소재끼리 같은 값이 흔해, 복사 판정에 섞으면 배너 오탐이 구조적으로 계속 난다
    #      (2026-08-12 실측: luna.humor·wikitrip.kr·ho1y_time 등 배너 6건 전부 오탐).
    if ended:
        copied = []
        for pid, ed in ended.items():
            rows = series.get(pid, [])
            pre = sorted((d, v) for d, v, _m in rows if d <= ed)
            carry = pre[-1][1] if pre else None   # 종료 전 마지막 실측 = 정상 carry-forward 값(제외 대상)
            # 종료-후 행이 '자기 carry 값'이 아닌데 (날짜,값)이 다른 게시물에도 있으면 복사 신호.
            # ⚠️ 상향(>carry)뿐 아니라 하향(<carry) 복사도 잡는다(2026-07-14 톡톡시아 릴스 54,400<212,917 누락 교훈).
            hits = [(d, v) for d, v, _m in rows if d > ed and v != carry and len(vidx.get((d, v), ())) > 1]
            if hits:
                src = sorted({name_of.get(x, "?") for dv in hits for x in vidx.get(dv, ()) if x != pid})
                copied.append((name_of.get(pid, "?"), ed, len(hits), src[:2]))
        if copied:
            copied.sort(key=lambda x: -x[2])
            ex = ", ".join(f"{acc}(종료{ed[5:]}·{n}행←{'/'.join(s) or '?'})" for acc, ed, n, s in copied[:4])
            line = f"종료-후 복사 오염 {len(copied)}건 — 종료 게시물에 타 게시물 값 복사(증분 왜곡, 소스 확인 필요): {ex}"
            if len(copied) > 4:
                line += f" … 외 {len(copied) - 4}건"
            lines.append(line)

    # 5-b) 활성 게시물 '수기 입력' 오기 감지 — 5번이 종료 게시물만 봐서 놓친 구멍(2026-08-12 s_3.mag).
    #      실제 사고: 활성 게시물에 14 → 199,379가 수기로 들어갔고 그 값은 같은 날 다른 게시물의
    #      자동 수집값과 6자리 완전 일치했다. 20.7만 조회수가 2주 넘게 과대계상되도록 알림이 없었다.
    #      복사 지문(거의 확실)과 급등(정황)을 분리해 알린다. 차단·자동 정정은 하지 않는다(절대규칙).
    #      ⚠️ 미러링·내부채널(위성/온드)은 같은 콘텐츠를 여러 채널로 추적해 같은 값을 의도적으로
    #         적는 경우가 있다 → 복사 알림에서 제외한다(실측 28개 중 10개가 이 유형).
    def _shares_values_by_design(p):
        name = str((p or {}).get("asset_name") or (p or {}).get("project_name") or "")
        return "미러링" in name or _is_internal_channel(p or {})
    skip_copy = {p["id"] for p in posts if _shares_values_by_design(p)}
    copy_hits, spike_hits = [], []
    for pid, rows in pseries.items():                    # 조회수만 — 배너 reach는 대상 아님
        if pid in ended:
            continue                                    # 종료분은 5번이 담당
        if pid not in skip_copy:
            for d, v, others in copy_suspects(rows, pvidx):
                src = sorted({name_of.get(o, "?") for o in others if o != pid})
                copy_hits.append((name_of.get(pid, "?"), d, v, src[:2]))
        for d, v, prev, mult in spike_suspects(rows):
            spike_hits.append((name_of.get(pid, "?"), d, v, prev, mult))
    if copy_hits:
        copy_hits.sort(key=lambda x: -x[2])
        ex = ", ".join(f"{acc}({d[5:]} {v:,}←{'/'.join(s) or '?'})" for acc, d, v, s in copy_hits[:4])
        line = f"🔴 수기 입력 복사 의심 {len(copy_hits)}건 — 타 게시물과 (날짜,값) 완전 일치, 오기 가능성 높음: {ex}"
        if len(copy_hits) > 4:
            line += f" … 외 {len(copy_hits) - 4}건"
        lines.append(line)
    if spike_hits:
        spike_hits.sort(key=lambda x: -x[4])
        ex = ", ".join(f"{acc}({d[5:]} {prev:,}→{v:,}, {mult:,.0f}배)" for acc, d, v, prev, mult in spike_hits[:3])
        line = f"수기 입력 급등 확인요청 {len(spike_hits)}건 — 실제 바이럴일 수도 있으니 값 확인만: {ex}"
        if len(spike_hits) > 3:
            line += f" … 외 {len(spike_hits) - 3}건"
        lines.append(line)

    # 5-c) 자동·수기 공통 상향 교차오염 사후감사. 급등 자체는 실제 바이럴일 수 있으므로
    #      차단하지 않고, 10배 이상 급등 뒤 3일 이상 값이 정확히 고정된 경우만 알린다.
    #      배너 reach는 pseries에 없어서 대상이 아니며 종료글은 이미 고정이 정상이라 제외한다.
    frozen_hits = []
    for pid, rows in pseries.items():
        if pid in ended:
            continue
        for spike_date, plateau_date, value, previous, days, reason in frozen_spike_suspects(
            rows, pvidx, post_id=pid,
        ):
            frozen_hits.append((name_of.get(pid, "?"), spike_date, plateau_date, value, previous, days, reason))
    if frozen_hits:
        frozen_hits.sort(key=lambda item: (-item[5], -item[3]))
        ex = ", ".join(
            f"{account}({spike_date[5:]} {previous if previous is not None else '?'}→{value:,}, {days}일 고정)"
            for account, spike_date, _plateau_date, value, previous, days, _reason in frozen_hits[:4]
        )
        line = f"🔴 조회수 급등 후 동결 {len(frozen_hits)}건 — 교차오염이 단조 가드에 고착됐을 수 있어 확인 필요: {ex}"
        if len(frozen_hits) > 4:
            line += f" … 외 {len(frozen_hits) - 4}건"
        lines.append(line)

    # 6) 누적 조회수 하락 감지 — 조회수는 누적이라 감소 불가. 특히 수동 입력(manual)은 mono 가드를 우회(2722cf4,
    #    원래 하향 정정 허용 목적)해서 오타·잘못된 숫자가 그대로 통과 → 누적·증분 깨짐(2026-07 시으니네 틱톡
    #    249,508→58,300 등, 틱톡 민감영상은 자동수집 불가라 수동 트래킹 강제 = 오기 다발). 차단 아닌 알림으로
    #    사람이 오기인지 정당한 하향 정정인지 판단. 수동 하락은 전부, 자동 하락은 5% 초과만(IG 미세 재집계 노이즈 제외).
    # ⚡ 위 `pseries`가 이미 동일 조건(play_count>0)의 (날짜, 값, 수기) 목록이라 전수 스캔을 재사용한다.
    #    예전엔 같은 테이블을 한 번 더 페이지네이션하며 통째로 긁었다(약 3만 행 × 2회).
    drops = []
    for pid, rows in pseries.items():
        if len(rows) < 2:
            continue
        rows = sorted(rows)          # 공유 구조를 건드리지 않도록 사본 정렬
        last_d, last_v, last_m = rows[-1]
        prior_max = max(v for _, v, _ in rows[:-1])
        if last_v < prior_max and (last_m or (last_v < prior_max * 0.95)):   # 수동 하락 전부 / 자동은 5% 초과만
            drops.append((name_of.get(pid, "?"), last_d, last_v, prior_max, last_m))
    if drops:
        drops.sort(key=lambda x: -(x[3] - x[2]))
        ex = ", ".join(f"{acc}({'수동' if m else '자동'} {d[5:]} {v:,}<직전 {pm:,})" for acc, d, v, pm, m in drops[:4])
        line = f"누적 조회수 하락 {len(drops)}건 — 누적은 감소 불가(수동 오기/과대 정정 확인 필요): {ex}"
        if len(drops) > 4:
            line += f" … 외 {len(drops) - 4}건"
        lines.append(line)

    # 6) 온드/위성 무상채널에 광고비·업체명 오입력 감시 — 리포트 CPV엔 무시하지만 시트·DB 정정 필요(사용자 지시로 댓글에만 표기).
    try:
        vr = (db.table("sponsored_posts")
              .select("account_name, channel_type, cost, company_name, product_name, ended_at")
              .in_("channel_type", ["온드미디어", "위성채널"]).is_("ended_at", "null").execute())
        for r in (vr.data or []):
            if "jd" not in (r.get("product_name") or "").lower():
                continue
            bad = []
            if (r.get("cost") or 0) > 0:
                bad.append(f"광고비 {int(r['cost']):,}원")
            if (r.get("company_name") or "").strip():
                bad.append(f"업체명 '{r['company_name'].strip()}'")
            if bad:
                nm = (r.get("account_name") or "").strip() or "?"
                lines.append(f"온드/위성 오입력 — {nm}({(r.get('channel_type') or '').strip()}): {' · '.join(bad)} → 시트·DB에서 삭제 필요")
    except Exception as e:
        print("[status] 온드/위성 검사 실패(무시):", e)

    return lines


def main():
    token = os.environ["SLACK_BOT_TOKEN"]
    target = os.getenv("MONITORING_DATE") or date.today().isoformat()
    outcome = (os.getenv("COLLECT_OUTCOME") or "").lower()  # success | failure | ""
    db = get_client()

    # 오늘 적재된 stats 집계
    rows, start = [], 0
    while True:
        res = db.table("post_daily_stats").select("post_id, play_count").eq(
            "measured_at", target
        ).order("id").range(start, start + 999).execute()
        chunk = res.data or []
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    total = len(rows)
    with_play = sum(1 for r in rows if r.get("play_count") is not None)

    # 플랫폼별 건수
    pids = [r["post_id"] for r in rows]
    meta = {}
    for c in _chunks(pids, 100):
        res = db.table("sponsored_posts").select("id, url").in_("id", c).execute()
        for m in (res.data or []):
            meta[m["id"]] = m.get("url")
    by_plat = {}
    for r in rows:
        p = _platform(meta.get(r["post_id"]))
        by_plat[p] = by_plat.get(p, 0) + 1
    plat_str = " · ".join(f"{k} {v}" for k, v in sorted(by_plat.items(), key=lambda x: -x[1])) or "-"

    # 활성인데 오늘 미측정 게시물 점검 (수집 누락·잘못된 URL 조기 발견)
    # ⚠️ 발송 판단(real_problem)에 쓰이므로 반드시 send/text 결정 전에 계산한다.
    today_ids = {r["post_id"] for r in rows}
    posts, off = [], 0
    while True:
        res = db.table("sponsored_posts").select(
            "id, url, account_name, created_at, ended_at, content_summary, posted_at, channel_type, notes"
        ).order("id").range(off, off + 999).execute()
        chunk = res.data or []
        posts.extend(chunk)
        if len(chunk) < 1000:
            break
        off += 1000
    active = [a for a in posts if not a.get("ended_at")]
    waiting = uncollectable = banner_skip = internal_skip = free_seed_skip = 0
    check = []  # (account, 사유, url)
    cand = []   # 미측정 후보 — 이미지(비영상) 판별 대기 (id, account, url)
    for a in active:
        if "수동추적 제외" in str(a.get("notes") or ""):
            continue
        if a["id"] in today_ids:
            continue
        c = str(a.get("created_at"))[:10]
        if c > target:
            continue                # 대상일 이후 등록 → 그날 존재 안 함(미측정 아님)
        u = (a.get("url") or "").lower()
        if c == target:
            waiting += 1            # 당일 등록 → 다음 수집에서 측정(정상)
        elif _is_banner(a):
            banner_skip += 1        # 배너는 도달수(reach_count)로 측정 → 조회수 미측정은 정상(점검 제외)
        elif _is_internal_channel(a):
            internal_skip += 1      # 내부채널(위성/온드) — 캠페인 아님·불규칙 수집 → 미측정 정상(점검 제외, 2026-07-15 사용자 지시)
        elif _is_free_seed_manual(a):
            free_seed_skip += 1     # 무상시딩 영상 소형 계정은 수동추적 버킷으로 분리(점검 목록에서는 제외)
        elif _is_uncollectable_play_platform(a):
            uncollectable += 1      # 수집 불가(정상 — 신경 안 써도 됨)
        elif "instagram.com" in u and not re.search(r"/(?:p|reels|reel|tv)/[A-Za-z0-9_-]+", u):
            check.append((a.get("account_name"), "URL오류(게시물 링크 아님)", a.get("url")))
        else:
            cand.append((a["id"], a.get("account_name"), a.get("url")))

    # 이미지(비영상) 게시물 제외 — 스크랩이 성공하면(likes 존재) 영상은 반드시 play_count가 있다.
    #   따라서 이력상 play_count가 한 번도 없고 likes만 있으면 조회수가 없는 이미지 게시물 → '미측정' 아님.
    #   (영상이 오늘만 실패한 경우엔 이전 날짜에 play_count 이력이 있어 제외되지 않고 정상 점검된다.)
    image_skip = 0
    if cand:
        hist = {}
        for cids in _chunks([x[0] for x in cand], 100):
            hres = db.table("post_daily_stats").select("post_id, play_count, likes_count").in_("post_id", cids).execute()
            for h in (hres.data or []):
                d = hist.setdefault(h["post_id"], {"play": False, "likes": False})
                if h.get("play_count") is not None:
                    d["play"] = True
                if h.get("likes_count") is not None:
                    d["likes"] = True
        for pid, nm, url in cand:
            d = hist.get(pid)
            if d and d["likes"] and not d["play"]:
                image_skip += 1     # 이미지 게시물(조회수 없음) → 미측정 아님
            else:
                check.append((nm, "미측정", url))

    # 발송 판단은 '수집 스텝 exit code'가 아니라 '실측 데이터 갭'으로 한다 (2026-08-05 cry-wolf 방지).
    #   재시도 빈 배치·보조플랫폼 일시오류로 수집 스텝이 failure여도, 실제 데이터가 정상이면 실패 DM을
    #   보내지 않는다. 단, 진짜 갭(total 0 또는 활성 점검대상 미수집=check)은 반드시 알린다(blind spot 금지).
    real_problem = (total == 0) or bool(check)
    if os.getenv("ONLY_ON_FAILURE") == "1" and not real_problem:
        print(f"[status] 실측 데이터 갭 없음(수집스텝={outcome or '?'}, total={total}, 점검=0) → ONLY_ON_FAILURE 발송 생략")
        return
    if not real_problem:
        text = (f"*✅ 협찬 데이터 정상 수집* ({target} KST)\n"
                f"총 {total:,}건 적재 · 조회수 {with_play:,}건\n"
                f"플랫폼: {plat_str}")
    else:
        reason = ""
        logf = os.getenv("COLLECT_LOG")
        if logf and os.path.exists(logf):
            try:
                tail = open(logf, encoding="utf-8", errors="replace").read().strip().splitlines()[-12:]
                reason = "\n".join(tail)
            except Exception:
                pass
        if not reason:
            reason = f"수집 단계 결과={outcome or '알수없음'}, 오늘 적재 {total}건"
        head = "*❌ 협찬 데이터 수집 실패/이상*" if (total == 0 or outcome == "failure") else "*⚠️ 협찬 데이터 점검 필요*"
        text = (f"{head} ({target} KST)\n"
                f"오늘 적재: {total:,}건 · 조회수 {with_play:,}건\n"
                f"사유(수집 로그 끝부분):\n```{reason[:1500]}```")

    unmeasured = waiting + uncollectable + len(check)
    if unmeasured:
        btail = (
            (f" · 배너 {banner_skip} 제외(도달수 측정)" if banner_skip else "")
            + (f" · 내부채널 {internal_skip} 제외(위성/온드)" if internal_skip else "")
            + (f" · 무상시딩 수동추적 {free_seed_skip}건 제외" if free_seed_skip else "")
            + (f" · 이미지 {image_skip} 제외(조회수 없음)" if image_skip else "")
        )
        text += f"\n\n⚠️ 오늘 미측정 활성 {unmeasured}건 (신규대기 {waiting} · 수집불가 {uncollectable} · 점검 {len(check)}){btail}"
        for nm, reason, url in check[:8]:
            tail = (url or "").rstrip("/").split("/")[-1]
            text += f"\n  · {nm} [{reason}] {tail}"
        if len(check) > 8:
            text += f"\n  … 외 {len(check) - 8}건"
    elif free_seed_skip:
        text += f"\n\nℹ️ 무상시딩 수동추적 {free_seed_skip}건 제외 — 소형 계정 수집 누락 노이즈라 점검 목록에서는 분리"

    # 캡션 미충전 감시 — 자동 보강(backfill_captions)이 안 돌면 빈 캡션이 쌓임(2026-07-02 사고: 77건 누적).
    # 매일 이 수치가 보이면, 다시 안 채워지기 시작할 때 즉시 알아챌 수 있다(조용한 실패 → 시끄러운 실패).
    empty_cap = sum(1 for a in active
                    if "instagram.com" in (a.get("url") or "").lower()
                    and re.search(r"/(?:p|reels|reel|tv)/[A-Za-z0-9_-]+", (a.get("url") or ""))
                    and not (a.get("content_summary") or "").strip())
    if empty_cap:
        text += f"\n\n📝 캡션 없는 활성 IG {empty_cap}건 — 자동 보강이 채우는 중(내일도 이 수치면 backfill 미작동 의심)"

    # 데이터 정합성 특이 — 이상 있을 때만 섹션 추가. 점검 자체가 죽어도 상태 발송은 유지하되 티는 낸다(조용한 실패 방지).
    try:
        integ = _integrity_lines(db, posts)
        if integ:
            text += "\n\n🧪 데이터 정합성 특이 — 수집과 별개로 데이터 손질 필요:\n" + "\n".join("  · " + l for l in integ)
    except Exception as e:
        text += f"\n\n🧪 정합성 점검 실패({type(e).__name__}) — notify_status 로그 확인 필요"

    ch = os.getenv("SLACK_CHANNEL") or os.getenv("STATUS_USER")
    if not ch:
        raise SystemExit("SLACK_CHANNEL 또는 STATUS_USER 필요")
    tts = os.getenv("SLACK_THREAD_TS")
    if ch[:1] in ("C", "G") and not tts:
        # 채널(C/G) 대상인데 답글 대상(thread_ts) 없음 → top-level 채널 게시가 되므로 발송 생략.
        print("[status] 채널+thread_ts 없음 → top-level 방지 위해 발송 생략")
        return
    payload = {"channel": ch, "text": text}
    if tts:
        payload["thread_ts"] = tts   # 리포트 메시지의 '댓글(스레드 답글)'로 게시
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(SLACK_API, data=data,
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    print("[status] ok=", r.get("ok"), "error=", r.get("error"), "ch=", ch, "thread=", tts, "outcome=", outcome, "total=", total)
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
