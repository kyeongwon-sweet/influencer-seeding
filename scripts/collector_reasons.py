"""수집기가 남긴 '왜 저장 안 했나' 기록을 사람이 읽는 사유로 — 알림·리포트 공용 단일 정본.

수집기(run_monitoring)는 값을 저장하지 않을 때 사유를 `view_missing_events_*.jsonl`(GitHub 산출물
`missing-view-diagnostics-*`)에 남긴다. DB에는 남지 않으므로 알림이 이 산출물을 읽지 않으면 원인이 사라진다.

사고(2026-10-20): 말랑동만 `p/DejZ6R5z4T3`은 수집기가 매번 조회수(11,545)를 받고도 '게시일 불일치'
(시트 10-19 ≠ 실제 10-16)로 버렸는데, 아침 수집 리포트는 이 기록을 읽지 않아 "미수집(원인 미상)"으로
보냈다(수집 사각 워치독은 같은 기록을 읽어 원인을 붙이고 있었다 — 경로마다 따로 구현한 결과).
같은 날 moduhappy 7건은 계정이 광고 글을 한꺼번에 내린 것이었는데 "접근 실패 1일" 7줄로만 보였다.
"""
from __future__ import annotations

import json
import os
from collections import Counter

from posted_at_mismatch import CHECK_HINT, describe

# not_found_policy.NOT_FOUND_REVIEW_THRESHOLD 와 같은 값(3일 연속 + 삭제 확인 응답이면 자동 종료).
AUTO_END_STREAK = 3
# 한 계정의 글이 이만큼 동시에 접근 불가면 '계정이 글을 내림'으로 묶어 한 줄로 알린다.
ACCOUNT_BURST_MIN = 3


def load_collector_reasons(diag_dir: str) -> dict[str, dict]:
    """`view_missing_events_*.jsonl`을 post_id별 최신 1건으로. 없거나 깨져 있으면 빈 dict(사유는 부가 정보)."""
    reasons: dict[str, dict] = {}
    if not diag_dir or not os.path.isdir(diag_dir):
        return reasons
    for root, _dirs, files in os.walk(diag_dir):
        for name in files:
            if not (name.startswith("view_missing_events_") and name.endswith(".jsonl")):
                continue
            try:
                lines = open(os.path.join(root, name), encoding="utf-8").read().splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                pid = ev.get("post_id")
                if not pid:
                    continue
                prev = reasons.get(pid)
                if prev is None or str(ev.get("measured_at") or "") >= str(prev.get("measured_at") or ""):
                    reasons[pid] = ev
    return reasons


def reason_text(ev: dict | None) -> str:
    """수집기 기록 1건 → 한 줄 사유. 기록이 없으면 그 사실 자체가 정보다(수집 대상에서 빠졌을 수 있음)."""
    if not ev:
        return "수집기 사유 기록 없음 — 수집 대상에서 빠졌을 수 있음"
    reason = ev.get("reason")
    if reason == "posted_at_mismatch":
        return f"수집은 되는데 버려짐: {describe(ev)} → {CHECK_HINT}"
    if reason == "no_collector_response":
        return "수집기 응답 없음 — 비공개·삭제·지역제한 가능, 링크 직접 확인"
    return f"수집기 기록: {reason}"


def miss_reason(post: dict, ev: dict | None) -> str:
    """미수집 게시물 한 건의 사유. 우선순위: 수집기 기록(구체적) > 삭제 확인 > 접근 실패 일수 > 기록 없음."""
    if ev and ev.get("reason") == "posted_at_mismatch":
        return reason_text(ev)
    streak = int(post.get("not_found_streak") or 0)
    if streak and post.get("review_requested_at"):
        left = max(0, AUTO_END_STREAK - streak)
        tail = f"{left}일 더 같으면 자동 종료" if left else "자동 종료 대상"
        return f"삭제 확인 — 계정 프로필에 이 글이 없음(접근 실패 {streak}일, {tail})"
    if streak:
        return f"접근 실패 not_found {streak}일"
    if ev:
        return reason_text(ev)
    return "미수집 — 수집기 사유 기록 없음(수집 대상에서 빠졌을 수 있음)"


def account_burst_lines(items: list[dict]) -> list[str]:
    """같은 계정 글이 ACCOUNT_BURST_MIN건 이상 동시에 접근 불가/삭제 확인이면 계정 단위 요약 한 줄씩."""
    hits = Counter(
        (i.get("account_name") or "-")
        for i in items
        if str(i.get("reason") or "").startswith(("접근 실패", "삭제 확인"))
    )
    return [
        f"• {acct} {n}건이 한꺼번에 접근 불가 — 계정이 광고 글을 내린 것으로 보임(계정은 확인 필요). "
        f"의도적 내림이면 종료 처리"
        for acct, n in sorted(hits.items(), key=lambda kv: -kv[1])
        if n >= ACCOUNT_BURST_MIN
    ]
