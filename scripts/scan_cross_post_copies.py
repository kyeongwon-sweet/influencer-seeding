"""교차-복사 오염 스캔 (재발방지 정기 점검용).

DB(post_daily_stats) 전수에서 '같은 (날짜, 값)을 다른 게시물과 서로 다른 날짜 2일 이상 공유'하는 쌍을 찾고,
그중 **복사 증거가 있는 쌍만** '진짜 의심'으로 보고한다.

증거 (2026-11-26 사용자 승인 "고쳐줘")
  ① 시트 수기값: 겹친 날 중 한쪽이 사람이 시트에 적은 값(manual=true)인 날이 2일 이상.
     실제 복사 오염 경로(시트 복사·드래그 → importStats)다. 2026-07 박홍↔먹샘, 배너 도달수 복사가 이 모양.
  ② 같은 영상 중복 등록 의심: 자동 측정값끼리 조회수·도달수·좋아요·댓글이 모두 같은 날이 3일 이상이고,
     두 게시물이 함께 측정된 날의 80% 이상. 같은 영상이 두 행으로 등록돼 같은 수집 결과를 받는 경우.
  자동 측정값끼리 조회수만 같은 쌍은 '우연 일치'로 세기만 하고 목록에서 뺀다.

  이유(11-26 진단): 조회수 1,000~3,000에 머문 저조회 위성 쇼츠·사진 수백 개가 같은 숫자에서 우연히 만난다.
  유튜브 8개를 실측해 보니 DB 값이 진짜였고, 수집기는 영상 ID가 같을 때만 값을 붙인다. 11-20에 기준을
  1천 이상으로 넓히면서 이런 우연 일치가 22쌍 → 324쌍으로 불어났었다.

슬랙 알림은 '최근 14일 안에 증거 날짜가 있는 진짜 의심'이 있을 때만 보낸다(옛 오염 목록을 매주 반복하지 않음).
전체 목록은 보고서 파일(artifact)에 남긴다.

값 기준은 시트 입력 복사 검사(web/lib/stats-import-copy.ts)와 같다: 조회수·도달수, 1,000 이상, 100 단위 반올림값 제외.

실행: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 환경변수 필요.
      PYTHONUTF8=1 python scripts/scan_cross_post_copies.py [최소일수(기본2)] [최소값(기본1000)]
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict, namedtuple
from datetime import date, timedelta

from kst_dates import kst_today

# web/lib/stats-import-copy.ts 의 COPY_MIN_SHARED_DATES·COPY_MIN_VALUE·COPY_ROUNDING_EXCLUDE 와 같아야 한다
# (test_scan_cross_post_copies.py 가 두 파일을 대조한다).
MIN_DAYS_DEFAULT = 2
MIN_VALUE_DEFAULT = 1000
ROUNDING_EXCLUDE = 100
METRICS = ("play_count", "reach_count")
PAGE_SIZE = 1000

DUPLICATE_MIN_DAYS = 3     # 같은 영상 중복 등록: 네 숫자가 모두 같은 날이 최소 이만큼
DUPLICATE_MIN_SHARE = 0.8  # …그리고 두 게시물이 함께 측정된 날 중 이 비율 이상
RECENT_DAYS = 14           # 슬랙 알림은 이 기간 안에 증거 날짜가 있는 쌍이 있을 때만

KIND_SHEET = "시트 수기"
KIND_DUPLICATE = "같은 영상 중복 의심"

# dates = 증거 날짜(시트 수기값이 낀 날 ∪ 네 숫자가 같은 날), values = 그날들의 공유 값(내림차순)
CopyPair = namedtuple("CopyPair", "a b dates values metrics kinds")


def is_round(v):
    """100 단위로 딱 떨어지는 라운드 추정값(오탐 후보)인지."""
    return v % ROUNDING_EXCLUDE == 0


def page(base_url, headers, table, query, opener=urllib.request.urlopen):
    """PostgREST 표를 끝까지 넘겨 읽는다.

    ⚠️ 마지막 정렬 키가 유일(id)해야 한다. 정렬 없이 Range 로 넘기면 페이지 경계에서 행이
       빠지거나 겹친다(대시보드 조회수 누락 사고 계열).
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


