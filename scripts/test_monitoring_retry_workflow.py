from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "monitoring-retry.yml"
RUN_MONITORING = ROOT / "scripts" / "run_monitoring.py"


def test_manual_monitoring_retry_defaults_to_target_queue():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "target_only:" in text
    assert 'description: "Only collect retryable missing-view queue targets"' in text
    assert "default: true" in text
    assert "VIEW_MISSING_TARGET_ONLY:" in text
    assert "github.event.inputs.target_only == 'false'" in text
    assert "github.event.inputs.recollect_all == 'true' && '0'" in text


def test_targeted_retry_zero_result_is_not_reported_as_success():
    text = RUN_MONITORING.read_text(encoding="utf-8")

    assert "retry_target_count = len(posts)" in text
    assert "zero_result_alert(target_only, retry_target_count, len(rows), TODAY)" in text
    assert "raise RuntimeError(retry_zero_alert)" in text


def test_batch_wide_instagram_not_found_does_not_advance_post_streaks():
    text = RUN_MONITORING.read_text(encoding="utf-8")

    assert "is_platform_not_found_outage(" in text
    assert "if not ig_not_found_outage:" in text
    assert "_record_not_found_observation(db, post, True)" in text
    assert "not_found streak 적립을 중단했습니다" in text


if __name__ == "__main__":
    test_manual_monitoring_retry_defaults_to_target_queue()
    test_targeted_retry_zero_result_is_not_reported_as_success()
    test_batch_wide_instagram_not_found_does_not_advance_post_streaks()
    print("monitoring retry workflow safety test passed")
