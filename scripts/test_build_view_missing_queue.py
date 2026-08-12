import unittest

from build_view_missing_queue import exclusion_reason, is_tiktok_view_post


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


if __name__ == "__main__":
    unittest.main()
