"""자정 수집 워크플로(cron-daily-collect.yml) 실행 역할 판정.

배경(2026-10-27): GitHub 예약 00:41 KST가 최근 31일 중앙값 +4시간 늦게 떴다(1시간 안 0일).
사용자: "최대한 00시 자정 가까이 수집되었으면 좋겠어".
→ 구글 Apps Script 트리거(00:05~00:35 KST)가 /api/ops/ensure-daily-collect 를 부르고, 그 라우트가
  이 워크플로를 final_snapshot=true 로 dispatch 한다(= 주 수집). GitHub 예약 3개는 남겨 두고,
  주 수집이 있으면 백업으로만 동작하게 이 스크립트가 역할을 정한다.

역할:
  primary  — 주 수집. 낮 시간 중간값까지 자정 최종값으로 다시 측정(FINAL_SNAPSHOT=1).
  backup   — 누락분만(VIEW_MISSING_TARGET_ONLY=1). 주 수집이 이미 끝났거나, 02:41·04:41 슬롯.
  deferred — 주 수집이 지금 돌고 있음 → 이번 실행은 수집하지 않는다(동시 수집 방지). 완료 마커도 안 찍는다.
  manual   — 그 밖의 수동 실행(복구·테스트). 기존 동작 그대로.

⚠️ '주 수집' 판정은 web/lib/collect-primary.ts 와 **같은 규칙**이어야 한다.
   오늘(KST) 00:00 이후 생성 + (제목에 [final_snapshot] 또는 02:30 KST 이전 생성 예약 실행).
⚠️ 이 스크립트는 절대 실패로 끝나지 않는다. GitHub API를 못 읽으면 예전 동작(00:41 슬롯=주 수집)으로 돌아간다.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from kst_dates import KST, kst_today

FINAL_SNAPSHOT_TAG = "[final_snapshot]"
PRIMARY_SCHEDULE = "41 15 * * *"
PRIMARY_SCHEDULE_CUTOFF = (2, 30)  # KST 시·분
RUNNING_STATUSES = {"queued", "in_progress", "waiting", "requested", "pending"}


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _kst_at(kdate: str, hour: int, minute: int) -> datetime:
    y, m, d = (int(x) for x in kdate.split("-"))
    return datetime(y, m, d, hour, minute, tzinfo=KST)


def is_primary_run(run: dict, kdate: str) -> bool:
    created = _parse_ts(run.get("created_at"))
    if created is None or created < _kst_at(kdate, 0, 0):
        return False
    if FINAL_SNAPSHOT_TAG in str(run.get("display_title") or ""):
        return True
    return run.get("event") == "schedule" and created < _kst_at(kdate, *PRIMARY_SCHEDULE_CUTOFF)


def primary_state(runs: list[dict], kdate: str, self_run_id: int | None = None) -> str:
    primary = [r for r in runs if r.get("id") != self_run_id and is_primary_run(r, kdate)]
    if any(r.get("status") in RUNNING_STATUSES for r in primary):
        return "running"
    if any(r.get("conclusion") == "success" for r in primary):
        return "done"
    return "none"


def decide_role(event: str, schedule: str, final_input: str, runs: list[dict] | None,
                kdate: str, self_run_id: int | None = None) -> tuple[str, str]:
    """(role, reason). runs=None 은 GitHub API 조회 실패."""
    if event == "workflow_dispatch":
        if str(final_input).lower() == "true":
            return "primary", "dispatch_final_snapshot"
        return "manual", "dispatch"
    if event != "schedule":
        return "manual", f"event_{event}"
    if runs is None:
        # 예전 동작으로 후퇴: 00:41 슬롯이 주 수집, 나머지는 백업.
        return ("primary", "api_error_legacy") if schedule == PRIMARY_SCHEDULE else ("backup", "api_error_legacy")
    state = primary_state(runs, kdate, self_run_id)
    if state == "running":
        return "deferred", "primary_running"
    if schedule == PRIMARY_SCHEDULE and state == "none":
        return "primary", "schedule_no_primary_yet"
    return "backup", f"primary_{state}" if state != "none" else "backup_slot"


def _list_today_runs(kdate: str) -> list[dict] | None:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY", "kyeongwon-sweet/influencer-seeding")
    since = _kst_at(kdate, 0, 0).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    query = urllib.parse.urlencode({"per_page": "50", "created": ">=" + since})
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/actions/workflows/cron-daily-collect.yml/runs?{query}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "collect-role",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp).get("workflow_runs") or []
    except Exception as exc:  # noqa: BLE001 — 어떤 실패든 예전 동작으로 후퇴
        print(f"[collect_role] GitHub 실행 목록 조회 실패: {exc}")
        return None


def main() -> int:
    event = os.environ.get("EVENT_NAME", "")
    schedule = os.environ.get("SCHEDULE", "")
    final_input = os.environ.get("FINAL_INPUT", "")
    run_id = os.environ.get("RUN_ID")
    kdate = kst_today()
    runs = _list_today_runs(kdate) if event == "schedule" else []
    role, reason = decide_role(event, schedule, final_input, runs, kdate, int(run_id) if run_id else None)
    print(f"[collect_role] kdate={kdate} event={event} schedule={schedule!r} final={final_input!r} → role={role} ({reason})")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"role={role}\nreason={reason}\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 — 역할 판정 실패로 수집 전체를 막지 않는다
        print(f"[collect_role] 판정 실패 → 예전 동작: {exc}")
        out = os.environ.get("GITHUB_OUTPUT")
        sched = os.environ.get("SCHEDULE", "")
        ev = os.environ.get("EVENT_NAME", "")
        if ev == "workflow_dispatch":
            fallback = "primary" if os.environ.get("FINAL_INPUT", "").lower() == "true" else "manual"
        else:
            fallback = "primary" if sched == PRIMARY_SCHEDULE else "backup"
        if out:
            with open(out, "a", encoding="utf-8") as fh:
                fh.write(f"role={fallback}\nreason=exception_legacy\n")
        sys.exit(0)
