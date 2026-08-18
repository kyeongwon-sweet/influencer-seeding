import unittest

from build_view_missing_queue import (
    exclusion_reason,
    is_tiktok_view_post,
    looks_like_image_no_view,
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
        """게시 3일차 IG /p/ 영상: 조회수 누락은 액터 글리치다 — 이미지로 단정하지 않는다."""
        post = {"url": "https://www.instagram.com/p/DcGqErSBW0a/", "posted_at": "2026-08-16"}
        self.assertFalse(looks_like_image_no_view(post, "2026-08-17"))

    def test_old_ig_feed_post_is_finally_assumed_image(self):
        """7일 넘게 조회수가 한 번도 없으면 사진 글로 본다 — 무한 재시도 방지."""
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/", "posted_at": "2026-08-01"}
        self.assertTrue(looks_like_image_no_view(post, "2026-08-17"))

    def test_unambiguous_video_urls_are_never_assumed_image(self):
        """🚨 틱톡 /video/·유튜브·IG 릴스는 나이와 무관하게 영상이다.
        실측: 이슈뜨기 /video/7668233508338306324 (게시 8/03, 14일 경과)가 나이 규칙만으로는
        이미지로 오분류됐다."""
        for url in (
            "https://www.tiktok.com/@issuetteugi/video/7668233508338306324/",
            "https://www.tiktok.com/@humorbox_/photo/7674629956256664840/",
            "https://www.youtube.com/shorts/L_4QWHt0hGo/",
            "https://www.instagram.com/reel/DcBZOaEpDyt/",
        ):
            with self.subTest(url=url):
                self.assertFalse(
                    looks_like_image_no_view({"url": url, "posted_at": "2026-06-01"}, "2026-08-17")
                )

    def test_missing_posted_at_keeps_retrying(self):
        """게시일을 모르면 경과일을 알 수 없다 — 이미지로 단정하지 않는다(공백≠판정근거)."""
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/", "posted_at": None}
        self.assertFalse(looks_like_image_no_view(post, "2026-08-17"))

    def test_boundary_is_exactly_seven_days(self):
        post = {"url": "https://www.instagram.com/p/DbAAAAAAAAA/"}
        self.assertFalse(looks_like_image_no_view({**post, "posted_at": "2026-08-11"}, "2026-08-17"))
        self.assertTrue(looks_like_image_no_view({**post, "posted_at": "2026-08-10"}, "2026-08-17"))
