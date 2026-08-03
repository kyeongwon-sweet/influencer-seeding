#!/usr/bin/env python3
"""알림을 보내는 스크립트를 돌리는 워크플로 스텝에는 Slack 전달 키가 반드시 있어야 한다.

2026-08-03 실측 사고: `cron-daily-collect.yml`의 수집 스텝에 `SLACK_BOT_TOKEN`/`STATUS_USER`가
없어서 `run_monitoring._send_status_alert`가 **조용히 return** 했다. 실행 로그에는
`[ALERT] IG not_found 3일 연속, 검토 요청: ...` 이 찍혔지만 Slack에는 한 번도 도착하지 않았고,
IG 접근불가 74건이 아무 통보 없이 방치됐다(누적 조회수가 마지막 실측에서 정지).

전달 경로가 (봇토큰+채널) 또는 (웹훅) 두 가지뿐이라 **둘 다 없으면 예외도, 실패 로그도 남지 않는다.**
그래서 사람이 눈으로 발견할 때까지 알 수 없었다 → 계약을 테스트로 고정한다.

의존성 없음(stdlib). PyYAML 없이 텍스트로 스텝 블록을 자른다.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"

# 알림을 직접 보내는 스크립트 목록. 세 스크립트 모두 전달 규칙이 같다:
#   토큰(SLACK_BOT_TOKEN) + 수신처(STATUS_USER=DM 또는 SLACK_CHANNEL=채널) 가 있어야 실제로 보낸다.
ALERTING_SCRIPTS = ("run_monitoring.py", "notify_status.py", "cron_watchdog.py")
TOKEN_KEY = "SLACK_BOT_TOKEN"
DEST_KEYS = ("STATUS_USER", "SLACK_CHANNEL")  # 둘 중 하나면 됨
# 웹훅만으로도 전달되는 경우를 허용(이것만 있어도 통과)
WEBHOOK_KEY = "SLACK_WEBHOOK_URL"


def split_steps(text: str) -> list[str]:
    """`      - name:` 단위로 스텝 블록을 자른다(들여쓰기 6칸 기준, 이 repo 규약)."""
    idx = [m.start() for m in re.finditer(r"^      - (?:name|uses|id):", text, re.M)]
    if not idx:
        return []
    idx.append(len(text))
    return [text[idx[i]:idx[i + 1]] for i in range(len(idx) - 1)]


def check_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []
    has = lambda step, key: bool(re.search(rf"^\s*{key}\s*:", step, re.M))
    for step in split_steps(text):
        for script in ALERTING_SCRIPTS:
            if not re.search(rf"python\s+{re.escape(script)}", step):
                continue
            if has(step, WEBHOOK_KEY):
                continue
            missing = []
            if not has(step, TOKEN_KEY):
                missing.append(TOKEN_KEY)
            if not any(has(step, k) for k in DEST_KEYS):
                missing.append(" 또는 ".join(DEST_KEYS))
            if missing:
                name = (re.search(r"- name:\s*(.+)", step) or [None, "(이름 없음)"])[1].strip()
                problems.append(
                    f"{path.name} / 스텝 '{name}' — {script} 를 실행하는데 {', '.join(missing)} 없음"
                    " → Slack 알림이 조용히 사라진다"
                )
    return problems


def main() -> int:
    if not WORKFLOWS.is_dir():
        print(f"워크플로 디렉터리 없음: {WORKFLOWS}")
        return 1
    problems: list[str] = []
    checked = 0
    for path in sorted(WORKFLOWS.glob("*.yml")):
        checked += 1
        problems += check_file(path)
    if problems:
        print("🔴 알림 env 계약 위반")
        for p in problems:
            print("  - " + p)
        return 1
    print(f"✅ 알림 env 계약 통과 (워크플로 {checked}개 검사)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
