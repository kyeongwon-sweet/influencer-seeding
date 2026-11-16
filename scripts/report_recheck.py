"""저녁 재확인 — 이미 나간 '어제' 리포트를 대시보드 숫자로 다시 맞춘다(2026-11-16 사용자 결정).

왜 필요한가:
  리포트는 낮 12:20에 나가는데, 그 뒤에 늦게 등록된 글(주로 위성채널)의 첫 조회수가
  오후 재수집(11/14/17시)으로 '어제' 날짜에 기록된다. 대시보드에는 바로 반영되지만
  이미 나간 리포트는 그대로라 숫자가 갈렸다(실측: 10/27 +9,138 · 10/28 +8,494 · 11/15 +6,601).
  사용자 결정 "대시보드랑 맞춰줘" → 매일 저녁 어제 리포트를 다시 계산해 **달라졌을 때만** 그 자리에서 고친다.

이 모듈은 판정만 한다(의존성 없음, 테스트 대상). 발송·편집은 notify_increments 가 한다.
"""
from __future__ import annotations

import re

from report_message import is_report_for

# 리포트 본문의 모든 숫자(증분·CPV·목표%·날짜·링크 속 ID 포함). 숫자 열이 같으면 내용이 같다고 본다.
#   ⚠️ 본문 전체 문자열을 비교하지 않는 이유: 슬랙이 저장한 본문은 이스케이프·링크 표기가 미세하게
#      다를 수 있어, 숫자가 같아도 '다름'으로 보고 매일 헛편집·헛알림을 보낼 수 있다.
_NUM = re.compile(r"\d[\d,.]*")
_TOTAL = re.compile(r"총 증분 \*\+([\d,]+)\*")

SLACK_WORKSPACE = "lalasweethq"


def report_messages(messages, target: str, product_title: str) -> list:
    """채널 메시지 중 그 제품·그 날짜의 리포트(제목줄 판정, report_message 정본 규칙)."""
    return [m for m in (messages or []) if m.get("ts") and is_report_for(m.get("text", ""), target, product_title)]


def numbers_of(text: str) -> list:
    return _NUM.findall(text or "")


def needs_update(old_text: str, new_text: str) -> bool:
    """다시 계산한 본문의 숫자가 나간 리포트와 다르면 True."""
    return numbers_of(old_text) != numbers_of(new_text)


def total_of(text: str):
    m = _TOTAL.search(text or "")
    return int(m.group(1).replace(",", "")) if m else None


def permalink(channel: str, ts: str) -> str:
    return f"https://{SLACK_WORKSPACE}.slack.com/archives/{channel}/p{ts.replace('.', '')}"


def change_summary(product_title: str, target: str, old_text: str, new_text: str, link: str) -> str:
    """고친 날 운영자 DM 문구: 총 증분 이전 → 이후."""
    old_t, new_t = total_of(old_text), total_of(new_text)
    if old_t is not None and new_t is not None:
        d = new_t - old_t
        sign = "+" if d >= 0 else "-"
        head = f"총 증분 +{old_t:,} → *+{new_t:,}* ({sign}{abs(d):,})"
    else:
        head = "총 증분은 그대로, 세부 숫자(CPV 등)만 바뀜"
    return (f"🔁 *저녁 재확인* — {product_title} `({target})` 리포트를 대시보드 숫자로 고쳤어요.\n"
            f"{head}\n<{link}|리포트 보기>")


def blocked_summary(product_title: str, target: str, reasons: list, link: str) -> str:
    """숫자가 달라졌지만 검수에 걸려 고치지 않은 날 운영자 DM 문구."""
    lines = "\n".join(f"• {r}" for r in reasons[:6])
    return (f"⏸️ *저녁 재확인 보류* — {product_title} `({target})` 리포트가 대시보드와 다르지만, "
            f"검수에 걸려 고치지 않았어요(잘못된 숫자로 덮어쓰지 않기 위해).\n{lines}\n<{link}|리포트 보기>")
