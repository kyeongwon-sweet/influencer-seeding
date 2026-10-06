# 단기형(배너·피드·캐러셀) 수기추적 면제의 **유효기간** — 행동 계약 (2026-10-06 추가).
#
# 🚨 배경: 배너 도달수는 수기로만 들어온다 → 배너는 예외 없이 수기 행이 생기고,
#    `manual_stat_tracked` 면제가 만료 없이 걸려 **영구 활성**이 됐다.
#    2026-10-06 실측: 활성 배너 332건이 전부 이 분기에서 막혀 있었고(위성/온드 제외 분기는 0건),
#    그중 300건은 수기 입력이 30일 넘게 끊긴 상태였다. 종료되지도, 측정되지도 않은 채
#    매일 점검 목록에만 올라왔다.
#
# 면제의 목적은 "지금 사람이 입력 중인 글을 끊지 않는다"이지 "한 번 적었으면 영원히"가 아니다.
#
# ⚠️ 장기형(영상 등)은 손대지 않는다 — exportStats 가 종료일 이후 수기값을 지우던 사고
#    (2026-07-24)의 보호 대상이 그쪽이고, 그 계약은 test_auto_end_rules.py 가 지킨다.

from auto_end_rules import MANUAL_TRACK_GRACE_DAYS, classify_auto_end

TODAY = "2026-10-06"


def _banner(**over):
    post = {
        "posted_at": "2026-08-17",          # 나이 50일 > 단기형 임계 7일
        "channel_type": "바이럴 (배너)",
        "project_name": "쫀득바 출시마케팅",
        "product_name": "JD혼",
        "content_summary": "",
    }
    post.update(over)
    return post


def _call(post, last_manual_at):
    return classify_auto_end(
        post, target_date=TODAY, max_metric=45_795,
        manual_tracked=True, last_manual_at=last_manual_at,
    )


def test_입력이_끊긴_배너는_나이_규칙으로_종료된다():
    d = _call(_banner(), "2026-08-25")   # 42일 전
    assert d.should_end is True
    assert d.reason == "age_after_7"


def test_지금_입력_중인_배너는_여전히_보호된다():
    d = _call(_banner(), "2026-10-05")   # 어제
    assert d.should_end is False
    assert d.reason == "manual_stat_tracked"


def test_유예_경계_직전은_보호_경계_당일은_종료():
    from datetime import date, timedelta
    t = date.fromisoformat(TODAY)
    keep = str(t - timedelta(days=MANUAL_TRACK_GRACE_DAYS - 1))
    drop = str(t - timedelta(days=MANUAL_TRACK_GRACE_DAYS))
    assert _call(_banner(), keep).reason == "manual_stat_tracked"
    assert _call(_banner(), drop).should_end is True


def test_수기_행은_있지만_숫자를_적은_적이_없으면_보호하지_않는다():
    # 보호할 값 자체가 없다. 단, 나이 규칙은 그대로 적용된다.
    assert _call(_banner(), None).should_end is True
    assert _call(_banner(posted_at="2026-10-04"), None).should_end is False  # 아직 7일 안 지남


def test_장기형은_유예와_무관하게_면제가_유지된다():
    d = classify_auto_end(
        _banner(channel_type="협찬 (인플루언서)"), target_date=TODAY,
        max_metric=45_795, manual_tracked=True, last_manual_at="2026-01-01",
    )
    assert d.should_end is False
    assert d.reason == "manual_stat_tracked", "영상 글을 끊으면 exportStats 수기값 삭제 사고가 재발한다"


def test_면제가_풀려도_상위_보호장치는_그대로():
    # 수기추적보다 앞에 있는 규칙들은 유예와 무관하게 먼저 이긴다.
    assert _call(_banner(manual_fields=["ended_at"]), "2026-01-01").reason == "manual_ended_at"
    assert _call(_banner(channel_type="위성채널 배너"), "2026-01-01").reason == "excluded_channel_project"
    # 고성과·고액은 수기추적 **뒤** 규칙이라, 면제가 풀리면 이쪽이 받아 준다.
    assert classify_auto_end(
        _banner(), target_date=TODAY, max_metric=600_000,
        manual_tracked=True, last_manual_at="2026-01-01",
    ).reason == "high_metric_500k"
    assert classify_auto_end(
        _banner(cost=20_000_000), target_date=TODAY, max_metric=100,
        manual_tracked=True, last_manual_at="2026-01-01",
    ).reason == "high_cost_10m"


def test_날짜가_깨졌으면_면제를_유지한다():
    assert _call(_banner(), "이상한값").reason == "manual_stat_tracked"


def test_사고적발_날짜를_안_넘긴_호출은_종전처럼_면제를_유지한다():
    # '호출부가 안 줬다'와 '사람이 적은 적 없다'를 None 하나로 뭉쳤더니, 날짜를 넘기지 않는
    # 호출부가 조용히 배너 335건을 종료 대상으로 바꿔버렸다(2026-10-06 dry-run 에서 적발).
    d = classify_auto_end(
        _banner(), target_date=TODAY, max_metric=45_795, manual_tracked=True)
    assert d.should_end is False
    assert d.reason == "manual_stat_tracked"


def test_호출부가_날짜를_실제로_넘긴다_소스_계약():
    from pathlib import Path
    src = (Path(__file__).resolve().parent / "run_monitoring.py").read_text(encoding="utf-8")
    assert "last_manual_at=last_manual_at_by_post.get(p[\"id\"])" in src
