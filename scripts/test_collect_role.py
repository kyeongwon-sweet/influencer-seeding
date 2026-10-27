"""collect_role 판정 — 자정 주 수집(구글 트리거 dispatch)과 GitHub 예약 백업이 겹치지 않게."""

from collect_role import decide_role, is_primary_run, primary_state

K = "2026-10-28"  # 실행일(KST). 대상일은 그 전날.


def run(id_, created_utc, event="schedule", status="completed", conclusion="success", title="Daily Collect (Vercel 크론 대체)"):
    return {"id": id_, "created_at": created_utc, "event": event, "status": status, "conclusion": conclusion, "display_title": title}


FINAL = "Daily Collect (Vercel 크론 대체) [final_snapshot]"


def test_dispatch_final_snapshot_is_primary():
    assert decide_role("workflow_dispatch", "", "true", [], K)[0] == "primary"
    assert decide_role("workflow_dispatch", "", "false", [], K)[0] == "manual"
    assert decide_role("workflow_dispatch", "", "", [], K)[0] == "manual"


def test_late_0041_slot_after_midnight_primary_is_backup_not_second_final():
    # 00:20 KST 주 수집 성공 → 05:44 KST에 늦게 뜬 00:41 슬롯은 백업(누락분만)이어야 한다.
    runs = [run(1, "2026-10-27T15:20:00Z", event="workflow_dispatch", title=FINAL)]
    assert decide_role("schedule", "41 15 * * *", "", runs, K, self_run_id=2) == ("backup", "primary_done")


def test_any_slot_waits_while_primary_running():
    runs = [run(1, "2026-10-27T15:20:00Z", event="workflow_dispatch", status="in_progress", conclusion=None, title=FINAL)]
    for slot in ("41 15 * * *", "41 17 * * *", "41 19 * * *"):
        assert decide_role("schedule", slot, "", runs, K, self_run_id=9)[0] == "deferred", slot


def test_0041_slot_is_primary_when_google_trigger_did_not_fire():
    assert decide_role("schedule", "41 15 * * *", "", [], K, self_run_id=5) == ("primary", "schedule_no_primary_yet")
    # 실패한 주 수집만 있으면 다시 주 수집으로
    failed = [run(1, "2026-10-27T15:20:00Z", event="workflow_dispatch", conclusion="failure", title=FINAL)]
    assert decide_role("schedule", "41 15 * * *", "", failed, K, self_run_id=5)[0] == "primary"


def test_backup_slots_stay_backup_without_primary():
    assert decide_role("schedule", "41 17 * * *", "", [], K, self_run_id=5)[0] == "backup"
    assert decide_role("schedule", "41 19 * * *", "", [], K, self_run_id=5)[0] == "backup"


def test_own_run_is_ignored():
    # 자기 자신(진행 중)을 '주 수집 진행 중'으로 보고 스스로 대기하면 안 된다.
    me = run(7, "2026-10-27T15:45:00Z", status="in_progress", conclusion=None)
    assert decide_role("schedule", "41 15 * * *", "", [me], K, self_run_id=7)[0] == "primary"


def test_on_time_0041_schedule_counts_as_primary_for_later_slots():
    # 00:41 슬롯이 제때(02:30 KST 전) 떠서 주 수집으로 돌고 있으면 02:41 슬롯은 기다린다.
    s = run(1, "2026-10-27T15:45:00Z", status="in_progress", conclusion=None)
    assert is_primary_run(s, K)
    assert decide_role("schedule", "41 17 * * *", "", [s], K, self_run_id=2)[0] == "deferred"
    # 02:30 KST 이후 생성된 예약 실행은 백업 슬롯이라 주 수집으로 치지 않는다.
    late = run(3, "2026-10-27T17:45:00Z", status="in_progress", conclusion=None)
    assert not is_primary_run(late, K)


def test_yesterdays_runs_do_not_count():
    old = run(1, "2026-10-27T14:59:00Z", event="workflow_dispatch", title=FINAL)  # 10-27 23:59 KST
    assert primary_state([old], K) == "none"


def test_api_error_falls_back_to_legacy_slots():
    assert decide_role("schedule", "41 15 * * *", "", None, K)[0] == "primary"
    assert decide_role("schedule", "41 17 * * *", "", None, K)[0] == "backup"
