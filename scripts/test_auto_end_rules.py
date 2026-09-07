from auto_end_rules import classify_auto_end
from not_found_policy import classify_confirmed_deleted_end


def _post(**overrides):
    post = {
        "posted_at": "2026-06-25",
        "channel_type": "협찬 (인플루언서)",
        "project_name": "듬뿍바 출시마케팅",
        "product_name": "DB딸",
        "content_summary": "",
    }
    post.update(overrides)
    return post


def test_high_metric_over_age_is_not_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=2_100_000)
    assert decision.should_end is False
    assert decision.reason == "high_metric_500k"
    assert decision.metric == 2_100_000


def test_high_metric_threshold_boundary_is_not_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=500_000)
    assert decision.should_end is False
    assert decision.reason == "high_metric_500k"


def test_normal_metric_over_age_is_auto_ended():
    decision = classify_auto_end(_post(), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is True
    assert decision.reason == "age_after_14"
    assert decision.age_days == 20
    assert decision.threshold_days == 14


def test_short_lived_type_uses_seven_day_threshold():
    decision = classify_auto_end(_post(channel_type="바이럴 (배너)"), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is True
    assert decision.reason == "age_after_7"
    assert decision.threshold_days == 7


def test_owned_or_satellite_channel_is_excluded():
    decision = classify_auto_end(_post(channel_type="위성채널"), target_date="2026-07-15", max_metric=100_000)
    assert decision.should_end is False
    assert decision.reason == "excluded_channel_project"


def test_free_seeding_policy_stays_age_based_not_excluded():
    decision = classify_auto_end(
        _post(channel_type="무상시딩 (피드)"),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is True
    assert decision.reason == "age_after_7"


def test_asset_name_participates_in_owned_channel_exclusion():
    decision = classify_auto_end(
        _post(channel_type="협찬 (인플루언서)", asset_name="온드미디어_리컷"),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is False
    assert decision.reason == "excluded_channel_project"


def test_caption_end_keyword_still_forces_end():
    decision = classify_auto_end(_post(content_summary="삭제 예정"), target_date="2026-07-15", max_metric=2_100_000)
    assert decision.should_end is True
    assert decision.reason == "caption_keyword"


def test_manual_ended_at_field_is_never_auto_ended():
    decision = classify_auto_end(
        _post(manual_fields=["ended_at"]),
        target_date="2026-07-15",
        max_metric=100_000,
    )
    assert decision.should_end is False
    assert decision.reason == "manual_ended_at"


def test_manual_stat_tracked_post_is_never_auto_ended():
    decision = classify_auto_end(
        _post(),
        target_date="2026-07-15",
        max_metric=100_000,
        manual_tracked=True,
    )
    assert decision.should_end is False
    assert decision.reason == "manual_stat_tracked"


def test_confirmed_delete_override_ends_manual_tracked_post_without_weakening_age_rule():
    age_decision = classify_auto_end(
        _post(),
        target_date="2026-09-02",
        max_metric=100_000,
        manual_tracked=True,
    )
    assert not age_decision.should_end
    assert age_decision.reason == "manual_stat_tracked"

    delete_decision = classify_confirmed_deleted_end(
        {**_post(), "not_found_streak": 3, "manual_fields": ["reach_count"]},
        error_description="Post does not exist",
        last_valid_measured_at="2026-08-30",
        observed_at="2026-09-02",
    )
    assert delete_decision.should_end
    assert delete_decision.ended_at == "2026-08-31"
    assert "ended_at" in delete_decision.manual_fields



# ───────── 고액 협찬 나이 종료 면제 (2026-09-07 에스파 사고) ─────────

def test_high_cost_survives_age_rule():
    """실측: 에스파 협찬 85,000,000원·유튜브 본편이 게시 15일째 나이 규칙으로 종료돼
    09-04~09-07 4일 트래킹이 끊겼다(누락 증분 10,341). 누적 302,017 이라 50만 예외엔 못 걸린다."""
    post = _post(posted_at="2026-08-21", cost=85_000_000, channel_type="협찬 (인플루언서)")
    d = classify_auto_end(post, target_date="2026-09-05", max_metric=302_017)
    assert d.should_end is False, d
    assert d.reason == "high_cost_10m", d.reason
    # 한 달 뒤에도 계속 면제(나이가 더 늘어도 동일)
    assert classify_auto_end(post, target_date="2026-10-05", max_metric=350_000).should_end is False


def test_high_cost_threshold_boundary():
    """임계는 백테스트로 정한 1,000만원(cost 상위 85M·45.5M·30M·11M → 8M 로 끊김)."""
    old = _post(posted_at="2026-06-01", cost=9_999_999)
    assert classify_auto_end(old, target_date="2026-09-07", max_metric=1000).should_end is True
    at = _post(posted_at="2026-06-01", cost=10_000_000)
    assert classify_auto_end(at, target_date="2026-09-07", max_metric=1000).reason == "high_cost_10m"


def test_high_cost_does_not_override_caption_or_channel_or_manual():
    """고액이라도 삭제·보관 캡션은 종료, 위성/온드는 여전히 제외, 수동 잠금이 최우선."""
    deleted = _post(posted_at="2026-06-01", cost=85_000_000, content_summary="삭제된 게시물입니다")
    assert classify_auto_end(deleted, target_date="2026-09-07", max_metric=1000).reason == "caption_keyword"
    sat = _post(posted_at="2026-06-01", cost=85_000_000, channel_type="위성채널")
    assert classify_auto_end(sat, target_date="2026-09-07", max_metric=1000).reason == "excluded_channel_project"
    pinned = _post(posted_at="2026-06-01", cost=85_000_000, manual_fields=["ended_at"])
    assert classify_auto_end(pinned, target_date="2026-09-07", max_metric=1000).reason == "manual_ended_at"


def test_high_cost_does_not_block_confirmed_delete():
    """확정삭제는 별 함수라 고액 예외의 영향을 받지 않는다 — 실제로 사라진 글은 종료돼야 한다."""
    post = _post(posted_at="2026-08-21", cost=85_000_000, not_found_streak=3, manual_fields=[])
    d = classify_confirmed_deleted_end(post, error_description="Post does not exist",
                                       last_valid_measured_at="2026-09-03", observed_at="2026-09-07")
    assert d.should_end is True, d
    assert d.ended_at == "2026-09-04", d.ended_at


# ───────── 고액 예외의 부작용(영구 활성) 감지 ─────────

def test_stale_high_cost_flags_frozen_and_dataless():
    from auto_end_rules import stale_high_cost_actives, stale_high_cost_line
    frozen = {"id": "a", "account_name": "정체건", "url": "u1", "cost": 85_000_000, "ended_at": None}
    growing = {"id": "b", "account_name": "성장건", "url": "u2", "cost": 85_000_000, "ended_at": None}
    cheap = {"id": "c", "account_name": "저액", "url": "u3", "cost": 500_000, "ended_at": None}
    # 실측 위험 사례: 띠미(11,000,000원)는 측정값이 아예 없었다
    dataless = {"id": "d", "account_name": "띠미", "url": "u4", "cost": 11_000_000, "ended_at": None}
    series = {
        "a": [("2026-08-25", 100), ("2026-08-26", 100), ("2026-08-27", 100), ("2026-08-28", 100),
              ("2026-08-29", 100), ("2026-08-30", 100), ("2026-08-31", 100), ("2026-09-01", 100)],
        "b": [("2026-08-31", 100), ("2026-09-01", 120)],
        "c": [("2026-08-25", 100), ("2026-09-01", 100)],
        "d": [],
    }
    out = stale_high_cost_actives([frozen, growing, cheap, dataless], series, "2026-09-01", stale_days=7)
    got = sorted(x["account"] for x in out)
    assert got == ["띠미", "정체건"], got
    line = stale_high_cost_line(out)
    assert "고액 협찬 정체 2건" in line and "u1" in line


def test_stale_high_cost_counts_collection_gap_as_stall():
    """정체 판정은 '증분 0 연속'과 '마지막 측정 이후 공백' 중 큰 쪽으로 본다(수집 끊김도 신호)."""
    from auto_end_rules import stale_high_cost_actives
    p = {"id": "a", "account_name": "끊김", "url": "u", "cost": 85_000_000, "ended_at": None}
    series = {"a": [("2026-08-20", 100), ("2026-08-21", 200)]}   # 증분은 있지만 이후 측정 없음
    assert len(stale_high_cost_actives([p], series, "2026-09-07", stale_days=7)) == 1
    assert stale_high_cost_actives([p], series, "2026-08-23", stale_days=7) == []


def test_stale_high_cost_skips_ended():
    from auto_end_rules import stale_high_cost_actives
    p = {"id": "a", "account_name": "종료됨", "url": "u", "cost": 85_000_000, "ended_at": "2026-09-01"}
    assert stale_high_cost_actives([p], {"a": []}, "2026-09-07") == []


def _run_all():
    """⚠️ 이 블록은 **파일 맨 끝**에 있어야 한다. globals() 자동 발견이라 실행 시점보다
    뒤에 정의된 테스트는 잡히지 않는다 — 2026-09-07 에 실제로 신규 7종이 조용히 안 돌았다."""
    ran = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            ran += 1
    return ran


if __name__ == "__main__":
    n = _run_all()
    print(f"auto_end_rules regression tests passed ({n}종)")
