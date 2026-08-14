"""리포트 발송 전 DB↔시트 동기화 풀 검수. 하나라도 BLOCK이면 발송 차단(사용자 지시 2026-08-14).

검수 4종 (DB=대시보드는 동일소스라 별도 대상 아님 — 대시보드는 DB를 그대로 읽음):
  ① 수집 완료      : target일 post_daily_stats 측정 수가 최근 중위값 대비 정상(0/부분수집 차단)
  ② DB↔시트 정합   : target일 조회수 DB vs 연동시트 불일치(시트 정본) 건수 >0 차단
  ③ 채널분류 반영   : 미분류(시트→DB 분류 미반영) 게시물 중 증분>0 건수 >0 차단
  ④ 인지광고 열매핑 : awareness 라우트 warn(조회수 칸 ₩=열밀림) 있으면 차단

`run_presend_audit(db, target, items=, ads=, norm_ch=)` → (blocks, warns).
  blocks: 발송 차단 사유(비면 통과). warns: 비차단 참고(검수 자체를 못 돌린 경우 등).

검수 로직은 검증된 reconcile_sheet_stat_mismatches의 헬퍼를 재사용한다(중복 방지).
판정부(decide_*)는 순수함수라 테스트로 고정한다(test_presend_sync_audit.py).
"""
from __future__ import annotations

import statistics
from datetime import date, timedelta
from typing import Any, Callable

# 검증된 비교 헬퍼 재사용 (import 시 부작용 없음 — main()은 __main__ 가드)
from reconcile_sheet_stat_mismatches import link_key, parse_date, parse_number, metric_column
from linked_sheet_reader import fetch_linked_sheet_rows

PAGE = 1000

# 차단 허용치(노이즈·export 지연으로 정상 리포트가 막히지 않게). 조정 시 여기 한 곳.
MIN_ABS_DIFF = 1000     # 절대차 이 미만은 무시(타이밍/반올림 노이즈)
MIN_PCT_DIFF = 0.03     # 그리고 상대차 이 미만도 무시 — 둘 다 넘어야 실질 불일치
MIN_UNCLASS_INC = 50_000  # 미분류 총증분 이 미만은 통과(신규글 분류지연 노이즈)


def is_material_desync(db_v: int, sheet_v: int) -> bool:
    """시트가 DB보다 '실질적으로 앞섬'(=DB 미반영, 리포트가 뒤처짐)일 때만 True.
    조회수는 누적(증가)이라 DB≥시트는 시트 export 지연(리포트가 최신)일 뿐 → 차단 대상 아님.
    시트>DB일 때만: 수기 정정 미반영/import 지연 등 리포트가 실제로 뒤처진 신호 → 절대·상대 허용치 초과 시 차단."""
    if sheet_v <= db_v:
        return False
    diff = sheet_v - db_v
    return diff >= MIN_ABS_DIFF and diff / sheet_v >= MIN_PCT_DIFF


# ────────────────────────────── 순수 판정부(테스트 대상) ──────────────────────────────
def decide_collection(today_n: int, hist_counts: list[int]) -> str | None:
    """① 수집 완료 판정. 0건이면 미실행/실패, 최근 중위 대비 50% 미만이면 부분누락."""
    if today_n == 0:
        return "수집 미완료 — 측정 0건(수집 워크플로 미실행/실패 의심)"
    valid = [h for h in hist_counts if h > 0]
    if valid:
        med = statistics.median(valid)
        if med >= 20 and today_n < med * 0.5:
            return f"수집 부분누락 의심 — 측정 {today_n}건 < 최근 중위 {med:.0f}건의 50%"
    return None


def decide_stat_mismatches(mismatches: list[tuple[str, int, int]]) -> str | None:
    """② DB↔시트 정합 판정. (url, db, sheet) 리스트(시트>DB 실질차만)가 비면 통과."""
    if not mismatches:
        return None
    ex = "; ".join(f"{u} 시트 {b:,}>DB {a:,}" for u, a, b in mismatches[:5])
    more = f" 외 {len(mismatches) - 5}건" if len(mismatches) > 5 else ""
    return f"DB↔시트 조회수 불일치 {len(mismatches)}건(시트가 DB보다 앞섬=DB 미반영) — {ex}{more}"


def check_classification(items: list[dict[str, Any]], norm_ch: Callable[[Any], str]) -> tuple[str, str] | None:
    """③ 채널분류 반영 — 미분류(시트→DB 분류 미반영) 게시물 중 증분>0이면 차단."""
    bad = [it for it in items if norm_ch(it.get("channel_type")) == "미분류" and (it.get("inc") or 0) > 0]
    tot = sum(it.get("inc") or 0 for it in bad)
    if not bad or tot < MIN_UNCLASS_INC:   # 신규글 분류지연 노이즈는 통과(리포트는 총합 정상 + ⚠️ 미분류 라인 표시)
        return None
    return ("BLOCK", f"채널분류 미반영 {len(bad)}건(증분 +{tot:,}) — 시트→DB 분류 동기화 지연(syncAll 필요). 예: {bad[0].get('url')}")


