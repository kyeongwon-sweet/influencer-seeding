#!/usr/bin/env python3
"""IG 조회수 누락 진단 — 읽기 전용. DB에 아무것도 쓰지 않는다.

배경(2026-08-19): 메인 액터 `apify/instagram-scraper`가 videoUrl은 주면서 videoPlayCount를
빼먹어 일부 릴스가 '좋아요만 있고 조회수 없음' 상태로 남았다. 인스타 웹에서는 같은 게시물의
조회수가 **공개로 보인다**(프로필 릴스 탭 실측: xeoj.ng DcGchu3Sm3Z = 1,739회).
즉 원천 불가가 아니라 수집 경로 문제다.

두 가설을 최소 호출로 확인한다:
  A) URL 형태 — DB엔 `/p/`로 저장돼 있다. `/reel/`로 넘기면 재생수를 주는가?
  B) 대체 액터 — `data-slayer/instagram-post-details`(캡션 보강에 쓰던 폴백)는 주는가?

사용: PROBE_URLS="url1,url2" python scripts/probe_ig_play_count.py
"""
from __future__ import annotations

import json
import os
import re

VIEW_FIELDS = ("videoPlayCount", "videoViewCount", "playCount", "viewCount", "views",
               "impressions", "play_count", "video_view_count", "count")


def shortcode(url: str) -> str | None:
    m = re.search(r"/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)", url or "")
    return m.group(1) if m else None


def as_reel(url: str) -> str:
    sc = shortcode(url)
    return f"https://www.instagram.com/reel/{sc}/" if sc else url


def view_fields(item: dict) -> dict:
    return {k: item.get(k) for k in VIEW_FIELDS if item.get(k) is not None}


def probe(client, actor: str, run_input: dict, label: str) -> None:
    print(f"\n=== {label} · {actor}")
    try:
        run = client.actor(actor).call(run_input=run_input)
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as e:                                  # 진단용 — 실패해도 다음 가설을 계속 본다
        print(f"  [실패] {type(e).__name__}: {e}")
        return
    print(f"  응답 {len(items)}건")
    for it in items:
        sc = shortcode(it.get("url") or it.get("inputUrl") or "")
        vf = view_fields(it)
        metrics = it.get("metrics") if isinstance(it.get("metrics"), dict) else {}
        mv = {k: v for k, v in metrics.items() if "play" in k or "view" in k}
        print(f"  - {sc}  조회수필드={vf or '없음'}"
              f"{'  metrics=' + json.dumps(mv, ensure_ascii=False) if mv else ''}"
              f"  likes={it.get('likesCount', it.get('likes'))}")


def main() -> None:
    from apify_client import ApifyClient
    urls = [u.strip() for u in (os.getenv("PROBE_URLS") or "").split(",") if u.strip()]
    if not urls:
        raise SystemExit("PROBE_URLS 환경변수에 콤마로 구분된 IG URL을 넣어라(읽기 전용).")
    client = ApifyClient(os.environ["APIFY_API_TOKEN"])
    print(f"진단 대상 {len(urls)}건 (DB 쓰기 없음)")
    for u in urls:
        print(f"  {u}  →  {as_reel(u)}")

    probe(client, "apify/instagram-scraper",
          {"directUrls": [as_reel(u) for u in urls], "resultsType": "posts",
           "resultsLimit": 1, "addParentData": False},
          "가설A: /reel/ 형태로 메인 액터 호출")
    probe(client, "data-slayer/instagram-post-details",
          {"postUrls": urls},
          "가설B: 대체 액터(data-slayer)")


if __name__ == "__main__":
    main()
