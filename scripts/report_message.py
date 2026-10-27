"""증분 리포트 메시지 판정 — 발송기와 워치독이 **같은 규칙**을 쓰게 하는 정본.

의존성 없음(stdlib). 워치독(`cron_watchdog.py`)이 supabase 같은 무거운 의존성을 끌지 않고
`notify_increments` 와 같은 판정을 쓰기 위해 별도 모듈로 둔다.

🚨 2026-09-23 실사고: 판정이 메시지 **본문 전체**에서 `"일일 증분"` + `"(대상일)"` 을 찾았다.
   09-21 리포트를 정정하며 본문에 `정정(2026-09-22): …` 을 넣었더니 그 메시지가
   09-22 리포트로 오인돼 ① 그날 발송이 '중복'으로 막히고 ② Apps Script 안전망도
   같은 판정이라 dispatch 를 건너뛰었다. 3시간 26분간 아무도 몰랐다.
   → **제목줄(첫 줄)만** 본다.

2026-10-27: 같은 채널에 **바치케** 리포트가 추가돼 제품명까지 본다. '일일 증분'만 보면
   바치케 리포트를 쫀득바 리포트로 착각해 쫀득바 발송이 '중복'으로 막히고(그 반대도),
   REPLACE/DELETE 가 다른 제품 리포트를 지운다. 웹 쪽 `web/lib/report-message.ts`
   (REPORT_TITLE = 쫀득바 제목)와 짝이다.
"""

DEFAULT_PRODUCT_TITLE = "쫀득바"


def report_title(product_title: str = DEFAULT_PRODUCT_TITLE) -> str:
    """제목줄의 고정 문구. 예: '쫀득바 조회수 일일 증분'."""
    return f"{product_title} 조회수 일일 증분"


def is_report_for(text, target: str, product_title: str = DEFAULT_PRODUCT_TITLE) -> bool:
    """이 메시지가 그 제품의 target 일자 증분 리포트인가. 제목줄만 본다.

    제목줄 형태: ``📈 *쫀득바 조회수 일일 증분* `(2026-09-22)```
    """
    body = text or ""
    head = body.splitlines()[0] if body.strip() else ""
    return report_title(product_title) in head and f"({target})" in head
