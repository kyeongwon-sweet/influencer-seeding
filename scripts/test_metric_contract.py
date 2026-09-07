#!/usr/bin/env python3
"""배너 판정·증분 규칙의 **교차언어** 계약 — Python 측.

왜 필요한가 (2026-09-05):
  같은 규칙이 TS와 Python에 각각 구현돼 있는데, 지금까지 양쪽 테스트는 **자기 모듈만** 봤다
  (`test_channel_kind.py`는 Python, `banner-metric.test.ts`는 TS). 주석에 "규칙이 같아야 한다"고만
  적혀 있고 검사가 없어서, 한쪽 상수만 바뀌면 **리포트(Python)와 대시보드(TS)가 같은 게시물을
  다르게 분류**한다 — 2026-09-03~04에 하루를 소모한 play/reach 혼재와 같은 증상이다.

무엇을 고정하나:
  ① `metric_contract.json` 벡터를 **Python 구현으로 직접 실행**해 결과 일치를 본다(행동 계약).
  ② TS 소스(`web/app/monitoring/lib.ts`)의 상수·백로그 창을 **읽어서** 계약값과 대조한다(교차 언어).
  ③ `notify_increments.py`의 백로그 창(`.days > N`)도 같은 값인지 본다.
     (`_safe_inc`는 `main()` 내부 중첩 함수라 임포트가 불가능하다 — 그래서 행동이 아닌 소스로 고정한다.
      나중에 모듈로 추출하면 이 검사를 행동 계약으로 승격할 것.)

한쪽만 고치면 이 테스트나 `web/tests/metric-contract.test.ts` 중 하나가 반드시 깨진다.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path

from channel_kind import MAGAZINE_BANNER_FROM, is_banner_channel

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(io.open(Path(__file__).resolve().parent / "metric_contract.json", encoding="utf-8").read())
LIB_TS = ROOT / "web" / "app" / "monitoring" / "lib.ts"
NOTIFY_PY = ROOT / "scripts" / "notify_increments.py"


def _read(path: Path) -> str:
    assert path.exists(), f"계약 대상 파일이 없다: {path} — 경로가 바뀌었으면 이 테스트도 함께 고칠 것"
    return io.open(path, encoding="utf-8").read()


def test_python_constant_matches_contract():
    assert MAGAZINE_BANNER_FROM == CONTRACT["magazine_banner_from"], (
        f"channel_kind.MAGAZINE_BANNER_FROM={MAGAZINE_BANNER_FROM!r} 인데 "
        f"계약은 {CONTRACT['magazine_banner_from']!r} — 규칙을 바꿨다면 metric_contract.json 과 "
        "web/app/monitoring/lib.ts 도 같이 고쳐야 한다"
    )


def test_python_behavior_matches_contract_vectors():
    """계약 벡터를 Python 구현으로 실제 실행한다(문자열 검사 아님)."""
    failures = []
    for v in CONTRACT["banner_vectors"]:
        got = is_banner_channel(v["channel_type"], v["posted_at"])
        if got is not v["expected"]:
            failures.append(f"  ct={v['channel_type']!r} posted={v['posted_at']!r} → {got} (기대 {v['expected']}) : {v['why']}")
    assert not failures, "is_banner_channel 이 계약 벡터와 다르다:\n" + "\n".join(failures)


def test_ts_constant_matches_contract():
    """TS 정본의 상수를 읽어 대조 — 여기가 실제 '교차언어' 지점이다."""
    src = _read(LIB_TS)
    m = re.search(r'export\s+const\s+MAGAZINE_BANNER_FROM\s*=\s*"([^"]+)"', src)
    assert m, f"{LIB_TS} 에서 MAGAZINE_BANNER_FROM 선언을 못 찾았다 — 이름이 바뀌었으면 계약 테스트도 함께 갱신할 것"
    assert m.group(1) == CONTRACT["magazine_banner_from"], (
        f"TS lib.ts 의 MAGAZINE_BANNER_FROM={m.group(1)!r} ≠ 계약 {CONTRACT['magazine_banner_from']!r}. "
        "TS만 바뀌었다면 리포트(Python)와 대시보드(TS)가 같은 매거진 글을 다르게 분류한다."
    )


def test_backlog_window_matches_on_both_sides():
    """'첫 유효측정 = 전액'을 허용하는 게시 후 최대 일수(현재 7)를 양쪽에서 고정."""
    want = CONTRACT["backlog_first_measurement_max_gap_days"]

    ts = _read(LIB_TS)
    m_ts = re.search(r"gapDays\s*>\s*(\d+)", ts)
    assert m_ts, f"{LIB_TS} 의 safeIncrement 에서 백로그 창(gapDays > N)을 못 찾았다"
    assert int(m_ts.group(1)) == want, (
        f"TS safeIncrement 백로그 창={m_ts.group(1)} ≠ 계약 {want}"
    )

    py = _read(NOTIFY_PY)
    m_py = re.search(r"\.days\s*>\s*(\d+)", py)
    assert m_py, f"{NOTIFY_PY} 의 _safe_inc 에서 백로그 창(.days > N)을 못 찾았다"
    assert int(m_py.group(1)) == want, (
        f"Python _safe_inc 백로그 창={m_py.group(1)} ≠ 계약 {want} — "
        "리포트와 대시보드의 '첫 측정=전액' 판정이 어긋난다"
    )


def test_contract_vectors_pin_the_boundary():
    """계약 벡터가 경계일 전/당일을 반드시 포함하게 강제(벡터가 물러지면 계약이 무의미)."""
    boundary = CONTRACT["magazine_banner_from"]
    posted = {(v["channel_type"], v["posted_at"]): v["expected"] for v in CONTRACT["banner_vectors"]}
    mag = "협찬 (파워채널/매거진)"
    assert posted.get((mag, boundary)) is True, "경계일 당일 = 배너 벡터가 계약에서 빠졌다"
    day_before = "2026-08-17"
    assert posted.get((mag, day_before)) is False, "경계일 하루 전 = 비배너 벡터가 계약에서 빠졌다"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("[OK] 교차언어 지표 계약 통과")