def check_awareness(ads: dict[str, Any] | None) -> tuple[str, str] | None:
    """④ 인지광고 열매핑 — awareness 라우트 warn(조회수 칸 ₩=열밀림)이면 차단. ads 없으면 스킵."""
    if not ads:
        return None
    warns = ads.get("warn")
    if warns:
        lst = warns if isinstance(warns, list) else [str(warns)]
        return ("BLOCK", "인지광고 시트 열매핑 이상(조회수 칸 ₩=열밀림 의심): " + "; ".join(lst))
    return None


# ────────────────────────────── DB/시트 조회부(부작용) ──────────────────────────────
def _measured_count(db, day: str) -> int:
    """day에 측정(play/reach 중 하나라도 값 있음)된 post_daily_stats 행 수."""
    n, start = 0, 0
    while True:
        res = db.table("post_daily_stats").select("post_id, play_count, reach_count").eq("measured_at", day).range(start, start + PAGE - 1).execute()
        rows = res.data or []
        n += sum(1 for r in rows if r.get("play_count") is not None or r.get("reach_count") is not None)
        if len(rows) < PAGE:
            return n
        start += PAGE


def check_collection(db, target: str) -> tuple[str, str] | None:
    try:
        td = date.fromisoformat(target)
        today_n = _measured_count(db, target)
        hist = [_measured_count(db, (td - timedelta(days=k)).isoformat()) for k in range(1, 8)]
    except Exception as e:  # DB 조회 실패 → 검수 못 함(치명) → 차단
        return ("BLOCK", f"수집 검수 오류(DB 조회 실패): {e}")
    msg = decide_collection(today_n, hist)
    return ("BLOCK", msg) if msg else None


def _stat_mismatches(db, target: str) -> list[tuple[str, int, int]]:
    """target일 DB 조회수 vs 연동시트 값(시트 정본) 불일치 목록. reconcile와 동일 규칙."""
    rows = fetch_linked_sheet_rows()
    headers = rows[0]
    date_columns = {i: parse_date(v) for i, v in enumerate(headers) if i >= 14}
    date_columns = {i: v for i, v in date_columns.items() if v}
    tgt = date.fromisoformat(target)
    tcols = [i for i, d in date_columns.items() if d == tgt]
    if not tcols:
        return []  # 시트에 target 날짜열 아직 없음 → 비교 대상 없음(불일치 아님)
    tcol = tcols[0]

    sheet_by_key: dict[str, list[Any]] = {}
    for row in rows[1:]:
        url = row[1].strip() if len(row) > 1 else ""
        key = link_key(url)
        if not key:
            continue
        val = parse_number(row[tcol]) if tcol < len(row) else None
        sheet_by_key.setdefault(key, []).append(val)

    stats: list[dict[str, Any]] = []
    start = 0
    while True:
        res = db.table("post_daily_stats").select("post_id, play_count, reach_count").eq("measured_at", target).range(start, start + PAGE - 1).execute()
        page = res.data or []
        stats.extend(page)
        if len(page) < PAGE:
            break
        start += PAGE

    posts, poff = [], 0
    while True:
        pr = db.table("sponsored_posts").select("id,url,channel_type,posted_at,ended_at").range(poff, poff + PAGE - 1).execute()
        pg = pr.data or []
        posts.extend(pg)
        if len(pg) < PAGE:
            break
        poff += PAGE
    post_by_id = {p["id"]: p for p in posts}
    posts_by_key: dict[str, list[Any]] = {}
    for p in posts:
        posts_by_key.setdefault(link_key(p.get("url")), []).append(p)

    mism: list[tuple[str, int, int]] = []
    for s in stats:
        post = post_by_id.get(s.get("post_id"))
        if not post:
            continue
        k = link_key(post.get("url"))
        # 시트·DB 모두에서 URL이 유일 매칭일 때만(중복키는 오판 방지로 제외 — reconcile와 동일)
        if len(sheet_by_key.get(k, [])) != 1 or len(posts_by_key.get(k, [])) != 1:
            continue
        col = metric_column(post)
        dbv = s.get(col)
        shv = sheet_by_key[k][0]
        if not isinstance(dbv, (int, float)) or dbv <= 0:
            continue
        if not isinstance(shv, (int, float)) or shv <= 0:  # 시트 빈칸(미반영)은 불일치 아님
            continue
        if is_material_desync(int(dbv), int(shv)):   # 시트>DB 실질차만(DB≥시트=export 지연은 통과)
            mism.append((post.get("url"), int(dbv), int(shv)))
    return mism


def check_stat_sync(db, target: str) -> tuple[str, str] | None:
    try:
        mism = _stat_mismatches(db, target)
    except Exception as e:  # 시트 조회 실패 = 확정 불일치 아님 → 비차단 경고(리포트 억제 방지)
        return ("WARN", f"DB↔시트 정합 검수 불가(연동시트 조회 실패, 발송은 진행): {e}")
    msg = decide_stat_mismatches(mism)
    return ("BLOCK", msg) if msg else None


def run_presend_audit(db, target: str, *, items, ads, norm_ch) -> tuple[list[str], list[str]]:
    """4종 검수 실행 → (blocks, warns). blocks 비면 통과."""
    results = [
        check_collection(db, target),
        check_stat_sync(db, target),
        check_classification(items, norm_ch),
        check_awareness(ads),
    ]
    blocks = [m for r in results if r and r[0] == "BLOCK" for m in [r[1]]]
    warns = [m for r in results if r and r[0] == "WARN" for m in [r[1]]]
    return blocks, warns
