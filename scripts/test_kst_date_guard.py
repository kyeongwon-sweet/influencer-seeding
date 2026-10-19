"""업무 날짜는 KST로 — UTC 타임스탬프를 날짜로 자르는 코드가 다시 들어오지 못하게 막는다.

사고(2026-10-19): `created_at[:10]`(UTC 날짜)을 KST 오늘과 비교해 KST 아침 등록 8건을 '어제 등록'으로
오판, 수집 사각 오탐. 같은 실수가 수집 상태 알림·수집 리포트·게시일 추출(utcfromtimestamp)에도 있었다.
타임스탬프 → 날짜는 `kst_dates.kst_date`, 오늘은 `kst_dates.kst_today`를 쓴다.
"""
import re
from pathlib import Path

from kst_dates import kst_date, kst_today

HERE = Path(__file__).parent
TS_FIELD = r"(?:created_at|updated_at|_last_at|requested_at|started_at|finished_at|last_success_at)"
FORBIDDEN = [
    (re.compile(TS_FIELD + r"\b[^\n]{0,60}?\)\s*\[:10\]"), "타임스탬프[:10] = UTC 날짜 → kst_date() 사용"),
    (re.compile(r"\butcfromtimestamp\("), "utcfromtimestamp = UTC 날짜 → kst_date(epoch) 사용"),
    (re.compile(r"\bdate\.today\(\)"), "러너는 UTC라 KST 오전엔 어제 → kst_today() 사용"),
]


def test_스크립트에_UTC_날짜_자르기가_없다():
    hits = []
    for path in sorted(HERE.glob("*.py")):
        if path.name.startswith("test_") or path.name == "kst_dates.py":
            continue
        for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for pattern, why in FORBIDDEN:
                if pattern.search(line):
                    hits.append(f"{path.name}:{no}: {why}\n    {line.strip()}")
    assert not hits, "UTC 날짜를 업무 날짜로 쓰는 코드:\n" + "\n".join(hits)


def test_kst_date_변환():
    assert kst_date("2026-10-18T23:33:25.123456+00:00") == "2026-10-19"  # 사고 재현
    assert kst_date("2026-10-18T14:59:59Z") == "2026-10-18"
    assert kst_date("2026-10-18T15:00:00Z") == "2026-10-19"
    assert kst_date("2026-10-18T23:33:25") == "2026-10-19"  # 오프셋 없음 = UTC
    assert kst_date("2026-10-17") == "2026-10-17"  # 날짜만 있는 값은 그대로
    assert kst_date(1760716800) == "2025-10-18"  # 2025-10-17T16:00Z 초
    assert kst_date(1760716800000) == "2025-10-18"  # 밀리초
    assert kst_date(None) == "" and kst_date("") == ""


def test_kst_today_형식():
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", kst_today())
