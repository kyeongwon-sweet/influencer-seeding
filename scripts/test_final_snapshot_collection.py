from pathlib import Path

from run_monitoring import _should_apply_same_day_cost_guard


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "cron-daily-collect.yml"


def test_primary_final_snapshot_does_not_skip_daytime_auto_value():
    assert not _should_apply_same_day_cost_guard(
        recollect_all=False,
        final_snapshot=True,
    )


def test_backup_run_keeps_same_day_cost_guard():
    assert _should_apply_same_day_cost_guard(
        recollect_all=False,
        final_snapshot=False,
    )


def test_manual_full_recollection_also_bypasses_cost_guard():
    assert not _should_apply_same_day_cost_guard(
        recollect_all=True,
        final_snapshot=False,
    )


def test_workflow_marks_only_primary_schedule_as_final_snapshot():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "FINAL_SNAPSHOT:" in text
    assert "github.event.schedule == '41 15 * * *'" in text
    assert "github.event.schedule != '41 15 * * *'" in text


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("final snapshot collection regression tests passed")
