#!/usr/bin/env python3
"""GitHub Actions run: 블록의 '쉘 변수 vs os.environ' 불일치를 CI에서 잡는다.

2026-07-30 사고: cron-daily-collect.yml에 `SUMMARY_FILE="..."`(export 없음)을 추가하고
`python -c "... os.environ['SUMMARY_FILE'] ..."`로 읽어, 자정수집이 KeyError로 40초 만에
죽었다. 백업 재시도 3회도 같은 이유로 전멸 → 7/29 자동수집 데이터 전량 누락.
쉘 변수는 자식 프로세스 환경에 상속되지 않으므로 `export` 또는 step `env:`가 필요하다.

의존성 없음(stdlib). YAML 파서를 쓰지 않고 run 블록만 들여쓰기로 추출한다.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

RUN_START = re.compile(r"^(\s*)run:\s*[|>][-+]?\s*$")
ASSIGN = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=")
EXPORT = re.compile(r"^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=")
GITHUB_ENV = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=[^\"']*\"?\s*>>\s*\"?\$GITHUB_ENV")
ENV_READ = re.compile(r"os\.environ\[\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s*\]|os\.getenv\(\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]")
ENV_MAPPING = re.compile(r"^\s{2,}([A-Z][A-Z0-9_]*):\s")


def scan_text(text: str, label: str = "<text>") -> list[str]:
    """run 블록별로 검사해 문제 메시지 목록을 돌려준다(빈 목록 = 통과)."""
    lines = text.splitlines()
    # 파일 전체의 env: 매핑 키(= 실제 환경변수로 주입되는 이름)는 안전한 이름으로 취급
    env_provided = {m.group(1) for line in lines if (m := ENV_MAPPING.match(line))}

    problems: list[str] = []
    i = 0
    while i < len(lines):
        m = RUN_START.match(lines[i])
        if not m:
            i += 1
            continue
        base_indent = len(m.group(1))
        block: list[tuple[int, str]] = []
        j = i + 1
        while j < len(lines):
            line = lines[j]
            if line.strip() and (len(line) - len(line.lstrip())) <= base_indent:
                break
            block.append((j + 1, line))
            j += 1

        assigned: dict[str, int] = {}
        exported: set[str] = set()
        for lineno, line in block:
            if em := EXPORT.match(line):
                exported.add(em.group(1))
                continue
            if gm := GITHUB_ENV.search(line):
                exported.add(gm.group(1))
            if am := ASSIGN.match(line):
                assigned.setdefault(am.group(1), lineno)

        for lineno, line in block:
            for rm in ENV_READ.finditer(line):
                name = rm.group(1) or rm.group(2)
                if name in exported or name in env_provided:
                    continue
                if name in assigned:
                    problems.append(
                        f"{label}:{lineno}: os.environ['{name}'] 읽는데 같은 run 블록의 "
                        f"{label}:{assigned[name]}에서 export 없이 쉘 변수로만 설정됨 "
                        f"→ 자식 프로세스에 상속 안 됨(KeyError). `export {name}=...` 또는 step env: 사용"
                    )
    # 같은 이름이 여러 번 읽히면 중복 메시지가 생기므로 정리
        i = j
    return sorted(set(problems))


def main() -> int:
    root = Path(__file__).resolve().parents[1] / ".github" / "workflows"
    files = sorted(root.glob("*.yml")) + sorted(root.glob("*.yaml"))
    if not files:
        print(f"[lint_workflow_env] 워크플로 파일을 찾지 못했습니다: {root}")
        return 1
    all_problems: list[str] = []
    for f in files:
        all_problems += scan_text(f.read_text(encoding="utf-8"), f.name)
    if all_problems:
        print("[lint_workflow_env] [FAIL] 문제 발견:")
        for p in all_problems:
            print("  - " + p)
        return 1
    print(f"[lint_workflow_env] [OK] 통과 - 워크플로 {len(files)}개, run 블록 env 불일치 0건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
