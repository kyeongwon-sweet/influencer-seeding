import unittest

from instagram_metric_policy import pick_instagram_metric


class InstagramMetricPolicyTest(unittest.TestCase):
    def test_explicit_instagram_play_excludes_facebook_crosspost(self):
        metrics = {
            "play_count": 29272,
            "ig_play_count": 28117,
            "fb_play_count": 1155,
        }
        self.assertEqual(
            pick_instagram_metric(metrics, "play_count", "fb_play_count", "ig_play_count"),
            28117,
        )

    def test_likes_and_comments_subtract_facebook_portion(self):
        self.assertEqual(pick_instagram_metric({"like_count": 672, "fb_like_count": 8}, "like_count", "fb_like_count"), 664)
        self.assertEqual(pick_instagram_metric({"comment_count": 10, "fb_comment_count": 1}, "comment_count", "fb_comment_count"), 9)

    def test_aggregate_is_preserved_when_facebook_breakdown_is_missing(self):
        self.assertEqual(pick_instagram_metric({"play_count": 1234}, "play_count", "fb_play_count", "ig_play_count"), 1234)
        self.assertIsNone(pick_instagram_metric({}, "play_count", "fb_play_count", "ig_play_count"))


if __name__ == "__main__":
    unittest.main()
