#!/usr/bin/env python3
"""모든 `scripts/test_*.py` 가 CI 어딘가에서 **실제로 실행되는지** 지키는 계약 테스트.

왜 만들었나 (2026-09-23):
  `test_cron_watchdog.py` 는 `test_` 함수 없이 `main()` 구조라 pytest 가 수집하지 않는다.
  그런데 `pytest -q` 의 "372 passed" 만 보고 이 파일도 돌았다고 오인하기 쉬웠다.
  그래서 전수 점검했더니 `test_cron_kpi_workflow.py` 와 `test_cross_post_metrics.py` 는
  pytest 도 워크플로도 부르지 않아 **아무 데서도 실행되지 않고 있었다**.
  하필 후자는 같은 날 빌드를 깨뜨린 교차게시(`_fetch_fb_play_counts`) 코드를 지키는
  테스트였다. 안 도는 테스트는 보호가 아니라 '보호받고 있다'는 착각이라 더 나쁘다.

판정은 **pytest 에게 직접 묻는다**(`--collect-only`).
  ⚠️ 수집 규칙을 여기서 재구현하지 말 것. 첫 시도에서 `unittest.TestCase` 서브클래스를
     `Test*` 접두 규칙으로만 찾다가, `*Test` 접미 이름 7개를 '죽은 테스트'로 오판했다.
     재구현한 판정은 원본과 갈라지고, 갈라진 줄도 모른다.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
WORKFLOWS = SCRIPTS.parent / ".github" / "workflows"

# 실행되지 않아도 되는 파일이 생기면 **이유와 함께** 여기 적는다. 비워 두는 게 정상이다.
EXEMPT: set[str] = set()


def pytest_collected_files() -> set[str]:
    """pytest 가 실제로 수집하는 파일 이름 집합. 수집 자체가 실패하면 조용히 통과시키지 않는다."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider"],
        cwd=SCRIPTS, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode not in (0, 5):  # 5 = no tests collected
        raise AssertionError(
            "pytest --collect-only 이 실패했습니다 — 수집 목록을 못 얻으면 이 계약은 성립하지 않습니다.\n"
            + (proc.stdout or "")[-2000:] + (proc.stderr or "")[-2000:]
        )
    return set(re.findall(r"(test_[A-Za-z0-9_]+\.py)::", proc.stdout or ""))


def workflow_invoked_files() -> set[str]:
    """.github/workflows 의 어느 yml 이든 파일명을 직접 부르면 '실행됨'으로 본다."""
    out: set[str] = set()
    if not WORKFLOWS.is_dir():
        return out
    blobs = [p.read_text(encoding="utf-8", errors="replace") for p in WORKFLOWS.glob("*.yml")]
    for path in SCRIPTS.glob("test_*.py"):
        pattern = re.compile(rf"(?<![\w.]){re.escape(path.name)}(?![\w])")
        if any(pattern.search(b) for b in blobs):
            out.add(path.name)
    return out


def unwired_test_files() -> list[str]:
    """pytest 도 워크플로도 부르지 않는 테스트 파일. 순수 판정 — 테스트 대상."""
    every = {p.name for p in SCRIPTS.glob("test_*.py")}
    alive = pytest_collected_files() | workflow_invoked_files() | EXEMPT
    return sorted(every - alive)


def test_every_script_test_file_is_wired_into_ci():
    every = {p.name for p in SCRIPTS.glob("test_*.py")}
    assert every, "scripts/test_*.py 를 하나도 못 찾음 — 이 계약 테스트가 무력화됐는지 확인"
    offenders = unwired_test_files()
    assert not offenders, (
        "아무 데서도 실행되지 않는 테스트 파일입니다. pytest 가 수집하도록 `def test_...()` "
        "진입점을 넣거나, .github/workflows 의 워크플로에서 직접 실행하세요: "
        + ", ".join(offenders)
    )


if __name__ == "__main__":
    bad = unwired_test_files()
    if bad:
        print("[FAIL] 실행되지 않는 테스트 파일: " + ", ".join(bad))
        raise SystemExit(1)
    total = len({p.name for p in SCRIPTS.glob("test_*.py")})
    print(f"[OK] scripts/test_*.py {total}개 전부 CI에서 실행됨(pytest 수집 또는 워크플로 직접 실행)")
