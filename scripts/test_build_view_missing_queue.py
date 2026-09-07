import unittest

from pathlib import Path

from build_view_missing_queue import (
    NON_RETRYABLE_REASONS,
    build_history_state,
    decide_reason,
    exclusion_reason,
    is_tiktok_view_post,
    has_no_public_view_metric,
)


class TikTokInternalRetryPolicyTest(unittest.TestCase):
    def test_tiktok_video_and_photo_are_view_capable_retry_targets(self):
        for path in ("video/7665977180072987925", "photo/7667917090640252168"):
            post = {
                "channel_type": "\uc704\uc131\ucc44\ub110",
                "url": f"https://www.tiktok.com/@channel/{path}",
                "notes": "",
            }
            self.assertTrue(is_tiktok_view_post(post["url"]))
            self.assertIsNone(exclusion_reason(post))

    def test_internal_view_platforms_are_retry_targets(self):
        for channel_type in ("\uc704\uc131\ucc44\ub110", "\uc628\ub4dc\ubbf8\ub514\uc5b4"):
            for url in (
                "https://www.instagram.com/reel/example/",
                "https://www.youtube.com/shorts/example",
                "https://www.tiktok.com/@channel/video/7665977180072987925",
                "https://x.com/channel/status/123456789",
            ):
                post = {"channel_type": channel_type, "url": url, "notes": ""}
                self.assertIsNone(exclusion_reason(post))

    def test_internal_youtube_fix_is_non_retroactive(self):
        post = {
            "channel_type": "\uc704\uc131\ucc44\ub110",
            "url": "https://www.youtube.com/shorts/example",
            "notes": "",
        }
        self.assertEqual(exclusion_reason(post, "2026-08-06"), "internal_channel")
        self.assertIsNone(exclusion_reason(post, "2026-08-07"))

    def test_internal_non_view_platforms_keep_existing_exclusion(self):
        for url in (
            "https://www.threads.net/@channel/post/example",
            "https://www.facebook.com/reel/example",
            "https://blog.naver.com/channel/example",
            "https://pf.kakao.com/channel/example",
        ):
            post = {
                "channel_type": "\uc704\uc131\ucc44\ub110",
                "url": url,
                "notes": "",
            }
            self.assertEqual(exclusion_reason(post), "internal_channel")

    def test_internal_non_tiktok_banner_stays_reach_only(self):
        for url in (
            "https://www.instagram.com/p/example/",
            "https://www.youtube.com/shorts/example",
        ):
            post = {
                "channel_type": "\uc704\uc131\ucc44\ub110(\ubc30\ub108)",
                "url": url,
                "notes": "",
            }
            self.assertEqual(exclusion_reason(post), "non_tiktok_banner_reach_only")

    def test_free_seed_video_is_retryable_but_feed_is_manual(self):
        # 무상시딩 (영상) = 조회수 있음 → 재수집 대상(제외 아님)
        video = {
            "channel_type": "무상시딩 (영상)",
            "url": "https://www.instagram.com/p/Dakqv22uexw/",
            "notes": "",
        }
        self.assertIsNone(exclusion_reason(video))
        # 무상시딩 (피드/이미지) = 수기 관리 → 제외 유지
        for ct in ("무상시딩 (피드)", "무상시딩 (이미지)"):
            feed = {"channel_type": ct, "url": "https://www.instagram.com/p/DailNIKpxcd/", "notes": ""}
            self.assertEqual(exclusion_reason(feed), "free_seed_manual")

    def test_manual_exclusion_still_wins_for_tiktok(self):
        post = {
            "channel_type": "\uc704\uc131\ucc44\ub110",
            "url": "https://www.tiktok.com/@channel/video/7665977180072987925",
            "notes": "\uc218\ub3d9\ucd94\uc801 \uc81c\uc678",
        }
        self.assertEqual(exclusion_reason(post), "manual_note")

    def test_not_found_review_pending_is_not_retried_forever(self):
        post = {
            "channel_type": "바이럴 (영상)",
            "url": "https://www.instagram.com/p/DbMzF18PTQz/",
            "notes": "",
            "review_requested_at": "2026-08-11T00:00:00+00:00",
        }
        self.assertEqual(exclusion_reason(post), "not_found_review_pending")


    def test_collector_uncollectable_note_is_excluded(self):
        # 수집기가 액터 에러(POST_SENSITIVE·not_found/private 등)로 '수집 불가' 자동 태깅한 건은
        # 재시도해도 같은 에러라 재시도 큐에서 제외(워치독 오탐 방지).
        for note in (
            "틱톡 수집 불가 감지(자동 2026-08-09, POST_NOT_FOUND_OR_PRIVATE) — 조회수 최종값에서 정지, 확인 필요",
            "틱톡 수집 불가 감지(자동 2026-08-06, POST_SENSITIVE) — 조회수 최종값에서 정지, 확인 필요",
            "틱톡: 영상은 공개(oembed 확인)이나 Apify 틱톡 액터가 not_found/private 반환 → 자동 수집 불가(지역제한 추정). 수동 확인 필요",
        ):
            post = {
                "channel_type": "위성채널",
                "url": "https://www.tiktok.com/@channel/video/7664506171604143381",
                "notes": note,
            }
            self.assertEqual(exclusion_reason(post), "collector_uncollectable")

    def test_normal_note_is_not_excluded(self):
        # '수집 불가'가 없는 일반/빈 노트는 정상 재시도 대상(오제외 방지)
        for note in ("", "팀 메모: 바이럴 확산 중", None):
            post = {
                "channel_type": "위성채널",
                "url": "https://www.tiktok.com/@channel/video/7664506171604143381",
                "notes": note,
            }
            self.assertIsNone(exclusion_reason(post))


