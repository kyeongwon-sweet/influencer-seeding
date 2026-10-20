"""미수집 사유 공용 정본 — 2026-10-20 '원인 미상'·계정 일괄 내림 재현."""
import json
from pathlib import Path

import collector_reasons as cr

# 실제 수집기 기록(10-19 재시도 run 39321559474) 그대로
MALLANG = {
    "post_id": "e87c3a29-b651-4b28-8727-205fb3b0fb87", "account_name": "말랑동만", "platform": "Instagram",
    "reason": "posted_at_mismatch", "url": "https://www.instagram.com/p/DejZ6R5z4T3/",
    "returned_metric": 11545, "expected_posted_at": "2026-10-19", "actual_posted_at": "2026-10-16",
    "measured_at": "2026-10-19",
}


def test_사고재현_게시일_불일치는_원인미상이_아니라_무엇을_고칠지_말한다():
    text = cr.miss_reason({"not_found_streak": 0}, MALLANG)
    assert "원인 미상" not in text
    assert "2026-10-19" in text and "2026-10-16" in text
    assert "업로드일" in text


def test_삭제확인된_글은_자동종료까지_남은_일수를_말한다():
    post = {"not_found_streak": 1, "review_requested_at": "2026-10-19T15:11:02+00:00"}
    text = cr.miss_reason(post, None)
    assert text.startswith("삭제 확인") and "2일 더" in text
    assert "자동 종료 대상" in cr.miss_reason({"not_found_streak": 3, "review_requested_at": "x"}, None)


def test_우선순위_접근실패_기록없음():
    assert cr.miss_reason({"not_found_streak": 2}, None) == "접근 실패 not_found 2일"
    assert "기록 없음" in cr.miss_reason({}, None)
    assert "응답 없음" in cr.miss_reason({}, {"reason": "no_collector_response"})


def test_사고재현_한계정_7건_동시_접근불가는_한줄로_묶는다():
    items = [{"account_name": "moduhappy", "reason": "삭제 확인 — 계정 프로필에 이 글이 없음(접근 실패 1일, 2일 더 같으면 자동 종료)"}] * 7
    items += [{"account_name": "말랑동만", "reason": cr.reason_text(MALLANG)}]
    lines = cr.account_burst_lines(items)
    assert len(lines) == 1 and "moduhappy 7건" in lines[0]
    assert cr.account_burst_lines(items[:2]) == []  # 2건은 묶지 않음


def test_진단폴더_읽기_최신기록_우선(tmp_path):
    older = dict(MALLANG, measured_at="2026-10-18", reason="no_collector_response")
    (tmp_path / "view_missing_events_a.jsonl").write_text(
        json.dumps(older) + "\n" + json.dumps(MALLANG) + "\n깨진줄\n", encoding="utf-8")
    got = cr.load_collector_reasons(str(tmp_path))
    assert got[MALLANG["post_id"]]["reason"] == "posted_at_mismatch"
    assert cr.load_collector_reasons("") == {}


def test_소스계약_아침리포트가_수집기_사유를_실제로_받는다():
    here = Path(__file__).resolve().parent
    wf = (here.parent / ".github" / "workflows" / "injibot-daily-report.yml").read_text(encoding="utf-8")
    assert "actions: read" in wf
    assert "missing-view-diagnostics-*" in wf
    assert '--diag-dir "$RUNNER_TEMP/collect_diag"' in wf
    src = (here / "daily_collect_report.py").read_text(encoding="utf-8")
    assert "miss_reason(p, reasons.get(" in src
    assert 'else "미수집(원인 미상)"' not in src, "사유는 공용 정본만 쓴다"