def _is_manual(row):
    return bool(row and row.get("manual"))


def _same_record(ra, rb):
    """두 자동 측정 행의 조회수·도달수·좋아요·댓글이 모두 같은지(같은 수집 결과를 받은 흔적)."""
    if not ra or not rb or _is_manual(ra) or _is_manual(rb):
        return False
    if ra.get("likes_count") is None:
        return False
    return all(_number(ra.get(k)) == _number(rb.get(k))
               for k in ("play_count", "reach_count", "likes_count", "comments_count"))


def find_copy_pairs(stats, post_ids, min_days=MIN_DAYS_DEFAULT, min_value=MIN_VALUE_DEFAULT):
    """같은 (날짜, 값)을 공유하는 게시물 쌍을 찾아 증거로 나눈다. 순수 함수 — 테스트 대상.

    반환 (genuine, noisy, coincidence)
      genuine:     [CopyPair] — 복사 증거(① 시트 수기값 ② 같은 영상 중복 의심)가 있는 쌍.
                   증거 날짜 많은 순 → 최근 순 → id 순.
      noisy:       [(a, b)] — 라운드값까지 쳐야 min_days일이 되는 쌍(우연 일치 후보).
      coincidence: [(a, b)] — 비-라운드 값으로 min_days일 이상 겹쳤지만 증거가 없는 쌍(자동 측정값끼리 우연 일치).
    한 게시물의 조회수와 도달수가 같은 값이어도 자기 자신과는 쌍이 되지 않는다.
    """
    post_ids = set(post_ids)
    rows = {}
    measured = defaultdict(set)
    owners_at = defaultdict(lambda: defaultdict(set))  # (date, value) -> post_id -> {metric}
    for s in stats:
        pid = s.get("post_id")
        if not pid or pid not in post_ids:
            continue
        d = str(s.get("measured_at") or "")[:10]
        if not d:
            continue
        rows[(pid, d)] = s
        measured[pid].add(d)
        for metric in METRICS:
            v = _number(s.get(metric))
            if v is None or v < min_value:
                continue
            owners_at[(d, v)][pid].add(metric)

    real_points = defaultdict(set)  # (a, b) -> {(date, value)} 비-라운드
    all_dates = defaultdict(set)
    metrics = defaultdict(set)
    for (d, v), owners in owners_at.items():
        if len(owners) < 2:
            continue
        ids = sorted(owners)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                key = (ids[i], ids[j])
                all_dates[key].add(d)
                if is_round(v):
                    continue
                real_points[key].add((d, v))
                metrics[key] |= owners[ids[i]] | owners[ids[j]]

    genuine, coincidence = [], []
    for (a, b), points in real_points.items():
        dates = {d for d, _ in points}
        if len(dates) < min_days:
            continue
        manual_dates = {d for d in dates if _is_manual(rows.get((a, d))) or _is_manual(rows.get((b, d)))}
        same_dates = {d for d in dates if _same_record(rows.get((a, d)), rows.get((b, d)))}
        both_measured = measured[a] & measured[b]
        kinds, evidence = [], set()
        if len(manual_dates) >= min_days:
            kinds.append(KIND_SHEET)
            evidence |= manual_dates
        if len(same_dates) >= DUPLICATE_MIN_DAYS and len(same_dates) >= DUPLICATE_MIN_SHARE * len(both_measured):
            kinds.append(KIND_DUPLICATE)
            evidence |= same_dates
        if not kinds:
            coincidence.append((a, b))
            continue
        vals = sorted({v for d, v in points if d in evidence}, reverse=True)
        genuine.append(CopyPair(a, b, evidence, vals, metrics[(a, b)], tuple(kinds)))

    # 안정 정렬: 증거 날짜 많은 순 → 최근 날짜 순 → id 순(결정적)
    genuine.sort(key=lambda p: (p.a, p.b))
    genuine.sort(key=lambda p: max(p.dates), reverse=True)
    genuine.sort(key=lambda p: len(p.dates), reverse=True)
    noisy = [
        (a, b) for (a, b), dates in all_dates.items()
        if len(dates) >= min_days and len({d for d, _ in real_points.get((a, b), ())}) < min_days
    ]
    return genuine, noisy, coincidence


