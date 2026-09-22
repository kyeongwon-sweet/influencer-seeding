#!/usr/bin/env python3
"""IG↔Facebook 교차게시 게시물 탐지 → sponsored_posts.is_cross_posted 갱신.

배경(2026-09-22 실측): 인스타 앱이 보여주는 조회수는 IG + Facebook 교차게시 합계인데
우리 수집기는 IG 전용값만 저장한다. 퐁패밀리 건이 대시보드 414,066 vs 실제 1,125,552 로 벌어졌다.
IG 3,675건 전수조사 결과 교차게시 148건(활성 15·종료 133), 숨은 FB 조회수 합 1,587,351.

왜 '플래그'를 두는가: 교차게시는 전체의 4%뿐인데 FB 값을 얻으려면 비싼 data-slayer 를 써야 한다.
매일 전량 호출하면 비용이 감당 안 되므로, **여기서 주기적으로 탐지해 표시해 두고** 일일 수집은
표시된 글만 추가 조회한다(run_monitoring `_fetch_fb_play_counts`).

⚠️ 액터가 아이템을 아예 안 주는 경우가 있다 — 실측에서 활성 9건 중 7건이 재시도로 회수됐고
   그중 1건은 교차게시였다(재시도 없으면 과소계상). 그래서 **못 받은 건은 한 번 더 호출**한다.
⚠️ 끝까지 응답이 없는 건은 대부분 **글이 삭제된 것**이다(표본 60건 중 44건 무응답 → DB 대조상
   34건은 자동수집 이력 자체가 없고 10건은 캠페인 종료 후 내려간 바이럴 영상). 그런 건은
   판정을 바꾸지 않고 **기존 값을 유지**한다(모른다고 false 로 덮으면 FB 수집이 끊긴다).
⚠️ 이미지(carousel_container·feed)는 재생수 자체가 없어 교차게시 판정 대상이 아니다 → false.

실행:
  python scripts/detect_cross_posts.py                 # 활성 IG만 탐지, 쓰기 없음(dry-run)
  python scripts/detect_cross_posts.py --apply         # 판정 결과를 DB에 반영
  python scripts/detect_cross_posts.py --scope all --apply
  python scripts/detect_cross_posts.py --from-json <활성.json> <종료.json> --apply
      # 이미 돌린 전수조사 결과 재사용(Apify 재호출 없음). ⚠️ 활성·종료가 두 파일이라 둘 다 넘겨야 한다.
"""
import argparse
import os
import sys

from cross_post_metrics import load_fb_by_shortcode, shortcode
from db import get_client

BATCH = 40
ACTOR = "data-slayer/instagram-post-details"


def _load_targets(db, scope: str):
    rows, start = [], 0
    while True:
        r = (db.table("sponsored_posts")
               .select("id, url, account_name, channel_type, ended_at, is_cross_posted")
               .order("id").range(start, start + 999).execute())
        chunk = r.data or []
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
        start += 1000
    out = []
    for a in rows:
        u = (a.get("url") or "")
        if "instagram.com" not in u.lower() or not shortcode(u):
            continue
        if scope == "active" and a.get("ended_at"):
            continue
        # 배너(이미지)는 재생수가 없어 교차게시가 성립하지 않는다 → 비싼 조회를 아낀다.
        if "배너" in (a.get("channel_type") or ""):
            continue
        out.append(a)
    return out


def _query_actor(urls: list) -> dict:
    """{shortcode: {ig, fb, all, type}}. 못 받은 건은 키가 없다."""
    from apify_client import ApifyClient
    client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
    got = {}
    for i in range(0, len(urls), BATCH):
        chunk = urls[i:i + BATCH]
        try:
            run = client.actor(ACTOR).call(run_input={"postUrls": chunk})
            for it in client.dataset(run["defaultDatasetId"]).iterate_items():
                code = it.get("code") or it.get("shortcode") or it.get("shortCode")
                if not code:
                    continue
                m = it.get("metrics") or {}
                got[code] = {
                    "ig": m.get("ig_play_count"),
                    "fb": m.get("fb_play_count"),
                    "all": m.get("play_count"),
                    "type": it.get("product_type") or it.get("media_type") or it.get("type"),
                }
        except Exception as e:  # 배치 하나가 죽어도 나머지는 계속
            print(f"  [WARN] 배치 {i // BATCH + 1} 실패: {type(e).__name__} {e}", flush=True)
    return got


