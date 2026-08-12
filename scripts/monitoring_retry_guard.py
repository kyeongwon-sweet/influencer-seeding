def zero_result_alert(
    target_only: bool,
    target_count: int,
    stored_rows: int,
    measured_at: str,
    *,
    verified_missing: int = 0,
) -> str | None:
    """Return an operator alert when a targeted retry made no progress."""
    if not target_only or target_count <= 0 or stored_rows > 0 or verified_missing > 0:
        return None
    return (
        f"🚨 [협찬 모니터링 재시도] 대상 {target_count}건 → 저장 0건 ({measured_at}). "
        "액터 실행이 SUCCESS여도 수집 결과가 비어 있습니다. Apify/플랫폼 접근 상태를 확인하세요."
    )
