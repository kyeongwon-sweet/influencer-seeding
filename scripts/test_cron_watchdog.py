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
    suppress_redundant_freshness,
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
    # 사고: injibot(06:38 KST)이 3h23m 지연. 나이 기준 26h는 '전날 성공 시각'에 좌우되므로
    # 전날이 늦게 성공하면 다음날 미실행을 못 본다. 다중화(백업 슬롯)한 워크플로에서 더 심하다.
    # 마감 기준은 전날 시각과 무관하게 '오늘 마감까지 안 돌았다'를 직접 본다.
    INJI = {"injibot-daily-report.yml": DAILY_DEADLINE_KST["injibot-daily-report.yml"]}

    def at_kst(mon: int, day: int, hh: int, mm: int) -> datetime:
        return datetime(2026, mon, day, hh, mm, tzinfo=timezone.utc) - timedelta(hours=9)

    # ⑦ 사각지대 재현: 전날이 백업 슬롯으로 늦게(08-26 08:50 KST) 성공한 경우.
    #    08-27 09:44 시점 나이는 24.9h로 26h 미달 → 나이 기준 침묵. 마감(09:38)은 초과 → 경고.
    late_yesterday = {"injibot-daily-report.yml": "2026-08-25T23:50:00Z"}  # KST 08-26 08:50
    now = at_kst(8, 27, 10, 20)   # 마감 10:08 초과, 나이 25.5h(<26h)
    age_silent = check_freshness({**all_fresh(), **late_yesterday}, now)
    if any("injibot" in x for x in age_silent):
        fails.append(f"⑦나이 기준은 이 시점에 침묵해야 함(사각지대 재현): {age_silent}")
    late = check_daily_deadlines(late_yesterday, now, deadlines=INJI)
    if len(late) != 1 or "injibot-daily-report" not in late[0]:
        fails.append(f"⑦마감 기준이 오늘 미실행을 잡아야 함: {late}")

    # ⑧ 마감 전(10:00 KST)에는 침묵 — 3중 크론 + 09:40 외부 폴백이 다 끝나기 전 오탐 방지
    if check_daily_deadlines(late_yesterday, at_kst(8, 27, 10, 0), deadlines=INJI):
        fails.append("⑧마감 전에는 경고하지 않아야 함(백업 슬롯·외부 폴백 진행 중)")

    # ⑨ 오늘 예약 성공(백업 슬롯이라도)이 있으면 침묵
    today_ok = {"injibot-daily-report.yml": "2026-08-26T23:40:00Z"}  # KST 08-27 08:40
    if check_daily_deadlines(today_ok, at_kst(8, 27, 10, 20), deadlines=INJI):
        fails.append("⑨오늘 예약 성공이 있으면 경고하지 않아야 함")

    # ⑩⑪ since: 신규 워크플로는 시행일 전엔 검사 안 함(첫 실행 전 오탐 방지)
    NEW = {"brand-new.yml": {"due": "08:20", "grace": 90, "since": "2026-08-28"}}
    if check_daily_deadlines({}, at_kst(8, 27, 23, 0), deadlines=NEW):
        fails.append("⑩since 이전에는 경고하지 않아야 함")
    if len(check_daily_deadlines({}, at_kst(8, 28, 9, 50), deadlines=NEW)) != 1:
        fails.append("⑪since 이후에는 예약 기록 없음을 경고해야 함")

    # ⑫ 수동 복구가 있으면 경고는 유지하되 '데이터 복구됨' 주석을 붙인다
    manual = {"injibot-daily-report.yml": {"updated_at": "2026-08-27T00:34:07Z",
                                          "event": "workflow_dispatch"}}
    late = check_daily_deadlines(late_yesterday, at_kst(8, 27, 10, 20), manual, deadlines=INJI)
    if len(late) != 1 or "데이터는 복구됨" not in late[0]:
        fails.append(f"⑫수동 복구 주석이 붙어야 함: {late}")

    # ⑬ 오탐 방지 회귀: 유예는 '마지막 크론 슬롯 + 실측 최대 지연'보다 30분 이상 커야 한다.
    #    (2026-08-27 측정. 값은 due 시각 대비 분)
    observed_max_delay_min = {
        "cron-daily-collect.yml": 258,     # 백업 마지막 슬롯 ~04:59
        "monitoring-validate.yml": 163,    # 백업 슬롯 ~07:43
        "injibot-daily-report.yml": 140,   # 3중 크론 마지막 08:38 + 실측 지연 ~20분
        "formula-audit.yml": 107,
        "invalid-creator-fields.yml": 97,
        "cron-kpi.yml": 90,
        "daily-increment-report.yml": 253, # 마지막 15:20 슬롯이 최대 16:32 완료(첫 12:20 대비)
    }
    if set(observed_max_delay_min) != set(DAILY_DEADLINE_KST):
        fails.append(
            "⑬DAILY_DEADLINE_KST에 실측 기준이 없는 항목이 있음 "
            f"(설정 {sorted(DAILY_DEADLINE_KST)} vs 실측 {sorted(observed_max_delay_min)})"
        )
    for wf, observed in observed_max_delay_min.items():
        grace = int(str(DAILY_DEADLINE_KST.get(wf, {}).get("grace", 0)))
        if grace < observed + 30:
            fails.append(f"⑬{wf} 유예 {grace}분이 실측 최대 지연 {observed}분 대비 여유 부족")

    # ⑭ 같은 워크플로가 마감·나이 임계를 동시에 넘겨도 Slack에는 더 정확한 마감 경고만 남긴다.
    #    ⚠️ 하드코딩 문자열로 검사하면 안 된다 — 억제 로직이 메시지 포맷(" — " 구분자,
    #    ".yml" 접미)을 파싱하므로, 생성 함수의 포맷이 바뀌면 억제가 조용히 죽는데
    #    하드코딩 테스트는 그대로 통과한다. 실제 생성 함수 출력으로 결합해 둔다.
    dedup_now = at_kst(8, 27, 12, 30)
    dedup_last = {wf: "2026-08-26T22:00:00Z" for wf in FRESHNESS_HOURS}
    dedup_last["injibot-daily-report.yml"] = "2026-08-25T21:55:42Z"  # 나이 임계도 초과
    real_stale = check_freshness(dedup_last, dedup_now)
    real_late = check_daily_deadlines(dedup_last, dedup_now, deadlines=INJI)
    if not any("injibot-daily-report" in x for x in real_stale):
        fails.append("⑭전제 붕괴: 이 시점엔 나이 경고에 injibot이 있어야 함")
    if not any("injibot-daily-report" in x for x in real_late):
        fails.append("⑭전제 붕괴: 이 시점엔 마감 경고에 injibot이 있어야 함")
    kept = suppress_redundant_freshness(real_stale, real_late)
    if any("injibot-daily-report" in x for x in kept):
        fails.append(f"⑭마감 경고가 있는데 나이 경고가 남음: {kept}")
    if any("banner-reach-sync" in x for x in real_stale) and not any(
        "banner-reach-sync" in x for x in kept
    ):
        fails.append("⑭마감 경고가 없는 워크플로의 나이 경고를 제거함")
    if suppress_redundant_freshness(real_stale, []) != real_stale:
        fails.append("⑭마감 경고가 없는데 나이 경고를 제거함")

    # ⑮ 복구된 날은 마감+120분 이후 침묵(소음 방지). 복구가 없으면 계속 경고.
    recovered = {"injibot-daily-report.yml": {"updated_at": "2026-08-27T00:40:00Z",
                                             "event": "workflow_dispatch"}}
    if check_daily_deadlines(late_yesterday, at_kst(8, 27, 12, 30), recovered, deadlines=INJI):
        fails.append("⑮복구된 날은 마감+120분 이후 침묵해야 함(매시간 소음 방지)")
    if len(check_daily_deadlines(late_yesterday, at_kst(8, 27, 11, 0), recovered,
                                 deadlines=INJI)) != 1:
        fails.append("⑮복구돼도 마감 직후 창 안에서는 알려야 함(스케줄러 열화)")
    if len(check_daily_deadlines(late_yesterday, at_kst(8, 27, 23, 0), None,
                                 deadlines=INJI)) != 1:
        fails.append("⑯복구가 없으면 창 제한 없이 계속 경고해야 함")

    # ⑰ 증분 리포트: 4중 GitHub 크론과 16:10 Apps Script 자가치유가 끝나기 전엔 침묵하고,
    #     이후에도 오늘 예약 성공이 없으면 스케줄 이상을 알린다. dispatch 성공은 복구 주석으로 남긴다.
    REPORT = {"daily-increment-report.yml": DAILY_DEADLINE_KST["daily-increment-report.yml"]}
    report_yesterday = {"daily-increment-report.yml": "2026-08-26T07:13:29Z"}  # KST 16:13
    if check_daily_deadlines(report_yesterday, at_kst(8, 27, 17, 4), deadlines=REPORT):
        fails.append("⑰증분 리포트 마감 전에는 경고하지 않아야 함")
    report_late = check_daily_deadlines(report_yesterday, at_kst(8, 27, 17, 5), deadlines=REPORT)
    if len(report_late) != 1 or "daily-increment-report.yml" not in report_late[0]:
        fails.append(f"⑰증분 리포트 예약 미실행 마감 경고 누락: {report_late}")
    report_recovered = {"daily-increment-report.yml": {
        "updated_at": "2026-08-27T07:41:15Z",  # KST 16:41 수동/자가치유 성공
        "event": "workflow_dispatch",
    }}
    report_late = check_daily_deadlines(
        report_yesterday, at_kst(8, 27, 17, 5), report_recovered, deadlines=REPORT
    )
    if len(report_late) != 1 or "데이터는 복구됨" not in report_late[0]:
        fails.append(f"⑰증분 리포트 복구 주석 누락: {report_late}")
    report_schedule_ok = {"daily-increment-report.yml": "2026-08-27T07:32:52Z"}
    if check_daily_deadlines(report_schedule_ok, at_kst(8, 27, 17, 5), deadlines=REPORT):
        fails.append("⑰증분 리포트 오늘 예약 성공이 있으면 경고하지 않아야 함")

    if fails:
        print("[FAIL] test_cron_watchdog 실패")
        for x in fails:
            print("  - " + x)
        return 1
    print(
        "[OK] test_cron_watchdog 통과: 나이기준 8종 + 마감기준 11종 "
        "(사각지대재현/유예내침묵/오늘성공/since전후/수동복구주석/유예여유/중복억제/복구창)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
