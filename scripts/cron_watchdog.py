#!/usr/bin/env python3
"""자동화 워치독 — 실패한 크론 + '아예 안 돈' 크론을 Slack으로 알린다.

2026-07-30 사고 교훈: 자정수집이 3회 전부 KeyError로 죽었는데 **아무 알림이 없어** 아침에
사람이 발견했다(7/29 자동수집 데이터 전량 누락). 실패는 GitHub Actions 화면에만 남았다.
또한 실패가 아니라 **스케줄 미발화**(GitHub 지연·스킵)로 조용히 안 도는 경우도 있어,
'최근 성공이 기대 주기보다 오래됐다'는 신선도 검사가 함께 필요하다.

읽기 전용(GitHub API 조회 + Slack 발송). 의존성 없음(stdlib).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# 워크플로 파일명 → 최근 성공이 이 시간(h)보다 오래되면 '안 돌았음'으로 경고
FRESHNESS_HOURS: dict[str, float] = {
    "cron-daily-collect.yml": 26,        # 매일 00:41 KST(+백업 2회)
    "injibot-daily-report.yml": 26,      # 매일 06:38 KST
    "formula-audit.yml": 26,             # 매일 10:10 KST
    "monitoring-validate.yml": 26,       # 매일 01:00 KST
    "cron-kpi.yml": 26,                  # 매일 10:05 KST
    "banner-reach-sync.yml": 3,          # 매시간 17분
}
FAILURE_CONCLUSIONS = {"failure", "timed_out", "cancelled", "startup_failure"}


def _api(path: str, token: str) -> dict:
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "cron-watchdog",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def kst(ts: str) -> str:
    return (datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(hours=9)).strftime("%m-%d %H:%M")


def classify_failures(runs: list[dict], now: datetime, window_min: int) -> list[str]:
    """최근 window_min 분 내 실패/취소/타임아웃 런을 알림 줄로. 순수 함수 — 테스트 대상."""
    out: list[str] = []
    cutoff = now - timedelta(minutes=window_min)
    for r in runs:
        if r.get("conclusion") not in FAILURE_CONCLUSIONS:
            continue
        updated = datetime.fromisoformat(str(r.get("updated_at", "")).replace("Z", "+00:00"))
        if updated < cutoff:
            continue
        out.append(
            f"❌ {r.get('name')} — {r.get('conclusion')} ({kst(r['updated_at'])} KST) {r.get('html_url', '')}"
        )
    return out


def check_freshness(last_success: dict[str, str | None], now: datetime) -> list[str]:
    """워크플로별 '최근 성공 시각'이 기대 주기를 넘겼는지. 순수 함수 — 테스트 대상.

    ⚠️ 전체 런 목록(per_page=100)에서 찾으면 실행량 많은 날 오래된 성공이 밀려나 오탐이 난다.
    반드시 워크플로별 last-success 조회 결과를 넣을 것(main에서 그렇게 호출).
    """
    stale: list[str] = []
    for wf, max_age in FRESHNESS_HOURS.items():
        ts = last_success.get(wf)
        if not ts:
            stale.append(f"⚠️ {wf} — 성공 기록 없음(스케줄 미발화/전면 실패 의심)")
            continue
        age_h = (now - datetime.fromisoformat(ts.replace("Z", "+00:00"))).total_seconds() / 3600
        if age_h > max_age:
            stale.append(
                f"⚠️ {wf} — 최근 성공이 {age_h:.1f}시간 전({kst(ts)} KST), 기대 주기 {max_age:g}h 초과"
            )
    return stale


def fetch_last_success(repo: str, wf: str, token: str) -> str | None:
    """워크플로 파일명 기준 가장 최근 성공 런의 updated_at(ISO) 또는 None."""
    try:
        data = _api(f"/repos/{repo}/actions/workflows/{wf}/runs?status=success&per_page=1", token)
    except urllib.error.HTTPError as e:
        print(f"[watchdog] {wf} 조회 실패 HTTP {e.code}")
        return None
    runs = data.get("workflow_runs", [])
    return str(runs[0]["updated_at"]) if runs else None


def notify(text: str) -> None:
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("STATUS_USER") or os.environ.get("SLACK_CHANNEL")
    if not token or not channel:
        print("[watchdog] Slack 미설정 — 콘솔 출력만")
        print(text)
        return
    body = json.dumps({"channel": channel, "text": text}).encode("utf-8")
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            resp = json.loads(res.read().decode("utf-8"))
        if not resp.get("ok"):
            print(f"[watchdog] Slack 실패: {resp.get('error')}")
    except urllib.error.URLError as e:
        print(f"[watchdog] Slack 예외: {e}")


def main() -> int:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY", "kyeongwon-sweet/influencer-seeding")
    window_min = int(os.environ.get("WINDOW_MIN", "70"))
    dry = os.environ.get("DRY_RUN") == "1"
    if not token:
        print("[watchdog] GH_TOKEN/GITHUB_TOKEN 없음")
        return 1

    data = _api(f"/repos/{repo}/actions/runs?per_page=100", token)
    runs = data.get("workflow_runs", [])
    now = datetime.now(timezone.utc)
    failures = classify_failures(runs, now, window_min)
    last_success = {wf: fetch_last_success(repo, wf, token) for wf in FRESHNESS_HOURS}
    stale = check_freshness(last_success, now)

    if not failures and not stale:
        print(f"[watchdog] ✅ 이상 없음 — 조회 {len(runs)}건, 최근 {window_min}분 실패 0, 신선도 경고 0")
        return 0

    lines = [f"🔴 [자동화 워치독] {repo}"]
    if failures:
        lines.append(f"*최근 {window_min}분 실패 {len(failures)}건*")
        lines += ["• " + f for f in failures[:8]]
    if stale:
        lines.append(f"*미발화/지연 의심 {len(stale)}건*")
        lines += ["• " + s for s in stale[:8]]
    text = "\n".join(lines)
    print(text)
    if not dry:
        notify(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
