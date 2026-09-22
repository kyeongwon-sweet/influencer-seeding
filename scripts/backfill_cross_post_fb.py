#!/usr/bin/env python3
"""교차게시 글의 **누적 조회수**를 IG+FB 합계로 한 번 보정한다(일회성).

배경(2026-09-22): 인스타 앱 조회수 = IG+FB 합계인데 우리는 IG 전용값만 저장했다.
활성 글은 다음 수집부터 run_monitoring 이 알아서 합계를 쓰지만, **종료된 글은 더 이상 수집되지 않아
영원히 IG 값으로 남는다**(전수조사 기준 133건). 그 133건을 여기서 한 번만 고친다.

무엇을 하나 — **마지막 측정 행을 제자리에서 보정**한다:
    play_count      = 기존 play_count(우리가 잰 IG 값) + FB 몫
    fb_play_count   = FB 몫
왜 새 행을 만들지 않나:
  · 종료일 이후 날짜에 행을 추가하면 자동종료·과다기록 정합성 점검과 충돌한다.
  · 새 날짜를 만들면 그날 증분이 생긴다. 제자리 보정이면 증분 계산은 play_count - fb_play_count
    (= 원래 IG 값)를 쓰므로 **증분이 1도 바뀌지 않는다**.

⚠️ FB 값은 실측만 쓴다(지어내지 않는다). 값을 못 받은 글은 건너뛴다.
⚠️ 과거 날짜별 FB 증분은 복구할 수 없다 — 그래서 '마지막 시점의 합계'만 맞춘다.
   이 글들은 Σ증분 < 최종 누적이 된다(의도된 것).
⚠️ 되돌리기: --apply 시 백업 JSON 을 남긴다(수정 전 play_count·fb_play_count).

실행(⚠️ 전수조사 결과는 활성·종료 두 파일이라 **둘 다** 넘긴다 — 하나만 넘기면 절반이 조용히 빠진다):
  python scripts/backfill_cross_post_fb.py --from-json <활성.json> <종료.json>            # dry-run
  python scripts/backfill_cross_post_fb.py --from-json <활성.json> <종료.json> --apply
"""
import argparse
import io
import json
import os
import sys
from datetime import datetime

from cross_post_metrics import load_fb_by_shortcode, shortcode
from db import get_client


def _all(db, table, select, **eq):
    rows, start = [], 0
    while True:
        q = db.table(table).select(select)
        for k, v in eq.items():
            q = q.eq(k, v)
        r = q.order("id").range(start, start + 999).execute()
        chunk = r.data or []
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-json", required=True, nargs="+",
                    help="{url: {ig, fb, all}} 형태 스윕 결과(여러 개 가능)")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only-ended", action="store_true", default=True,
                    help="종료된 글만(기본). 활성 글은 다음 수집이 알아서 고친다.")
    args = ap.parse_args()

    # detect_cross_posts 와 **같은 로더**를 쓴다 — 두 스크립트가 같은 파일에서 같은 값을 읽어야
    # '표시된 글'과 '보정된 글'이 어긋나지 않는다.
    fb_by_code = load_fb_by_shortcode(args.from_json)
    print(f"[backfill] 실측 FB 값 {len(fb_by_code)}건 로드 (파일 {len(args.from_json)}개)")

    db = get_client()
    posts = _all(db, "sponsored_posts", "id, url, account_name, ended_at")
    targets = {}
    for p in posts:
        code = shortcode(p.get("url") or "")
        if not code or code not in fb_by_code:
            continue
        if args.only_ended and not p.get("ended_at"):
            continue
        targets[p["id"]] = (p, fb_by_code[code])
    print(f"[backfill] 대상 게시물 {len(targets)}건")
    if not targets:
        return 0

    plans, skipped = [], []
    for pid, (p, fb) in targets.items():
        rows = _all(db, "post_daily_stats",
                    "id, measured_at, play_count, fb_play_count", post_id=pid)
        valid = [r for r in rows
                 if isinstance(r.get("play_count"), (int, float)) and r["play_count"] > 0]
        if not valid:
            skipped.append((p, "측정 이력 없음"))
            continue
        last = max(valid, key=lambda r: r["measured_at"])
        if last.get("fb_play_count") is not None:
            skipped.append((p, "이미 보정됨"))
            continue
        plans.append({
            "row_id": last["id"], "post": p, "measured_at": last["measured_at"],
            "before": last["play_count"], "fb": fb, "after": last["play_count"] + fb,
        })

    plans.sort(key=lambda x: -x["fb"])
    total_fb = sum(x["fb"] for x in plans)
    print(f"[backfill] 보정 예정 {len(plans)}건 · 건너뜀 {len(skipped)}건 · 더해질 FB 합 {total_fb:,}")
    print(f"{'계정':<18}{'측정일':<12}{'기존':>11}{'FB':>10}{'보정후':>12}")
    for x in plans[:20]:
        print(f"{(x['post'].get('account_name') or '?'):<18}{x['measured_at']:<12}"
              f"{x['before']:>11,}{x['fb']:>10,}{x['after']:>12,}")
    if len(plans) > 20:
        print(f"   … 외 {len(plans) - 20}건")

    if not args.apply:
        print("[backfill] dry-run — 쓰지 않았다. 반영하려면 --apply")
        return 0

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bpath = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         f"backup_cross_post_fb_{stamp}.json")
    json.dump([{"row_id": x["row_id"], "play_count": x["before"], "fb_play_count": None}
               for x in plans], io.open(bpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[backfill] 백업 저장: {bpath}")

    done = 0
    for x in plans:
        db.table("post_daily_stats").update(
            {"play_count": x["after"], "fb_play_count": x["fb"]}).eq("id", x["row_id"]).execute()
        done += 1
    print(f"[backfill] 반영 완료 {done}건")

    # 직후 재감사 — 쓴 값이 실제로 들어갔는지 표본이 아니라 전수로 확인한다.
    bad = 0
    for x in plans:
        r = db.table("post_daily_stats").select("play_count, fb_play_count").eq("id", x["row_id"]).execute()
        got = (r.data or [{}])[0]
        if got.get("play_count") != x["after"] or got.get("fb_play_count") != x["fb"]:
            bad += 1
            print(f"  [ERROR] 불일치 row {x['row_id']}: {got}")
    print(f"[backfill] 재감사: 불일치 {bad}건 / {len(plans)}건")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
