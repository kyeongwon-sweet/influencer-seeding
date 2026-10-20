"""인지봇 '자정 수집' 보고 스레드 — 수집 관련 알림은 그날 보고의 **댓글**로 단다(단일 정본).

2026-10-19 사용자·팀 요청:
  · "이런 오류 스레드 댓글로 달기로 했잖아" — 09:16 '수집 사각 감지'가 채널에 새 글로 올라왔다.
  · 최서은: "인지봇 수집 보고도 스레드 형식 + 담당자 태그로" (손익트래커봇처럼 제목 한 줄 + 댓글).

그래서
  · 일일 보고(daily_collect_report)는 채널에 **제목 한 줄**만 올리고 내용은 댓글로 단다.
  · 수집 사각(view_tracking_watchdog)·exportStats(exportstats_watchdog) 경보는 그날 보고 스레드의
    댓글로, 담당자 태그를 붙여 단다.
  · 보고가 아직 없으면 잠시 기다리고, 끝내 없으면 **채널에 바로** 올린다 — 경보가 조용히 사라지는
    것보다 위치가 어긋나는 게 낫다(누락 < 중복 원칙, 리포트 idempotency 와 같은 정책).
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

KST = timezone(timedelta(hours=9))
REPORT_KEYWORD = "자정 수집"
# 제품군별 기본 담당자(2026-10-19 사용자 지정). 알림에 걸린 글의 제품으로 고른다.
#   파인트 = 이재원 · 김보나 / 쫀득바 = 김바다 · 권예원
# 제품을 모르거나 글과 무관한 알림(exportStats 등)은 두 팀 전원 — 누구에게도 안 가는 것보다 낫다.
# 전체를 한 번에 바꾸려면 GHA 변수 COLLECT_ALERT_ASSIGNEES(쉼표 목록)가 이 표보다 우선한다.
PRODUCT_ASSIGNEES = {
    "파인트": ["U09RCJ1B9ML", "U0C0W2V4X4G"],  # 이재원, 김보나
    "쫀득바": ["U08S4MCC4HY", "U0C7QDL5GHF"],  # 김바다, 권예원
}
ALL_ASSIGNEES = [u for ids in PRODUCT_ASSIGNEES.values() for u in ids]


def product_group(product: str | None) -> str | None:
    """제품코드/상품명 → 담당 제품군. P바치처럼 한글 2자 코드도 파인트(2026-10-16 결정)."""
    v = re.sub(r"\s+", "", str(product or ""))
    if re.fullmatch(r"P[가-힣]+", v) or v.endswith("파인트"):
        return "파인트"
    if re.fullmatch(r"JD[가-힣]+", v) or "쫀득" in v:
        return "쫀득바"
    return None


def assignees_for(products=None, env: dict | None = None) -> list[str]:
    """알림에 걸린 글들의 제품으로 태그할 사람. 하나라도 제품을 모르면(또는 글 무관 알림) 전원."""
    raw = (env if env is not None else os.environ).get("COLLECT_ALERT_ASSIGNEES") or ""
    override = [x.strip() for x in raw.split(",") if x.strip()]
    if override:
        return override
    items = list(products or [])
    groups = [product_group(p) for p in items]
    if not items or any(g is None for g in groups):
        return list(ALL_ASSIGNEES)
    out: list[str] = []
    for g in groups:
        for u in PRODUCT_ASSIGNEES[g]:
            if u not in out:
                out.append(u)
    return out

Api = Callable[[str, dict], dict]


def report_title(status_word: str, today: str, attention: int = 0) -> str:
    """채널에 올라가는 보고 제목 한 줄. ⚠️ '자정 수집'과 '(YYYY-MM-DD)'는 중복 발송 판정·스레드 찾기의
    열쇠라 빼면 안 된다."""
    # 2026-10-20 사용자 지정 양식: 제목 굵게 + 날짜, 확인 필요가 있으면 다음 줄에 건수.
    #   :bar_chart: *자정 수집 성공 알림* (2026-10-20)
    #    — 확인 필요 8건
    title = ":bar_chart: *%s %s 알림* (%s)" % (REPORT_KEYWORD, status_word, today)
    if attention:
        title += "\n — 확인 필요 %d건" % attention
    return title


def is_report_message(text: str | None, today: str) -> bool:
    t = text or ""
    return REPORT_KEYWORD in t and ("(%s)" % today) in t


def find_report_ts(messages: list[dict], today: str) -> str | None:
    """채널 history 에서 오늘 보고(최상위 글)의 ts. 스레드 댓글·다른 날 보고는 무시한다."""
    for m in messages:
        thread_ts = m.get("thread_ts")
        if thread_ts and thread_ts != m.get("ts"):
            continue  # 남의 스레드에 달린 댓글
        if is_report_message(m.get("text"), today):
            return m.get("ts")
    return None


def mention_prefix(env: dict | None = None, products=None) -> str:
    ids = assignees_for(products, env)
    return " ".join("<@%s>" % x for x in ids) + " " if ids else ""


def slack_api(token: str) -> Api:
    def call(method: str, payload: dict) -> dict:
        if method == "conversations.history":
            req = urllib.request.Request(
                "https://slack.com/api/conversations.history?" + urllib.parse.urlencode(payload),
                headers={"Authorization": "Bearer " + token})
        else:
            req = urllib.request.Request(
                "https://slack.com/api/" + method, data=json.dumps(payload).encode("utf-8"), method="POST",
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"})
        return json.load(urllib.request.urlopen(req, timeout=30))
    return call


def _day_start_epoch(today: str) -> str:
    d = datetime.fromisoformat(today).replace(tzinfo=KST)
    return str(int(d.timestamp()))


def post_to_report_thread(api: Api, channel: str, text: str, today: str, *,
                          wait_seconds: int = 0, poll_seconds: int = 60,
                          sleep: Callable[[float], None] = time.sleep) -> dict:
    """오늘 보고 스레드에 댓글로 단다. 반환: {"ok", "where": "thread"|"channel", "ts", "error"}"""
    deadline = time.monotonic() + max(0, wait_seconds)
    parent = None
    while True:
        hist = api("conversations.history", {"channel": channel, "oldest": _day_start_epoch(today), "limit": 200})
        if hist.get("ok"):
            parent = find_report_ts(hist.get("messages") or [], today)
        else:
            print("[report-thread] history 조회 실패(%s)" % hist.get("error"))
        if parent or time.monotonic() >= deadline:
            break
        print("[report-thread] 오늘(%s) 자정 수집 보고가 아직 없음 → %d초 뒤 다시 확인" % (today, poll_seconds))
        sleep(poll_seconds)

    if parent:
        r = api("chat.postMessage", {"channel": channel, "thread_ts": parent, "text": text})
        where = "thread"
    else:
        note = "ℹ️ 오늘(%s) 자정 수집 보고가 아직 없어 채널에 바로 올립니다.\n" % today
        r = api("chat.postMessage", {"channel": channel, "text": note + text})
        where = "channel"
    print("[report-thread]", where, "ok" if r.get("ok") else "FAIL %s" % r.get("error"))
    return {"ok": bool(r.get("ok")), "where": where, "ts": r.get("ts"), "error": r.get("error")}
