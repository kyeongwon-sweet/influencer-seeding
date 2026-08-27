#!/usr/bin/env python3
"""cron_watchdog 단위 테스트 — 2026-07-30 사고 패턴을 회귀 케이스로 고정."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cron_watchdog import (  # noqa: E402
    DAILY_DEADLINE_KST,
    FRESHNESS_HOURS,
    check_daily_deadlines,
    check_freshness,
    classify_failures,
)

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

    # ③-3 예약 실행이 실제 발화한 뒤 실패했고 수동 복구된 경우:
    #      미발화가 아니라 예약 실패로 분류하고 데이터 복구 상태도 함께 설명한다.
    s = check_freshness(
        all_fresh(**{"cron-daily-collect.yml": ts_ago(35 * 60)}),
        NOW,
        {"cron-daily-collect.yml": {
            "updated_at": ts_ago(7 * 60),
            "event": "workflow_dispatch",
            "html_url": "https://x/manual",
        }},
        {"cron-daily-collect.yml": {
            "updated_at": ts_ago(10 * 60),
            "event": "schedule",
            "conclusion": "failure",
            "html_url": "https://x/scheduled-failure",
        }},
    )
    if not any(
        "cron-daily-collect" in x
        and "예약 실행은 발화했지만 failure" in x
        and "데이터 freshness" in x
        for x in s
    ):
        fails.append(f"③-3예약 실패/수동 복구 분류 오류: {s}")

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


    # ───────── 마감 기반 검사(2026-08-27 사고 회귀) ─────────
    # 사고: injibot(06:38 KST)이 3h23m 지연. 전날 06:55 성공 → 08:35 시점 나이 25.7h로
    # 26h 임계 미달 → 나이 기준 워치독이 침묵했다. 마감 기준은 이걸 잡아야 한다.
    INJI = {"injibot-daily-report.yml": DAILY_DEADLINE_KST["injibot-daily-report.yml"]}
    yesterday_ok = {"injibot-daily-report.yml": "2026-08-25T21:55:42Z"}  # KST 08-26 06:55

    def at_kst(mon: int, day: int, hh: int, mm: int) -> datetime:
        return datetime(2026, mon, day, hh, mm, tzinfo=timezone.utc) - timedelta(hours=9)

    # ⑦ 사고 재현: 08-27 08:35 KST — 나이 기준은 침묵, 마감 기준은 경고
    now = at_kst(8, 27, 8, 35)
    age_silent = check_freshness(
        {**all_fresh(), "injibot-daily-report.yml": yesterday_ok["injibot-daily-report.yml"]},
        now,
    )
    if any("injibot" in x for x in age_silent):
        fails.append(f"⑦나이 기준은 이 시점에 침묵해야 함(사각지대 재현): {age_silent}")
    late = check_daily_deadlines(yesterday_ok, now, deadlines=INJI)
    if len(late) != 1 or "injibot-daily-report" not in late[0]:
        fails.append(f"⑦마감 기준이 오늘 미실행을 잡아야 함: {late}")

    # ⑧ 유예 내(07:00 KST, 마감 07:38)에는 침묵 — 평소 지연 14~18분 오탐 방지
    if check_daily_deadlines(yesterday_ok, at_kst(8, 27, 7, 0), deadlines=INJI):
        fails.append("⑧유예 내에는 경고하지 않아야 함")

    # ⑨ 오늘 예약 성공이 있으면 침묵
    today_ok = {"injibot-daily-report.yml": "2026-08-26T21:55:00Z"}  # KST 08-27 06:55
    if check_daily_deadlines(today_ok, at_kst(8, 27, 8, 35), deadlines=INJI):
        fails.append("⑨오늘 예약 성공이 있으면 경고하지 않아야 함")

    # ⑩ since: 신규 워크플로는 시행일 전엔 검사 안 함(첫 실행 전 오탐 방지)
    WD = {"injibot-report-watchdog.yml": DAILY_DEADLINE_KST["injibot-report-watchdog.yml"]}
    if check_daily_deadlines({}, at_kst(8, 27, 9, 50), deadlines=WD):
        fails.append("⑩since 이전에는 경고하지 않아야 함")
    if len(check_daily_deadlines({}, at_kst(8, 28, 9, 50), deadlines=WD)) != 1:
        fails.append("⑪since 이후에는 예약 기록 없음을 경고해야 함")

    # ⑫ 수동 복구가 있으면 경고는 유지하되 '데이터 복구됨' 주석을 붙인다
    manual = {"injibot-daily-report.yml": {"updated_at": "2026-08-27T00:34:07Z",
                                          "event": "workflow_dispatch"}}
    late = check_daily_deadlines(yesterday_ok, at_kst(8, 27, 9, 50), manual, deadlines=INJI)
    if len(late) != 1 or "데이터는 복구됨" not in late[0]:
        fails.append(f"⑫수동 복구 주석이 붙어야 함: {late}")

    # ⑬ 오탐 방지 회귀: 유예는 실측 최대 지연 + 30분 이상 여유가 있어야 한다
    #    (2026-08-27 측정, 최근 10회 예약 실행의 due 대비 최대 지연 분)
    observed_max_delay_min = {
        "cron-daily-collect.yml": 258,     # 백업 마지막 슬롯 ~04:59
        "monitoring-validate.yml": 163,    # 백업 슬롯 ~07:43
        "injibot-daily-report.yml": 18,
        "formula-audit.yml": 107,
        "invalid-creator-fields.yml": 97,
        "cron-kpi.yml": 90,
    }
    for wf, observed in observed_max_delay_min.items():
        grace = int(str(DAILY_DEADLINE_KST[wf]["grace"]))
        if grace < observed + 30:
            fails.append(f"⑬{wf} 유예 {grace}분이 실측 최대 지연 {observed}분 대비 여유 부족")

    if fails:
        print("[FAIL] test_cron_watchdog 실패")
        for x in fails:
            print("  - " + x)
        return 1
    print(
        "[OK] test_cron_watchdog 통과: 나이기준 8종 + 마감기준 7종 "
        "(사각지대재현/유예내침묵/오늘성공/since전후/수동복구주석/유예여유)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
