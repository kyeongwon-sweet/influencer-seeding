import pytest

from repair_specific_daily_stat import parse_count, parse_optional_bool


def test_repair_count_parser_preserves_null_and_integer_contract():
    assert parse_count("NULL") is None
    assert parse_count("1,234") == 1234


def test_repair_manual_parser_rejects_ambiguous_values():
    assert parse_optional_bool("KEEP") is None
    assert parse_optional_bool("true") is True
    with pytest.raises(Exception):
        parse_optional_bool("maybe")
