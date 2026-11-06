"""viral_caption_watchdog 판정 테스트 — 소재명은 모두 RD 시트 실제 값(2026-10~11)."""
from datetime import date

from viral_caption_watchdog import find_misses, slack_text

TODAY = date(2026, 11, 6)
V = "바이럴 (영상)"
NEW = "[26.10]F_V_P바치_인지_바치케출시_바이럴형_맛잘알권위_var3.릴스_떵개파급력.유행어강조.떡잎부터남다른스타성.X_파인트__261030_빙과_박채현"


def row(asset, caption, ctype=V, created="2026-11-03T02:00:00+00:00", url="https://www.instagram.com/reel/AAA/"):
    return {"url": url, "asset_name": asset, "content_summary": caption, "channel_type": ctype,
            "product_name": "P바치", "created_at": created}


def test_derived_top_copy_is_ok():
    checked, misses = find_misses([row(NEW, "떵개파급력.유행어강조.떡잎부터남다른스타성")], TODAY)
    assert (checked, misses) == (1, [])


def test_nfd_asset_incident_is_caught():
    # 11-06 사고: 소재명 NFD + 게시물 캡션 남음
    import unicodedata
    checked, misses = find_misses([row(unicodedata.normalize("NFD", NEW), "진짜 스타성 ㄹㅈㄷ임ㅋㅋㅋㅋㅋ")], TODAY)
    assert checked == 1 and len(misses) == 1
    assert misses[0]["reason"] == "소재명 규칙을 못 알아봄(파일명 형식 변경 의심)"


def test_derived_caption_with_nfd_asset_still_ok():
    import unicodedata
    _, misses = find_misses([row(unicodedata.normalize("NFD", NEW), "떵개파급력.유행어강조.떡잎부터남다른스타성")], TODAY)
    assert misses == []


def test_new_format_incident_hashtag_caption_is_caught():
    # 11-03 사고: P 없는 새 형식 → 스크랩 해시태그 캡션 남음
    asset = "[26.10]F_V_JD복_인지_복쫀바출시_유명인활용형__main.렉카_소혜.여돌냉장고에이런거들어있어도되는거예요.흰.안예빈.X_스틱바__261029_빙과_이채윤"
    _, misses = find_misses([row(asset, "쟁여둔 거 졸귀ㅋㅋ #아이돌 #예쁘다")], TODAY)
    assert len(misses) == 1


def test_blank_caption_is_caught():
    _, misses = find_misses([row(NEW, "")], TODAY)
    assert misses[0]["reason"] == "캡션 빈칸"


def test_banner_asset_typed_as_video_has_reason():
    asset = "[26.10]F_I_JD복_바이럴_상시_바이럴형_반전캐릭터성.마T기획_.배너_원어스.예능캐.스타성.__김어진_261101_빙과"
    _, misses = find_misses([row(asset, "스타성 하나는 찐 아이돌급")], TODAY)
    assert misses[0]["reason"] == "소재명은 배너인데 채널분류가 영상"


def test_scope_excludes_old_backfill_out_of_window_and_non_viral():
    old_backfill = row("[25.06]F_V_BA복_바이럴_렉카형_트렌드가속성강조2_음식유행_이선민_250605_구승미", "음식 유행 또 바뀜")
    out_of_window = row(NEW, "진짜 스타성", created="2026-10-20T02:00:00+00:00")
    not_viral = row(NEW, "진짜 스타성", ctype="위성채널")
    not_rule = row("떵개 바치케 릴스", "진짜 스타성")
    checked, misses = find_misses([old_backfill, out_of_window, not_viral, not_rule], TODAY)
    assert (checked, misses) == (0, [])


def test_window_uses_kst_date():
    # 2026-10-22 15:30 UTC = 10-23 00:30 KST → 14일 창(10-23~) 안
    _, misses = find_misses([row(NEW, "진짜 스타성", created="2026-10-22T15:30:00+00:00")], TODAY)
    assert len(misses) == 1


def test_slack_text_lists_urls_and_scope():
    _, misses = find_misses([row(NEW, "진짜 스타성", url="https://www.instagram.com/reel/XYZ/")], TODAY)
    text = slack_text(5, misses)
    assert "1건" in text and "5건 검사" in text and "https://www.instagram.com/reel/XYZ/" in text
