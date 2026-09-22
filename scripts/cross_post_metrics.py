"""IG↔Facebook 교차게시 합산의 증분 규칙 (Python 쪽 정본).

배경(2026-09-22 실측): 인스타 앱이 보여주는 조회수는 IG+FB 합계인데 우리는 IG 전용값만 저장해
퐁패밀리 건이 대시보드 414,066 vs 실제 1,125,552 로 벌어졌다. 사용자 지시로 교차게시 글의
``play_count`` 에 **합계**를 저장하고, 그 중 FB 몫을 ``fb_play_count`` 에 남긴다.

그래서 합산을 시작한 날 ``play_count`` 가 크게 뛴다. 그 점프를 그대로 증분으로 치면
하루에 71만이 찍혀 리포트·그래프가 망가진다. 그런데 그 71만이 **언제 쌓였는지는 알 수 없다** —
과거 날짜별 FB 조회수를 되살릴 방법이 없다(값을 지어내지 않는다는 절대 규칙).
→ 첫 FB 측정은 어느 날에도 얹지 않고, 두 번째 측정부터 실제 증가분만 더한다.
→ 교차게시 글은 의도적으로 **Σ증분 < 최종 누적**이 된다.

⚠️ 대시보드(web/app/monitoring/lib.ts 의 fbAt·fbIncrement·safeIncrement)와 **같은 규칙**이어야 한다.
   한쪽만 고치면 대시보드와 슬랙 리포트 숫자가 조용히 갈린다.
"""


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def fb_at(rows, row) -> float:
    """그 측정일 시점에 ``play_count`` 에 섞여 있는 FB 몫.

    그날 값이 비면 **직전까지 알려진 최대값**을 이어 쓴다. FB 조회가 하루 실패해도
    ``play_count`` 는 역행가드(mono)로 합계를 유지하므로, 0 으로 읽으면 그날 IG 가
    FB 만큼 갑자기 늘어난 것처럼 보여 증분이 폭발한다.
    교차게시가 아닌 글은 어느 행에도 값이 없어 항상 0 → 기존 동작과 완전히 같다.
    """
    own = _num((row or {}).get("fb_play_count"))
    if own is not None and own > 0:
        return own
    carried = 0
    for r in rows or []:
        if r.get("measured_at") > row.get("measured_at"):
            continue
        v = _num(r.get("fb_play_count"))
        if v is not None and v > carried:
            carried = v
    return carried


def fb_increment(rows, target) -> float:
    """FB 몫 증분. 첫 FB 측정은 0(언제 쌓였는지 모르는 과거분을 특정 날에 얹지 않는다)."""
    cur, base, has = None, 0, False
    for r in rows or []:
        v = _num(r.get("fb_play_count"))
        if r.get("measured_at") == target:
            cur = v
        elif r.get("measured_at") < target and v is not None and v > 0:
            has = True
            if v > base:
                base = v
    if cur is None or cur <= 0 or not has:
        return 0
    return max(0, cur - base)


def ig_only(rows, row):
    """증분 계산용 IG 계열 값 = play_count - (그 시점 FB 몫). 측정이 없으면 None."""
    pc = _num((row or {}).get("play_count"))
    if pc is None:
        return None
    return pc - fb_at(rows, row)

# ── 스윕 결과 읽기 ────────────────────────────────────────────────────
# 전수조사 결과는 {url: {ig, fb, all}} 형태 JSON 이고 **활성분·종료분 두 파일로 나뉘어 있다**
# (data/output/crosspost_sweep_active_*.json, _ended_*.json). 한 파일만 받으면 절반이 조용히 빠지므로
# 두 스크립트(detect_cross_posts·backfill_cross_post_fb) 모두 여러 파일을 받는다.

import io as _io
import json as _json
import re as _re

_SHORTCODE_RE = _re.compile(r"/(?:p|reels|reel|tv)/([A-Za-z0-9_-]+)")


def shortcode(url: str):
    """게시물 URL → shortcode. 게시물 URL 이 아니면 None."""
    m = _SHORTCODE_RE.search(url or "")
    return m.group(1) if m else None


def load_fb_by_shortcode(paths) -> dict:
    """스윕 결과 JSON 여러 개 → {shortcode: fb_play_count}. FB 가 0/없음이면 담지 않는다.

    ⚠️ 0 을 담지 않는 이유: 0 은 '교차게시 아님'이지 '측정값 0'이 아니다. 담으면
       교차게시 해제/보정 판정이 '실측 0' 인 것처럼 오동작한다.
    """
    if isinstance(paths, (str, bytes)):
        paths = [paths]
    out = {}
    for path in paths:
        for u, v in _json.load(_io.open(path, encoding="utf-8")).items():
            fb = (v or {}).get("fb")
            code = shortcode(u)
            if code and isinstance(fb, (int, float)) and not isinstance(fb, bool) and fb > 0:
                out[code] = int(fb)
    return out
