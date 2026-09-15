# -*- coding: utf-8 -*-
"""매체 판정 단일 정본 — 알림과 재시도 큐가 갈라지지 않게 하는 계약.

2026-09-15 실측: 카카오 숏폼 1건(`자곰`)이 자정 알림에 매일 `[미수집(원인 미상)]`으로 떴다.
원인 미상이 아니라 **카카오 숏폼은 조회수를 아예 주지 않는다**(같은 카카오 글 `라밍`의 notes:
"카카오 숏폼은 자동 조회수 수집 미지원"). 재시도 큐는 is_view_capable 로 이미 빼고 있었는데
알림만 그 규칙을 몰랐다 — 사흘 연속 나온 '알림이 큐와 다른 기준을 쓴다'의 세 번째 사례다.
"""

import unittest
from pathlib import Path

from platform_kind import (
    NO_VIEW_METRIC_HOSTS,
    has_no_view_metric_host,
    is_view_capable,
    platform,
)


class NoViewMetricHostTest(unittest.TestCase):
    def test_kakao_shortform_has_no_view_metric(self):
        self.assertTrue(has_no_view_metric_host(
            "https://shortform.kakao.com/contents/6a9942c83268add3efa4fcd2/"))

    def test_all_listed_hosts_are_detected(self):
        """목록에 호스트를 추가해도 판정이 따라오는지 — 실제 URL 모양으로 확인한다."""
        samples = {
            "threads.": "https://www.threads.net/@a/post/xyz",
            "facebook.com": "https://www.facebook.com/a/videos/1",
            "naver.com": "https://blog.naver.com/a/1",
            "kakao.com": "https://shortform.kakao.com/contents/x/",
        }
        self.assertEqual(set(samples), set(NO_VIEW_METRIC_HOSTS),
                         "호스트 목록이 바뀌었다 — 이 표본도 같이 갱신할 것")
        for host, url in samples.items():
            self.assertTrue(has_no_view_metric_host(url), "%s 미검출: %s" % (host, url))

    def test_view_platforms_are_not_swept_in(self):
        for url in ("https://www.instagram.com/p/abc/",
                    "https://www.youtube.com/shorts/abc",
                    "https://www.tiktok.com/@a/video/1",
                    "https://x.com/a/status/1"):
            self.assertFalse(has_no_view_metric_host(url), url)

    def test_broken_url_is_not_treated_as_normal(self):
        """⚠️ 주소가 깨진 글은 '미수집이 정상'이 아니다 — 조용히 숨기면 고칠 기회를 잃는다."""
        for url in ("", None, "몰라요", "https://example.com/abc"):
            self.assertFalse(has_no_view_metric_host(url), repr(url))


class ViewCapableTest(unittest.TestCase):
    def test_unknown_platform_is_not_capable(self):
        self.assertFalse(is_view_capable({"url": "https://example.com/abc"}))

    def test_no_metric_hosts_are_not_capable(self):
        self.assertFalse(is_view_capable({"url": "https://shortform.kakao.com/contents/x/"}))

    def test_view_platforms_are_capable(self):
        self.assertTrue(is_view_capable({"url": "https://www.instagram.com/p/abc/"}))

    def test_platform_labels(self):
        self.assertEqual(platform("https://youtu.be/x"), "youtube")
        self.assertEqual(platform("https://twitter.com/a/status/1"), "x")
        self.assertEqual(platform("https://shortform.kakao.com/x"), "other")


class SingleSourceContractTest(unittest.TestCase):
    """두 소비자가 각자 규칙을 재구현하면 또 갈라진다 — 소스로 고정한다."""

    def _src(self, name):
        return Path(__file__).with_name(name).read_text(encoding="utf-8")

    def test_queue_imports_the_canonical_rule(self):
        src = self._src("build_view_missing_queue.py")
        self.assertIn("from platform_kind import", src)
        self.assertNotIn('def is_view_capable(', src, "큐가 규칙을 다시 구현했다")

    def test_report_imports_the_canonical_rule(self):
        src = self._src("daily_collect_report.py")
        self.assertIn("from platform_kind import has_no_view_metric_host", src)
        for host in ("kakao.com", "naver.com", "threads."):
            self.assertNotIn('"%s"' % host, src, "알림이 호스트 목록을 따로 들고 있다")

    def test_report_checks_after_the_ended_branch(self):
        """⚠️ 종료 판정보다 앞에 두면 이미 종료된 글까지 끌어와 '종료' 집계를 빼앗는다.
        처음에 그렇게 넣었다가 무지표매체가 1이 아니라 7로 부풀어 잡았다."""
        src = self._src("daily_collect_report.py")
        ended = src.index("if is_ended(p):")
        host = src.index("elif has_no_view_metric_host(")
        self.assertLess(ended, host, "매체 판정이 종료 판정보다 앞에 있다")


if __name__ == "__main__":
    unittest.main()
