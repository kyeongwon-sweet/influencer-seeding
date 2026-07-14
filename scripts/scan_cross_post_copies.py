"""교차-복사 오염 스캔 (재발방지 정기 점검용).

DB(post_daily_stats) 전수에서 '같은 (날짜, play_count)을 2개 이상 게시물이 ≥2일 공유'하는
교차-복사 시그니처를 찾는다. 미러링/종료 게시물끼리 시트 드래그-채우기로 누적 궤적이
복제되는 오염을 탐지하기 위한 것.

주의: 바이럴 배너/영상의 라운드 추정값(58000, 60000 등)은 우연히 겹쳐 오탐이 많다.
      비-라운드 값이 여러 날 일치하는 쌍이 진짜 복사 신호다.

실행: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 환경변수 필요.
      PYTHONUTF8=1 python scripts/scan_cross_post_copies.py [최소일수(기본2)] [최소값(기본10000)]
"""
import os
import sys
import json
import urllib.request
import urllib.parse
from collections import defaultdict

U = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
K = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}"}
MIN_DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
MIN_VALUE = int(sys.argv[2]) if len(sys.argv) > 2 else 10000


def page(table, query):
    out, off = [], 0
    while True:
        req = urllib.request.Request(
            f"{U}/rest/v1/{table}?{urllib.parse.urlencode(query)}",
            headers={**H, "Range": f"{off}-{off + 999}"},
        )
        chunk = json.load(urllib.request.urlopen(req))
        out += chunk
        if len(chunk) < 1000:
            return out
        off += 1000


def is_round(v):
    """1000 단위로 딱 떨어지는 라운드 추정값(오탐 후보)인지."""
    return v % 1000 == 0


def main():
    posts = {p["id"]: p for p in page("sponsored_posts", {"select": "id,account_name,url,ended_at"})}
    stats = page("post_daily_stats", {"select": "post_id,measured_at,play_count"})

    dv = defaultdict(set)  # (date, value) -> {post_id}
    for s in stats:
        pid, v = s.get("post_id"), s.get("play_count") or 0
        if pid and pid in posts and v >= MIN_VALUE:
            dv[(s["measured_at"][:10], v)].add(pid)

    pair_dates = defaultdict(set)  # (pidA, pidB) -> {(date, value)}
    for (d, v), pids in dv.items():
        if len(pids) >= 2:
            pl = sorted(pids)
            for i in range(len(pl)):
                for j in range(i + 1, len(pl)):
                    pair_dates[(pl[i], pl[j])].add((d, v))

    genuine, noisy = [], []
    for (a, b), dvs in pair_dates.items():
        if len(dvs) < MIN_DAYS:
            continue
        vals = sorted({v for _, v in dvs}, reverse=True)
        (noisy if all(is_round(v) for v in vals) else genuine).append((a, b, dvs, vals))

    genuine.sort(key=lambda x: -len(x[2]))
    print(f"교차-복사 스캔: stats {len(stats)}행 / 진짜의심 {len(genuine)}쌍 / 라운드오탐 {len(noisy)}쌍\n")
    print("=== 진짜 복사 의심 (비-라운드 값 ≥%d일 공유) ===" % MIN_DAYS)
    for a, b, dvs, vals in genuine:
        na, nb = posts[a]["account_name"], posts[b]["account_name"]
        ea = (posts[a].get("ended_at") or "-")[:10]
        eb = (posts[b].get("ended_at") or "-")[:10]
        print(f"  {na}(종료{ea}) ↔ {nb}(종료{eb}): {len(dvs)}일, 값 {vals[:3]}")
    if not genuine:
        print("  (없음 — 깨끗)")


if __name__ == "__main__":
    main()