def detect(urls: list) -> dict:
    """1차 조회 + 못 받은 건 1회 재시도. 재시도가 교차게시를 실제로 더 찾아낸다(실측)."""
    got = _query_actor(urls)
    missing = [u for u in urls if shortcode(u) not in got]
    if missing:
        print(f"  1차 미응답 {len(missing)}건 → 재시도", flush=True)
        retry = _query_actor(missing)
        recovered = sum(1 for k, v in retry.items() if (v.get("fb") or 0) > 0)
        got.update(retry)
        print(f"  재시도 회수 {len(retry)}건 (그중 교차게시 {recovered}건)", flush=True)
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=["active", "all"], default="active")
    ap.add_argument("--apply", action="store_true", help="DB 에 반영(없으면 dry-run)")
    ap.add_argument("--from-json", nargs="+",
                    help="{url: {ig,fb,all}} 형태 기존 결과 재사용. **활성·종료 두 파일을 모두** 넘길 것.")
    args = ap.parse_args()

    db = get_client()
    targets = _load_targets(db, args.scope)
    print(f"[cross-post] 대상 {len(targets)}건 (scope={args.scope})")
    if not targets:
        return 0

    if args.from_json:
        # load_fb_by_shortcode 는 FB>0 인 것만 담는다 → 여기 없는 글은 '교차게시 아님'으로 본다.
        # ⚠️ 그래서 스윕 파일을 하나만 넘기면 나머지 절반이 통째로 '해제' 판정될 수 있다.
        fb_map = load_fb_by_shortcode(args.from_json)
        got = {code: {"fb": fb} for code, fb in fb_map.items()}
        print(f"[cross-post] 기존 결과 {len(args.from_json)}개 파일 · 교차게시 {len(got)}건 재사용 — Apify 호출 없음")
    else:
        got = detect([a["url"] for a in targets])

    to_true, to_false, unknown = [], [], []
    for a in targets:
        code = shortcode(a["url"])
        g = got.get(code)
        cur = a.get("is_cross_posted")
        if g is None and not args.from_json:
            unknown.append(a)                       # 응답 없음 = 대개 삭제된 글 → 판정 유지
            continue
        # --from-json 은 이미 전수조사한 결과라, 목록에 없으면 '교차게시 아님'이 맞다.
        want = ((g or {}).get("fb") or 0) > 0
        if want and cur is not True:
            to_true.append(a)
        elif not want and cur is True:
            # 한 번 교차게시였던 글이 FB 0 으로 바뀌는 건 드물다. 값이 실제로 왔을 때만 내린다.
            to_false.append(a)

    print(f"[cross-post] 교차게시 신규 {len(to_true)}건 · 해제 {len(to_false)}건 · 판정보류(무응답) {len(unknown)}건")
    for a in to_true[:20]:
        g = got[shortcode(a["url"])]
        print(f"   + {(a.get('account_name') or '?'):<16} FB {g.get('fb'):>9,}  {a['url']}")
    if not args.apply:
        print("[cross-post] dry-run — 쓰지 않았다. 반영하려면 --apply")
        return 0

    for flag, group in ((True, to_true), (False, to_false)):
        for a in group:
            db.table("sponsored_posts").update({"is_cross_posted": flag}).eq("id", a["id"]).execute()
    print(f"[cross-post] 반영 완료: true {len(to_true)}건 · false {len(to_false)}건")

    after = (db.table("sponsored_posts").select("id", count="exact")
               .eq("is_cross_posted", True).execute())
    print(f"[cross-post] 현재 is_cross_posted=true 총 {after.count}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
