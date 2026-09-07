#!/usr/bin/env python3
"""'가격미매핑'(유상채널인데 비용 0원) 활성 감시 — 결과 워치독.

왜 만들었나 (2026-09-07):
  리포트 경고 규칙을 만들어 놓고 **그 경고가 몇 건인지는 아무도 세지 않았다.** 2026-09-03
  `6682119e` 가 '가격미매핑' 판정을 배너에서 유상채널 전체로 넓히면서 **미러링 23건이
  전부 오탐**이 됐는데, 경고는 그날 TOP10 에 든 게시물에만 보이므로 활성 1건(오하루)만
  매일 떴고 사람이 눈으로 발견할 때까지 4일간 아무도 총량을 몰랐다.
  → 이 모듈은 매일 **전수 카운트**를 낸다. 규칙이 다시 오탐으로 넓어지면 건수가 튀어
  즉시 보이고(무상 제외 건수도 함께 찍는다), 진짜 미기입은 방치 일수로 압박한다.

⚠️ 값은 절대 바꾸지 않는다(알림 전용). 비용 정본은 연동시트 팀 입력이다.
⚠️ cost 컬럼에는 NULL 이 없다(실측 3,534행 전부 NOT NULL) → 0 은 '미기입'과 '무상 확정'
   공용이라 컬럼값만으로 못 가른다. 무상 판정은 channel_kind.is_free_by_design 단일 정본.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from channel_kind import FREE_CH, is_free_by_design

STALE_DAYS = 14          # 이 일수를 넘겨 방치된 미매핑은 별도 카운트로 압박
MAX_DETAIL = 3


def _days_since(posted_at: Any, today: str) -> int | None:
    p = str(posted_at or "")[:10]
    if len(p) != 10:
        return None
    try:
        return (date.fromisoformat(today) - date.fromisoformat(p)).days
    except ValueError:
        return None


def unmapped_cost_actives(posts, today: str) -> dict:
    """활성 게시물 중 '가격미매핑'(유상채널·비용 0원) 집계.

    반환: {"unmapped": [게시물…(게시일 오래된 순)], "mirror": N, "free_ch": N}
    제외 건수를 **사유별로** 돌려주는 이유 — 두 숫자를 같이 봐야 '데이터가 늘었나
    판정 규칙이 깨졌나'를 가를 수 있다. ⚠️ 미러링과 무상채널을 합치면 위성채널
    수백 건에 묻혀(실측 free_ch≈696) 미러링 규칙 붕괴가 안 보인다 — 그래서 분리한다.
    """
    unmapped, mirror, free_ch = [], 0, 0
    for p in posts:
        if p.get("ended_at"):
            continue
        if (p.get("cost") or 0) > 0:
            continue
        ct, name = p.get("channel_type"), p.get("account_name")
        if any(x in str(ct or "") for x in FREE_CH):
            free_ch += 1
            continue
        if is_free_by_design(ct, name):
            mirror += 1
            continue
        unmapped.append(p)
    unmapped.sort(key=lambda p: str(p.get("posted_at") or "9999-99-99"))
    return {"unmapped": unmapped, "mirror": mirror, "free_ch": free_ch}


def unmapped_cost_line(agg: dict, today: str, max_detail: int = MAX_DETAIL) -> str | None:
    """상태 댓글 한 줄. 미매핑이 없으면 None(조용히 지나간다)."""
    rows = agg.get("unmapped") or []
    if not rows:
        return None
    stale = [p for p in rows
             if (_days_since(p.get("posted_at"), today) or 0) >= STALE_DAYS]
    ex = " / ".join(
        f"{(p.get('account_name') or '?').strip()}"
        f"({(p.get('posted_at') or '?')[5:]}"
        + (f", {d}일" if (d := _days_since(p.get("posted_at"), today)) is not None else "")
        + f") {p.get('url') or ''}".rstrip()
        for p in rows[:max_detail]
    )
    line = (f"가격미매핑 활성 {len(rows)}건 — 유상채널인데 비용 0원(연동시트 비용 입력 필요): {ex}")
    if len(rows) > max_detail:
        line += f" … 외 {len(rows) - max_detail}건"
    if stale:
        line += f" · {STALE_DAYS}일+ 방치 {len(stale)}건"
    line += (f" · 무상 제외 미러링 {agg.get('mirror', 0)}건·무상채널 {agg.get('free_ch', 0)}건"
             " (미러링이 0으로 떨어지면 판정 규칙 붕괴 의심)")
    return line
