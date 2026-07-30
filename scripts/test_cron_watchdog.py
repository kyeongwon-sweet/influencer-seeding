#!/usr/bin/env python3
"""cron_watchdog 단위 테스트 — 2026-07-30 사고 패턴을 회귀 케이스로 고정."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cron_watchdog import FRESHNESS_HOURS, check_freshness, classify_failures  # noqa: E402

NOW = datetime(2026, 7, 30, 0, 10, tzinfo=timezone.utc)  # KST 09:10


def run(path: str, conclusion: str, minutes_ago: int, name: str = "wf") -> dict:
    ts = (NOW - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"path": f".github/workflows/{path}", "name": name, "conclusion": conclusion,
            "updated_at": ts, "html_url": "https://x"}


def ts_ago(minutes: int) -> str:
    return (NOW - timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def all_fresh(**override: str | None) -> dict[str, str | None]:
    base = {wf: ts_ago(5) for wf in FRESHNESS_HOURS}
    base.update(override)
    return base


def main() -> int:
    fails: list[str] = []

    # ① 사고 재현: 자정수집 실패 2건(최근 70분 내 1건만) → 윈도우 내 1건만 알림
    f = classify_failures([
        run("cron-daily-collect.yml", "failure", 35, "Daily Collect"),
        run("cron-daily-collect.yml", "failure", 150, "Daily Collect"),
    ], NOW, 70)
    if len(f) != 1:
        fails.append(f"①윈도우 내 실패 1건이어야 함: {f}")

    # ② 정상: 실패 없음 + 전부 최근 성공 → 알림 0
    if classify_failures([run("cron-kpi.yml", "success", 10)], NOW, 70):
        fails.append("②성공만 있는데 실패로 잡음")
    if check_freshness(all_fresh(), NOW):
        fails.append("②전부 신선한데 경고 발생")

    # ③ 스케줄 미발화: 자정수집 최근 성공이 30시간 전 → 신선도 경고(26h 기준)
    s = check_freshness(all_fresh(**{"cron-daily-collect.yml": ts_ago(30 * 60)}), NOW)
    if not any("cron-daily-collect" in x and "26h" in x for x in s):
        fails.append(f"③30시간 경과 경고 누락: {s}")

    # ③-2 스케줄은 늦었지만 수동 복구가 성공한 경우: 경고는 유지하되 데이터 복구 문구를 붙인다.
    s = check_freshness(
        all_fresh(**{"cron-daily-collect.yml": ts_ago(30 * 60)}),
        NOW,
        {"cron-daily-collect.yml": {
            "updated_at": ts_ago(60),
            "event": "workflow_dispatch",
            "html_url": "https://x/manual",
        }},
    )
    if not any("cron-daily-collect" in x and "workflow_dispatch" in x and "데이터 freshness" in x for x in s):
        fails.append(f"③-2수동 복구 설명 누락: {s}")

    # ④ 성공 기록 자체가 없음(전면 실패) → 경고
    s = check_freshness(all_fresh(**{"cron-daily-collect.yml": None}), NOW)
    if not any("성공 기록 없음" in x for x in s):
        fails.append(f"④성공 기록 없음 경고 누락: {s}")

    # ④-2 신선도는 '스케줄' 성공만 봐야 한다(2026-07-30 교훈).
    #     수동 실행이 신선도를 채우면 스케줄러 정지를 못 잡으므로, 조회 URL에 event=schedule이 있어야 함.
    src = (Path(__file__).resolve().parent / "cron_watchdog.py").read_text(encoding="utf-8")
    if "event=schedule" not in src:
        fails.append("④-2 fetch_last_success가 event=schedule로 좁히지 않음(수동 실행이 신선도를 오염)")

    # ⑤ 매시간 배너 sync가 4시간째 성공 없음 → 경고(3h 기준), 26h 대상은 조용
    s = check_freshness(all_fresh(**{"banner-reach-sync.yml": ts_ago(4 * 60)}), NOW)
    if len(s) != 1 or "banner-reach-sync" not in s[0]:
        fails.append(f"⑤배너 sync만 경고여야 함: {s}")

    # ⑥ cancelled/timed_out도 실패로 취급
    f = classify_failures([run("cron-kpi.yml", "timed_out", 10, "KPI"),
                           run("cron-kpi.yml", "cancelled", 10, "KPI")], NOW, 70)
    if len(f) != 2:
        fails.append(f"⑥timed_out/cancelled 미검출: {f}")

    if fails:
        print("🔴 test_cron_watchdog 실패")
        for x in fails:
            print("  - " + x)
        return 1
    print("✅ test_cron_watchdog 통과 (사고재현·정상·미발화·수동복구·기록없음·주기초과·비정상종료 7종)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
