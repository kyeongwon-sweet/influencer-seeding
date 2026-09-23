"""cross_post_metrics 의 행동 계약 — TS(lib.ts)와 **같은 답**을 내야 한다.

web/tests/cross-post-fb-increment.test.ts 와 **같은 시나리오·같은 기대값**을 쓴다.
한쪽만 고치면 대시보드와 슬랙 리포트 숫자가 조용히 갈리므로, 두 파일을 짝으로 관리한다.

실행: python scripts/test_cross_post_metrics.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cross_post_metrics import (  # noqa: E402
    fb_at, fb_increment, ig_only, load_fb_by_shortcode, prev_ig_baseline, shortcode,
)


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

    # 합산 전환일: IG 증가분 + FB 전액이 그날 증분(사용자 결정 2026-09-22 — 총량 보존)
    s = [day("2026-09-20", 410_000), day("2026-09-21", 414_066),
         day("2026-09-22", 1_125_552, 711_486)]
    eq(safe_inc(s, s[2], "2026-09-01"), 711_486, "합산 전환일 증분")

    # 🚨 Σ증분 == 최종 누적 — 깨지면 리포트 총합이 대시보드 누적과 영구히 어긋난다.
    s = [day("2026-09-20", 100_000), day("2026-09-21", 150_000),
         day("2026-09-22", 900_000, 700_000), day("2026-09-23", 920_000, 705_000)]
    eq(sum(safe_inc(s, r, "2026-09-19") or 0 for r in s), 920_000, "Σ증분 == 최종 누적")

    # 두 번째 측정부터 실제 증가분
    s = [day("2026-09-22", 1_125_552, 711_486), day("2026-09-23", 1_130_552, 713_486)]
    eq(safe_inc(s, s[1], "2026-09-01"), 5_000, "IG+FB 델타 합")

    # 🚨 FB 조회가 하루 실패해도 튀지 않는다(play_count 는 역행가드로 합계 유지)
    s = [day("2026-09-22", 1_125_552, 711_486), day("2026-09-23", 1_125_552, None)]
    eq(fb_at(s, s[1]), 711_486, "FB 결측일 이어쓰기")
    eq(safe_inc(s, s[1], "2026-09-01"), 0, "FB 결측일 증분")

    # 첫 측정이 곧 첫 FB 측정이면 그날 전액(IG+FB)
    s = [day("2026-09-22", 50_000, 20_000)]
    eq(safe_inc(s, s[0], "2026-09-20"), 50_000, "첫 측정 전액")

    # fb_increment 경계
    a, b, c = day("2026-09-22", 100, 50), day("2026-09-23", 120, 70), day("2026-09-24", 120, 60)
    eq(fb_increment([a], "2026-09-22"), 50, "첫 FB 측정 = 전액 귀속")
    eq(fb_increment([a, b], "2026-09-23"), 20, "FB 델타")
    eq(fb_increment([a, b, c], "2026-09-24"), 0, "FB 감소는 0")

    # 측정 없음
    eq(ig_only([], day("2026-09-22", None)), None, "play 없음 → None")

    # ── 스윕 결과 로더 ────────────────────────────────────────────────
    # 🚨 전수조사 결과는 활성·종료 **두 파일**이다. 한 파일만 넘기면 나머지 절반이 조용히
    #    빠지고, detect 는 그 글들을 '교차게시 아님'으로 해제해 버린다(실제로 처음에 그렇게 짰다).
    import json
    import tempfile

    def tmp(obj):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(obj, f, ensure_ascii=False)
        f.close()
        return f.name

    P = "https://www.instagram.com/p/"
    f1 = tmp({P + "AAA1/": {"ig": 100, "fb": 50}, P + "BBB2/": {"ig": 9, "fb": 0}})
    f2 = tmp({P + "CCC3/": {"ig": 7, "fb": 3}, P + "DDD4/": {"ig": 7, "fb": None}})

    eq(load_fb_by_shortcode([f1, f2]), {"AAA1": 50, "CCC3": 3}, "두 파일 병합")
    eq(load_fb_by_shortcode(f1), {"AAA1": 50}, "문자열 하나도 받는다")
    eq(len(load_fb_by_shortcode([f1])), 1, "한 파일만 넘기면 다른 파일 건은 안 들어온다")

    # fb=0·None 은 '교차게시 아님'이지 '측정값 0'이 아니다 → 담지 않는다.
    eq("BBB2" in load_fb_by_shortcode([f1]), False, "fb=0 을 담으면 안 된다")
    eq("DDD4" in load_fb_by_shortcode([f2]), False, "fb=None 을 담으면 안 된다")

    # 프로필 URL 등 게시물이 아닌 주소는 무시
    f3 = tmp({"https://www.instagram.com/someacct/": {"fb": 999}})
    eq(load_fb_by_shortcode([f3]), {}, "게시물 URL 이 아니면 무시")

    eq(shortcode(P + "AAA1/"), "AAA1", "shortcode 추출")
    eq(shortcode("https://www.instagram.com/acct/"), None, "프로필 URL 은 None")

    # ── 역행 가드 기준(2026-09-23 실사고 재발 방지) ───────────────────
    # 🚨 저장된 play_count 는 교차게시 글에서 IG+FB 합계다. 새 IG 실측을 그 합계와 비교하면
    #    멀쩡한 값이 '역행'으로 잡혀 합계로 clamp 되고, 뒤이어 FB 가 다시 더해져 이중 계상이 난다.
    #    실제로 퐁패밀리 09-22 누적이 2,207,775 로 부풀었고 활성 15건 중 12건이 오염됐다.
    eq(prev_ig_baseline(1_121_288, 711_486), 409_802, "합계에서 FB 를 빼야 IG 기준")
    eq(prev_ig_baseline(1_121_288, None), 1_121_288, "교차게시 아님(FB 없음) → 종전과 동일")
    eq(prev_ig_baseline(None, 711_486), None, "직전 측정 없음 → 비교 안 함")
    eq(prev_ig_baseline(0, None), 0, "0 도 값이다(없음과 구분)")

    # 사고 재현: 새 IG 414,066 은 직전 IG 409,802 보다 크므로 clamp 되면 안 된다.
    new_ig, prev_total, prev_fb = 414_066, 1_121_288, 711_486
    eq(new_ig < prev_total, True, "합계와 비교하면 역행으로 오판한다(사고 원인)")
    eq(new_ig < prev_ig_baseline(prev_total, prev_fb), False, "IG 기준이면 역행이 아니다")

    # 소스 계약: 수집기가 합계를 그대로 비교/대입하면 안 된다.
    import os as _os
    src = open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "run_monitoring.py"),
               encoding="utf-8").read()
    if 'play_count = existing.get("play_count")' in src:
        fails.append("run_monitoring: 역행 clamp 가 합계(existing.play_count)를 그대로 대입한다 — 이중 계상 재발")
    if "prev_ig_baseline" not in src:
        fails.append("run_monitoring: 역행 가드가 prev_ig_baseline 을 안 쓴다")

    if fails:
        for f in fails:
            print("  ✗ " + f)
        print(f"실패 {len(fails)}건")
        return 1
    print("cross_post_metrics: 통과")
    return 0


if __name__ == "__main__":
    sys.exit(run())