if __name__ == "__main__":
    unittest.main()


class ImageAssumptionGuard(unittest.TestCase):
    """🚨 2026-08-18: 액터가 videoPlayCount를 빼먹어 신규 릴스 11건이 영구 제외된 사고 고정.

    `apify/instagram-scraper` 응답 필드 키에 videoUrl은 있고 재생수는 없었다
    (reason=missing_play_count). 옛 규칙은 '좋아요만 있고 조회수 없음'을 곧바로 이미지로 단정해
    retryable=False로 만들었고, 알림도 없어 조용히 결측으로 굳었다.
    """

    def test_actor_glitch_on_fresh_ig_post_stays_retryable(self):
        """게시 3일차 IG /p/ 영상: 조회수 누락은 액터 글리치다 — 조회수 확보 불가로 단정하지 않는다."""
        post = {"url": "https://www.instagram.com/p/DcGqErSBW0a/", "posted_at": "2026-08-16"}
        self.assertFalse(has_no_public_view_metric(post, "2026-08-17"))

    def test_old_ig_feed_post_is_finally_assumed_image(self):
        """7일 넘게 조회수가 한 번도 없으면 조회수 확보 불가로 본다(비공개 계정·사진 글) — 무한 재시도 방지."""
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/", "posted_at": "2026-08-01"}
        self.assertTrue(has_no_public_view_metric(post, "2026-08-17"))

    def test_unambiguous_video_urls_are_never_assumed_image(self):
        """🚨 틱톡 /video/·유튜브·IG 릴스는 나이와 무관하게 영상이다.
        실측: 이슈뜨기 /video/7668233508338306324 (게시 8/03, 14일 경과)가 나이 규칙만으로는
        조회수 확보 불가로 오분류됐다."""
        for url in (
            "https://www.tiktok.com/@issuetteugi/video/7668233508338306324/",
            "https://www.tiktok.com/@humorbox_/photo/7674629956256664840/",
            "https://www.youtube.com/shorts/L_4QWHt0hGo/",
            "https://www.instagram.com/reel/DcBZOaEpDyt/",
        ):
            with self.subTest(url=url):
                self.assertFalse(
                    has_no_public_view_metric({"url": url, "posted_at": "2026-06-01"}, "2026-08-17")
                )

    def test_missing_posted_at_keeps_retrying(self):
        """게시일을 모르면 경과일을 알 수 없다 — 조회수 확보 불가로 단정하지 않는다(공백≠판정근거)."""
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/", "posted_at": None}
        self.assertFalse(has_no_public_view_metric(post, "2026-08-17"))

    def test_boundary_is_exactly_seven_days(self):
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/"}
        self.assertFalse(has_no_public_view_metric({**post, "posted_at": "2026-08-11"}, "2026-08-17"))
        self.assertTrue(has_no_public_view_metric({**post, "posted_at": "2026-08-10"}, "2026-08-17"))


