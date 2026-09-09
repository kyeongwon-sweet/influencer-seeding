#!/usr/bin/env python3
"""플랫폼 단위 수집 붕괴 감시 — 결과 워치독.

🚨 왜 만들었나 (2026-09-08 사고):
  `streamers/youtube-scraper` 응답 스키마가 바뀌어 **활성 유튜브 275건 중 268건**이
  하루아침에 미수집됐는데, 그날 사람이 받은 알림은 두 개로 쪼개져 있었다 —
  ① 자정수집 리포트 '확인필요 12건'(위성채널 257건은 규칙상 제외돼 빠짐)
  ② 계정 단위 전멸 감시 '5개 계정'(위성 계정만 임계를 넘김).
  **"유튜브가 통째로 죽었다"고 말해주는 줄은 어디에도 없었다.**

  이 모듈은 계정·채널분류가 아니라 **플랫폼(URL 도메인) 단위**로 어제 확보율을 직전
  7일 중앙값과 비교한다. 계정마다 흩어져 임계를 못 넘기는 사고도 한 줄로 잡힌다.

⚠️ 값은 절대 바꾸지 않는다(알림 전용). 미수집일은 공백으로 남긴다(공백≠0).
"""

from __future__ import annotations

MIN_MISSING = 20        # 이 수보다 적게 빠지면 일상적 노이즈로 보고 알리지 않는다
MIN_BASELINE = 0.5      # 평소 확보율이 이보다 낮은 플랫폼(수기 관리 위주)은 대상 아님
COLLAPSE_RATIO = 0.5    # 평소의 절반 밑으로 떨어지면 붕괴로 본다
BASELINE_DAYS = 7


def platform_of(url) -> str | None:
    u = str(url or "").lower()
    if "youtube.com" in u or "youtu.be" in u:
        return "유튜브"
    if "instagram.com" in u:
        return "인스타"
    if "tiktok.com" in u:
        return "틱톡"
    return None


def _median(values):
    vs = sorted(values)
    if not vs:
        return None
    mid = len(vs) // 2
    return vs[mid] if len(vs) % 2 else (vs[mid - 1] + vs[mid]) / 2


def platform_collapses(active_posts, measured_by_date, target, prev_dates,
                       min_missing: int = MIN_MISSING) -> list:
    """플랫폼별 붕괴 목록.

    active_posts    : 활성 게시물 [{id, url}, …]
    measured_by_date: {날짜: {지표가 있는 post_id}} — 날짜별 실측 집합
    target          : 판정 대상 날짜(보통 어제)
    prev_dates      : 비교 기준 날짜들(최근 7일, target 제외)

    반환: [{platform, active, measured, missing, ratio, baseline}] (미수집 많은 순)
    """
    by_platform = {}
    for p in active_posts:
        pl = platform_of(p.get("url"))
        if pl:
            by_platform.setdefault(pl, []).append(p["id"])

    out = []
    for pl, ids in by_platform.items():
        idset = set(ids)
        def ratio(d):
            got = measured_by_date.get(d) or set()
            return len(idset & got) / len(idset) if idset else 0.0
        today = ratio(target)
        baseline = _median([ratio(d) for d in prev_dates[-BASELINE_DAYS:]])
        if baseline is None or baseline < MIN_BASELINE:
            continue                      # 평소부터 자동수집이 적은 플랫폼은 대상 아님
        measured = len(idset & (measured_by_date.get(target) or set()))
        missing = len(idset) - measured
        if missing < min_missing or today >= baseline * COLLAPSE_RATIO:
            continue
        out.append({"platform": pl, "active": len(idset), "measured": measured,
                    "missing": missing, "ratio": today, "baseline": baseline})
    out.sort(key=lambda x: -x["missing"])
    return out


def platform_collapse_line(collapses, target) -> str | None:
    """상태 댓글 한 줄. 붕괴가 없으면 None."""
    if not collapses:
        return None
    parts = [f"{c['platform']} {c['measured']}/{c['active']}건({c['ratio']*100:.0f}%, "
             f"평소 {c['baseline']*100:.0f}% → 미수집 {c['missing']}건)" for c in collapses]
    return ("🔴 플랫폼 수집 붕괴 %s — %s. 수집기(액터) 응답·스키마 확인 필요. "
            "해당일 값은 공백으로 남깁니다(소급 입력 금지)." % (target, " · ".join(parts)))
