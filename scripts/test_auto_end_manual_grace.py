# 단기형(배너·피드·캐러셀)은 수기 입력이 있어도 게시 후 7일 나이 규칙으로 종료한다 — 행동 계약.
#
# 🚨 2026-10-06: 배너 도달수는 수기로만 들어와 `manual_stat_tracked` 면제가 만료 없이 걸려
#    배너 332건이 영구 활성이었다 → '마지막 수기 입력 후 14일' 유예로 줄였다.
# 🚨 2026-10-28: 그래도 배너가 7일 트래킹이 끝난 뒤 2주 넘게 '트래킹 중'으로 남아 시트 빈칸이 '수집 누락'처럼
#    보였다(https://www.instagram.com/p/DeYt9OAiSfy/: 10-12 게시, 도달수 10-19까지 입력, 11-03 예정 종료).
#    reconcile_auto_end 는 마지막 입력일을 넘기지 않아 유예가 아예 안 풀렸다.
#    사용자: "7일 지나서 트래킹 종료처리되었어야하잖아" → 단기형은 면제 없음.
#
# ⚠️ 장기형(영상 등)은 손대지 않는다 — exportStats 가 종료일 이후 수기값을 지우던 사고
#    (2026-07-24)의 보호 대상이 그쪽이고, 그 계약은 test_auto_end_rules.py 가 지킨다.

from auto_end_rules import classify_auto_end

TODAY = "2026-10-28"


def _banner(**over):
    post = {
        "posted_at": "2026-10-12",          # 실사례 wikitrip.kr — 나이 16일 > 단기형 임계 7일
        "channel_type": "바이럴 (배너)",
        "project_name": "P바치 바이럴",
        "product_name": "P바치",
        "content_summary": "",
    }
    post.update(over)
    return post


def _call(post, manual_tracked=True, metric=32_460):
    return classify_auto_end(post, target_date=TODAY, max_metric=metric, manual_tracked=manual_tracked)


def test_수기_도달수가_있어도_7일_지난_배너는_종료된다():
    d = _call(_banner())
    assert d.should_end is True
    assert d.reason == "age_after_7"


def test_게시_7일째까지는_트래킹_8일째부터_종료():
    assert _call(_banner(posted_at="2026-10-21")).should_end is False      # 7일째
    assert _call(_banner(posted_at="2026-10-21")).reason == "not_due"
    assert _call(_banner(posted_at="2026-10-20")).should_end is True       # 8일째


def test_피드_캐러셀도_같은_7일_규칙():
    for ct in ("바이럴 (피드)", "협찬 (캐러셀)"):
        assert _call(_banner(channel_type=ct)).reason == "age_after_7", ct


def test_매거진_협찬도_배너와_같은_7일():
    # 2026-10-28 사용자: 매거진 협찬 트래킹 기간 = "배너와 같이 7일". 예: 오늘의메뉴 08-25 마지막 입력인데 10월까지 활성.
    d = _call(_banner(channel_type="협찬 (파워채널/매거진)", posted_at="2026-08-07"), metric=45_795)
    assert d.should_end is True and d.reason == "age_after_7"
    assert _call(_banner(channel_type="협찬 (파워채널/매거진)", posted_at="2026-10-22")).reason == "not_due"


def test_장기형은_수기추적_면제가_그대로():
    d = _call(_banner(channel_type="협찬 (인플루언서)", posted_at="2026-01-01"))
    assert d.should_end is False
    assert d.reason == "manual_stat_tracked", "영상 글을 끊으면 exportStats 수기값 삭제 사고가 재발한다"


def test_상위_보호장치는_그대로_먼저_이긴다():
    assert _call(_banner(manual_fields=["ended_at"])).reason == "manual_ended_at"      # 사람이 살린 글
    assert _call(_banner(channel_type="위성채널 배너")).reason == "excluded_channel_project"
    assert _call(_banner(), metric=600_000).reason == "high_metric_500k"
    assert _call(_banner(cost=20_000_000), metric=100).reason == "high_cost_10m"


def test_두_호출부가_같은_판정을_한다_소스_계약():
    # reconcile 은 마지막 입력일을 안 넘기고 run_monitoring 은 넘겼다 → 같은 배너가 경로마다 달리 판정됐다.
    # 이제 분류기는 마지막 입력일을 받지 않는다.
    from pathlib import Path
    root = Path(__file__).resolve().parent
    for f in ("run_monitoring.py", "reconcile_auto_end.py"):
        src = (root / f).read_text(encoding="utf-8")
        call = src.split("classify_auto_end(", 1)[1].split(")", 1)[0]
        assert "last_manual_at" not in call, f