class ManualZeroConfirmedTest(unittest.TestCase):
    """사람이 실물 확인해 넣은 조회수 0 은 재시도 대상에서 빼되, 값은 건드리지 않는다.

    배경(2026-09-07 실측): 기존 규칙은 `best_today > 0` 만 '측정됨'으로 봤기 때문에
    실측 0 이 영원히 미수집으로 남아 매일 재시도되고 cron-daily-collect 게이트를
    상시 '미수집'으로 만들었다(이슈뜨기 틱톡 8건). 틱톡은 no_public_view_metric
    탈출구를 못 쓰므로(is_unambiguous_view_post) 더 갇힌다.
    """

    TIKTOK = {
        "url": "https://www.tiktok.com/@issuetteugi/video/7674635789774490887/",
        "channel_type": "위성채널",
        "posted_at": "2026-08-16",
        "notes": "",
    }
    ZERO_ROW = [{"play_count": 0, "reach_count": None, "manual": True}]

    def _state(self, **kw):
        base = {"has_metric": False, "has_likes_or_comments": True, "has_manual_zero": False}
        base.update(kw)
        return base

    def test_manual_zero_without_positive_history_is_confirmed(self):
        reason = decide_reason(self.TIKTOK, self.ZERO_ROW, self._state(has_manual_zero=True), "2026-09-06")
        self.assertEqual(reason, "manual_zero_confirmed")
        self.assertIn(reason, NON_RETRYABLE_REASONS)

    def test_positive_history_wins_so_it_self_heals(self):
        """나중에 조회수가 붙으면 조건이 깨져 자동으로 큐에 복귀해야 한다."""
        reason = decide_reason(
            self.TIKTOK, self.ZERO_ROW,
            self._state(has_manual_zero=True, has_metric=True), "2026-09-06")
        self.assertNotEqual(reason, "manual_zero_confirmed")
        self.assertNotIn(reason, NON_RETRYABLE_REASONS)

    def test_automatic_zero_is_not_accepted(self):
        """자동 0 은 수집 실패일 수 있다 — manual=True 인 0만 근거로 삼는다."""
        auto_zero = [{"play_count": 0, "reach_count": None, "manual": False}]
        reason = decide_reason(self.TIKTOK, auto_zero, self._state(), "2026-09-06")
        self.assertEqual(reason, "same_day_non_positive_metric")
        self.assertNotIn(reason, NON_RETRYABLE_REASONS)

    def test_tiktok_cannot_use_no_public_view_escape(self):
        """틱톡은 조회수가 반드시 있는 플랫폼이라 no_public_view_metric 이 안 걸린다(사용자 확인)."""
        self.assertFalse(has_no_public_view_metric(self.TIKTOK, "2026-09-06"))

    def test_missing_row_and_null_metric_reasons_unchanged(self):
        self.assertEqual(decide_reason(self.TIKTOK, [], self._state(), "2026-09-06"), "missing_same_day_row")
        null_row = [{"play_count": None, "reach_count": None, "manual": False}]
        self.assertEqual(
            decide_reason(self.TIKTOK, null_row, self._state(), "2026-09-06"),
            "same_day_row_without_view_metric",
        )


