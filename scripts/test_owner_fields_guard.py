#!/usr/bin/env python3
"""담당자 빈칸 감시 행동 테스트 — 값은 채우지 않고 '세기만' 하는지 고정."""

import unittest

from owner_fields_guard import STALE_DAYS, blank_owner_actives, blank_owner_line

TODAY = "2026-09-10"


def post(**kw):
    base = {
        "account_name": "acc", "url": "https://x/1", "channel_type": "협찬 (인플루언서)",
        "posted_at": "2026-09-01", "ended_at": None, "creator": "김제작", "planner": "박기획",
        "project_name": None, "asset_name": None,
    }
    base.update(kw)
    return base


class ScopeTest(unittest.TestCase):
    def test_only_active_paid_counts(self):
        posts = [
            post(creator=""),                                   # 대상
            post(creator="", ended_at="2026-09-01"),            # 종료 → 제외
            post(creator="", channel_type="위성채널"),           # 무상 → 제외
        ]
        agg = blank_owner_actives(posts, TODAY)
        self.assertEqual(len(agg["creator"]), 1)
        self.assertEqual(agg["paid"], 1)

    def test_ended_at_any_value_is_excluded(self):
        """관례 고정: 종료일이 오늘/미래여도 '활성'으로 세지 않는다.

        cost_mapping_guard·notify_status 가 모두 `if ended_at: continue` 다.
        정의가 갈리면 같은 지표를 다른 숫자로 보고하게 된다(2026-09-10 실제로 겪음).
        """
        posts = [post(creator="", ended_at=TODAY), post(creator="", ended_at="2099-01-01")]
        self.assertEqual(blank_owner_actives(posts, TODAY)["paid"], 0)

    def test_free_reasons_are_counted_separately(self):
        posts = [post(channel_type="위성채널"), post(channel_type="온드미디어"),
                 post(account_name="어떤채널 미러링")]
        agg = blank_owner_actives(posts, TODAY)
        self.assertGreaterEqual(len(agg["free_by_reason"]), 2,
                                "제외 사유를 합쳐 세면 규칙 붕괴가 수백 건에 묻힌다")

    def test_creator_and_planner_are_tracked_separately(self):
        posts = [post(creator=""), post(planner=""), post(creator="", planner="")]
        agg = blank_owner_actives(posts, TODAY)
        self.assertEqual(len(agg["creator"]), 2)
        self.assertEqual(len(agg["planner"]), 2)

    def test_whitespace_only_is_blank(self):
        self.assertEqual(len(blank_owner_actives([post(creator="   ")], TODAY)["creator"]), 1)


class LineTest(unittest.TestCase):
    def test_no_blanks_is_silent(self):
        self.assertIsNone(blank_owner_line(blank_owner_actives([post()], TODAY), TODAY))

    def test_line_reports_counts_and_denominator(self):
        line = blank_owner_line(blank_owner_actives([post(creator=""), post(planner="")], TODAY), TODAY)
        self.assertIn("제작자 1건", line)
        self.assertIn("기획자 1건", line)
        self.assertIn("유상 활성 2건 중", line)

    def test_stale_is_surfaced(self):
        old = post(creator="", posted_at="2026-01-01")
        line = blank_owner_line(blank_owner_actives([old], TODAY), TODAY)
        self.assertIn(f"{STALE_DAYS}일 초과 방치", line)

    def test_line_never_suggests_autofill(self):
        line = blank_owner_line(blank_owner_actives([post(creator="")], TODAY), TODAY)
        self.assertIn("연동시트 담당자 입력 필요", line)
        for banned in ("자동 입력", "자동 채움", "autofill"):
            self.assertNotIn(banned, line, "감시는 알림만 — 값을 채우자고 하면 안 된다")


if __name__ == "__main__":
    unittest.main()
