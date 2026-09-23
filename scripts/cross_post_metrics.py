"""IG↔Facebook 교차게시 합산의 증분 규칙 (Python 쪽 정본).

배경(2026-09-22 실측): 인스타 앱이 보여주는 조회수는 IG+FB 합계인데 우리는 IG 전용값만 저장해
퐁패밀리 건이 대시보드 414,066 vs 실제 1,125,552 로 벌어졌다. 사용자 지시로 교차게시 글의
``play_count`` 에 **합계**를 저장하고, 그 중 FB 몫을 ``fb_play_count`` 에 남긴다.

그래서 합산을 시작한 날 ``play_count`` 가 크게 뛴다. 그 71만이 **언제 쌓였는지는 알 수 없다** —
과거 날짜별 FB 조회수를 되살릴 방법이 없다.

처음엔 '아무 날에도 얹지 않는' 쪽으로 만들었으나, 그러면 그만큼이 어느 날 증분에도 안 잡혀
일일 리포트 총합에서 영구히 빠진다(실측 영향: 리포트 대상 쫀득바 기준 718,363).
**사용자 결정(2026-09-22): 총량이 사라지는 것보다 낫다 — 전환일 하루에 몰아넣는다.**

⚠️ 전환일은 하루 증분이 크게 튄다(퐁패밀리 51,068 → 762,554). 리포트 TOP10·그래프 봉우리는
   **실제 급상승이 아니라 합산 전환**이다 — 급변 알림 트리아지 때 그날 fb_play_count 첫 등장을 먼저 볼 것.

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
    """FB 몫 증분. **첫 FB 측정분도 그날에 귀속**한다(총량 보존 — 사용자 결정 2026-09-22)."""
    cur, base, has = None, 0, False
    for r in rows or []:
        v = _num(r.get("fb_play_count"))
        if r.get("measured_at") == target:
            cur = v
        elif r.get("measured_at") < target and v is not None and v > 0:
            has = True
            if v > base:
                base = v
    if cur is None or cur <= 0:
        return 0
    if not has:
        return cur          # 첫 FB 측정 = 그때까지 쌓인 FB 전액을 그날에 귀속
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

def prev_ig_baseline(prev_play, prev_fb):
    """역행 가드가 새 IG 실측과 비교해야 할 **직전 IG 전용값**. 측정이 없으면 None.

    🚨 2026-09-23 실사고: 저장된 ``play_count`` 는 교차게시 글에서 **IG+FB 합계**다.
       새 IG 실측(약 41만)을 그 합계(112만)와 비교하니 매번 '역행'으로 잡혀 합계로 clamp 됐고,
       그 뒤 FB 를 다시 더해 **이중 계상**이 났다(퐁패밀리 누적 2,207,775, 활성 15건 중 12건 오염).
       비교도 clamp 도 반드시 이 값 기준이어야 한다.
    """
    if not isinstance(prev_play, (int, float)) or isinstance(prev_play, bool):
        return None
    return prev_play - (prev_fb or 0)

