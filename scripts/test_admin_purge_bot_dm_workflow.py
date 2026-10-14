"""admin-purge-bot-dm.yml 의 셸 로직을 가짜 Slack 응답으로 실제 실행해 검증한다.

2026-10-14 재발방지: 사람이 넣은 D… 채널(D0B2U2J8QNS)과 봇 토큰이 해석한 DM(D0B8FHE8R0A)이
달랐다. 실행했다면 되돌릴 수 없는 삭제가 다른 방에서 일어날 뻔했다. 그래서
  · dry-run은 토큰 봇·대화 상대·최근 봇 메시지 견본을 보여 주고
  · 실제 삭제는 confirm='DELETE <해석된 채널ID>' 일 때만 진행한다.
정적 문자열 검사로는 bash/jq 흐름이 깨져도 못 잡으므로 run 블록을 그대로 돌린다.
(jq 가 있는 CI(ubuntu)에서는 반드시 실행 — 없으면 skip 이 아니라 실패)
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "admin-purge-bot-dm.yml"

_HAVE_TOOLS = shutil.which("jq") is not None and shutil.which("bash") is not None
if not _HAVE_TOOLS and os.environ.get("GITHUB_ACTIONS") == "true":
    raise RuntimeError("CI에는 jq·bash 가 있어야 이 회귀 테스트가 실제로 돈다")
pytestmark = pytest.mark.skipif(not _HAVE_TOOLS, reason="로컬에 jq/bash 없음 — CI에서 실행")

MOCK_SLACK = r'''
curl() {
  local all="$*"
  echo "$all" >> "$CALLS"
  case "$all" in
    *auth.test*) echo '{"ok":true,"user":"yeomunbot","bot_id":"B_SELF","team":"lala"}' ;;
    *conversations.open*) echo '{"ok":true,"channel":{"id":"D_RESOLVED"}}' ;;
    *conversations.info*) echo '{"ok":true,"channel":{"user":"U0B2Y0ZC8QZ"}}' ;;
    *conversations.history*) echo '{"ok":true,"messages":[
        {"ts":"3.000003","bot_id":"B_SELF","text":"최신 알림\n둘째줄"},
        {"ts":"2.000002","bot_id":"B_OTHER","text":"다른 봇"},
        {"ts":"1.000001","user":"U1","text":"사람"}],
      "response_metadata":{"next_cursor":""}}' ;;
    *chat.delete*) echo '{"ok":true}' ;;
    *) echo '{"ok":false,"error":"unmocked"}' ;;
  esac
}
sleep() { :; }
'''


def _run_block() -> str:
    text = WORKFLOW.read_text(encoding="utf-8")
    step = text[text.index("- name: Purge bot DM messages"):]
    body = step[step.index("run: |\n") + len("run: |\n"):]
    lines = []
    for line in body.splitlines():
        if line.strip() and not line.startswith(" " * 10):
            break  # 블록 스칼라 들여쓰기(10칸) 밖 = 다음 YAML 키
        lines.append(line)
    return textwrap.dedent("\n".join(lines))


def _run(**env_over: str) -> tuple[int, str, str]:
    with tempfile.TemporaryDirectory() as tmp:
        calls = Path(tmp) / "calls.log"
        calls.write_text("", encoding="utf-8")
        script = Path(tmp) / "run.sh"
        script.write_text(MOCK_SLACK + "\n" + _run_block(), encoding="utf-8")
        env = {
            **os.environ,
            "SLACK_BOT_TOKEN": "xoxb-test",
            "CHANNEL": "U0B2Y0ZC8QZ",
            "BEFORE": "",
            "TS_LIST": "",
            "MAX": "200",
            "DRY_RUN": "true",
            "CONFIRM": "",
            "TOKEN_SOURCE": "github",
            "CRON_SECRET": "cron-test",
            "APP_URL": "https://example.invalid",
            "CALLS": str(calls),
        }
        env.update(env_over)
        proc = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True)
        return proc.returncode, proc.stdout + proc.stderr, calls.read_text(encoding="utf-8")


def test_dry_run_shows_which_bot_and_which_room_and_deletes_nothing() -> None:
    rc, out, calls = _run()
    assert rc == 0, out
    assert "토큰 봇: yeomunbot (bot_id=B_SELF" in out
    assert "대상 방: D_RESOLVED · 대화 상대: U0B2Y0ZC8QZ" in out
    assert "봇 메시지 1건" in out  # 이 토큰 봇 것만 센다
    assert "다른 봇 메시지 1건" in out
    assert "최신 알림 둘째줄" in out  # 맞는 방인지 눈으로 확인할 견본(줄바꿈 평탄화)
    assert "confirm='DELETE D_RESOLVED'" in out
    assert "chat.delete" not in calls


def test_bare_delete_confirm_is_rejected_before_any_slack_call() -> None:
    rc, out, calls = _run(DRY_RUN="false", CONFIRM="DELETE")
    assert rc != 0
    assert "DELETE <채널ID>" in out
    assert calls == ""


def test_confirm_for_a_different_room_never_deletes() -> None:
    # 사람이 본 예전 방 ID로 확인했는데 봇은 다른 방을 잡은 상황(2026-10-14 실제 케이스)
    rc, out, calls = _run(DRY_RUN="false", CONFIRM="DELETE D0B2U2J8QNS")
    assert rc != 0
    assert "확인 문자열이 해석된 방과 다릅니다" in out
    assert "DELETE D_RESOLVED" in out
    assert "chat.delete" not in calls


def test_confirm_bound_to_resolved_room_deletes_only_own_bot_messages() -> None:
    rc, out, calls = _run(DRY_RUN="false", CONFIRM="DELETE D_RESOLVED")
    assert rc == 0, out
    assert "삭제 1건 / 실패 0건 / 발견 1건" in out
    deletes = [c for c in calls.splitlines() if "chat.delete" in c]
    assert len(deletes) == 1 and "ts=3.000003" in deletes[0]


def test_ts_list_keeps_original_user_destination_instead_of_opening_app_dm() -> None:
    rc, out, calls = _run(
        TS_LIST="3.000003",
        DRY_RUN="false",
        CONFIRM="DELETE U0B2Y0ZC8QZ",
    )
    assert rc == 0, out
    assert "원래 메시지 대상 사용자 ID 유지: U0B2Y0ZC8QZ" in out
    assert "conversations.open" not in calls
    deletes = [c for c in calls.splitlines() if "chat.delete" in c]
    assert len(deletes) == 1
    assert "channel=U0B2Y0ZC8QZ" in deletes[0]
    assert "ts=3.000003" in deletes[0]
    assert "as_user=true" in deletes[0]
