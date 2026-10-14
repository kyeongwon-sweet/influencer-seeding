# '게시일 불일치로 버린 응답' 알림 문구 + 수집 사각 알림의 사유 표시 — 행동 계약 (2026-10-14 추가).
#
# 🚨 실사고: 연동시트의 soosoo_beauty 쫀득바 행에 ma__si__jjung 의 9/15 말차 파인트 글(`p/DdTfR1VTzxE`)
#    링크가 잘못 붙었다. 수집기는 매번 응답을 받고도 '시트 10-04 ≠ 실제 09-15'로 버렸는데,
#    ① 수집기 DM 은 "시트 게시일을 실제 값으로 정정"만 안내했고(따랐다면 엉뚱한 글이 캠페인 비용으로 굳음)
#    ② 채널의 '수집 사각 감지'는 "한 번도 수집 안 됨"만 보여 원인을 사람이 처음부터 다시 파야 했다.

import json

import posted_at_mismatch as pam
import view_tracking_watchdog as wd

DDTF = {
    "post_id": "520875e4", "measured_at": "2026-10-13", "reason": "posted_at_mismatch",
    "account_name": "ma__si__jjung", "actual_owner": "ma__si__jjung",
    "expected_posted_at": "2026-10-04", "actual_posted_at": "2026-09-15",
    "returned_metric": 1234, "url": "https://www.instagram.com/p/DdTfR1VTzxE/",
}


def test_사고재현_날짜만_고치라고_하지_않는다():
    text = pam.alert_text([DDTF])
    assert "게시일을 실제 값으로 정정" not in text
    assert "다른 글 링크" in text and pam.CHECK_HINT in text
    assert "2026-10-04 ≠ 실제 2026-09-15" in text


def test_계정이_다르면_링크_오류로_짚는다():
    ev = {**DDTF, "account_name": "soosoo_beauty"}
    assert "계정도 다름(시트 soosoo_beauty / 실제 ma__si__jjung)" in pam.describe(ev)


def test_계정이_같거나_모르면_계정_문구를_붙이지_않는다():
    assert "계정도 다름" not in pam.describe(DDTF)
    assert "계정도 다름" not in pam.describe({**DDTF, "actual_owner": None})
    assert "계정도 다름" not in pam.describe({**DDTF, "account_name": "@MA__SI__JJUNG"})


def test_워치독은_수집기_사유를_post별_최신으로_읽는다(tmp_path):
    run = tmp_path / "123" / "missing-view-diagnostics-123"
    run.mkdir(parents=True)
    old = {**DDTF, "measured_at": "2026-10-12", "reason": "no_collector_response"}
    (run / "view_missing_events_2026-10-12.jsonl").write_text(json.dumps(old) + "\n", encoding="utf-8")
    (run / "view_missing_events_2026-10-13.jsonl").write_text(
        json.dumps(DDTF, ensure_ascii=False) + "\n깨진 줄\n", encoding="utf-8")
    reasons = wd.load_collector_reasons(str(tmp_path))
    assert reasons["520875e4"]["reason"] == "posted_at_mismatch"


def test_진단_폴더가_없어도_워치독은_돈다():
    assert wd.load_collector_reasons("") == {}
    assert wd.load_collector_reasons("/없는/경로") == {}


def test_사고재현_수집사각_알림에_원인과_행동이_붙는다():
    row = {"posted_at": "2026-10-04", "channel_type": "무상시딩 (영상)", "account_name": "ma__si__jjung",
           "url": DDTF["url"], "reason": wd.reason_text(DDTF)}
    text = wd.slack_lines({"flagged_count": 1, "grace_days": 2, "flagged": [row],
                           "bad_url_count": 0, "bad_url": [], "review_stale_count": 0, "review_stale": []})
    assert "↳ 수집은 되는데 버려짐: 시트 업로드일 2026-10-04 ≠ 실제 2026-09-15" in text
    assert pam.CHECK_HINT in text


def test_사유_기록이_없으면_그렇다고_말한다():
    assert "기록 없음" in wd.reason_text(None)
    assert "응답 없음" in wd.reason_text({"reason": "no_collector_response"})


def test_소스계약_수집기와_워크플로가_사유를_실제로_넘긴다():
    from pathlib import Path
    here = Path(__file__).resolve().parent
    src = (here / "run_monitoring.py").read_text(encoding="utf-8")
    assert '"actual_owner": s.get("owner_username")' in src, "불일치 이벤트에 실제 글 주인이 실려야 한다"
    assert "_send_status_alert(posted_at_mismatch_alert_text(events))" in src, "DM 문구는 단일 정본을 써야 한다"
    assert "게시일을 실제 값으로 정정" not in src
    wf = (here.parent / ".github" / "workflows" / "view-tracking-watchdog.yml").read_text(encoding="utf-8")
    assert "actions: read" in wf, "산출물을 내려받을 권한이 없으면 사유가 조용히 빈다"
    assert "--diag-dir \"$RUNNER_TEMP/collect_diag\"" in wf
    assert "missing-view-diagnostics-*" in wf
