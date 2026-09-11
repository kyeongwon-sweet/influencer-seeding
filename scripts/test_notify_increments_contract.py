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

    # REPORT_NOTE(숫자 해석 주석) — 값은 못 바꾸고 설명만 붙는다. 미설정이면 아무것도 안 붙어야 하고,
    # 사용자 입력이 그대로 mrkdwn 에 흘러들지 않게 _esc 를 반드시 거쳐야 한다.
    if 'os.getenv("REPORT_NOTE")' not in src:
        fails.append("REPORT_NOTE 주입 지점을 찾지 못함")
    else:
        note_block = src[src.index('os.getenv("REPORT_NOTE")'):][:400]
        if "_esc(" not in note_block:
            fails.append("REPORT_NOTE 를 _esc 없이 본문에 넣고 있음(mrkdwn 주입 위험)")
        if "if _note:" not in note_block:
            fails.append("REPORT_NOTE 가 비었을 때 줄이 붙지 않는 가드가 없음")

    # 정합성 체크(1~14) 전달 경로 — 2026-09-11 이전에는 notify_status 의 ONLY_ON_FAILURE 게이트에
    # 막혀 **수집 정상일엔 한 번도 사용자에게 안 갔다**. 매일 도착하는 이 리포트 스레드가 유일한 경로다.
    if "_integrity_lines" not in src:
        fails.append("정합성 체크가 리포트 스레드에 안 붙는다 — notify_status 게이트에 막혀 영구 무음이 된다")
    else:
        blk = src[src.index("_integ_lines = []"):][:1600]
        if "_asecs.append" not in blk:
            fails.append("정합성 결과를 스레드 댓글(_asecs)에 넣지 않는다")
        if "except Exception" not in blk:
            fails.append("정합성 체크 실패가 리포트 본문 발송을 막을 수 있다(try/except 없음)")

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