def recent_cutoff(today, days=RECENT_DAYS):
    """KST 오늘(YYYY-MM-DD)에서 days일 전 날짜."""
    return (date.fromisoformat(today) - timedelta(days=days)).isoformat()


def recent_pairs(genuine, today, days=RECENT_DAYS):
    """최근 days일 안에 증거 날짜가 있는 진짜 의심. 슬랙 알림은 이게 있을 때만 보낸다."""
    cutoff = recent_cutoff(today, days)
    return [p for p in genuine if max(p.dates) >= cutoff]


def main(argv=None, today=None):
    argv = sys.argv[1:] if argv is None else argv
    min_days = int(argv[0]) if len(argv) > 0 else MIN_DAYS_DEFAULT
    min_value = int(argv[1]) if len(argv) > 1 else MIN_VALUE_DEFAULT
    today = today or kst_today()
    base_url = os.environ.get("SUPABASE_URL") or os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    posts = {p["id"]: p for p in page(base_url, headers, "sponsored_posts",
                                       {"select": "id,account_name,url,ended_at", "order": "id.asc"})}
    stats = page(base_url, headers, "post_daily_stats",
                 {"select": "id,post_id,measured_at,play_count,reach_count,likes_count,comments_count,manual",
                  "order": "id.asc"})
    genuine, noisy, coincidence = find_copy_pairs(stats, posts.keys(), min_days, min_value)
    recent = recent_pairs(genuine, today)
    recent_keys = {(p.a, p.b) for p in recent}

    report_lines = []

    def emit(line=""):
        print(line)
        report_lines.append(line)

    emit(f"교차-복사 스캔: stats {len(stats)}행 / 진짜의심 {len(genuine)}쌍 / 라운드오탐 {len(noisy)}쌍")
    emit(f"최근 {RECENT_DAYS}일({recent_cutoff(today)}~{today}) 새 증거가 있는 진짜의심: {len(recent)}쌍 (0이면 슬랙 알림 안 보냄)")
    emit(f"자동 측정값끼리 조회수만 같은 우연 일치(복사 아님, 목록 제외): {len(coincidence)}쌍")
    emit(f"기준: 조회수·도달수 {min_value:,} 이상, {ROUNDING_EXCLUDE} 단위 반올림값 제외, 서로 다른 날짜 {min_days}일 이상 같은 값"
         f" + 증거(① 한쪽이 시트 수기값인 날 {min_days}일 이상 ② 네 숫자가 모두 같은 자동값 {DUPLICATE_MIN_DAYS}일 이상·"
         f"함께 측정한 날의 {int(DUPLICATE_MIN_SHARE * 100)}% 이상)")
    emit()
    emit("=== 진짜 복사 의심 (비-라운드 값 ≥%d일 공유) ===" % min_days)
    ordered = [p for p in genuine if (p.a, p.b) in recent_keys] + [p for p in genuine if (p.a, p.b) not in recent_keys]
    for p in ordered:
        na, nb = posts[p.a]["account_name"], posts[p.b]["account_name"]
        ea = (posts[p.a].get("ended_at") or "-")[:10]
        eb = (posts[p.b].get("ended_at") or "-")[:10]
        tags = "".join(f" [{k}]" for k in p.kinds) + (" [도달수 포함]" if "reach_count" in p.metrics else "")
        prefix = "[최근] " if (p.a, p.b) in recent_keys else ""
        emit(f"  {prefix}{na}(종료{ea}) ↔ {nb}(종료{eb}): {len(p.dates)}일(최근 {max(p.dates)}), 값 {p.values[:3]}{tags}")
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
            f.write(f"recent_count={len(recent)}\n")
            f.write(f"coincidence_count={len(coincidence)}\n")


if __name__ == "__main__":
    main()
