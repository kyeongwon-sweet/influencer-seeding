"""수집 사각 워치독이 '영상인데 조회수가 한 번도 없는 글(행은 있음)'을 잡는지 고정한다.

🚨 2026-11-24: p.25_d.y `p/DgAd6JuTEBX`는 좋아요·댓글 행이 2개 쌓여 'stats 0행' 기준을 빠져나갔다.
   영상인데 조회수가 이틀째 비어도 아무 알림이 없었다.
"""
import re
from datetime import date

import view_tracking_watchdog as wd

TODAY = date(2026, 11, 24)


def _post(pid, url, channel_type):
    return {
        "id": pid, "account_name": pid, "channel_type": channel_type, "product_name": "P바치",
        "posted_at": "2026-11-21", "created_at": "2026-11-23T00:39:15+00:00", "url": url,
        "notes": None, "not_found_streak": 0, "review_requested_at": None,
    }


POSTS = {
    "reel_no_views": (_post("reel_no_views", "https://www.instagram.com/p/DgAd6JuTEBX/", "무상시딩 (영상)"), (0, 2, 0)),
    "ig_photo": (_post("ig_photo", "https://www.instagram.com/p/AAAAAAAAAAA/", "무상시딩 (피드)"), (0, 3, 0)),
    "ig_banner": (_post("ig_banner", "https://www.instagram.com/p/BBBBBBBBBBB/", "바이럴 (배너)"), (0, 1, 1)),
    "tt_banner": (_post("tt_banner", "https://www.tiktok.com/@a/video/7700000000000000001", "바이럴 (배너)"), (0, 2, 2)),
    # 도달수가 아직 안 들어온 배너 — 배너는 도달수 경로가 맡으므로 '영상 조회수 없음'으로 울리면 안 된다
    "tt_banner_no_reach": (_post("tt_banner_no_reach", "https://www.tiktok.com/@a/video/7700000000000000003", "바이럴 (배너)"), (0, 2, 0)),
    "tt_no_views": (_post("tt_no_views", "https://www.tiktok.com/@a/video/7700000000000000002", "위성채널"), (0, 2, 0)),
    "yt_no_views": (_post("yt_no_views", "https://www.youtube.com/watch?v=tdsrShfL8ow", "위성채널"), (0, 40, 0)),
    "tt_labeled_video": (_post("tt_labeled_video", "https://www.tiktok.com/@a/video/7700000000000000004", "바이럴 (영상)"), (0, 2, 0)),
    # 조회수 대신 도달수로 추적되는 글은 이미 지표가 들어오고 있다
    "ig_video_with_reach": (_post("ig_video_with_reach", "https://www.instagram.com/p/IIIIIIIIIII/", "바이럴 (영상)"), (0, 3, 2)),
    "has_views": (_post("has_views", "https://www.instagram.com/p/CCCCCCCCCCC/", "무상시딩 (영상)"), (5, 5, 0)),
    # 분류명에 '영상'이 없는 협찬 글 — 수집기 기록의 글 형식으로 판단한다
    "paid_reel": (_post("paid_reel", "https://www.instagram.com/p/EEEEEEEEEEE/", "협찬 (인플루언서)"), (0, 3, 0)),
    "paid_photo": (_post("paid_photo", "https://www.instagram.com/p/FFFFFFFFFFF/", "협찬 (인플루언서)"), (0, 3, 0)),
    "paid_unknown": (_post("paid_unknown", "https://www.instagram.com/p/GGGGGGGGGGG/", "협찬 (인플루언서)"), (0, 3, 0)),
    # 분류명에 배너와 영상이 같이 있어도 배너는 도달수 경로가 맡는다
    "ig_banner_video": (_post("ig_banner_video", "https://www.instagram.com/p/HHHHHHHHHHH/", "바이럴 (배너 영상)"), (0, 2, 0)),
    "zero_rows": (_post("zero_rows", "https://www.instagram.com/p/DDDDDDDDDDD/", "무상시딩 (영상)"), (0, 0, 0)),
}


REASONS = {
    "paid_reel": {"reason": "missing_play_count", "media_type": "Video", "product_type": "clips"},
    "paid_photo": {"reason": "missing_play_count", "media_type": "Image"},
}


def _build(monkeypatch, names, reasons=None):
    monkeypatch.setattr(wd, "fetch_active_posts", lambda: [POSTS[n][0] for n in names])

    def fake_get(path, count=False):
        pid = re.search(r"post_id=eq\.([^&]+)", path).group(1)
        views, total, reach = POSTS[pid][1]
        if "play_count=not.is.null" in path:
            return views
        if "reach_count=not.is.null" in path:
            return reach
        return total

    monkeypatch.setattr(wd, "_get", fake_get)
    return wd.build(TODAY, REASONS if reasons is None else reasons)


def _ids(rows):
    return sorted(r["post_id"] for r in rows)


def test_사고재현_좋아요행만_쌓인_영상은_잡는다(monkeypatch):
    r = _build(monkeypatch, ["reel_no_views"])
    assert _ids(r["no_views"]) == ["reel_no_views"]
    assert r["flagged_count"] == 0, "행이 있으니 '0행' 칸이 아니라 새 칸에 나와야 한다"


def test_원래_조회수가_없는_사진과_배너는_잡지_않는다(monkeypatch):
    r = _build(monkeypatch, ["ig_photo", "ig_banner", "tt_banner", "tt_banner_no_reach", "ig_banner_video"])
    assert r["no_views_count"] == 0 and r["flagged_count"] == 0


def test_분류명에_영상이_없어도_수집기가_영상이라고_남긴_글은_잡는다(monkeypatch):
    r = _build(monkeypatch, ["paid_reel", "paid_photo", "paid_unknown"])
    assert _ids(r["no_views"]) == ["paid_reel"], "사진으로 응답한 글·형식 기록이 없는 글은 판단 불가라 뺀다"
    assert "사진·캐러셀" not in wd.slack_lines(r)


def test_틱톡_유튜브는_실제_0회가_흔해서_이_칸에서_뺀다(monkeypatch):
    # 2026-11-24 실데이터: 위성 유튜브 29건이 걸렸는데 확인한 4건 모두 공개 상태·조회수 0회(진짜 0).
    # 수집기는 0을 저장하지 않으므로 넣으면 매일 영구 오탐이 된다.
    r = _build(monkeypatch, ["tt_no_views", "yt_no_views", "tt_labeled_video"])
    assert r["no_views_count"] == 0


def test_도달수로_추적되는_영상은_정상(monkeypatch):
    r = _build(monkeypatch, ["ig_video_with_reach"])
    assert r["no_views_count"] == 0


def test_조회수가_한번이라도_있으면_정상(monkeypatch):
    r = _build(monkeypatch, ["has_views"])
    assert r["no_views_count"] == 0 and r["flagged_count"] == 0


def test_0행_글은_예전처럼_수집사각_칸으로(monkeypatch):
    r = _build(monkeypatch, ["zero_rows"])
    assert _ids(r["flagged"]) == ["zero_rows"] and r["no_views_count"] == 0


def test_슬랙_문구에_새_칸과_링크가_나온다(monkeypatch):
    r = _build(monkeypatch, list(POSTS))
    text = wd.slack_lines(r)
    assert "영상인데 조회수가 한 번도 안 잡힘" in text
    assert "https://www.instagram.com/p/DgAd6JuTEBX/" in text
    assert _ids(r["no_views"]) == ["paid_reel", "reel_no_views"]
