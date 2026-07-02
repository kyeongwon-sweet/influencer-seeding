#!/usr/bin/env python3
# 캡션 없는 활성 IG 게시물을 data-slayer로 보강.
# 배경: 메인 IG 액터(apify/instagram-scraper)가 조회수는 주면서 캡션(caption)을 누락하는 경우가 있어,
#       run_monitoring의 캡션 자동채움이 채울 소스가 없던 문제(2026-07-01). data-slayer는 캡션 정상 반환.
# 실행: cron-daily-collect.yml 수집 직후 단계. 대상 = 캡션 빈 활성 IG만(평소 소량 → Apify 비용 작음).
import os
import re
from db import get_client


def _sc(u: str):
    m = re.search(r'/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)', u or "")
    return m.group(1) if m else None


def backfill():
    db = get_client()
    rows, start = [], 0
    while True:
        r = db.table("sponsored_posts").select("id, url, content_summary, ended_at").range(start, start + 999).execute()
        chunk = r.data or []
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    targets = [a for a in rows
               if not a.get("ended_at")
               and "instagram" in (a.get("url") or "").lower()
               and not (a.get("content_summary") or "").strip()
               and _sc(a.get("url"))]
    if not targets:
        print("[caption] 보강 대상 없음")
        return
    print(f"[caption] 캡션 없는 활성 IG {len(targets)}건 → data-slayer 조회")
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))

    def _fetch(urls):
        run = client.actor("data-slayer/instagram-post-details").call(run_input={"postUrls": urls})
        out = {}
        for it in client.dataset(run["defaultDatasetId"]).iterate_items():
            code = it.get("shortcode") or it.get("code") or _sc(it.get("url") or "") or it.get("url")
            c = it.get("caption")
            text = c.get("text") if isinstance(c, dict) else c
            if code and text:
                out[code] = text.strip()[:300]
        return out

    cap = _fetch([t["url"] for t in targets])
    # data-slayer가 한 런에서 일부 게시물을 누락하는 경우가 있어 못 받은 건만 1회 재시도.
    missed = [t for t in targets if not cap.get(_sc(t["url"]))]
    if missed:
        print(f"[caption] 1차 미수신 {len(missed)}건 → 재시도")
        cap.update(_fetch([m["url"] for m in missed]))
    updated = 0
    for a in targets:
        t = cap.get(_sc(a["url"]))
        if not t:
            continue
        db.table("sponsored_posts").update({"content_summary": t}).eq("id", a["id"]).execute()
        updated += 1
    print(f"[caption] 캡션 채움: {updated}건 / 대상 {len(targets)}건")


if __name__ == "__main__":
    backfill()
