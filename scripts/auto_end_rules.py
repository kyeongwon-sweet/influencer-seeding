from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any


CAPTION_END_KEYWORDS = ("삭제", "보관", "종료")
AUTO_END_EXCLUDED_TERMS = ("위성채널", "온드미디어")
HIGH_METRIC_THRESHOLD = 500_000  # 누적 50만 이상 = 고성과 → 나이(게시+N일)로 자동종료 안 함(트래킹 유지, 사용자 결정 2026-07-15 복원)
# 비용 1,000만원 이상 = 고액 협찬 → 나이로 자동종료 안 함(사용자 결정 2026-09-07).
#   배경: 에스파 협찬(85,000,000원, 유튜브 본편)이 게시 15일째 나이 규칙으로 종료돼 09-04~09-07
#   4일간 트래킹이 끊겼다(누락 증분 10,341). 누적 302,017 이라 HIGH_METRIC(50만) 예외에 못 걸렸다.
#   유튜브 본편은 릴스·숏폼과 달리 2주 뒤에도 조회수가 계속 붙는다.
#   ⚠️ 임계는 백테스트로 정했다(2026-09-07 실측): cost 상위가 85M·45.5M·30M·11M → 8M 로 끊겨
#   1,000만원이 자연 경계다. 100만원으로 낮추면 보호 대상이 활성 2건 → 28건(IG 24건)으로 뛰고
#   나이 50일대 오래된 글까지 영구 활성이 된다(활성 풀 = Apify 비용, 월 한도 $120·비용 거의 전부 IG).
#   ⚠️ 이 예외는 '영구 활성'을 만든다 → stale_high_cost_actives() 감지 알림과 반드시 세트로 운영.
HIGH_COST_THRESHOLD = 10_000_000


@dataclass(frozen=True)
class AutoEndDecision:
    should_end: bool
    reason: str
    age_days: int | None
    threshold_days: int | None
    metric: int


def text_of(value: Any) -> str:
    return str(value or "")


def is_short_lived_type(channel_type: Any) -> bool:
    text = text_of(channel_type)
    return any(term in text for term in ("배너", "피드", "캐러셀"))


def is_auto_end_excluded(post: dict[str, Any]) -> bool:
    haystack = " ".join(
        text_of(post.get(field))
        for field in ("channel_type", "asset_name", "project_name", "product_name")
    )
    return any(term in haystack for term in AUTO_END_EXCLUDED_TERMS)


def has_caption_end_keyword(post: dict[str, Any]) -> bool:
    caption = text_of(post.get("content_summary"))
    return any(keyword in caption for keyword in CAPTION_END_KEYWORDS)


def row_metric(row: dict[str, Any]) -> int:
    values = []
    for field in ("play_count", "reach_count"):
        value = row.get(field)
        if isinstance(value, (int, float)) and value > 0:
            values.append(int(value))
    return max(values, default=0)


def classify_auto_end(
    post: dict[str, Any],
    *,
    target_date: str,
    max_metric: int = 0,
    manual_tracked: bool = False,
) -> AutoEndDecision:
    # 수동 트래킹 재개 존중: ended_at을 사람이 직접 관리(manual_fields 포함)하면 자동종료로 덮지 않는다.
    # (대시보드/시트에서 수동으로 살린 글이 나이 규칙으로 매일 재종료돼 수동 입력이 사라지던 버그 수정.)
    manual = post.get("manual_fields") or []
    if isinstance(manual, (list, tuple)) and "ended_at" in manual:
        return AutoEndDecision(False, "manual_ended_at", None, None, int(max_metric or 0))

    if has_caption_end_keyword(post):
        return AutoEndDecision(True, "caption_keyword", None, None, int(max_metric or 0))

    if is_auto_end_excluded(post):
        return AutoEndDecision(False, "excluded_channel_project", None, None, int(max_metric or 0))

    # 수동 입력값 보존(사용자 지시 2026-07-24): 팀이 손으로 조회수를 입력 중인 글(manual stat 존재,
    # 대개 틱톡 민감·유튜브 비공개 등 자동수집 불가라 수동추적)은 나이 규칙으로 종료하지 않는다.
    # 종료되면 exportStats가 종료일 이후 수동값을 지워 매일 사라지던 문제의 근본 차단.
    if manual_tracked:
        return AutoEndDecision(False, "manual_stat_tracked", None, None, int(max_metric or 0))

    metric = int(max_metric or 0)
    if metric >= HIGH_METRIC_THRESHOLD:
        return AutoEndDecision(False, "high_metric_500k", None, None, metric)

    # 고액 협찬은 나이로 끊지 않는다. 이 검사는 캡션 '삭제/보관' 키워드·채널 제외·수동추적 **뒤**에
    # 둔다 — 고액이라도 실제로 삭제·보관된 글은 종료돼야 한다. 확정삭제(not_found)는 별 함수
    # (classify_confirmed_deleted_end)라 이 예외의 영향을 받지 않는다.
    try:
        cost = int(float(post.get("cost") or 0))
    except (TypeError, ValueError):
        cost = 0
    if cost >= HIGH_COST_THRESHOLD:
        return AutoEndDecision(False, "high_cost_10m", None, None, metric)

    posted_at = post.get("posted_at")
    if not posted_at:
        return AutoEndDecision(False, "missing_posted_at", None, None, metric)

    try:
        age_days = (date.fromisoformat(target_date) - date.fromisoformat(str(posted_at)[:10])).days
    except ValueError:
        return AutoEndDecision(False, "invalid_posted_at", None, None, metric)

    if age_days < 0:
        return AutoEndDecision(False, "pre_posted", age_days, None, metric)

    threshold_days = 7 if is_short_lived_type(post.get("channel_type")) else 14
    if age_days > threshold_days:
        return AutoEndDecision(True, f"age_after_{threshold_days}", age_days, threshold_days, metric)

    return AutoEndDecision(False, "not_due", age_days, threshold_days, metric)


