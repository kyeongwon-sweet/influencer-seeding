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
    assert "verified_missing=verified_not_found_count" in text
    assert "raise RuntimeError(retry_zero_alert)" in text


def test_targeted_instagram_not_found_uses_profile_survival_not_batch_ratio():
    text = RUN_MONITORING.read_text(encoding="utf-8")

    assert "is_platform_not_found_outage(" in text
    assert "target_only or batch_ratio_suspicious" in text
    assert "_fetch_alive_instagram_handles(handles)" in text
    assert "confirmed=confirmed" in text
    assert "ig_not_found_quarantined_keys" in text


def test_confirmed_delete_auto_end_keeps_raw_signal_behind_outage_quarantine():
    text = RUN_MONITORING.read_text(encoding="utf-8")
    run_body = text[text.index("def run():"):text.index("def _fetch_stats(")]

    assert '"error_description": error_description' in text
    assert 'error_description=s.get("error_description")' in run_body
    assert 'last_valid_measured_at=last_valid_metric_date_by_post.get(post["id"])' in run_body
    assert run_body.index("if key in ig_not_found_quarantined_keys:") < run_body.index(
        "end_decision = classify_confirmed_deleted_end("
    )
    assert '.is_("ended_at", "null")' in run_body
    assert '"review_requested_at": None' in run_body


def test_cron_backup_zero_result_is_nonfatal_but_retry_workflow_remains_fatal():
    cron_text = (ROOT / ".github" / "workflows" / "cron-daily-collect.yml").read_text(encoding="utf-8")
    retry_text = WORKFLOW.read_text(encoding="utf-8")

    assert "RETRY_ZERO_FATAL:" in cron_text
    assert "github.event.schedule != '41 15 * * *'" in cron_text
    assert "RETRY_ZERO_FATAL:" not in retry_text


if __name__ == "__main__":
    test_manual_monitoring_retry_defaults_to_target_queue()
    test_targeted_retry_zero_result_is_not_reported_as_success()
    test_targeted_instagram_not_found_uses_profile_survival_not_batch_ratio()
    test_confirmed_delete_auto_end_keeps_raw_signal_behind_outage_quarantine()
    test_cron_backup_zero_result_is_nonfatal_but_retry_workflow_remains_fatal()
    print("monitoring retry workflow safety test passed")
