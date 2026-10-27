"""수집 사전점검(Check today) 실패 DM — DB 없이 동작한다.

재발방지(2026-10-24~26 사고): Supabase 무료 egress 한도 초과로 모든 DB 요청이 402가 됐다.
'Check today' 가 실패하면 decide 가 skipped 되고, 기존 '수집 실패 시 알럿'(notify_status)은
go=='1' 일 때만 돌고 본문도 DB 를 읽으므로 **아무 알림도 없었다**(원인 402 는 로그에만 있었다).
여기는 점검 로그 끝부분만 Slack 으로 보낸다. DB·외부 모듈 import 없음.
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request

SLACK_API = "https://slack.com/api/chat.postMessage"
EGRESS_MARK = "exceed_egress_quota"


def build_text(log_text: str, run_url: str = "") -> str:
    """순수 함수 — 테스트 대상."""
    lines = (log_text or "").strip().splitlines()
    tail = "\n".join(lines[-12:]) or "(점검 로그 없음)"
    if EGRESS_MARK in (log_text or ""):
        head = ("*🚨 Supabase 전송량(egress) 한도 초과 — DB 정지, 수집 못 함*\n"
                "모든 DB 요청이 402. 플랜 업그레이드 또는 spend cap 해제 전까지 수집·리포트·대시보드·시트 연동이 전부 멈춘다.")
    else:
        head = "*❌ 수집 사전점검 실패 — 수집이 시작되지 않았다*"
    text = f"{head}\n사유(점검 로그 끝부분):\n```{tail[:1500]}```"
    if run_url:
        text += f"\n실행: {run_url}"
    return text


def main() -> None:
    path = os.getenv("CHECK_LOG") or ""
    log_text = ""
    if path and os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as f:
            log_text = f.read()
    text = build_text(log_text, os.getenv("RUN_URL") or "")
    data = urllib.parse.urlencode({"channel": os.environ["STATUS_USER"], "text": text}).encode()
    req = urllib.request.Request(SLACK_API, data=data, headers={
        "Authorization": "Bearer " + os.environ["SLACK_BOT_TOKEN"],
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    })
    r = json.load(urllib.request.urlopen(req, timeout=30))
    print("[precheck-alert] ok=", r.get("ok"), "error=", r.get("error"))
    assert r.get("ok"), r


if __name__ == "__main__":
    main()
