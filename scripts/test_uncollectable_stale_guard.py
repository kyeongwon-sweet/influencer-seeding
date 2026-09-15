# -*- coding: utf-8 -*-
"""'수집 불가' 태깅이 영구 침묵이 되지 않는지 — 재확인 워치독 계약.

배경(2026-09-14~15): 인스타 제한 2건을 '수집 불가'로 자동 태깅하도록 고쳤더니 매일 뜨던
오탐은 멎었지만, 그 태깅이 재시도 큐·워치독·자정 알림 목록에서 글을 동시에 지운다.
게다가 수기 입력 이력이 있으면 auto_end 의 manual_stat_tracked 로 나이 종료까지 면제된다
→ 사람이 손대지 않으면 활성으로 영원히 남는다. 그래서 '오래 조용한 것'만 다시 띄운다.
"""

import unittest

from uncollectable_stale_guard import (
    STALE_DAYS,
    is_uncollectable_tagged,
    stale_lines,
    stuck_uncollectable,
)

TAGGED = "인스타 수집 불가 감지(자동 2026-09-13, restricted_page) — 조회수 최종값에서 정지, 확인 필요"


def post(**kw):
    base = {"id": "p1", "account_name": "moduhappy", "channel_type": "바이럴 (영상)",
            "url": "https://www.instagram.com/p/DclNwKLTAyg/", "notes": TAGGED,
            "ended_at": None, "posted_at": "2026-08-18"}
    base.update(kw)
    return base


class TaggingTest(unittest.TestCase):
    def test_auto_and_manual_notes_both_count(self):
        self.assertTrue(is_uncollectable_tagged(post()))
        self.assertTrue(is_uncollectable_tagged(post(
            notes="틱톡: 영상은 공개이나 액터가 not_found 반환 → 자동 수집 불가(지역제한 추정)")))

    def test_unrelated_notes_do_not_count(self):
        self.assertFalse(is_uncollectable_tagged(post(notes="팀 메모: 재촬영 예정")))
        self.assertFalse(is_uncollectable_tagged(post(notes=None)))


class StuckTest(unittest.TestCase):
    def test_surfaces_only_after_the_window(self):
        posts, seen = [post()], {"p1": "2026-09-08"}
        self.assertEqual(stuck_uncollectable(posts, seen, "2026-09-15"), [])   # 7일 — 아직
        found = stuck_uncollectable(posts, seen, "2026-09-23")                 # 15일 — 뜬다
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["days"], 15)
        self.assertEqual(found[0]["last_seen"], "2026-09-08")

    def test_boundary_is_strictly_greater(self):
        posts, seen = [post()], {"p1": "2026-09-08"}
        exact = (2026, 9, 8 + STALE_DAYS)
        self.assertEqual(stuck_uncollectable(posts, seen, "2026-09-22"), [],
                         "경계일 당일은 아직 아니다(초과일 때만)")
        self.assertEqual(len(stuck_uncollectable(posts, seen, "2026-09-23")), 1)
        del exact

    def test_ended_posts_are_not_asked_again(self):
        """이미 사람이 닫은 글을 다시 물어보면 노이즈다."""
        self.assertEqual(
            stuck_uncollectable([post(ended_at="2026-09-10")], {"p1": "2026-09-08"}, "2026-09-30"), [])

    def test_untagged_posts_are_ignored(self):
        self.assertEqual(
            stuck_uncollectable([post(notes=None)], {"p1": "2026-09-08"}, "2026-09-30"), [])

    def test_recovery_clears_it(self):
        """값이 다시 들어오면 last_seen 이 최신이라 자동으로 빠진다(자가치유와 짝)."""
        self.assertEqual(
            stuck_uncollectable([post()], {"p1": "2026-09-29"}, "2026-09-30"), [])

    def test_never_measured_falls_back_to_posted_at(self):
        found = stuck_uncollectable([post()], {}, "2026-09-30")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["last_seen"], "2026-08-18")

    def test_unknown_reference_date_is_not_surfaced(self):
        """경과일을 못 세는데 '오래됐다'고 단정하면 갓 등록된 글이 끌려 나온다."""
        self.assertEqual(stuck_uncollectable([post(posted_at=None)], {}, "2026-09-30"), [])
        self.assertEqual(stuck_uncollectable([post(posted_at="몰라")], {}, "2026-09-30"), [])

    def test_oldest_first(self):
        posts = [post(id="new", url="u-new"), post(id="old", url="u-old")]
        found = stuck_uncollectable(posts, {"new": "2026-09-08", "old": "2026-08-20"}, "2026-09-30")
        self.assertEqual([f["post_id"] for f in found], ["old", "new"])


class LinesTest(unittest.TestCase):
    def test_no_section_when_empty(self):
        self.assertEqual(stale_lines([]), [])

    def test_header_says_it_does_not_auto_end(self):
        lines = stale_lines(stuck_uncollectable([post()], {"p1": "2026-09-08"}, "2026-09-23"))
        self.assertIn("자동 종료하지 않습니다", lines[0])
        self.assertIn("DclNwKLTAyg", "\n".join(lines))

    def test_long_lists_are_truncated(self):
        posts = [post(id=str(i), url="u%d" % i) for i in range(15)]
        seen = {str(i): "2026-08-20" for i in range(15)}
        lines = stale_lines(stuck_uncollectable(posts, seen, "2026-09-30"), max_detail=10)
        self.assertIn("... 외 5건", lines[-1])


if __name__ == "__main__":
    unittest.main()
