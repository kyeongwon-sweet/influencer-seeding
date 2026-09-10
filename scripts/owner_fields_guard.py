#!/usr/bin/env python3
"""제작자·기획자 빈칸 활성 감시 — 결과 워치독.

왜 만들었나 (2026-09-10):
  담당자 빈칸은 **아무도 세지 않고 있었다.** 매일 도는 `invalid-creator-fields` 감사는
  '잘못 들어간 값을 지우는' 것이 일이라 `기획자·제작자가 둘 다 비어 있음 → 지울 게 없음`
  으로 **빈칸을 명시적으로 건너뛴다**(audit_invalid_creator_fields.py). 그래서 빈칸은
  감시 사각이었다.
  실측: 2026-09-07 제작자 75 → 2026-09-10 **91**(기획자 52 → 68). 3일간 기존 75건은
  **하나도 채워지지 않았고** 09-09 에 16건이 통째로 빈칸으로 새로 등록됐다.
  ⚠️ 그 사이 나는 "팀이 채우고 있다(개선 중)"고 보고했는데, 그건 **인계문 수치(정의 불명)와
  내 측정치를 나란히 비교한 오류**였다. 같은 자로 재면 악화였다. 그래서 이 모듈은
  **항상 같은 정의로 매일 전수 카운트**를 낸다 — 추세를 눈대중으로 말하지 않기 위해서다.

⚠️ 값은 절대 채우지 않는다(알림 전용). 담당자 정본은 연동시트 팀 입력이다.
⚠️ 분모는 '활성 + 유상'이다. 무상(위성·온드·무상시딩·미러링 등)은 애초에 담당자를 안 적는
   규칙이라 제외하고, **제외 건수는 사유별로 따로 센다** — 합치면 위성채널 수백 건에 묻혀
   판정 규칙이 깨진 것을 못 본다([[cost-zero-vs-unmapped]] 와 같은 이유).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from channel_kind import free_reason

STALE_DAYS = 14          # 이 일수를 넘겨 방치된 빈칸은 별도 카운트로 압박
MAX_DETAIL = 3


def _days_since(posted_at: Any, today: str) -> int | None:
    p = str(posted_at or "")[:10]
    if len(p) != 10:
        return None
    try:
        return (date.fromisoformat(today) - date.fromisoformat(p)).days
    except ValueError:
        return None


def _blank(value: Any) -> bool:
    return not str(value or "").strip()


def _posted_key(post: dict) -> str:
    return str(post.get("posted_at") or "")[:10]


def blank_owner_actives(posts, today: str) -> dict:
    """활성·유상 게시물 중 제작자/기획자 빈칸 집계.

    반환: {"creator": [...], "planner": [...], "free_by_reason": {사유: 건수}, "paid": 총 유상 활성수}
    제작자와 기획자를 **따로** 돌려주는 이유 — 둘은 겹치지만 같지 않다(한쪽만 빈 글이 있다).
    """
    creator, planner, by_reason = [], [], {}
    paid = 0
    for p in posts:
        if p.get("ended_at"):
            continue
        reason = free_reason(p.get("channel_type"), p.get("account_name"),
                             p.get("project_name"), p.get("asset_name"))
        if reason:
            by_reason[reason] = by_reason.get(reason, 0) + 1
            continue
        paid += 1
        if _blank(p.get("creator")):
            creator.append(p)
        if _blank(p.get("planner")):
            planner.append(p)
    creator.sort(key=_posted_key)      # 오래된 순 — 방치가 긴 것부터 보인다
    planner.sort(key=_posted_key)
    return {"creator": creator, "planner": planner, "free_by_reason": by_reason, "paid": paid}


def blank_owner_line(agg: dict, today: str, max_detail: int = MAX_DETAIL) -> str | None:
    """상태 댓글 한 줄. 빈칸이 없으면 None(조용히 지나간다)."""
    creator = agg.get("creator") or []
    planner = agg.get("planner") or []
    if not creator and not planner:
        return None

    def stale(rows):
        return [p for p in rows if (_days_since(p.get("posted_at"), today) or 0) >= STALE_DAYS]

    parts = []
    if creator:
        parts.append(f"제작자 {len(creator)}건")
    if planner:
        parts.append(f"기획자 {len(planner)}건")
    line = f"담당자 빈칸 활성 {' · '.join(parts)}"
    paid = agg.get("paid")
    if paid:
        line += f" (유상 활성 {paid}건 중)"

    stale_c, stale_p = stale(creator), stale(planner)
    if stale_c or stale_p:
        line += f" — {STALE_DAYS}일 초과 방치 제작자 {len(stale_c)}·기획자 {len(stale_p)}"

    # 예시는 더 시급한 쪽(건수가 많은 쪽)에서 가장 오래 방치된 것부터 보여준다.
    worst = creator if len(creator) >= len(planner) else planner
    ex = " / ".join(
        f"{(p.get('account_name') or '?').strip()}"
        f"({(p.get('posted_at') or '?')[5:]}"
        + (f", {d}일" if (d := _days_since(p.get("posted_at"), today)) is not None else "")
        + f") {p.get('url') or ''}".rstrip()
        for p in worst[:max_detail]
    )
    if ex:
        line += f": {ex}"
        if len(worst) > max_detail:
            line += f" … 외 {len(worst) - max_detail}건"
    line += " → 연동시트 담당자 입력 필요"
    return line
