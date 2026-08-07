#!/usr/bin/env python3
"""notify_increments.py 운영 계약 테스트.

기존 리포트 수정 전 프리뷰는 DRY_RUN으로 본문을 확인해야 한다. DEDUP이 먼저
return하면 이미 게시된 날짜의 프리뷰가 사라지므로, DRY_RUN은 DEDUP 조기 종료를
우회해야 한다.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "notify_increments.py"


def main() -> int:
    src = SCRIPT.read_text(encoding="utf-8")
    fails: list[str] = []

    dedup = re.search(r"elif\s+(.+?_already_posted\(token,\s*CHANNEL,\s*target\)\s*):", src, re.S)
    if not dedup:
        fails.append("DEDUP _already_posted 분기를 찾지 못함")
    else:
        condition = " ".join(dedup.group(1).split())
        if "not os.getenv(\"DRY_RUN\")" not in condition:
            fails.append("DRY_RUN=true일 때 DEDUP 조기 종료를 우회하지 않음")
        if "not update_ts" not in condition:
            fails.append("update_ts 편집 경로가 DEDUP에 막힐 수 있음")

    dry_idx = src.find('if os.getenv("DRY_RUN")')
    update_idx = src.find("if update_ts:")
    if dry_idx < 0:
        fails.append("DRY_RUN 출력 분기를 찾지 못함")
    if update_idx < 0:
        fails.append("update_ts chat.update 분기를 찾지 못함")
    if dry_idx >= 0 and update_idx >= 0 and dry_idx > update_idx:
        fails.append("DRY_RUN 분기가 chat.update 뒤에 있어 프리뷰가 발송 경로를 탈 수 있음")

    if fails:
        print("[FAIL] notify_increments 계약 위반")
        for fail in fails:
            print("  - " + fail)
        return 1
    print("[OK] notify_increments 계약 통과 (DRY_RUN 우선, update_ts DEDUP 우회)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
