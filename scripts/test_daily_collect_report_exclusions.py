# -*- coding: utf-8 -*-
"""자정 수집 알림이 '정상인 미수집'을 매일 재알림하지 않는지 — 가짜 HTTP로 전체 경로 검증.

2026-09-14 실측 사고: 알림(daily_collect_report)이 재시도 큐(build_view_missing_queue)와 **별개로**
자체 판정을 하고 있어서, 큐에서 빠진 글이 알림에는 매일 그대로 떴다. 두 가지가 샜다.
  ① 매거진 배너 경계일(2026-08-18) **이전** 게시물('오늘의 메뉴', 08-07) — 사진 캐러셀이라
     조회수가 아예 없는데 매일 '활성인데 미수집'으로 보고됐다.
  ② 인스타가 제한(restricted_page)을 건 글 — 수집기가 notes에 '수집 불가'를 태깅해도 알림은
     그 노트를 보지 않아 매일 다시 떴다.
"""

import datetime
import io
import json
import sys
import unittest
import urllib.request
from contextlib import redirect_stdout

import daily_collect_report as R

YDAY = "2026-09-13"

POSTS = [
    # ① 경계 밖 매거진 — 도달수만 수기, 조회수 없음이 정상
    {"id": "magazine", "account_name": "오늘의 메뉴", "channel_type": "협찬 (파워채널/매거진)",
     "url": "https://www.instagram.com/p/DbutARtkWS8/", "notes": None, "ended_at": None,
     "posted_at": "2026-08-07", "created_at": "2026-08-20", "not_found_streak": 0,
     "review_requested_at": None},
    # ② 인스타 제한 — 수집기가 '수집 불가' 태깅함
    {"id": "restricted", "account_name": "moduhappy", "channel_type": "바이럴 (영상)",
     "url": "https://www.instagram.com/p/DclNwKLTAyg/",
     "notes": "인스타 수집 불가 감지(자동 2026-09-14, restricted_page) — 조회수 최종값에서 정지, 확인 필요",
     "ended_at": None, "posted_at": "2026-08-18", "created_at": "2026-08-18",
     "not_found_streak": 0, "review_requested_at": None},
    # ③ 진짜 미수집 — 반드시 남아야 한다(과잉 억제 방지)
    {"id": "real", "account_name": "진짜미수집", "channel_type": "바이럴 (영상)",
     "url": "https://www.instagram.com/p/REALMISS/", "notes": None, "ended_at": None,
     "posted_at": "2026-08-18", "created_at": "2026-08-18", "not_found_streak": 0,
     "review_requested_at": None},
    # ④ 제한 태깅이 붙어 있지만 값이 돌아온 글 — 확보로 세야 한다(자가치유 지연 대비)
    {"id": "recovered", "account_name": "복구됨", "channel_type": "바이럴 (영상)",
     "url": "https://www.instagram.com/p/RECOVER/",
     "notes": "인스타 수집 불가 감지(자동 2026-09-10, restricted_page) — 조회수 최종값에서 정지, 확인 필요",
     "ended_at": None, "posted_at": "2026-08-18", "created_at": "2026-08-18",
     "not_found_streak": 0, "review_requested_at": None},
]

SAME_DAY = [
    {"post_id": "magazine", "play_count": None, "reach_count": None, "created_at": YDAY + "T15:00:00+00:00"},
    {"post_id": "restricted", "play_count": None, "reach_count": None, "created_at": YDAY + "T15:00:00+00:00"},
    {"post_id": "real", "play_count": None, "reach_count": None, "created_at": YDAY + "T15:00:00+00:00"},
    {"post_id": "recovered", "play_count": 51984, "reach_count": None, "created_at": YDAY + "T15:00:00+00:00"},
]

# 매거진의 마지막 도달수는 08-25 — 최근 7일 창 **밖**이다(이 사고의 핵심).
FULL_HISTORY = {
    "magazine": [
        {"play_count": 45795, "reach_count": 45795, "manual": True},   # 수기 행이 도달수를 두 칸에 복사
        {"play_count": None, "reach_count": 45795, "manual": True},
        {"play_count": None, "reach_count": None, "manual": False},
    ],
}


class _FakeResponse(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _fake_urlopen(req, timeout=None):
    url = req.full_url if hasattr(req, "full_url") else str(req)
    if "sponsored_posts" in url:
        body = POSTS if "offset=0" in url else []
    elif "select=play_count,reach_count,manual" in url:          # 후보 전체 이력
        pid = url.split("post_id=eq.")[1].split("&")[0]
        body = FULL_HISTORY.get(pid, [])
    elif "select=post_id,manual,play_count,reach_count" in url:  # 최근 7일
        body = [] if "offset=0" not in url else [
            {"post_id": p["post_id"], "manual": False,
             "play_count": p["play_count"], "reach_count": p["reach_count"]}
            for p in SAME_DAY
        ]
    elif "measured_at=eq." in url:                               # 측정일 스탯
        body = SAME_DAY if "offset=0" in url else []
    else:
        body = []
    return _FakeResponse(json.dumps(body).encode("utf-8"))


class DailyReportExclusionTest(unittest.TestCase):
    def setUp(self):
        self._env, self._open, self._argv = R.load_env, urllib.request.urlopen, sys.argv
        R.load_env = lambda: {"NEXT_PUBLIC_SUPABASE_URL": "https://x.test",
                              "SUPABASE_SERVICE_ROLE_KEY": "k"}
        urllib.request.urlopen = _fake_urlopen
        sys.argv = ["report.py", "--date", YDAY]

    def tearDown(self):
        R.load_env, urllib.request.urlopen, sys.argv = self._env, self._open, self._argv

    def _run(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            R.main()
        return buf.getvalue()

    def test_out_of_cutoff_magazine_is_not_reported(self):
        out = self._run()
        self.assertNotIn("DbutARtkWS8", out,
                         "경계 밖 매거진(사진 캐러셀)이 매일 '미수집'으로 다시 뜬다")

    def test_collector_tagged_restricted_post_is_not_reported(self):
        out = self._run()
        self.assertNotIn("DclNwKLTAyg", out,
                         "'수집 불가' 태깅된 글이 알림에 매일 다시 뜬다")

    def test_genuine_miss_is_still_reported(self):
        """과잉 억제 금지 — 진짜 미수집은 반드시 남아야 한다."""
        out = self._run()
        self.assertIn("REALMISS", out)

    def test_recovered_post_counts_as_measured_not_excluded(self):
        """노트가 남아 있어도 값이 돌아왔으면 '확보'로 센다 — 확보율이 부풀면 안 된다."""
        out = self._run()
        self.assertNotIn("RECOVER", out)
        self.assertIn("2건 중 값 확보 1건", out)   # real(미수집) + recovered(확보)

    def test_excluded_counts_are_visible(self):
        """제외는 조용히 사라지면 안 된다 — 사유별 건수가 본문에 보여야 한다."""
        out = self._run()
        self.assertIn("수집불가 1", out)          # restricted 1건
        self.assertIn("배너 1", out)              # 경계 밖 매거진 1건


if __name__ == "__main__":
    unittest.main()
