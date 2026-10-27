#!/usr/bin/env python3
"""발송된 바치케 리포트의 '유튜브' 줄을 Google Ads 값(ad_platform_daily)으로 교체한다 — 수동 1회성(2026-10-27 사용자 지시).

바꾸는 것: 인지 광고의 `    유튜브 *+조회수*  CPV n원` 한 줄 + 총 증분(조회수 차이만큼). 다른 줄은 발송 당시 그대로.
값: Google Ads TrueView 조회수·비용(광고그룹 이름에 'P바치', google_ads_sync 가 적재). 그날을 조회했다는 마커
  (jobs.payload ops_marker=google_ads_sync:pbachi, run_date=그날 — google_ads_sync.upsert_job_markers 와 같은 키)가
  없으면 '빈 값'이라 건드리지 않는다. (ops_daily_runs 는 프로덕션에 없음 — Codex 29d12449)
공개 레포 — 로그에는 날짜·변경 여부만, 조회수·광고비 값은 찍지 않는다.

env: SLACK_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATES(쉼표 YYYY-MM-DD, 필수), DRY_RUN("true" 기본)
"""
from __future__ import annotations

import os
import re
import sys

os.environ.setdefault("REPORT_PRODUCT", "pbachi")
import patch_report_conversion as prc  # noqa: E402  (find_report·_slack·TOTAL_RE·GOAL_RE 재사용)

LABEL = "유튜브"
YT_RE = re.compile(r"^    유튜브 \*\+([\d,]+)\*(?:  CPV [^\n]*)?$", re.M)
from google_ads_sync import RUN_SERVICE  # noqa: E402  (마커 키 단일 정본 — 쓰는 쪽과 같은 값)


def ad_cpv(cost, views) -> str:
    """notify_increments._ad_cpv 와 같은 표기(짝 테스트로 고정)."""
    if not views:
        return ""
    if not cost:
        return "CPV -"
    return f"CPV {cost / views:,.1f}원"


def replace_youtube_line(text: str, views: int, cost: float):
    """(new_text, info) / 못 고치거나 같으면 (None, 사유)."""
    m, t = YT_RE.search(text), prc.TOTAL_RE.search(text)
    if not m:
        return None, "유튜브 줄 없음(발송본에 인지 광고 유튜브 줄이 없던 날 — 이 도구는 교체만 한다)"
    if not t:
        return None, "총 증분 줄 형식을 찾지 못함"
    views = int(round(views))
    old_views = int(m.group(1).replace(",", ""))
    new_line = f"    {LABEL} *+{views:,}*  {ad_cpv(cost, views)}".rstrip()
    if m.group(0) == new_line:
        return None, "이미 Google Ads 값과 같음"
    old_total = int(t.group(1).replace(",", ""))
    new_total = old_total - old_views + views
    if new_total < 0:
        return None, "총 증분이 음수가 됨"
    new = YT_RE.sub(new_line, text, count=1)
    new = prc.TOTAL_RE.sub(f"오늘 총 증분 *+{new_total:,}*", new, count=1)
    g = prc.GOAL_RE.search(new)
    if g:
        goal_man = int(g.group(1))
        goal = goal_man * 10000
        tail = ("달성 +" + f"{new_total - goal:,}") if new_total >= goal else ("미달 " + f"{new_total - goal:,}")
        new = prc.GOAL_RE.sub(f"*일 {goal_man}만 목표* {new_total / (goal / 100):.0f}% · {tail}", new, count=1)
    removed = [ln for ln in text.split("\n") if ln not in new.split("\n")]
    added = [ln for ln in new.split("\n") if ln not in text.split("\n")]
    allowed = lambda ln: "총 증분" in ln or "만 목표" in ln or YT_RE.match(ln)  # noqa: E731
    if len(removed) > 3 or len(added) != len(removed) or not all(allowed(ln) for ln in removed + added):
        return None, "예상 외 변경(유튜브·총 증분·목표 외 줄)"
    return new, {"old_total": old_total, "new_total": new_total, "views_changed": old_views != views}


def gads_day(sb, date: str):
    """그날 Google Ads P바치 합계 (views, cost) / 조회 마커가 없으면 None(빈 값). 조회수 지표가 빈 값인 행이 있으면 None."""
    mk = (sb.table("jobs").select("id").eq("type", "monitoring").eq("status", "done")
          .contains("payload", {"ops_marker": RUN_SERVICE, "run_date": date}).limit(1).execute())
    if not mk.data:
        return None
    rows = (sb.table("ad_platform_daily").select("views,cost_krw")
            .eq("platform", "google_ads").eq("product", "P바치").eq("date", date).execute()).data or []
    if any(r.get("views") is None for r in rows):
        return None
    return sum(int(r["views"]) for r in rows), sum(float(r["cost_krw"] or 0) for r in rows)


def main() -> int:
    dates = [s.strip() for s in (os.getenv("DATES") or "").split(",") if s.strip()]
    if not dates:
        print("DATES 필수(이 도구는 수동 1회성)")
        return 1
    dry = (os.getenv("DRY_RUN") or "true").lower() == "true"
    token = os.environ["SLACK_BOT_TOKEN"]
    from db import get_client
    sb = get_client()
    print(f"모드: {'DRY_RUN(편집 안 함)' if dry else 'APPLY'} / 바치케 유튜브 줄 ← Google Ads / 대상 {dates}")
    failed = 0
    for date in dates:
        day = gads_day(sb, date)
        if day is None:
            print(f"[{date}] Google Ads 미조회(또는 조회수 빈 값) → 건너뜀")
            continue
        hits = prc.find_report(token, date)
        if len(hits) != 1:
            print(f"[{date}] 바치케 리포트 {len(hits)}건 → 건너뜀(정확히 1건이어야 함)")
            failed += 1
            continue
        msg = hits[0]
        new, info = replace_youtube_line(msg.get("text") or "", *day)
        if new is None:
            print(f"[{date}] ts={msg['ts']} 건너뜀: {info}")
            continue
        print(f"[{date}] ts={msg['ts']} 유튜브 줄·총 증분 교체 대상(조회수 {'변경' if info['views_changed'] else '동일, CPV만'})")
        if dry:
            continue
        r = prc._slack("chat.update", token, {"channel": prc.CHANNEL, "ts": msg["ts"], "text": new}, post=True)
        if not r.get("ok"):
            print(f"[{date}] chat.update 실패: {r.get('error')}")
            failed += 1
            continue
        chk = prc._slack("conversations.history", token,
                         {"channel": prc.CHANNEL, "latest": msg["ts"], "inclusive": "true", "limit": 1})
        cur = ((chk.get("messages") or [{}])[0].get("text") or "")
        ok = cur.strip() == new.strip()
        print(f"[{date}] 편집 {'확인됨' if ok else '⚠️ 재조회 불일치'}")
        failed += 0 if ok else 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
