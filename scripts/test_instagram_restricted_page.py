"""인스타 '제한(restricted_page)' 게시물이 조용히 매일 재수집되지 않게 한다.

2026-09-14 실측 사고:
  moduhappy / smile_ggobuk_s2 두 게시물에 인스타가 제한을 걸어 09-09부터 조회수가 끊겼다.
  Apify 응답은 `{"error": "restricted_page",
                "errorDescription": "Restricted access, only partial data available"}`
  로 **명시적 에러**였는데, IG 저장 경로가 `error == "not_found"` 한 값만 봐서 아무 표시도
  남기지 않았다. 그래서 notes 태깅이 없고 → 재시도 큐가 매일 다시 담고 → 매일 Apify를
  재호출하며 매일 같은 '활성 게시물인데 조회수 미수집' 경고가 떴다.
  보조 플랫폼(_store_aux_rows)은 이미 `if s.get("error")` 로 어떤 에러든 태깅하고 있었다.
"""

import re
import unittest
from pathlib import Path

from run_monitoring import _ig_error_signals, is_ig_mass_error

SOURCE = Path(__file__).with_name("run_monitoring.py").read_text(encoding="utf-8")

# IG 저장 루프의 제한(restricted) 분기 — 조건이 바뀌면 여기만 고치면 된다.
RESTRICTED_BRANCH_RE = (
    r'if s\.get\("error_code"\)(.*?)'
    + chr(10)
    + r'            updates = \{\}'
)

RESTRICTED_ITEM = {
    "url": "https://www.instagram.com/reel/DclNwKLTAyg/",
    "media_id": "3973642730290810016",
    "user": {"username": "moduhappy"},
    "error": "restricted_page",
    "errorDescription": "Restricted access, only partial data available",
}


class InstagramErrorSignalsTest(unittest.TestCase):
    def test_restricted_page_is_reported_as_error_not_deleted(self):
        deleted, code, desc = _ig_error_signals(RESTRICTED_ITEM)
        self.assertFalse(deleted, "제한은 삭제가 아니다 — 자동 종료로 새면 살아 있는 글이 종료된다")
        self.assertEqual(code, "restricted_page")
        self.assertEqual(desc, "Restricted access, only partial data available")

    def test_not_found_stays_deleted_and_does_not_leak_into_error_code(self):
        deleted, code, _ = _ig_error_signals({"error": "not_found"})
        self.assertTrue(deleted)
        self.assertIsNone(code, "삭제 확정은 기존 not_found 경로가 처리한다 — 중복 처리 금지")

    def test_does_not_exist_description_still_counts_as_deleted(self):
        deleted, code, _ = _ig_error_signals(
            {"errorDescription": "The post does not exist"}
        )
        self.assertTrue(deleted)
        self.assertIsNone(code)

    def test_normal_item_has_no_error(self):
        deleted, code, desc = _ig_error_signals(
            {"type": "Sidecar", "likesCount": 1094, "videoViewCount": None}
        )
        self.assertFalse(deleted)
        self.assertIsNone(code)
        self.assertIsNone(desc)

    def test_unknown_future_error_codes_are_passed_through(self):
        """액터가 새 에러 코드를 내도 '조회수 없음'으로 뭉개지 않고 태깅된다."""
        _, code, _ = _ig_error_signals({"error": "age_restricted"})
        self.assertEqual(code, "age_restricted")


class InstagramMassErrorGuardTest(unittest.TestCase):
    """배치 전체가 에러인 날은 자동 태깅을 멈춰야 한다 — 단정이 감시를 끄면 진짜 장애가 묻힌다."""

    def test_single_restricted_post_is_not_mass_error(self):
        stats = [{"error_code": "restricted_page"}] + [{} for _ in range(19)]
        self.assertFalse(is_ig_mass_error(stats))

    def test_batch_wide_errors_are_detected(self):
        self.assertTrue(is_ig_mass_error([{"error_code": "rate_limited"} for _ in range(20)]))

    def test_threshold_is_a_ratio_not_a_count(self):
        stats = [{"error_code": "x"} for _ in range(6)] + [{} for _ in range(14)]
        self.assertTrue(is_ig_mass_error(stats))          # 30%
        stats = [{"error_code": "x"} for _ in range(5)] + [{} for _ in range(15)]
        self.assertFalse(is_ig_mass_error(stats))         # 25%

    def test_tiny_samples_never_trip_the_guard(self):
        """표본이 작으면 비율이 요동쳐서, 개별 제한 1건이 '장애'로 오인된다."""
        self.assertFalse(is_ig_mass_error([{"error_code": "restricted_page"}]))
        self.assertFalse(is_ig_mass_error([]))

    def test_guard_is_wired_into_the_save_loop(self):
        self.assertIn("if not ig_mass_error and not (post.get(\"notes\") or \"\").strip():", SOURCE)
        self.assertIn("ig_mass_error = is_ig_mass_error(", SOURCE)


class InstagramRestrictedSaveContractTest(unittest.TestCase):
    """저장 루프가 제한 게시물을 어떻게 다루는지 소스 계약으로 고정한다."""

    def test_save_loop_tags_notes_and_skips_daily_row(self):
        block = re.search(
            RESTRICTED_BRANCH_RE, SOURCE, re.S
        )
        self.assertIsNotNone(block, "IG 저장 루프의 error_code 분기가 사라졌다")
        body = block.group(1)
        self.assertIn("수집 불가 감지(자동", body, "notes 자동 태깅이 없으면 큐에서 제외되지 않는다")
        self.assertIn("continue", body, "일별행을 저장하면 직전 누적값이 NULL 로 덮일 수 있다")
        for forbidden in ("ended_at", "not_found_streak", "_record_not_found_observation"):
            self.assertNotIn(forbidden, body, f"제한 게시물이 {forbidden} 판정에 새면 안 된다")

    def test_notes_are_only_written_when_empty(self):
        block = re.search(
            RESTRICTED_BRANCH_RE, SOURCE, re.S
        ).group(1)
        self.assertIn('not (post.get("notes") or "").strip():', block,
                      "수동으로 적은 특이사항을 덮어쓰면 안 된다")

    def test_fallback_recovery_is_not_discarded(self):
        """data-slayer 폴백이 조회수를 되찾아온 건을 '수집 불가'로 버리면 폴백이 무의미해진다.

        두 겹으로 막는다: ① 저장 분기가 play_count is None 을 함께 본다
                        ② 폴백 병합부가 deleted 와 함께 error_code 도 푼다.
        """
        self.assertIn('if s.get("error_code") and s.get("play_count") is None:', SOURCE)
        self.assertEqual(
            SOURCE.count('cur["deleted"] = False'),
            SOURCE.count('cur["error_code"] = None'),
            "폴백 병합부마다 error_code 해제가 짝으로 있어야 한다",
        )

    def test_self_heal_clears_auto_note_when_views_return(self):
        self.assertIn('"수집 불가 감지(자동" in (post.get("notes") or "")', SOURCE)
        self.assertRegex(SOURCE, r'updates\["notes"\] = None')

    def test_queue_exclusion_keyword_matches_the_note(self):
        """큐는 notes 의 '수집 불가' 문자열로 제외한다 — 문구가 바뀌면 제외가 조용히 깨진다."""
        queue_src = Path(__file__).with_name("build_view_missing_queue.py").read_text(encoding="utf-8")
        self.assertIn('if "수집 불가" in notes:', queue_src)
        self.assertIn("수집 불가 감지(자동", SOURCE)


if __name__ == "__main__":
    unittest.main()
