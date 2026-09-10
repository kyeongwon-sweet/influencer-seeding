#!/usr/bin/env python3
"""소급 기록(측정 지연) 감시 — 결과 워치독.

🚨 왜 만들었나 (2026-09-10 슈기 사고):
  `post_daily_stats` 에는 **'무슨 날짜로 치는가'(measured_at)** 와 **'행이 언제 생겼나'(created_at)**
  만 있고, **그 값을 실제로 언제 읽었는지가 판정에 전혀 안 쓰인다.** 그래서 09-08 값을
  09-09 16:00 에 읽어도 자정수집 값과 똑같이 취급된다.
  여기에 safeIncrement 의 **'첫 유효측정 = 전액'** 규칙이 겹치면 폭발한다 —
  슈기는 첫 측정이 1.7일 지연돼 읽혀 **463,731 전액이 09-08 하루치**로 잡혔고,
  그만큼 09-09 가 깎였다(70,573 ← 실제 121,304). 사용자가 눈으로 발견했다.

  평소엔 재시도 큐가 0~1건이라 무해하다. **플랫폼 전멸을 대량 소급 복구하는 날**
  (09-08 유튜브 268건)에만 터지는데, 그런 날일수록 아무도 안 보고 있다.

이 모듈은 값을 바꾸지 않는다. **'언제 읽혔는지'를 세어서 알리기만 한다.**
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
# 증분 리포트가 매일 12:35 KST 에 나간다. 그 뒤에 도착한 값은 리포트와 DB 를 어긋나게 한다.
REPORT_HOUR_KST = 12
MAX_DETAIL = 3


def _kst(ts) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(KST)
    except ValueError:
        return None


def _cutoff(target: str) -> datetime:
    """대상일 D 의 정상 기록 마감 = D+1 12:00 KST(리포트 발송 직전)."""
    d = datetime.fromisoformat(target).replace(tzinfo=KST)
    return d + timedelta(days=1, hours=REPORT_HOUR_KST)


def late_backfills(target_rows, target: str, first_seen: dict) -> dict:
    """대상일 행 중 '리포트 이후에 기록된' 것들.

    target_rows : [{post_id, created_at, play_count, reach_count}] — measured_at == target 인 행
    first_seen  : {post_id: 최초 measured_at} — '첫 측정' 판정용
    반환: {"late": [...], "first": [...]}  (first ⊂ late, 증분 전액이 얹히는 건)
    """
    cut = _cutoff(target)
    late, first = [], []
    for r in target_rows:
        v = r.get("play_count")
        if v is None:
            v = r.get("reach_count")
        if v is None:
            continue                       # 값 없는 행은 소급 기록이 아니다
        created = _kst(r.get("created_at"))
        if created is None or created <= cut:
            continue
        item = {"post_id": r.get("post_id"), "value": v, "created": created}
        late.append(item)
        if first_seen.get(r.get("post_id")) == target:
            first.append(item)             # 이 날이 최초 측정 → safeIncrement 가 전액을 이 날에 얹는다
    late.sort(key=lambda x: -x["value"])
    first.sort(key=lambda x: -x["value"])
    return {"late": late, "first": first}


def late_backfill_line(agg: dict, target: str, name_of: dict, max_detail: int = MAX_DETAIL) -> str | None:
    """상태 댓글 한 줄. 소급 기록이 없으면 None."""
    late, first = agg.get("late") or [], agg.get("first") or []
    if not late:
        return None
    def nm(i):
        return (name_of.get(i["post_id"]) or "?").strip() or "?"
    line = (f"소급 기록 {len(late)}건 — {target} 값인데 리포트 발송 뒤에 들어왔다"
            f"(그날 증분·리포트가 어긋난다). 최대 {late[0]['value']:,} ({nm(late[0])})")
    if first:
        ex = " / ".join(f"{nm(i)} {i['value']:,}({i['created'].strftime('%m-%d %H:%M')} 기록)"
                        for i in first[:max_detail])
        line += (f" · ⚠️ 그중 **첫 측정 {len(first)}건**은 값 전체가 {target} 하루치로 잡힌다"
                 f" — 다음날 증분이 그만큼 깎인다: {ex}")
        if len(first) > max_detail:
            line += f" 외 {len(first) - max_detail}건"
        line += ". 팀 실측이 있으면 그 값으로 정정할 것(값 추정 금지)."
    return line
