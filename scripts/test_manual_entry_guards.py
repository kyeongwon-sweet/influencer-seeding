"""수기 입력 오기 감지 회귀 테스트 — 2026-08-12 실제 사고 수치로 고정."""
from __future__ import annotations

from manual_entry_guards import copy_suspects, spike_suspects


# 실제 사고: s_3.mag 이력. 199,379는 같은 날 빵친장 값과 완전 일치했다.
S3MAG = [
    ("2026-07-27", 10, False),
    ("2026-07-28", 14, True),
    ("2026-07-29", 199_379, True),
    ("2026-07-30", 207_000, True),
    ("2026-08-05", 207_000, True),
]
OWNERS = {
    ("2026-07-29", 199_379): {"s3mag", "bbangchinjang"},   # 두 게시물에 동시 존재 = 복사 지문
    ("2026-07-28", 14): {"s3mag"},
    ("2026-07-30", 207_000): {"s3mag"},
}


def test_real_incident_is_caught_by_copy_fingerprint():
    hits = copy_suspects(S3MAG, OWNERS)
    assert len(hits) == 1
    date, value, owners = hits[0]
    assert (date, value) == ("2026-07-29", 199_379)
    assert "bbangchinjang" in owners


def test_real_incident_is_NOT_caught_by_spike_and_that_is_by_design():
    """14 → 199,379은 14,000배지만 급등 탐지는 일부러 놓친다.

    직전값이 14라 배수가 의미 없고, 그 구간(prev<1000)을 열면 신규 게시물 초기 성장
    (유튜브 쇼츠 3→2,201 등)이 대량 오탐으로 들어온다. 이 사고는 복사 지문이 잡는다.
    두 탐지가 서로를 보완하는 구조라는 걸 고정해 둔다.
    """
    assert spike_suspects(S3MAG) == []
    assert len(copy_suspects(S3MAG, OWNERS)) == 1


def test_rounded_values_are_not_copy_suspects():
    """실측: 267,000·89,000·109,000 같은 반올림 수기값이 우연히 겹쳐 오탐 112건을 만들었다."""
    rows = [("2026-07-30", 89_000, True)]
    owners = {("2026-07-30", 89_000): {"a", "b"}}
    assert copy_suspects(rows, owners) == []


def test_fresh_post_early_growth_is_not_a_spike():
    """신규 게시물 3 → 2,201은 734배지만 정상 성장이다(유튜브 쇼츠 실측)."""
    rows = [("2026-07-25", 3, True), ("2026-07-26", 2_201, True)]
    assert spike_suspects(rows) == []


def test_large_manual_spike_from_established_base_is_flagged():
    """직전값이 충분히 크면(3,033 → 73,798) 확인 요청 대상이다."""
    rows = [("2026-07-28", 3_033, True), ("2026-07-29", 73_798, True)]
    hits = spike_suspects(rows)
    assert len(hits) == 1 and hits[0][0] == "2026-07-29"


def test_automatic_viral_spike_is_not_flagged():
    """🚨 2026-08-07 ufo__skyblue 2,479→63,119는 실측 확인된 진짜 바이럴이다.
    자동 수집값은 급등 알림 대상이 아니다(오탐이 반복되면 알림을 신뢰하지 않게 된다)."""
    rows = [("2026-08-06", 2_479, False), ("2026-08-07", 63_119, False)]
    assert spike_suspects(rows) == []


def test_small_values_are_not_copy_suspects():
    """3·10·14 같은 작은 값은 서로 다른 게시물에서 흔히 겹친다 — 우연 일치 배제."""
    rows = [("2026-07-28", 3, True)]
    owners = {("2026-07-28", 3): {"a", "b", "c"}}
    assert copy_suspects(rows, owners) == []


def test_normal_manual_growth_is_not_a_spike():
    rows = [("2026-08-01", 50_000, True), ("2026-08-02", 62_000, True)]
    assert spike_suspects(rows) == []


def test_blank_days_are_not_read_as_zero():
    """공백(None)을 0으로 읽으면 다음 값이 무한배 급등으로 잡힌다 — 절대규칙."""
    rows = [("2026-08-01", 50_000, True), ("2026-08-02", None, True), ("2026-08-03", 51_000, True)]
    assert spike_suspects(rows) == []


def test_single_owner_is_not_a_copy():
    rows = [("2026-07-30", 207_000, True)]
    assert copy_suspects(rows, OWNERS) == []


def test_helper_is_metric_agnostic_so_caller_must_exclude_reach():
    """🚨 배너 도달수(reach)를 넣으면 오탐이 난다 — 제외는 호출부 책임임을 고정한다.

    배너 reach는 시트 수기 입력이라 며칠 같은 값이 유지되는 게 정상이고,
    같은 소재를 같은 조건으로 돌리면 서로 같은 값이 흔히 나온다.
    2026-08-12 실측: luna.humor·wikitrip.kr·ho1y_time 등 배너 6건이 전부 오탐이었다.
    notify_status는 play_count 전용 인덱스(pseries/pvidx)를 넘겨 이를 배제한다.
    """
    reach_rows = [("2026-08-09", 75_888, True)]
    owners = {("2026-08-09", 75_888): {"banner_a", "banner_b"}}
    # 헬퍼 자체는 지표를 구분하지 못한다 → 그대로 넣으면 잡힌다(그래서 호출부가 걸러야 한다)
    assert len(copy_suspects(reach_rows, owners)) == 1
