"""교차-복사 오염 스캔 (재발방지 정기 점검용).

DB(post_daily_stats) 전수에서 '같은 (날짜, 값)을 다른 게시물과 서로 다른 날짜 2일 이상 공유'하는
교차-복사 시그니처를 찾는다. 미러링/종료 게시물끼리 시트 드래그-채우기로 누적 궤적이 복제되거나,
한 번의 수집에서 같은 값이 두 게시물에 써지는 오염을 탐지하기 위한 것.

2026-11-20 기준을 시트 입력 복사 검사(web/lib/stats-import-copy.ts)와 맞췄다.
  - 조회수(play_count)와 도달수(reach_count)를 함께 본다(조회수→배너 도달수 교차 복사 포함).
  - 값 1,000 이상, 100 단위 반올림값은 '진짜 의심'에서 뺀다(우연 일치 노이즈).
  이유: 시트 입력 검사가 'DB에 이미 같은 값'은 매일 경고하지 않게 바뀌어서, DB에 이미 든 교차복사는
  이 주간 스캔이 유일한 보고처가 됐다. 예전 기준(조회수 1만 이상만)은 배너 도달수와 1천~1만 사이
  위성 값 대부분을 못 봤다(11-20 실측: 예전 96쌍 → 새 기준 286쌍).

주의: 바이럴 배너/영상의 라운드 추정값(58,000·60,000 등)은 우연히 겹쳐 오탐이 많다.
      라운드값까지 쳐야 2일이 되는 쌍은 '라운드오탐'으로 따로 센다(목록에는 안 띄움).

실행: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 환경변수 필요.
      PYTHONUTF8=1 python scripts/scan_cross_post_copies.py [최소일수(기본2)] [최소값(기본1000)]
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

# web/lib/stats-import-copy.ts 의 COPY_MIN_SHARED_DATES·COPY_MIN_VALUE·COPY_ROUNDING_EXCLUDE 와 같아야 한다
# (test_scan_cross_post_copies.py 가 두 파일을 대조한다).
MIN_DAYS_DEFAULT = 2
MIN_VALUE_DEFAULT = 1000
ROUNDING_EXCLUDE = 100
METRICS = ("play_count", "reach_count")
PAGE_SIZE = 1000


def is_round(v):
    """100 단위로 딱 떨어지는 라운드 추정값(오탐 후보)인지."""
    return v % ROUNDING_EXCLUDE == 0


def page(base_url, headers, table, query, opener=urllib.request.urlopen):
    """PostgREST 표를 끝까지 넘겨 읽는다.

    ⚠️ 마지막 정렬 키가 유일(id)해야 한다. 정렬 없이 Range 로 넘기면 페이지 경계에서 행이
       빠지거나 겹친다(대시보드 조회수 누락 사고 계열). 예전 이 스캔도 정렬 없이 넘기고 있었다.
    """
    order = str(query.get("order") or "")
    last_key = order.split(",")[-1].split(".")[0].strip() if order else ""
    if last_key != "id":
        raise ValueError(f"page({table}): 마지막 정렬 키가 id 여야 합니다 — order={order!r}")
    rows, offset = [], 0
    while True:
        req = urllib.request.Request(
            f"{base_url}/rest/v1/{table}?{urllib.parse.urlencode(query)}",
            headers={**headers, "Range": f"{offset}-{offset + PAGE_SIZE - 1}"},
        )
        chunk = json.load(opener(req))
        rows += chunk
        if len(chunk) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def _number(value):
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else f


def find_copy_pairs(stats, post_ids, min_days=MIN_DAYS_DEFAULT, min_value=MIN_VALUE_DEFAULT):
    """같은 (날짜, 값)을 공유하는 게시물 쌍을 찾는다. 순수 함수 — 테스트 대상.

    반환 (genuine, noisy)
      genuine: [(a, b, 날짜 set, 값 내림차순 list, metric set)] — 비-라운드 값으로 서로 다른 날짜 min_days일 이상
               (공유 날짜가 많은 순, 같으면 최근 날짜 순)
      noisy:   [(a, b)] — 라운드값까지 쳐야 min_days일이 되는 쌍(우연 일치 후보)
    한 게시물의 조회수와 도달수가 같은 값이어도 자기 자신과는 쌍이 되지 않는다.
    """
    post_ids = set(post_ids)
    owners_at = defaultdict(lambda: defaultdict(set))  # (date, value) -> post_id -> {metric}
    for s in stats:
        pid = s.get("post_id")
        if not pid or pid not in post_ids:
            continue
        date = str(s.get("measured_at") or "")[:10]
        if not date:
            continue
        for metric in METRICS:
            v = _number(s.get(metric))
            if v is None or v < min_value:
                continue
            owners_at[(date, v)][pid].add(metric)

    real_dates = defaultdict(set)
    all_dates = defaultdict(set)
    values = defaultdict(set)
    metrics = defaultdict(set)
    for (date, v), owners in owners_at.items():
        if len(owners) < 2:
            continue
        ids = sorted(owners)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = (ids[i], ids[j])
                all_dates[key].add(date)
                if is_round(v):
                    continue
                real_dates[key].add(date)
                values[key].add(v)
                metrics[key] |= owners[ids[i]] | owners[ids[j]]

    genuine = [
        (a, b, real_dates[(a, b)], sorted(values[(a, b)], reverse=True), metrics[(a, b)])
        for (a, b) in real_dates
        if len(real_dates[(a, b)]) >= min_days
    ]
    # 안정 정렬: 공유 날짜 많은 순 → 최근 날짜 순 → id 순(결정적)
    genuine.sort(key=lambda x: (x[0], x[1]))
    genuine.sort(key=lambda x: max(x[2]), reverse=True)
    genuine.sort(key=lambda x: len(x[2]), reverse=True)
    noisy = [
        (a, b) for (a, b), dates in all_dates.items()
        if len(dates) >= min_days and len(real_dates.get((a, b), ())) < min_days
    ]
    return genuine, noisy


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    min_days = int(argv[0]) if len(argv) > 0 else MIN_DAYS_DEFAULT
    min_value = int(argv[1]) if len(argv) > 1 else MIN_VALUE_DEFAULT
    base_url = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    posts = {p["id"]: p for p in page(base_url, headers, "sponsored_posts",
                                       {"select": "id,account_name,url,ended_at", "order": "id.asc"})}
    stats = page(base_url, headers, "post_daily_stats",
                 {"select": "id,post_id,measured_at,play_count,reach_count", "order": "id.asc"})
    genuine, noisy = find_copy_pairs(stats, posts.keys(), min_days, min_value)

    report_lines = []

    def emit(line=""):
        print(line)
        report_lines.append(line)

    emit(f"교차-복사 스캔: stats {len(stats)}행 / 진짜의심 {len(genuine)}쌍 / 라운드오탐 {len(noisy)}쌍")
    emit(f"기준: 조회수·도달수 {min_value:,} 이상, {ROUNDING_EXCLUDE} 단위 반올림값 제외, 서로 다른 날짜 {min_days}일 이상 같은 값")
    emit()
    emit("=== 진짜 복사 의심 (비-라운드 값 ≥%d일 공유) ===" % min_days)
    for a, b, dates, vals, mets in genuine:
        na, nb = posts[a]["account_name"], posts[b]["account_name"]
        ea = (posts[a].get("ended_at") or "-")[:10]
        eb = (posts[b].get("ended_at") or "-")[:10]
        tag = " [도달수 포함]" if "reach_count" in mets else ""
        emit(f"  {na}(종료{ea}) ↔ {nb}(종료{eb}): {len(dates)}일(최근 {max(dates)}), 값 {vals[:3]}{tag}")
    if not genuine:
        emit("  (없음 — 깨끗)")

    report_path = os.environ.get("SCAN_REPORT_PATH")
    if report_path:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("\n".join(report_lines) + "\n")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"genuine_count={len(genuine)}\n")
            f.write(f"noisy_count={len(noisy)}\n")


if __name__ == "__main__":
    main()
