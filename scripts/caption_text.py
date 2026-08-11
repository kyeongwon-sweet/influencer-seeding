"""캡션(content_summary) 저장 형식 정규화.

배경(2026-08-11 실측):
  · 연동 시트 '캡션' 열은 대부분 소재명 8번째 토큰에서 파생된 한 줄 문구다
    (`fillCaptionFromAsset_`). 그래서 줄바꿈이 없는 게 정상처럼 보였다.
  · 그런데 스크랩한 원문 캡션이 DB `content_summary`로 들어가는 경로가 따로 있고,
    이쪽은 줄바꿈을 그대로 저장한다 → 시트에도 그대로 흘러가 셀이 여러 줄로 보인다
    (실측: 2,058건 중 5건, 그중 4건이 2026-08-10 신규 수집분).
  · `fillCaptionFromAsset_`는 **캡션이 이미 차 있으면 건너뛴다**(`.디자인N`·후행점만 정리).
    그래서 시트 쪽 자가치유로는 줄바꿈이 절대 사라지지 않는다 → 저장 시점에 정규화한다.

규칙: 줄바꿈은 **띄어쓰기 한 칸**으로. 내용은 지우지 않는다(글자 손실 금지).
"""
from __future__ import annotations

import re

# 줄바꿈(그리고 줄바꿈에 붙은 공백)만 한 칸으로. 문장 속 일반 공백은 건드리지 않는다.
_NEWLINE_RUN = re.compile(r"[ \t]*(?:\r\n|\r|\n)+[ \t]*")


def normalize_caption(text, limit: int | None = None):
    """캡션을 한 줄로 만든다. 빈 값이면 None을 돌려준다(빈 문자열 저장 방지).

    limit을 주면 정규화 **후** 자른다 — 먼저 자르면 잘린 끝에 줄바꿈이 남을 수 있다.
    """
    if text is None:
        return None
    s = _NEWLINE_RUN.sub(" ", str(text)).strip()
    if limit is not None:
        s = s[:limit]
    return s or None
