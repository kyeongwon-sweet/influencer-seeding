#!/usr/bin/env python3
"""발송된 일일 증분 리포트에 '전환 조회수'만 사후 보정한다(다른 숫자는 발송 당시 그대로).

배경: 전환 조회수(마케팅T [인지_쫀득바] 일별 '전환 노출수' 열)는 팀이 다음날 이후 입력하는 경우가 많아
12:20 발송 때 빈칸이면 줄이 빠지고 총 증분에도 안 들어간다(빈칸≠0 규칙). 값이 나중에 채워졌을 때
update_ts 재생성을 쓰면 늦게 등록된 게시물의 첫 측정 몰림 등 다른 숫자까지 바뀌므로, 여기서는
① 인지 광고 아래 전환 조회수 줄 삽입 ② 총 증분 합산 ③ 목표% 재계산만 한다.
식은 notify_increments.py와 같다(전환은 round 후 합산, 0이면 줄만 '+0'으로 표시).

env: SLACK_BOT_TOKEN, APP_URL, CRON_SECRET, DATES(쉼표 구분 YYYY-MM-DD), DRY_RUN("true"면 미편집)
     DATES가 비면(스케줄 실행) 최근 AUTO_DAYS일(기본 5, KST 어제부터)을 본다 — 전환 탭은 주말분을
     다음 주에 몰아 채우는 경우가 있어 넉넉히 잡는다. 이미 전환 줄이 있거나 시트가 비어 있으면 건너뛴다.
     OVERWRITE("true"면 전환 출처가 메타인 제품의 기존 전환 값을 나이와 무관하게 메타 값으로 교체 — 수동용)

바치케(전환 출처=메타 광고 관리자, 2026-10-27 사용자 결정 "일주일 기준으로 최종 데이터로 엎어줘"):
  ① '미집계' 줄은 메타 값으로 채우고 ② 리포트 대상일이 FINAL_AGE_DAYS(7)일 이상 지났으면 메타 확정값과
  다를 때 전환 값·총 증분을 덮어쓴다(replace_conversion_value). 쫀득바(시트)는 덮어쓰지 않는다.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from meta_conversion import fetch_meta_conversion  # noqa: E402
from report_message import is_report_for  # noqa: E402  (scripts/ 가 sys.path[0])

CHANNEL = os.getenv("SLACK_CHANNEL") or "C0B4F7GBX17"  # #빙과_마케팅_리포트

# 리포트 제품(2026-10-27 바치케 추가). notify_increments.PRODUCT_PROFILES 와 같은 값이어야 한다
#   (이 워크플로는 requirements 를 설치하지 않아 notify 를 import 할 수 없음 → 짝 테스트로 묶음).
#   conv: 전환 조회수 출처(sheet=시트 탭 / meta=메타 광고 관리자 P바치 전환 광고 노출수)
PRODUCTS = {
    "jd": {"title": "쫀득바", "tab": "", "conv": "sheet"},
    "pbachi": {"title": "바치케", "tab": "pint", "conv": "meta"},
}
FINAL_AGE_DAYS = 7   # 메타 출처: 대상일 + 7일부터 확정값으로 덮어쓴다
PRODUCT = (os.getenv("REPORT_PRODUCT") or "jd").strip().lower()

TOTAL_RE = re.compile(r"오늘 총 증분 \*\+([\d,]+)\*")
# 이모지는 Slack이 단축코드(:dart:)로 돌려줄 수 있어 패턴에서 제외
GOAL_RE = re.compile(r"\*일 (\d+)만 목표\* \d+% · (?:달성 \+|미달 -)[\d,]+")
CONV_LABEL = "전환 조회수"
CONV_VALUE_RE = re.compile(r"^    전환 조회수 \*\+([\d,]+)\*", re.M)
# 발송 시점에 시트가 비어 notify가 남긴 '미입력' 줄(값 없는 전환 줄). 이 줄을 값으로 바꾼다.
CONV_PENDING_RE = re.compile(r"^    전환 조회수(?! \*\+).*$", re.M)


def f(n):
    return f"{n:,}"


def patch_text(text, conv):
    """(new_text, info) 반환. 고칠 수 없거나 고칠 필요 없으면 (None, 사유)."""
    if CONV_VALUE_RE.search(text):
        return None, "이미 전환 조회수 줄 있음"
    conv = round(conv)
    m = TOTAL_RE.search(text)
    g = GOAL_RE.search(text)   # 목표 줄은 목표가 있는 제품만(바치케는 없음) → 있으면 다시 계산
    if not m:
        return None, "총 증분 줄 형식을 찾지 못함"
    old_total = int(m.group(1).replace(",", ""))
    new_total = old_total + conv

    lines = text.split("\n")
    pend = next((i for i, ln in enumerate(lines) if CONV_PENDING_RE.match(ln)), None)
    sec = next((i for i, ln in enumerate(lines) if "*인지 광고*" in ln), None)
    if pend is not None:
        lines[pend] = f"    {CONV_LABEL} *+{f(conv)}*"   # '미입력' 줄을 값으로 교체(0이면 +0)
    elif sec is not None:
        j = sec + 1
        while j < len(lines) and lines[j].startswith("    "):
            j += 1
        lines.insert(j, f"    {CONV_LABEL} *+{f(conv)}*")
    elif conv > 0:
        # 발송본에 메타/틱톡/유튜브 줄이 하나도 없어 섹션 자체가 없던 경우: notify와 같은 자리에 섹션 생성
        anchor = next((i for i, ln in enumerate(lines) if ln.startswith("`CPV는 누적 기준")), None)
        if anchor is None:
            return None, "인지 광고 섹션/삽입 위치를 찾지 못함"
        lines[anchor:anchor] = ["• *인지 광고*  `CPV는 일일 기준`", f"    {CONV_LABEL} *+{f(conv)}*", ""]
    else:
        return None, "전환 0 + 인지광고 섹션 없음 → 발송 로직상 표시 안 함"

    new = "\n".join(lines)
    new = TOTAL_RE.sub(f"오늘 총 증분 *+{f(new_total)}*", new, count=1)
    pct = tail = None
    if g:
        goal_man = int(g.group(1))
        goal = goal_man * 10000
        pct = f"{new_total / (goal / 100):.0f}"
        tail = ("달성 +" + f(new_total - goal)) if new_total >= goal else ("미달 " + f(new_total - goal))
        new = GOAL_RE.sub(f"*일 {goal_man}만 목표* {pct}% · {tail}", new, count=1)

    # 안전장치: 바뀐 줄이 정확히 총 증분·목표 두 줄이고, 추가된 줄은 전환/섹션 줄뿐인지 확인
    old_set, new_set = text.split("\n"), new.split("\n")
    removed = [ln for ln in old_set if ln not in new_set]
    added = [ln for ln in new_set if ln not in old_set]
    # 삭제는 총 증분·목표 줄(전환 0이면 안 바뀜)과 교체된 미입력 줄만 허용
    if new == text or len(removed) > 3 or not all(
            ("총 증분" in ln or "만 목표" in ln or CONV_PENDING_RE.match(ln)) for ln in removed):
        return None, f"예상 외 변경(삭제 {removed})"
    if any(not ("총 증분" in ln or "만 목표" in ln or CONV_LABEL in ln or "*인지 광고*" in ln or ln == "")
           for ln in added):
        return None, f"예상 외 변경(추가 {added})"
    return new, {"old_total": old_total, "new_total": new_total, "conv": conv, "pct": pct, "tail": tail}


def replace_conversion_value(text, conv):
    """이미 들어간 전환 값을 conv로 교체(메타 확정값 덮어쓰기). 총 증분은 차이만큼, 목표%는 다시 계산.
    (new_text, info) / 고칠 필요 없거나 못 고치면 (None, 사유)."""
    conv = round(conv)
    cm, m = CONV_VALUE_RE.search(text), TOTAL_RE.search(text)
    if not cm:
        return None, "전환 값 줄 없음"
    if not m:
        return None, "총 증분 줄 형식을 찾지 못함"
    old_conv = int(cm.group(1).replace(",", ""))
    if old_conv == conv:
        return None, f"이미 확정값과 같음(+{f(conv)})"
    old_total = int(m.group(1).replace(",", ""))
    new_total = old_total - old_conv + conv
    if new_total < 0:
        return None, f"총 증분이 음수가 됨({f(new_total)})"
    new = CONV_VALUE_RE.sub(f"    {CONV_LABEL} *+{f(conv)}*", text, count=1)
    new = TOTAL_RE.sub(f"오늘 총 증분 *+{f(new_total)}*", new, count=1)
    g = GOAL_RE.search(new)
    pct = tail = None
    if g:
        goal_man = int(g.group(1))
        goal = goal_man * 10000
        pct = f"{new_total / (goal / 100):.0f}"
        tail = ("달성 +" + f(new_total - goal)) if new_total >= goal else ("미달 " + f(new_total - goal))
        new = GOAL_RE.sub(f"*일 {goal_man}만 목표* {pct}% · {tail}", new, count=1)
    # 안전장치: 바뀐 줄은 전환 값·총 증분·목표 줄뿐이어야 한다
    old_set, new_set = text.split("\n"), new.split("\n")
    removed = [ln for ln in old_set if ln not in new_set]
    added = [ln for ln in new_set if ln not in old_set]
    if len(removed) > 3 or len(added) != len(removed) or not all(
            ("총 증분" in ln or "만 목표" in ln or CONV_VALUE_RE.match(ln)) for ln in removed + added):
        return None, f"예상 외 변경(삭제 {removed} / 추가 {added})"
    return new, {"old_total": old_total, "new_total": new_total, "conv": conv, "old_conv": old_conv,
                 "pct": pct, "tail": tail}


def report_age_days(date, now_utc):
    """리포트 대상일이 KST 오늘로부터 며칠 전인가(default_dates와 같은 KST 기준)."""
    today_kst = (now_utc + dt.timedelta(hours=9)).date()
    return (today_kst - dt.date.fromisoformat(date)).days


def _slack(method, token, params=None, post=False):
    url = f"https://slack.com/api/{method}"
    hdr = {"Authorization": "Bearer " + token}
    if post:
        req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(),
                                     headers={**hdr, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8"})
    else:
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params or {}), headers=hdr)
    return json.load(urllib.request.urlopen(req, timeout=30))


def default_dates(now_utc, days):
    """KST 기준 어제부터 days일치 날짜(최신순). 어제분 리포트는 오늘 12:20에 나간다."""
    today_kst = (now_utc + dt.timedelta(hours=9)).date()
    return [(today_kst - dt.timedelta(days=i)).isoformat() for i in range(1, days + 1)]


_history = {"msgs": [], "cursor": None, "done": False, "pages": 0}


def find_report(token, date):
    """채널에서 그 날짜 증분 리포트(제목 줄 기준) 메시지를 찾는다. 반환은 매칭 목록(정확히 1건이어야 정상).
    채널 기록은 페이지 단위로 한 번만 읽어 날짜 간에 재사용한다(여러 날짜 실행 시 호출 수 절약)."""
    title = PRODUCTS[PRODUCT]["title"]

    def match(msg):
        # 제품명까지 본다 — 같은 채널의 다른 제품 리포트(쫀득바↔바치케)를 고치지 않게.
        return is_report_for(msg.get("text") or "", date, title) and msg.get("bot_id")

    while True:
        hits = [m for m in _history["msgs"] if match(m)]
        # 리포트는 최신순으로 쌓이므로, 이미 읽은 범위에 있으면 더 읽지 않는다
        if hits or _history["done"] or _history["pages"] >= 8:
            return hits
        p = {"channel": CHANNEL, "limit": 200}
        if _history["cursor"]:
            p["cursor"] = _history["cursor"]
        d = _slack("conversations.history", token, p)
        if not d.get("ok"):
            raise RuntimeError(f"history 실패: {d.get('error')}")
        _history["msgs"].extend(d.get("messages", []))
        _history["pages"] += 1
        _history["cursor"] = (d.get("response_metadata") or {}).get("next_cursor")
        if not _history["cursor"]:
            _history["done"] = True


def fetch_conversion(date, attempts=3, wait=5):
    """라우트(시트 조회)는 간헐 502를 낸다 → 몇 번 재시도. 끝내 실패하면 예외(호출부가 그 날짜만 실패 처리).
    전환 출처가 메타인 제품은 메타 라우트(/api/meta-ads-pbachi)의 P바치 전환 노출수."""
    base = os.environ["APP_URL"].rstrip("/")
    if PRODUCTS[PRODUCT]["conv"] == "meta":
        return fetch_meta_conversion(base, os.environ["CRON_SECRET"], date, attempts, wait)
    tab = PRODUCTS[PRODUCT]["tab"]
    req = urllib.request.Request(f"{base}/api/awareness-ads?date={urllib.parse.quote(date)}" + (f"&tab={tab}" if tab else ""),
                                 headers={"Authorization": "Bearer " + os.environ["CRON_SECRET"]})
    for i in range(attempts):
        try:
            d = json.load(urllib.request.urlopen(req, timeout=40))
            break
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(wait * (i + 1))
    if not d.get("found"):
        return None
    v = (d.get("conversion") or {}).get("views")
    return v if isinstance(v, (int, float)) else None


def main():
    token = os.environ["SLACK_BOT_TOKEN"]
    dry = (os.getenv("DRY_RUN") or "true").lower() == "true"
    overwrite = (os.getenv("OVERWRITE") or "false").lower() == "true"
    now_utc = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    dates = [s.strip() for s in (os.getenv("DATES") or "").split(",") if s.strip()]
    auto = not dates
    if not dates:
        dates = default_dates(now_utc, int(os.getenv("AUTO_DAYS") or 5))
    if PRODUCT not in PRODUCTS:
        print(f"알 수 없는 REPORT_PRODUCT={PRODUCT!r}")
        sys.exit(1)
    meta = PRODUCTS[PRODUCT]["conv"] == "meta"
    src = "메타 광고 관리자" if meta else "시트"
    final = (" / 확정값 덮어쓰기 " + ("강제" if overwrite else f"{FINAL_AGE_DAYS}일 경과분")) if meta else ""
    print(f"모드: {'DRY_RUN(편집 안 함)' if dry else 'APPLY'} / 제품 {PRODUCTS[PRODUCT]['title']} / 전환 출처 {src}{final}"
          f" / 채널 {CHANNEL} / 대상 {dates}")
    failed = 0
    for date in dates:
        try:
            conv = fetch_conversion(date)
        except Exception as e:  # 한 날짜의 조회 실패로 나머지 날짜까지 멈추지 않게
            print(f"[{date}] {src} 조회 실패(재시도 후) → 건너뜀: {e}")
            failed += 1
            continue
        if conv is None:
            print(f"[{date}] {src} 전환 조회수 없음(빈칸/행없음/집계 전) → 건너뜀")
            continue
        hits = find_report(token, date)
        if not hits and auto:
            # 자동 범위(최근 N일)에선 그날 리포트가 없을 수 있다 — 신규 제품 첫 주, 증가분 없어 발송 생략한 날.
            # 리포트 미발송 감지는 도착 워치독 몫이라 여기선 실패로 치지 않는다(매일 빨간불 방지).
            print(f"[{date}] 리포트 없음 → 건너뜀(자동 범위)")
            continue
        if len(hits) != 1:
            print(f"[{date}] 리포트 메시지 {len(hits)}건 → 건너뜀(정확히 1건이어야 함)")
            failed += 1
            continue
        msg = hits[0]
        text = msg.get("text") or ""
        if meta and CONV_VALUE_RE.search(text):
            age = report_age_days(date, now_utc)
            if not overwrite and age < FINAL_AGE_DAYS:
                print(f"[{date}] ts={msg['ts']} 건너뜀: 전환 값 있음, 확정 덮어쓰기는 {FINAL_AGE_DAYS}일 뒤(현재 {age}일)")
                continue
            new, info = replace_conversion_value(text, conv)
        else:
            new, info = patch_text(text, conv)
        if new is None:
            print(f"[{date}] ts={msg['ts']} 건너뜀: {info}")
            continue
        goal_txt = f" | 목표 {info['pct']}% · {info['tail']}" if info["pct"] else ""
        was = f" (기존 +{f(info['old_conv'])} → 확정값)" if "old_conv" in info else ""
        print(f"[{date}] ts={msg['ts']} 전환 +{f(info['conv'])}{was} | 총 증분 {f(info['old_total'])} → {f(info['new_total'])}{goal_txt}")
        if dry:
            continue
        r = _slack("chat.update", token, {"channel": CHANNEL, "ts": msg["ts"], "text": new}, post=True)
        if not r.get("ok"):
            print(f"[{date}] chat.update 실패: {r.get('error')}")
            failed += 1
            continue
        # 반영 확인(실물 재조회)
        chk = _slack("conversations.history", token,
                     {"channel": CHANNEL, "latest": msg["ts"], "inclusive": "true", "limit": 1})
        cur = ((chk.get("messages") or [{}])[0].get("text") or "")
        ok = f"    {CONV_LABEL} *+{f(info['conv'])}*" in cur and f"오늘 총 증분 *+{f(info['new_total'])}*" in cur
        print(f"[{date}] 편집 {'확인됨' if ok else '⚠️ 재조회 불일치'}")
        failed += 0 if ok else 1
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
