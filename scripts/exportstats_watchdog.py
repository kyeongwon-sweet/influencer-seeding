#!/usr/bin/env python
"""exportStats(역채움 DB→시트) 결과 워치독.

목적: dailyAuto의 exportStats 단계가 **조용히 안 돌거나 실패**해 연동 시트의
어제(T-1) 조회수 열이 안 채워지는 사고를 매일 자동 감지해 Slack으로 알린다.

배경(2026-09-07): dailyAuto가 importStats→exportStats 직렬이라, importStats가
Apps Script 30분 상한을 넘겨 종료되자 뒤의 exportStats가 통째로 스킵됐다. 값은
DB에 정상 수집돼 있었는데 시트에만 안 써졌고, **사람이 스크린샷으로 발견**했다
(전형적 조용한 실패). Codex가 단계 분리+내부 재개를 넣고 exportStats 성공 시
`jobs` 테이블에 하트비트를 남기게 했다. 이 워치독은 그 하트비트를 외부(GHA)에서
마감기준으로 확인해, **트리거 자체가 안 뜨는 경우까지** 잡는 defense-in-depth다.

판정(마감기준):
  · jobs에서 payload.job='exportStats'인 최신 행을 읽는다.
  · run_date(=exportStats가 기록한 대상일, 보통 T-1)가 어제 이상이고 status='done'이면 OK.
    (run_date가 어제까지 올라왔다 = 오늘 export가 실제로 돌았다는 뜻)
  · 하트비트 없음 / run_date가 어제 미만 / status!=done 이면 ALERT.

읽기 전용(jobs 조회만). DB·시트 변경 없음. --send 없으면 콘솔 출력만.
scripts/db_probe.py의 load_env(정본 env 자동 탐색)·_request를 재사용한다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db_probe as db  # noqa: E402

KST = timezone(timedelta(hours=9))
SLACK_TOKEN = os.getenv("INJIBOT_SLACK_TOKEN")
SLACK_CHANNEL = os.getenv("EXPORTSTATS_WATCHDOG_SLACK_CHANNEL", "C0B659HEYDV")  # #빙과_마케팅_스틱바p


def latest_exportstats_heartbeat(env) -> dict | None:
    """jobs에서 payload.job='exportStats'인 최신 행 1건."""
    body, _ = db._request(
        env,
        "jobs",
        {
            "select": "id,type,status,payload,updated_at",
            "payload->>job": "eq.exportStats",
            "order": "updated_at.desc",
            "limit": 1,
        },
    )
    rows = json.loads(body) if body else []
    return rows[0] if rows else None


def evaluate(hb: dict | None, today: date) -> dict:
    expected_run_date = today - timedelta(days=1)  # exportStats는 T-1을 기록
    result = {
        "date": today.isoformat(),
        "expected_run_date": expected_run_date.isoformat(),
        "status": "ALERT",
        "reason": "",
        "heartbeat": None,
    }
    if not hb:
        result["reason"] = "exportStats 하트비트가 jobs에 전혀 없음(기록 경로 자체 이상 의심)."
        return result
    payload = hb.get("payload") or {}
    run_date_raw = str(payload.get("run_date") or "")[:10]
    job_status = str(hb.get("status") or "")
    result["heartbeat"] = {
        "run_date": run_date_raw,
        "job_status": job_status,
        "source": payload.get("source"),
        "updated_at": str(hb.get("updated_at"))[:19],
    }
    try:
        run_date = date.fromisoformat(run_date_raw)
    except ValueError:
        result["reason"] = f"하트비트 run_date 파싱 실패: {run_date_raw!r}"
        return result
    if job_status != "done":
        result["reason"] = f"최신 exportStats 하트비트 status={job_status} (done 아님)."
        return result
    if run_date < expected_run_date:
        result["reason"] = (
            f"exportStats가 어제({expected_run_date})분을 아직 안 기록 "
            f"(최신 run_date={run_date}). dailyAuto export 단계 미실행/실패 의심."
        )
        return result
    result["status"] = "OK"
    result["reason"] = f"exportStats run_date={run_date} (>= 어제 {expected_run_date}), status=done."
    return result


def slack_text(r: dict) -> str:
    hb = r.get("heartbeat")
    hb_line = (
        f"\n• 최신 하트비트: run_date={hb['run_date']} · status={hb['job_status']} · {hb['updated_at']}"
        if hb else "\n• 최신 하트비트: 없음"
    )
    return (
        f":rotating_light: *exportStats 미실행/미완료 의심* — 연동 시트 T-1({r['expected_run_date']}) "
        f"조회수 열이 안 채워졌을 수 있음\n• 사유: {r['reason']}{hb_line}\n"
        f"• 조치: dailyAuto export 단계(또는 시트 메뉴 역채움) 실행 확인. 값은 DB엔 정상일 수 있음(시트 반영만 누락)."
    )


def send_slack(text: str) -> None:
    if not SLACK_TOKEN:
        print("[WARN] INJIBOT_SLACK_TOKEN 없음 — 발송 스킵")
        return
    data = json.dumps({"channel": SLACK_CHANNEL, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=data,
        headers={
            "Authorization": f"Bearer {SLACK_TOKEN}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    resp = json.load(urllib.request.urlopen(req, timeout=30))
    print("[SLACK]", "ok" if resp.get("ok") else f"FAIL {resp.get('error')}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=datetime.now(KST).date().isoformat())
    parser.add_argument("--send", action="store_true", help="ALERT 시 Slack 발송")
    args = parser.parse_args()

    env = db.load_env()
    hb = latest_exportstats_heartbeat(env)
    result = evaluate(hb, date.fromisoformat(args.date))
    print("[EXPORTSTATS_WATCHDOG]", json.dumps(result, ensure_ascii=False))
    if result["status"] == "ALERT":
        text = slack_text(result)
        print(text)
        if args.send:
            send_slack(text)
    else:
        print("✅ exportStats 정상 — ", result["reason"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
