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
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Callable

KST = timezone(timedelta(hours=9))
REPORT_KEYWORD = "자정 수집"
# 수집 파이프라인 운영 담당(황경원). 바꿀 땐 GHA 변수 COLLECT_ALERT_ASSIGNEES(쉼표 목록)로.
DEFAULT_ASSIGNEES = "U0B2Y0ZC8QZ"

Api = Callable[[str, dict], dict]


def report_title(status_word: str, today: str, attention: int = 0) -> str:
    """채널에 올라가는 보고 제목 한 줄. ⚠️ '자정 수집'과 '(YYYY-MM-DD)'는 중복 발송 판정·스레드 찾기의
    열쇠라 빼면 안 된다."""
    title = "📊 %s %s 알림 (%s)" % (REPORT_KEYWORD, status_word, today)
    if attention:
        title += " — 확인 필요 %d건" % attention
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


def mention_prefix(env: dict | None = None) -> str:
    raw = (env if env is not None else os.environ).get("COLLECT_ALERT_ASSIGNEES") or DEFAULT_ASSIGNEES
    ids = [x.strip() for x in raw.split(",") if x.strip()]
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
