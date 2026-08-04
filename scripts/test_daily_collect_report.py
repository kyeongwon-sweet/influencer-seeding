import json
import tempfile
from pathlib import Path

from daily_collect_report import load_auto_end_watchdog


def test_zero_backlog_is_healthy():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "report.json"
        path.write_text(json.dumps({"summary": {"to_end": 0}, "to_end": []}), encoding="utf-8")
        result = load_auto_end_watchdog(path)
        assert result["ok"] is True
        assert result["count"] == 0


def test_overdue_posts_raise_actionable_alert():
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "report.json"
        path.write_text(json.dumps({"summary": {"to_end": 2}, "to_end": [{"url": "https://example.com/1"}]}), encoding="utf-8")
        result = load_auto_end_watchdog(path)
        assert result["ok"] is False
        assert result["count"] == 2
        assert "자동종료 누락 2건" in result["line"]


def test_watchdog_failure_is_not_silent():
    result = load_auto_end_watchdog("missing.json", outcome="failure")
    assert result["ok"] is False
    assert result["count"] is None
    assert "검사 실패" in result["line"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("daily_collect_report watchdog tests passed")
