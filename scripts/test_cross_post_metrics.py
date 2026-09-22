"""cross_post_metrics 의 행동 계약 — TS(lib.ts)와 **같은 답**을 내야 한다.

web/tests/cross-post-fb-increment.test.ts 와 **같은 시나리오·같은 기대값**을 쓴다.
한쪽만 고치면 대시보드와 슬랙 리포트 숫자가 조용히 갈리므로, 두 파일을 짝으로 관리한다.

실행: python scripts/test_cross_post_metrics.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cross_post_metrics import fb_at, fb_increment, ig_only  # noqa: E402


def day(measured_at, play_count, fb=None):
    return {"measured_at": measured_at, "play_count": play_count, "fb_play_count": fb}


def safe_inc(rows, row, posted_at=None):
    """lib.ts safeIncrement(비배너)와 같은 골격 — FB 규칙이 같은 답을 내는지 보려는 최소 재현."""
    from datetime import date
    cur = ig_only(rows, row)
    if cur is None or cur <= 0:
        return None
    base, has = 0, False
    for r in rows:
        if r["measured_at"] >= row["measured_at"]:
            continue
        v = ig_only(rows, r)
        if v is not None and v > 0:
            has = True
            base = max(base, v)
    if not has:
        if posted_at and (date.fromisoformat(row["measured_at"])
                          - date.fromisoformat(posted_at)).days > 7:
            return None
        return cur + fb_increment(rows, row["measured_at"])
    return max(0, cur - base) + fb_increment(rows, row["measured_at"])


def run():
    fails = []

    def eq(got, want, label):
        if got != want:
            fails.append(f"{label}: 기대 {want} / 실제 {got}")

    # 교차게시가 아니면 완전히 기존 동작(회귀 방지)
    s = [day("2026-09-20", 1000), day("2026-09-21", 1500), day("2026-09-22", 1800)]
    eq(safe_inc(s, s[2], "2026-09-01"), 300, "비교차 증분")
    eq(fb_at(s, s[2]), 0, "비교차 fb_at")
    eq(fb_increment(s, "2026-09-22"), 0, "비교차 fb_increment")

    # 🚨 합산 시작일에 FB 누적 전액이 하루 증분으로 찍히면 안 된다(퐁패밀리 실측 형태)
    s = [day("2026-09-20", 410_000), day("2026-09-21", 414_066),
         day("2026-09-22", 1_125_552, 711_486)]
    eq(safe_inc(s, s[2], "2026-09-01"), 0, "합산 시작일 증분 스파이크")

    # 두 번째 측정부터 실제 증가분
    s = [day("2026-09-22", 1_125_552, 711_486), day("2026-09-23", 1_130_552, 713_486)]
    eq(safe_inc(s, s[1], "2026-09-01"), 5_000, "IG+FB 델타 합")

    # 🚨 FB 조회가 하루 실패해도 튀지 않는다(play_count 는 역행가드로 합계 유지)
    s = [day("2026-09-22", 1_125_552, 711_486), day("2026-09-23", 1_125_552, None)]
    eq(fb_at(s, s[1]), 711_486, "FB 결측일 이어쓰기")
    eq(safe_inc(s, s[1], "2026-09-01"), 0, "FB 결측일 증분")

    # 첫 측정이 곧 첫 FB 측정이어도 FB 몫은 안 얹는다
    s = [day("2026-09-22", 50_000, 20_000)]
    eq(safe_inc(s, s[0], "2026-09-20"), 30_000, "첫 측정 IG 몫만")

    # fb_increment 경계
    a, b, c = day("2026-09-22", 100, 50), day("2026-09-23", 120, 70), day("2026-09-24", 120, 60)
    eq(fb_increment([a], "2026-09-22"), 0, "첫 FB 측정 = 0")
    eq(fb_increment([a, b], "2026-09-23"), 20, "FB 델타")
    eq(fb_increment([a, b, c], "2026-09-24"), 0, "FB 감소는 0")

    # 측정 없음
    eq(ig_only([], day("2026-09-22", None)), None, "play 없음 → None")

    if fails:
        for f in fails:
            print("  ✗ " + f)
        print(f"실패 {len(fails)}건")
        return 1
    print("cross_post_metrics: 통과")
    return 0


if __name__ == "__main__":
    sys.exit(run())
