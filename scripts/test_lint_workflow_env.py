#!/usr/bin/env python3
"""lint_workflow_env 단위 테스트 — 2026-07-30 실사고 스니펫을 회귀 케이스로 고정."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lint_workflow_env import scan_text  # noqa: E402

# 실제 사고 코드(3702ae9): export 없이 쉘 변수만 설정 → python이 KeyError
BAD = """
jobs:
  collect:
    steps:
      - name: queue
        run: |
          TODAY=$(date +%F)
          SUMMARY_FILE="$RUNNER_TEMP/view_missing_queue_${TODAY}.json"
          RETRYABLE=$(python -c "import json, os; print(json.load(open(os.environ['SUMMARY_FILE']))['retryable_count'])")
"""

# 수정본(f3664e6): export 추가
GOOD_EXPORT = """
jobs:
  collect:
    steps:
      - name: queue
        run: |
          TODAY=$(date +%F)
          export SUMMARY_FILE="$RUNNER_TEMP/view_missing_queue_${TODAY}.json"
          RETRYABLE=$(python -c "import json, os; print(json.load(open(os.environ['SUMMARY_FILE']))['retryable_count'])")
"""

# step env: 로 주입하는 정상 패턴(export 불필요)
GOOD_ENV_MAPPING = """
jobs:
  alert:
    steps:
      - name: notify
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: |
          python3 -c "import os; print(os.environ['SLACK_BOT_TOKEN'][:3])"
"""

# $GITHUB_ENV 로 넘기는 패턴도 정상
GOOD_GITHUB_ENV = """
jobs:
  a:
    steps:
      - run: |
          echo "KDATE=$(date +%F)" >> "$GITHUB_ENV"
      - run: |
          python -c "import os; print(os.environ['KDATE'])"
"""

# 읽지 않는 쉘 변수는 문제 아님
GOOD_UNREAD = """
jobs:
  a:
    steps:
      - run: |
          TMP_PATH=/tmp/x.json
          cat "$TMP_PATH" || true
"""


def main() -> int:
    failures: list[str] = []

    bad = scan_text(BAD, "bad.yml")
    if len(bad) != 1 or "SUMMARY_FILE" not in bad[0]:
        failures.append(f"사고 스니펫을 못 잡음: {bad}")

    for name, text in (
        ("export 수정본", GOOD_EXPORT),
        ("step env 주입", GOOD_ENV_MAPPING),
        ("GITHUB_ENV 전달", GOOD_GITHUB_ENV),
        ("읽지 않는 쉘 변수", GOOD_UNREAD),
    ):
        got = scan_text(text, "good.yml")
        if got:
            failures.append(f"오탐({name}): {got}")

    if failures:
        print("🔴 test_lint_workflow_env 실패")
        for f in failures:
            print("  - " + f)
        return 1
    print("✅ test_lint_workflow_env 통과 (사고 케이스 검출 1건 · 정상 패턴 오탐 0건)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
