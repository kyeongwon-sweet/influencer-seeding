import json
import tempfile
from pathlib import Path

from daily_collect_report import collection_ran_for_date, load_auto_end_watchdog


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


# ───────── 발송 게이트: 대상일 수집 완료 확인 (2026-08-28 사고 회귀) ─────────
# 사고: 리포트 09:33 발송 → 수집 09:35 시작·09:45 완료. "값 확보 24%·확인필요 319건"이
#       전부 오탐이었고, idempotency가 이후 슬롯을 스킵해 틀린 리포트가 최종본으로 고정됐다.
# 판정은 확보율 같은 곁가지가 아니라 '수집 워크플로가 대상일로 성공했는가'(실제 상태)로 한다.
# cron-daily-collect는 실행 시점 KST '어제'를 대상일로 쓰므로, 대상일 D의 수집은
# KST 날짜 D+1에 생성된 성공 실행이다.

def _run(created_at, conclusion="success"):
    return {"created_at": created_at, "conclusion": conclusion}


def test_gate_blocks_when_collection_has_not_run():
    """사고 재현: 08-28 08:38(리포트 슬롯)에 08-27 수집 성공 실행이 아직 없다."""
    runs = [_run("2026-08-25T21:55:00Z")]          # KST 08-26 06:55 → 대상일 08-25
    assert collection_ran_for_date(runs, "2026-08-27") is False


def test_gate_passes_on_normal_day():
    """정상일: 00:41 KST(=전일 15:41Z) 수집 성공 → 06:38 리포트 통과."""
    runs = [_run("2026-08-27T15:41:00Z")]          # KST 08-28 00:41 → 대상일 08-27
    assert collection_ran_for_date(runs, "2026-08-27") is True


def test_gate_passes_for_late_arriving_collection():
    """지연일: 09:35 KST(=00:35Z) 도착도 같은 KST 날짜이므로 대상일 08-27로 인정."""
    runs = [_run("2026-08-28T00:35:00Z")]          # KST 08-28 09:35 → 대상일 08-27
    assert collection_ran_for_date(runs, "2026-08-27") is True


def test_gate_ignores_failed_and_other_dates():
    runs = [
        _run("2026-08-28T00:35:00Z", "failure"),   # 대상일 맞지만 실패
        _run("2026-08-29T00:35:00Z"),              # 성공이지만 대상일 08-28
        _run("2026-08-27T00:35:00Z"),              # 성공이지만 대상일 08-26
    ]
    assert collection_ran_for_date(runs, "2026-08-27") is False


def test_gate_is_robust_to_bad_input():
    assert collection_ran_for_date([], "2026-08-27") is False
    assert collection_ran_for_date(None, "2026-08-27") is False
    assert collection_ran_for_date([_run("2026-08-28T00:35:00Z")], "not-a-date") is False
    assert collection_ran_for_date([{"conclusion": "success"}], "2026-08-27") is False
    assert collection_ran_for_date([_run("garbage")], "2026-08-27") is False


def test_kst_day_boundary_is_respected():
    """14:59Z = KST 23:59 같은 날 / 15:00Z = KST 00:00 다음 날 — 경계에서 대상일이 바뀐다."""
    assert collection_ran_for_date([_run("2026-08-28T14:59:00Z")], "2026-08-27") is True
    assert collection_ran_for_date([_run("2026-08-28T15:00:00Z")], "2026-08-27") is False
    assert collection_ran_for_date([_run("2026-08-28T15:00:00Z")], "2026-08-28") is True



if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("daily_collect_report tests passed (watchdog 3 + 수집게이트 6)")
