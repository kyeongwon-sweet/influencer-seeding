#!/usr/bin/env python3
"""진단·검증 조회 공용 모듈 — 애드혹 스크립트가 매번 밟던 함정을 구조적으로 막는다.

왜 만들었나 (2026-09-04, 하루에 같은 종류로 네 번 틀림):
  ① `play_count`만 조회했는데 값이 `reach_count`에 있어서 "오염값 0행"이라 오판.
  ② 출력에서 `format(v or 0)`을 써서 **NULL을 0으로** 찍음 — 프로젝트 절대규칙(공백≠0)을
     정작 진단 스크립트에서 위반. 0은 '아무도 안 봤다'는 실측이고 NULL은 '안 재봤다'다.
  ③ `limit=3000`을 줬는데 PostgREST 서버 상한이 1000이라 **첫 페이지만** 받고 그 수를
     전체 건수로 보고(실제 1,196 → 1,000으로 보고). 세 날짜가 전부 정확히 1000이었는데 놓쳤다.
  ④ 검증 날짜 창을 내가 어림해서(08-28~) 실제 변경일(08-26)을 비켜 보고 "문제 없음" 결론.

이 모듈을 쓰면 ①~④가 호출 단계에서 막힌다. repo에 fetch_all 재구현이 12곳 넘게 있어
각자 실수할 자리가 그만큼 많았다 — 새 진단 스크립트는 이걸 import 할 것.
"""

from __future__ import annotations

import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request

PAGE_MAX = 1000          # PostgREST 서버 상한. limit을 더 크게 줘도 이 이상 오지 않는다.
_ENV_CANDIDATES = (
    r"C:\Users\hwangkw\AI\.claude\influencer-seeding\web\.env.local",
    r"C:\Users\hwangkw\_yeomun_wt\web\.env.local",
)


def load_env(paths=_ENV_CANDIDATES) -> dict:
    """SUPABASE URL/KEY를 찾는다. ⚠️ 값이 빈 문자열인 파일은 건너뛴다 —
    워크트리 web/.env.local 은 전부 ""로 채워진 placeholder라 그대로 쓰면 조용히 실패한다."""
    for path in paths:
        if not os.path.exists(path):
            continue
        env = {}
        for line in io.open(path, encoding="utf-8-sig"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
        url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL") or ""
        key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
        if url and key:
            return {"url": url, "key": key, "source": path}
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL") or ""
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if url and key:
        return {"url": url, "key": key, "source": "environ"}
    raise RuntimeError(
        "SUPABASE URL/KEY를 찾지 못했습니다. 값이 빈 placeholder인 .env.local 도 무효로 봅니다 — "
        "정본 repo의 web/.env.local 또는 환경변수를 확인하세요."
    )


def _request(env, path, params, prefer=None, transport=None):
    url = env["url"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"apikey": env["key"], "Authorization": "Bearer " + env["key"]}
    if prefer:
        headers["Prefer"] = prefer
    if transport is not None:                     # 테스트 주입
        return transport(url, headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=240) as resp:
        return resp.read(), dict(resp.headers)


def _require_unique_order(params):
    """유일 정렬키 없는 range/offset 페이지네이션은 경계 행을 잃는다([[pagination-unique-sort-key]])."""
    order = str(params.get("order") or "")
    if "id" not in order:
        raise RuntimeError(
            "fetch_all: order 에 유일 정렬키(id)가 없습니다 — measured_at 같은 중복 키만으로 "
            "페이지네이션하면 경계 행이 누락됩니다. 예: order='id.asc' 또는 'measured_at.asc,id.asc'"
        )


def fetch_all(env, path, params, *, page=PAGE_MAX, transport=None) -> list[dict]:
    """전 페이지를 끝까지 가져온다. limit/offset을 호출부가 직접 다루지 못하게 막는다."""
    if "limit" in params or "offset" in params:
        raise RuntimeError("fetch_all: limit/offset 을 직접 주지 마세요 — 절단의 원인입니다.")
    _require_unique_order(params)
    rows, off = [], 0
    while True:
        q = dict(params, limit=page, offset=off)
        body, _ = _request(env, path, q, transport=transport)
        chunk = json.loads(body) if body else []
        rows += chunk
        if len(chunk) < page:
            return rows
        off += page


def count(env, path, params, *, transport=None) -> int:
    """행 수는 받아서 세지 말고 서버에 센다(Content-Range). 절단 오해가 원천적으로 불가능."""
    q = dict(params, select=params.get("select", "id"), limit=1)
    body, headers = _request(env, path, q, prefer="count=exact", transport=transport)
    del body
    rng = headers.get("Content-Range") or headers.get("content-range") or ""
    total = rng.split("/")[-1]
    if not total.isdigit():
        raise RuntimeError(f"count: Content-Range 를 읽지 못했습니다 → {rng!r}")
    return int(total)


def metric(row) -> int | None:
    """지표 한 값. play_count 우선, 없으면 reach_count(배너·매거진). 둘 다 없으면 None.
    ⚠️ play_count == 0 은 실측 0이므로 None으로 뭉개지 않는다."""
    if row is None:
        return None
    play = row.get("play_count")
    if play is not None:
        return play
    return row.get("reach_count")


def fmt(value) -> str:
    """None 은 반드시 'NULL' 로. 0 과 절대 같은 문자열이 되지 않게 한다(공백≠0)."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return format(value, ",")
    return str(value)


def assert_window_covers(manifest_dates, date_from, date_to) -> None:
    """검증 창이 '변경 매니페스트'의 모든 날짜를 덮는지 확인. 안 덮으면 검증이 성립하지 않는다.
    남의 작업을 검증할 때는 대상 날짜를 어림하지 말고 백업/작업로그에서 받아 이 함수에 넣는다."""
    missed = sorted({str(d)[:10] for d in manifest_dates if not (date_from <= str(d)[:10] <= date_to)})
    if missed:
        raise RuntimeError(
            f"검증 창({date_from}~{date_to})이 변경일 {missed} 을 비켜갑니다 — "
            "이 창으로 '문제 없음'을 결론내면 무효입니다."
        )
