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

    # ②-a is_material_desync (비대칭: 시트>DB 실질차만 True)
    eq("desync.db_ahead", A.is_material_desync(75890, 62322), False)   # DB>시트=export 지연 → 통과
    eq("desync.equal", A.is_material_desync(1000, 1000), False)
    eq("desync.sheet_noise_abs", A.is_material_desync(1870, 1880), False)  # 시트>DB지만 차이 10 → 무시
    eq("desync.sheet_noise_pct", A.is_material_desync(1_000_000, 1_010_000), False)  # 1% → 무시
    eq("desync.sheet_ahead_material", A.is_material_desync(62322, 75890), True)  # 시트 앞섬+실질차 → 차단

    # ②-b decide_stat_mismatches
    eq("stat.empty", A.decide_stat_mismatches([]), None)
    m = A.decide_stat_mismatches([("u1", 100, 5000), ("u2", 5, 9000)])
    eq("stat.some", bool(m and "2건" in m and "시트" in m), True)
    m6 = A.decide_stat_mismatches([(f"u{i}", i, i + 9999) for i in range(1, 8)])
    eq("stat.more", bool(m6 and "외 2건" in m6), True)

    # ③ check_classification
    items_ok = [{"channel_type": "바이럴 (영상)", "inc": 100, "url": "x"}]
    eq("class.ok", A.check_classification(items_ok, _norm_ch), None)
    items_small = [{"channel_type": "", "inc": 500, "url": "https://x/p/1"}]  # 미분류지만 <5만 → 통과
    eq("class.small_ok", A.check_classification(items_small, _norm_ch), None)
    items_bad = [{"channel_type": "", "inc": 60_000, "url": "https://x/p/1"}]  # ≥5만 → 차단
    r = A.check_classification(items_bad, _norm_ch)
    eq("class.bad_block", bool(r and r[0] == "BLOCK"), True)
    items_zero = [{"channel_type": "", "inc": 0, "url": "x"}]  # 미분류지만 증분 0 → 통과
    eq("class.zero_ok", A.check_classification(items_zero, _norm_ch), None)

    # ②-c is_sheet_behind (역방향: DB>시트 실질차만 True) — 2026-08-28 사고 회귀
    #   원래 "DB≥시트는 export 지연일 뿐 무해"로 보고 안 봤는데, carry-forward가 최신 칸에
    #   전날 값을 써넣고 다시 안 덮으므로 지연이 영구 고정된다. 실측: 먹리니 08-27
    #   DB 633,374 vs 시트 466,637.
    eq("behind.real_case", A.is_sheet_behind(633_374, 466_637), True)
    eq("behind.sheet_ahead", A.is_sheet_behind(62_322, 75_890), False)   # 반대 방향은 여기서 안 봄
    eq("behind.equal", A.is_sheet_behind(1000, 1000), False)
    eq("behind.noise_abs", A.is_sheet_behind(1880, 1870), False)          # 차이 10 → 무시
    eq("behind.noise_pct", A.is_sheet_behind(1_010_000, 1_000_000), False)  # 1% → 무시

    # ②-d decide_sheet_behind
    eq("behind.empty", A.decide_sheet_behind([]), None)
    wb = A.decide_sheet_behind([("u1", 633_374, 466_637)])
    eq("behind.msg_has_count", bool(wb and "1건" in wb), True)
    eq("behind.msg_names_cause", bool(wb and "carry-forward" in wb), True)

    # ②-e check_stat_sync: 양방향이 동시에 걸리면 BLOCK+WARN 둘 다 (BLOCK이 발송을 막고,
    #   WARN은 시트 미반영 사실을 함께 알린다)
    orig_mm = A._stat_mismatches
    A._stat_mismatches = lambda db, t: ([("a", 100, 9999)], [("b", 633_374, 466_637)])
    try:
        res = A.check_stat_sync(None, "2026-08-27")
        eq("stat.both_severities", sorted(r[0] for r in res), ["BLOCK", "WARN"])
        A._stat_mismatches = lambda db, t: ([], [])
        eq("stat.clean", A.check_stat_sync(None, "2026-08-27"), [])
        A._stat_mismatches = lambda db, t: ([], [("b", 633_374, 466_637)])
        only = A.check_stat_sync(None, "2026-08-27")
        eq("stat.behind_only_warns", [r[0] for r in only], ["WARN"])
    finally:
        A._stat_mismatches = orig_mm

    # ④ check_awareness
    eq("aware.none", A.check_awareness(None), None)
    eq("aware.clean", A.check_awareness({"meta": {"views": 1}}), None)
    rw = A.check_awareness({"warn": ["조회수 칸(열 49)에 ₩값 감지"]})
    eq("aware.warn_block", bool(rw and rw[0] == "BLOCK"), True)

    # run_presend_audit 집계: check_* 몽키패치로 severity 분리 검증
    orig = (A.check_collection, A.check_stat_sync, A.check_classification, A.check_awareness)
    A.check_collection = lambda db, t: ("BLOCK", "수집")
    A.check_stat_sync = lambda db, t: [("WARN", "시트조회실패")]  # 양방향이라 리스트
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
