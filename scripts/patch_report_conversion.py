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
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

CHANNEL = os.getenv("SLACK_CHANNEL") or "C0B4F7GBX17"  # #빙과_마케팅_리포트

TOTAL_RE = re.compile(r"오늘 총 증분 \*\+([\d,]+)\*")
# 이모지는 Slack이 단축코드(:dart:)로 돌려줄 수 있어 패턴에서 제외
GOAL_RE = re.compile(r"\*일 (\d+)만 목표\* \d+% · (?:달성 \+|미달 -)[\d,]+")
CONV_LABEL = "전환 조회수"


def f(n):
    return f"{n:,}"


def patch_text(text, conv):
    """(new_text, info) 반환. 고칠 수 없거나 고칠 필요 없으면 (None, 사유)."""
    if CONV_LABEL in text:
        return None, "이미 전환 조회수 줄 있음"
    conv = round(conv)
    m = TOTAL_RE.search(text)
    g = GOAL_RE.search(text)
    if not m or not g:
        return None, "총 증분/목표 줄 형식을 찾지 못함"
    old_total = int(m.group(1).replace(",", ""))
    goal_man = int(g.group(1))
    goal = goal_man * 10000
    new_total = old_total + conv

    lines = text.split("\n")
    sec = next((i for i, ln in enumerate(lines) if "*인지 광고*" in ln), None)
    if sec is not None:
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
    pct = f"{new_total / (goal / 100):.0f}"
    tail = ("달성 +" + f(new_total - goal)) if new_total >= goal else ("미달 " + f(new_total - goal))
    new = GOAL_RE.sub(f"*일 {goal_man}만 목표* {pct}% · {tail}", new, count=1)

    # 안전장치: 바뀐 줄이 정확히 총 증분·목표 두 줄이고, 추가된 줄은 전환/섹션 줄뿐인지 확인
    old_set, new_set = text.split("\n"), new.split("\n")
    removed = [ln for ln in old_set if ln not in new_set]
    added = [ln for ln in new_set if ln not in old_set]
    if len(removed) != 2 or not all(("총 증분" in ln or "만 목표" in ln) for ln in removed):
        return None, f"예상 외 변경(삭제 {removed})"
    if any(not ("총 증분" in ln or "만 목표" in ln or CONV_LABEL in ln or "*인지 광고*" in ln or ln == "")
           for ln in added):
        return None, f"예상 외 변경(추가 {added})"
    return new, {"old_total": old_total, "new_total": new_total, "conv": conv, "pct": pct, "tail": tail}


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
    def match(msg):
        first = (msg.get("text") or "").split("\n", 1)[0]
        return "일일 증분" in first and f"`({date})`" in first and msg.get("bot_id")

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


def fetch_conversion(date):
    base = os.environ["APP_URL"].rstrip("/")
    req = urllib.request.Request(f"{base}/api/awareness-ads?date={urllib.parse.quote(date)}",
                                 headers={"Authorization": "Bearer " + os.environ["CRON_SECRET"]})
    d = json.load(urllib.request.urlopen(req, timeout=40))
    if not d.get("found"):
        return None
    v = (d.get("conversion") or {}).get("views")
    return v if isinstance(v, (int, float)) else None


def main():
    token = os.environ["SLACK_BOT_TOKEN"]
    dry = (os.getenv("DRY_RUN") or "true").lower() == "true"
    dates = [s.strip() for s in (os.getenv("DATES") or "").split(",") if s.strip()]
    if not dates:
        dates = default_dates(dt.datetime.now(dt.timezone.utc).replace(tzinfo=None), int(os.getenv("AUTO_DAYS") or 5))
    print(f"모드: {'DRY_RUN(편집 안 함)' if dry else 'APPLY'} / 채널 {CHANNEL} / 대상 {dates}")
    failed = 0
    for date in dates:
        conv = fetch_conversion(date)
        if conv is None:
            print(f"[{date}] 시트 전환 조회수 없음(빈칸/행없음) → 건너뜀")
            continue
        hits = find_report(token, date)
        if len(hits) != 1:
            print(f"[{date}] 리포트 메시지 {len(hits)}건 → 건너뜀(정확히 1건이어야 함)")
            failed += 1
            continue
        msg = hits[0]
        new, info = patch_text(msg.get("text") or "", conv)
        if new is None:
            print(f"[{date}] ts={msg['ts']} 건너뜀: {info}")
            continue
        print(f"[{date}] ts={msg['ts']} 전환 +{f(info['conv'])} | 총 증분 {f(info['old_total'])} → {f(info['new_total'])}"
              f" | 목표 {info['pct']}% · {info['tail']}")
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
        ok = CONV_LABEL in cur and f"*+{f(info['new_total'])}*" in cur
        print(f"[{date}] 편집 {'확인됨' if ok else '⚠️ 재조회 불일치'}")
        failed += 0 if ok else 1
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
