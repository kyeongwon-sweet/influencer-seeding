#!/usr/bin/env python3
"""게시일 불일치로 버린 조회수는 반드시 사람에게 알려야 한다 — 회귀 고정.

2026-08-03 실측 사고: Apify가 조회수를 정상 반환했는데도(3,544/1,945/3,276) 시트 게시일과
실제 게시일이 1일 넘게 달라 가드가 응답을 버렸고, **아무 알림도 없어** 무상시딩 3건이
7/22~7/28 이후 조용히 미수집 상태로 방치됐다(리포트에도 '원인 미상'으로만 보였다).

가드 자체는 유지한다(값을 함부로 저장하지 않음). 대신 버린 사실을 알린다.
posted_at은 절대 자동 수정하지 않는다 — 사람이 시트에서 정정해야 다음 수집부터 자동 복구된다.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# CI(build-test)는 supabase/dotenv를 설치하지 않는다. 이 테스트는 순수 로직만 보므로
# DB 클라이언트 모듈을 스텁으로 갈아끼워 설치 없이 20초 안에 끝나게 한다.
if "db" not in sys.modules:
    _stub = types.ModuleType("db")
    _stub.get_client = lambda: None  # type: ignore[attr-defined]
    sys.modules["db"] = _stub

import run_monitoring  # noqa: E402


def sample(reason: str, **over) -> dict:
    base = {
        "reason": reason,
        "account_name": "jjin.mood_",
        "url": "https://www.instagram.com/p/DaiJpPkRm40/",
        "expected_posted_at": "2026-07-11",
        "actual_posted_at": "2026-07-08",
        "returned_metric": 3544,
    }
    base.update(over)
    return base


def run_flush(events: list[dict]) -> list[str]:
    sent: list[str] = []
    original_events = run_monitoring.MISSING_VIEW_EVENTS
    original_send = run_monitoring._send_status_alert
    try:
        run_monitoring.MISSING_VIEW_EVENTS = events
        run_monitoring._send_status_alert = lambda text: sent.append(text)
        run_monitoring._flush_posted_at_mismatch_alert()
    finally:
        run_monitoring.MISSING_VIEW_EVENTS = original_events
        run_monitoring._send_status_alert = original_send
    return sent


def main() -> int:
    fails: list[str] = []

    # ① 사고 재현: 게시일 불일치 3건 → 알림 1건, 계정·양쪽 날짜·버려진 값·URL이 다 들어가야 함
    sent = run_flush([
        sample("posted_at_mismatch"),
        sample("posted_at_mismatch", account_name="ddo_chichi",
               url="https://www.instagram.com/p/DbFwKV9vnzM/",
               expected_posted_at="2026-07-24", actual_posted_at="2026-07-22", returned_metric=1945),
        sample("posted_at_mismatch", account_name="nasso_home",
               url="https://www.instagram.com/p/DaU7ckzvS0X/",
               expected_posted_at="2026-07-18", actual_posted_at="2026-07-03", returned_metric=3276),
    ])
    if len(sent) != 1:
        fails.append(f"①알림 1건이어야 함: {len(sent)}건")
    else:
        text = sent[0]
        for token in ("3건", "jjin.mood_", "ddo_chichi", "nasso_home",
                      "2026-07-11", "2026-07-08", "3544", "DaiJpPkRm40"):
            if token not in text:
                fails.append(f"①알림 본문에 '{token}' 없음")
        if "자동 수정하지 않습니다" not in text:
            fails.append("①posted_at 자동수정 금지 안내 누락(사람이 시트를 고쳐야 복구됨)")

    # ② 불일치 없으면 조용해야 함(다른 사유는 이 알림 대상 아님)
    if run_flush([sample("not_found"), sample("no_collector_response")]):
        fails.append("②불일치 아닌 사유인데 알림 발송")
    if run_flush([]):
        fails.append("②이벤트 0건인데 알림 발송")

    # ③ 9건 이상이면 8건만 나열하고 나머지는 개수로 요약
    many = [sample("posted_at_mismatch", account_name=f"acct{i}") for i in range(12)]
    sent = run_flush(many)
    if not sent or "...외 4건" not in sent[0]:
        fails.append(f"③초과분 요약 누락: {sent[:1]}")

    if fails:
        print("[FAIL] test_posted_at_mismatch_alert")
        for f in fails:
            print("  - " + f)
        return 1
    print("[OK] test_posted_at_mismatch_alert 통과 (사고재현·무이벤트·타사유·초과요약 4종)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
