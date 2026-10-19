"""KST 날짜 변환 — 업무 날짜(대상일·게시일·등록일)는 전부 한국 날짜로 비교한다.

DB 타임스탬프는 UTC(`2026-10-18T23:33:25Z`)라 앞 10자리를 자르면 **UTC 날짜**가 된다.
KST 00:00~08:59에 생긴 기록은 하루 이른 날짜로 읽힌다.

사고(2026-10-19): KST 08:33 등록된 위성 틱톡 8건이 '어제 등록'으로 계산돼 수집 사각 알림이
울렸다. 같은 실수가 수집 상태 알림·수집 리포트·게시일 추출(run_monitoring)에도 있었다.
타임스탬프를 날짜로 바꿀 때는 `[:10]`·`utcfromtimestamp`·`date.today()` 대신 이 모듈을 쓴다
(`test_kst_date_guard.py`가 막는다).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def kst_now() -> datetime:
    """지금(KST, 시간대 포함). 파일명 타임스탬프 등 사람이 읽는 시각은 `datetime.now()`(러너=UTC) 대신 이걸로."""
    return datetime.now(KST)


def kst_today() -> str:
    """오늘(KST) YYYY-MM-DD. GitHub 러너는 UTC라 `date.today()`는 KST 오전에 어제가 된다."""
    return datetime.now(KST).date().isoformat()


def kst_date(value: object) -> str:
    """타임스탬프를 KST 날짜(YYYY-MM-DD)로. 값이 없으면 빈 문자열.

    - 날짜만 있는 값(`2026-10-17`, posted_at·measured_at)은 그대로 둔다.
    - ISO 문자열은 오프셋을 따르고, 오프셋이 없으면 UTC로 본다(DB·Apify 관례).
    - 숫자는 유닉스 시각(초, 1e12 이상이면 밀리초).
    """
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        return value.isoformat()
    elif isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e12 else value
        dt = datetime.fromtimestamp(seconds, tz=timezone.utc)
    else:
        raw = str(value).strip()
        if len(raw) == 10:
            return raw
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return raw[:10]
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST).date().isoformat()
