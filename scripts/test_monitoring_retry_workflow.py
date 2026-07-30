from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "monitoring-retry.yml"


def test_manual_monitoring_retry_defaults_to_target_queue():
    text = WORKFLOW.read_text(encoding="utf-8")

    assert "target_only:" in text
    assert 'description: "Only collect retryable missing-view queue targets"' in text
    assert "default: true" in text
    assert "VIEW_MISSING_TARGET_ONLY:" in text
    assert "github.event.inputs.target_only == 'false'" in text
    assert "github.event.inputs.recollect_all == 'true' && '0'" in text


if __name__ == "__main__":
    test_manual_monitoring_retry_defaults_to_target_queue()
    print("monitoring retry workflow safety test passed")