class HistoryPaginationContractTest(unittest.TestCase):
    """이력 조회는 반드시 끝까지 읽어야 한다.

    2026-09-07 실측: 게시물 100개 묶음의 이력이 1,677행이라 단발 `.execute()` 는 PostgREST
    1000 상한에 조용히 절단됐다. 그러면 has_metric 이 거짓 False 가 되어 no_public_view_metric
    이 조회수 있는 글을 영구 제외할 수 있고(2026-08-18 사고와 같은 형태),
    manual_zero_confirmed 의 self-heal 조건도 깨진다.
    """

    def test_history_query_uses_fetch_pages(self):
        src = Path(__file__).resolve().parent.joinpath("build_view_missing_queue.py").read_text(encoding="utf-8")
        self.assertIn("hist_rows = fetch_pages(", src)
        # 단발 .execute() 로 되돌리면 위 문자열이 사라져 이 테스트가 즉시 깨진다.
        hist_block = src.split("hist_rows = ")[1][:200]
        self.assertNotIn(".execute()", hist_block,
                         "이력 조회를 단발 .execute() 로 되돌리면 1000행에서 조용히 절단된다")

    def test_excluded_counter_has_new_reason(self):
        src = Path(__file__).resolve().parent.joinpath("build_view_missing_queue.py").read_text(encoding="utf-8")
        self.assertIn('"manual_zero_confirmed": 0,', src, "제외 사유가 집계에 안 보이면 조용히 사라진다")


class HistoryStateTest(unittest.TestCase):
    """이력 요약이 '사람이 넣은 0'과 '자동 0'을 반드시 구분해야 한다.

    자동 0을 '확정된 0'으로 받으면 수집 실패를 조용히 감춘다(절대규칙 위반).
    """

    def test_manual_zero_only_counts_when_manual(self):
        manual = build_history_state([
            {"measured_at": "2026-09-06", "play_count": 0, "reach_count": None,
             "likes_count": 0, "comments_count": 1, "manual": True},
        ])
        self.assertTrue(manual["has_manual_zero"])
        self.assertFalse(manual["has_metric"])

        auto = build_history_state([
            {"measured_at": "2026-09-06", "play_count": 0, "reach_count": None,
             "likes_count": 0, "comments_count": 1, "manual": False},
        ])
        self.assertFalse(auto["has_manual_zero"], "자동 0을 확정된 0으로 받으면 수집 실패를 감춘다")

    def test_null_metric_is_not_a_zero(self):
        """공백(미측정) ≠ 0. NULL 을 0으로 읽으면 프로젝트 절대규칙 위반이다."""
        state = build_history_state([
            {"measured_at": "2026-09-06", "play_count": None, "reach_count": None,
             "likes_count": 3, "comments_count": None, "manual": True},
        ])
        self.assertFalse(state["has_manual_zero"])
        self.assertTrue(state["has_likes_or_comments"])

    def test_positive_metric_and_latest_tracking(self):
        state = build_history_state([
            {"measured_at": "2026-09-01", "play_count": 100, "reach_count": None,
             "likes_count": None, "comments_count": None, "manual": False},
            {"measured_at": "2026-09-03", "play_count": 250, "reach_count": None,
             "likes_count": None, "comments_count": None, "manual": False},
            {"measured_at": "2026-09-02", "play_count": 180, "reach_count": None,
             "likes_count": None, "comments_count": None, "manual": False},
        ])
        self.assertTrue(state["has_metric"])
        self.assertEqual(state["last_metric"], 250)
        self.assertEqual(state["last_metric_date"], "2026-09-03")

    def test_banner_reach_counts_as_metric(self):
        state = build_history_state([
            {"measured_at": "2026-09-06", "play_count": None, "reach_count": 500,
             "likes_count": None, "comments_count": None, "manual": True},
        ])
        self.assertTrue(state["has_metric"])
        self.assertFalse(state["has_manual_zero"])