def stale_high_cost_actives(posts, series_by_post, today, stale_days=7):
    """고액 예외로 나이 종료를 면제받아 활성인데 **증분이 stale_days일 이상 0**인 글.

    이 예외는 영구 활성을 만든다 — 캠페인이 끝나 조회수가 멈춰도 계속 수집 대상이고,
    활성 풀은 Apify 비용이다. 실제 위험 사례: `띠미`(11,000,000원)는 측정값이 아예 없어
    예외가 있었다면 데이터 0으로 영구 활성이 됐다.
    자동 종료하지 않고(값·상태 자동 변경 금지) 사람이 닫도록 알리기만 한다.

    posts: [{id, url, account_name, cost, ended_at, ...}]
    series_by_post: {post_id: [(date, value), ...]}  값 있는 측정만, 날짜 오름차순
    반환: [{account, url, cost, last_date, last_value, stale_days}]  — 없으면 빈 목록
    """
    out = []
    for post in posts:
        if post.get("ended_at"):
            continue
        try:
            cost = int(float(post.get("cost") or 0))
        except (TypeError, ValueError):
            cost = 0
        if cost < HIGH_COST_THRESHOLD:
            continue
        rows = sorted(series_by_post.get(post.get("id")) or [])
        if len(rows) < 2:
            # 측정이 아예 없거나 1개뿐 = 정체 판정 불가지만, 고액인데 데이터가 없는 것 자체가 신호다.
            out.append({
                "account": (post.get("account_name") or "?").strip(),
                "url": post.get("url"), "cost": cost,
                "last_date": rows[-1][0] if rows else None,
                "last_value": rows[-1][1] if rows else None,
                "stale_days": None,
            })
            continue
        stale = 0
        for i in range(len(rows) - 1, 0, -1):
            if rows[i][1] - rows[i - 1][1] == 0:
                stale += 1
            else:
                break
        # 마지막 측정이 오래 전이면(수집 끊김) 그 공백도 정체로 본다.
        gap = 0
        try:
            from datetime import date as _d
            gap = (_d.fromisoformat(str(today)[:10]) - _d.fromisoformat(str(rows[-1][0])[:10])).days
        except ValueError:
            gap = 0
        if max(stale, gap) >= stale_days:
            out.append({
                "account": (post.get("account_name") or "?").strip(),
                "url": post.get("url"), "cost": cost,
                "last_date": rows[-1][0], "last_value": rows[-1][1],
                "stale_days": max(stale, gap),
            })
    return out


def stale_high_cost_line(stale, max_detail=3):
    """상태 알림용 한 줄. 없으면 None."""
    if not stale:
        return None
    def one(x):
        where = f"{x['last_date']} {x['last_value']:,}" if x["last_date"] else "측정 없음"
        days = f"{x['stale_days']}일 정체" if x["stale_days"] is not None else "데이터 없음"
        return f"{x['account']}({int(x['cost']) // 10000:,}만원·{days}·마지막 {where}, {x['url']})"
    line = (f"고액 협찬 정체 {len(stale)}건 — 비용 {HIGH_COST_THRESHOLD // 10000:,}만원+ 라 나이 자동종료가 "
            f"면제된 글인데 조회수가 멈췄다(캠페인 종료면 사람이 종료 처리 필요, 활성 유지 = 수집 비용): ")
    line += ", ".join(one(x) for x in stale[:max_detail])
    if len(stale) > max_detail:
        line += f" … 외 {len(stale) - max_detail}건"
    return line
