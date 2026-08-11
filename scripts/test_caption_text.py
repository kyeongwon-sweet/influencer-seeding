"""캡션 정규화 회귀 테스트 — 실측 사례 기반(2026-08-11).

시트에서 여러 줄로 보이던 실제 5건의 형태를 그대로 재현해 고정한다.
"""
from __future__ import annotations

from caption_text import normalize_caption


def test_single_newline_becomes_one_space():
    assert normalize_caption("진짜 기묘하다…ㅋㅋㅋㅋ\n#유머") == "진짜 기묘하다…ㅋㅋㅋㅋ #유머"


def test_consecutive_newlines_collapse_to_one_space():
    # 실측: "@lalasweet_icecream \n\n#라라스윗 #CU듬뿍바"
    assert normalize_caption("@lalasweet_icecream \n\n#라라스윗 #CU듬뿍바") == "@lalasweet_icecream #라라스윗 #CU듬뿍바"


def test_dot_only_lines_are_preserved_as_text():
    # 실측: 인스타 줄바꿈용 점(.)은 내용이므로 지우지 않는다 — 줄바꿈만 공백으로.
    assert normalize_caption("기묘하다\n.\n.\n#fyp") == "기묘하다 . . #fyp"


def test_blank_lines_with_spaces_collapse_to_one_space():
    """🚨 실측 결함(2026-08-11): 공백만 있는 빈 줄이 섞이면 줄바꿈 수만큼 공백이 남았다."""
    assert normalize_caption("@lalasweet_icecream \n \n#라라스윗") == "@lalasweet_icecream #라라스윗"
    assert normalize_caption("가\n\n\n나") == "가 나"
    assert normalize_caption("가 \n\t \n \n 나") == "가 나"


def test_crlf_and_tabs_around_newline():
    assert normalize_caption("가\r\n\t나") == "가 나"
    assert normalize_caption("가  \n  나") == "가 나"


def test_inner_spaces_are_not_touched():
    """줄바꿈만 손댄다 — 문장 속 연속 공백까지 뭉개면 원문이 훼손된다."""
    assert normalize_caption("가   나") == "가   나"


def test_empty_becomes_none():
    for v in (None, "", "   ", "\n\n"):
        assert normalize_caption(v) is None, v


def test_limit_is_applied_after_normalization():
    # 먼저 자르면 잘린 끝에 줄바꿈이 남는다 → 정규화 후 자른다.
    assert normalize_caption("가나다\n라마바", limit=5) == "가나다 라"


def test_already_clean_text_is_unchanged():
    s = "#광고 라라스윗 멜론쫀득바 맛있어요"
    assert normalize_caption(s) == s
