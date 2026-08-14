#!/usr/bin/env python3
"""monitoring-validate의 수집 후 실행·진짜 누락 실패 계약을 고정한다."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "monitoring-validate.yml"


def main() -> int:
    src = WORKFLOW.read_text(encoding="utf-8")
    failures: list[str] = []

    # GitHub cron은 UTC. 20:00/22:00 UTC = 다음날 05:00/07:00 KST.
    for cron in ('cron: "0 20 * * *"', 'cron: "0 22 * * *"'):
        if cron not in src:
            failures.append(f"수집 후 검증 스케줄 누락: {cron}")

    # 레이스를 만든 옛 01:00/03:30 KST 스케줄이 돌아오면 실패한다.
    for stale in ('cron: "0 16 * * *"', 'cron: "30 18 * * *"'):
        if stale in src:
            failures.append(f"옛 수집 경합 스케줄 잔존: {stale}")

    # 시각 이동이 누락 감지를 약화시키면 안 된다.
    required = (
        "if yesterday_count == 0:",
        "exit(1)",
        "if: failure()",
        "Create issue on missing data",
    )
    for token in required:
        if token not in src:
            failures.append(f"진짜 누락 실패/알림 계약 누락: {token}")
    if "continue-on-error" in src:
        failures.append("누락 실패를 숨기는 continue-on-error 사용 금지")

    if failures:
        print("[FAIL] monitoring-validate 계약 위반")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("[OK] monitoring-validate: 05:00/07:00 KST + 0건 실패·알림 계약 유지")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
