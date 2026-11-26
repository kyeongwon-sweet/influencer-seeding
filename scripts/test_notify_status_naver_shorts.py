import notify_status as ns

A = "https://m.naver.com/shorts/?seedMediaId=A7EFAF4207F5E76994E524E10033CB9032CF&serviceType=CLIP"
B = "https://m.naver.com/shorts/?seedMediaId=B1234567890ABCDEF"


def test_canon_url_keeps_naver_shorts_media_id() -> None:
    # web/lib/url-utils.ts normalizeUrl 과 같은 표준형 (2026-11-26)
    assert ns._canon_url(A) == "https://m.naver.com/shorts/?seedMediaId=A7EFAF4207F5E76994E524E10033CB9032CF"
    assert ns._canon_url(ns._canon_url(A)) == ns._canon_url(A)
    assert ns._canon_url("https://m.naver.com/shorts/") == "https://m.naver.com/shorts/"


def test_urlkey_separates_different_naver_shorts() -> None:
    assert ns._urlkey(A) == "nvs:A7EFAF4207F5E76994E524E10033CB9032CF"
    assert ns._urlkey(A) != ns._urlkey(B)
    assert ns._urlkey("https://naver.com/shorts?serviceType=CLIP&seedMediaId=a7efaf4207f5e76994e524e10033cb9032cf") == ns._urlkey(A)
