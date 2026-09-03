#!/usr/bin/env python3
"""KPI 갱신의 '감시는 되는데 자동복구가 없던' 사각을 계약으로 고정한다(2026-09-03).

cron-kpi는 cron_watchdog DAILY_DEADLINE_KST에 due 10:05 + grace 150(= 마감 12:35 KST)로
등록돼 있어 **누락은 알렸지만**, 다른 일일 작업과 달리 외부 폴백이 없어 드롭된 날은
사람이 손으로 돌려야 했다. 백업 크론으로 자동복구를 만들고, 그 시각이 마감과
어긋나지 않게 묶어둔다.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "cron-kpi.yml"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cron_watchdog import DAILY_DEADLINE_KST  # noqa: E402


def utc_cron_to_kst_minutes(minute: int, hour: int) -> int:
    """UTC cron(분, 시) → KST 자정 기준 분. 24시를 넘으면 그날 안으로 되돌린다."""
    return ((hour + 9) % 24) * 60 + minute


def hhmm_to_minutes(text: str) -> int:
    h, m = text.split(":")
    return int(h) * 60 + int(m)


def main() -> int:
    src = WORKFLOW.read_text(encoding="utf-8")
    failures: list[str] = []

    crons = re.findall(r'cron:\s*"(\d+)\s+(\d+)\s+\*\s+\*\s+\*"', src)
    slots = sorted(utc_cron_to_kst_minutes(int(m), int(h)) for m, h in crons)
    if len(slots) < 2:
        failures.append(f"드롭 대비 백업 크론이 없다(스케줄 {len(slots)}개) — 누락일에 자동복구 불가")

    cfg = DAILY_DEADLINE_KST.get("cron-kpi.yml")
    if not cfg:
        failures.append("cron-kpi.yml이 DAILY_DEADLINE_KST에서 빠졌다 — 누락 감시가 사라진다")
    else:
        due = hhmm_to_minutes(str(cfg["due"]))
        deadline = due + int(cfg["grace"])
        if slots and slots[0] != due:
            failures.append(f"첫 크론({slots[0]}분)과 워치독 due({due}분)가 어긋난다")
        # 백업 중 최소 하나는 마감 안에 있어야 '백업 성공 = 워치독 조용'이 성립한다.
        if not any(due < s <= deadline for s in slots):
            failures.append(f"마감({deadline}분) 안에 드는 백업 크론이 없다 — 복구돼도 알림이 울린다")

    # UTC 00:00 데드존(=KST 09:00)에 슬롯을 두면 대량 드롭 시간대와 겹친다.
    for m, h in crons:
        if int(h) == 0:
            failures.append(f'UTC 0시 데드존 슬롯 금지: cron "{m} {h} * * *"')

    # 멱등이라 스킵 로직 없이 다중화한 근거를 주석으로 남겨둔다(지워지면 의도가 사라짐).
    if "멱등" not in src:
        failures.append("멱등 근거 주석이 사라졌다 — 스킵 없이 다중화한 이유가 설명되지 않는다")

    if failures:
        print("[FAIL] test_cron_kpi_workflow")
        for f in failures:
            print("   -", f)
        return 1
    print(f"[OK] test_cron_kpi_workflow 통과 (크론 {len(slots)}개, 워치독 마감 정합, 데드존 회피, 멱등 근거)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
