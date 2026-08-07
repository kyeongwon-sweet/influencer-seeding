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

    def test_non_tiktok_internal_channels_keep_existing_exclusion(self):
        for url in (
            "https://www.instagram.com/reel/example/",
            "https://www.youtube.com/shorts/example",
        ):
            post = {
                "channel_type": "\uc704\uc131\ucc44\ub110",
                "url": url,
                "notes": "",
            }
            self.assertEqual(exclusion_reason(post), "internal_channel")

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


if __name__ == "__main__":
    unittest.main()
