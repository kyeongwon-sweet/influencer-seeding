"""'게시일 불일치로 버린 수집 응답'을 사람에게 설명하는 문구 — 단일 정본.

수집기(run_monitoring)는 시트 게시일과 실제 게시일이 1일 넘게 다르면 받아온 값을 저장하지 않는다
(다른 게시물 응답 방어 가드). 이 모듈은 그 사실을 알림 문구로 바꾸기만 한다. 판정·저장은 하지 않는다.

🚨 2026-10-14 실사고: `p/DdTfR1VTzxE` 행의 **링크 자체가 틀렸는데**(같은 계정의 9/15 말차 파인트 글),
   옛 알림은 "시트의 게시일을 실제 값으로 정정"만 안내했다. 그대로 따랐다면 엉뚱한 글이 쫀득바 캠페인
   비용(₩12,599)으로 추적돼 이중계상이 굳었다. shortcode가 일치해도 **시트에 붙은 링크가 맞는 글인지**는
   보장되지 않는다 → 날짜만 고치라고 하지 말고, 글을 열어 날짜·내용을 보고 틀린 쪽을 고치게 한다.

DM(run_monitoring)과 채널 '수집 사각' 알림(view_tracking_watchdog)이 같은 문구를 쓰도록 여기 한 곳에 둔다.
"""
from __future__ import annotations

from not_found_policy import normalize_instagram_handle

CHECK_HINT = "링크를 열어 날짜·계정·내용을 확인 → 업로드일 오타면 업로드일을, 다른 글이면 링크를 정정"


def owner_mismatch(event: dict) -> tuple[str, str] | None:
    """시트 채널명과 실제 글 주인이 다르면 (시트, 실제) 핸들을 돌려준다. 비교 불가면 None."""
    sheet = normalize_instagram_handle(event.get("account_name"))
    actual = normalize_instagram_handle(event.get("actual_owner"))
    if sheet and actual and sheet != actual:
        return sheet, actual
    return None


def describe(event: dict) -> str:
    """한 건의 불일치를 사람이 바로 행동할 수 있는 한 줄로."""
    text = f"시트 업로드일 {event.get('expected_posted_at') or '?'} ≠ 실제 {event.get('actual_posted_at') or '?'}"
    owners = owner_mismatch(event)
    if owners:
        text += f" · 계정도 다름(시트 {owners[0]} / 실제 {owners[1]}) → 링크가 틀렸을 가능성 큼"
    return text


def alert_text(events: list[dict], *, sample_size: int = 8) -> str:
    """수집기 DM 본문."""
    lines = [
        f"🚨 [협찬 모니터링] 시트 업로드일과 실제 글 날짜가 달라 조회수를 버린 게시물 {len(events)}건",
        "Apify는 값을 정상 반환했지만 날짜가 1일 넘게 어긋나 저장하지 않았습니다.",
        "업로드일 오타일 수도, **시트에 다른 글 링크가 붙었을 수도** 있습니다(같은 계정의 다른 글 포함).",
        f"{CHECK_HINT}하면 다음 수집부터 자동 복구됩니다(업로드일은 자동 수정하지 않습니다).",
    ]
    for e in events[:sample_size]:
        lines.append(
            f"- {e.get('account_name') or '-'} {describe(e)} "
            f"(미저장 조회수 {e.get('returned_metric')}) {e.get('url')}"
        )
    if len(events) > sample_size:
        lines.append(f"- ...외 {len(events) - sample_size}건")
    return "\n".join(lines)
