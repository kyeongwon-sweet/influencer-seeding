"""presend_sync_audit 순수 판정 로직 테스트. Workflow Lint에서 실행."""
from __future__ import annotations

import sys

import presend_sync_audit as A


def _norm_ch(ct):
    c = (ct or "").strip()
    return c or "미분류"


def main() -> int:
    fails: list[str] = []

    def eq(name, got, want):
        if got != want:
            fails.append(f"{name}: got={got!r} want={want!r}")

    # ① decide_collection
    eq("collection.zero", bool(A.decide_collection(0, [50, 60, 55])), True)          # 0건 → 차단
    eq("collection.normal", A.decide_collection(60, [50, 60, 55, 58, 62, 59, 61]), None)  # 정상 → 통과
    eq("collection.partial", bool(A.decide_collection(20, [50, 60, 55, 58, 62, 59, 61])), True)  # <50% → 차단
    eq("collection.small_hist", A.decide_collection(5, [4, 6, 5]), None)             # 중위<20이면 부분판정 안 함
    eq("collection.no_hist", A.decide_collection(3, [0, 0, 0]), None)                # 이력 없고 오늘>0 → 통과

    # ② decide_stat_mismatches
    eq("stat.empty", A.decide_stat_mismatches([]), None)
    m = A.decide_stat_mismatches([("u1", 100, 200), ("u2", 5, 9)])
    eq("stat.some", bool(m and "2건" in m), True)
    m6 = A.decide_stat_mismatches([(f"u{i}", i, i + 1) for i in range(1, 8)])
    eq("stat.more", bool(m6 and "외 2건" in m6), True)

    # ③ check_classification
    items_ok = [{"channel_type": "바이럴 (영상)", "inc": 100, "url": "x"}]
    eq("class.ok", A.check_classification(items_ok, _norm_ch), None)
    items_bad = [{"channel_type": "", "inc": 500, "url": "https://x/p/1"}]
    r = A.check_classification(items_bad, _norm_ch)
    eq("class.bad_block", bool(r and r[0] == "BLOCK"), True)
    items_zero = [{"channel_type": "", "inc": 0, "url": "x"}]  # 미분류지만 증분 0 → 통과
    eq("class.zero_ok", A.check_classification(items_zero, _norm_ch), None)

    # ④ check_awareness
    eq("aware.none", A.check_awareness(None), None)
    eq("aware.clean", A.check_awareness({"meta": {"views": 1}}), None)
    rw = A.check_awareness({"warn": ["조회수 칸(열 49)에 ₩값 감지"]})
    eq("aware.warn_block", bool(rw and rw[0] == "BLOCK"), True)

    # run_presend_audit 집계: check_* 몽키패치로 severity 분리 검증
    orig = (A.check_collection, A.check_stat_sync, A.check_classification, A.check_awareness)
    A.check_collection = lambda db, t: ("BLOCK", "수집")
    A.check_stat_sync = lambda db, t: ("WARN", "시트조회실패")
    A.check_classification = lambda items, n: None
    A.check_awareness = lambda ads: ("BLOCK", "열밀림")
    try:
        blocks, warns = A.run_presend_audit(None, "2026-08-13", items=[], ads={}, norm_ch=_norm_ch)
        eq("run.blocks", blocks, ["수집", "열밀림"])
        eq("run.warns", warns, ["시트조회실패"])
    finally:
        A.check_collection, A.check_stat_sync, A.check_classification, A.check_awareness = orig

    if fails:
        print("[FAIL] presend_sync_audit")
        for x in fails:
            print("  - " + x)
        return 1
    print("[OK] presend_sync_audit 판정/집계 통과")
    return 0


def test_presend_sync_audit():  # pytest 수집용(build-test.yml `pytest -q`)
    assert main() == 0


if __name__ == "__main__":
    sys.exit(main())
