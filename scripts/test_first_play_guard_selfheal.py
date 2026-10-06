# '첫 측정 조회수 가드'의 자기고착 — 행동 계약 (2026-10-06 추가).
#
# 🚨 실사고: 가드는 "스크래퍼가 좋아요 수를 조회수 자리에 넣은 **첫 측정**"만 거르려고
#    만들어졌는데, 판정 기준이 '직전 행에 조회수가 있나'였다. 가드가 걸리면 그날 조회수를
#    None 으로 비우므로 **다음날의 직전 행도 비어 있다** → 매일 "첫 측정"으로 보이고
#    매일 다시 비워졌다. 한 번 걸리면 영구히 못 빠져나온다.
#
#    fromsensuous(p/Dd4HREdSQKa, 비용 12,599원)가 그렇게 나흘간 조회수 공백이었다.
#    Apify 는 1,099(10-01)~1,166(10-05)을 꾸준히 돌려줬고 사람이 실물로 1,199 를 확인해
#    줬는데도, 좋아요 531 의 3배(1,593) 미만이라는 이유로 매일 버려졌다.
#
# 이 가드엔 테스트가 하나도 없었다. 그래서 여기서부터 계약을 고정한다.

import run_monitoring as rm


FIRST = dict(play_count=1166, likes_count=531, comments_count=8)


def test_첫_측정이고_좋아요_대비_조회수가_낮으면_거른다():
    # 가드의 원래 목적 — 이력이 전혀 없는 첫 측정만 의심한다.
    assert rm._looks_like_engagement_count_as_views(**FIRST) is True


def test_직전_행에_조회수가_있으면_통과시킨다():
    assert rm._looks_like_engagement_count_as_views(
        **FIRST, existing={"play_count": 1100}) is False


def test_사고핵심_직전행이_비어도_과거_이력이_있으면_통과시킨다():
    # 사고의 핵심. 어제 가드가 비워놓은 공백을 '첫 측정'으로 오인하면 영구 고착된다.
    assert rm._looks_like_engagement_count_as_views(
        **FIRST, existing={"play_count": None}, had_play_before=True) is False


def test_사고재현_고착_시나리오_재현_이력이_없으면_매일_다시_걸린다():
    # had_play_before 를 안 넘기면(=이력 미집계) 사고 당시와 똑같이 매일 걸린다.
    for _ in range(4):
        assert rm._looks_like_engagement_count_as_views(
            **FIRST, existing={"play_count": None}) is True


def test_이력_집계는_수기_입력도_친다():
    # fromsensuous 의 유일한 조회수(1,099)는 사람이 시트에 적은 manual 행이었다.
    # 사람이 본 값도 '첫 측정이 아니다'의 증거다 — 제외하면 이 글은 영영 안 풀린다.
    had = set()
    rm._summarize_history_rows(
        [{"post_id": "p1", "measured_at": "2026-10-01", "play_count": 1099,
          "reach_count": None, "likes_count": 531, "comments_count": 8, "manual": True}],
        {}, {}, set(), {}, had)
    assert had == {"p1"}


def test_이력_집계는_배너_도달수를_조회수로_치지_않는다():
    # reach 만 있는 배너는 조회수 이력이 아니다 — 치면 배너의 첫 조회수 보호가 풀린다.
    had = set()
    rm._summarize_history_rows(
        [{"post_id": "banner", "measured_at": "2026-10-01", "play_count": None,
          "reach_count": 50000, "likes_count": 3, "comments_count": 0, "manual": False},
         {"post_id": "zero", "measured_at": "2026-10-01", "play_count": 0,
          "reach_count": None, "likes_count": 3, "comments_count": 0, "manual": False}],
        {}, {}, set(), {}, had)
    assert had == set(), "reach·0 은 조회수 이력이 아니다"


def test_이력_집계는_선택사항이라_기존_호출부를_깨지_않는다():
    rm._summarize_history_rows([], {}, {}, set(), {})  # 5인자 호출(기존 계약) 유지


def test_요약이_이력집합까지_돌려준다_소스_계약():
    # run()이 5번째 반환값을 쓰므로 arity 가 바뀌면 수집 전체가 죽는다.
    from pathlib import Path
    src = (Path(__file__).resolve().parent / "run_monitoring.py").read_text(encoding="utf-8")
    assert "had_play_by_post,\n    )" in src, "_active_stats_summary 가 이력집합을 반환해야 한다"
    assert "had_play_before=post[\"id\"] in had_play_ids" in src, "호출부가 이력을 넘겨야 한다"
    assert "had_play_ids: set = set()" in src, "요약 실패 시 보수적 기본값이 있어야 한다"
