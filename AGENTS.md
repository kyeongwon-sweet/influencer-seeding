# AGENTS.md — 이 레포에서 일하는 모든 AI(Codex 포함) 필수 규칙

전체 규칙·아키텍처는 `CLAUDE.md`, 현재 상태는 `AI_SHARED_STATUS.md`(작업 전 필독)에 있다. 아래 두 가지는 **절대 규칙**이다.

## 1. 데이터 무결성
실측이 없으면 값을 지어내지 않는다. 수집 불가·미측정이면 비워둔다(빈 값 ≠ 0). 이상치는 자동 보정하지 말고 감지 알림만.

## 2. ⛔ 업무 날짜는 KST (2026-10-19 사용자 지시)
DB·Apify·GitHub 러너·Vercel 시각은 UTC다. 앞 10자리를 자르면 UTC 날짜가 되어 KST 00:00~08:59 기록이 '어제'가 된다(반복 사고).
- 금지: `toISOString().slice(0,10)`·`.split("T")[0]` / 파이썬 `created_at[:10]`·`date.today()`·`datetime.now()`·`utcnow()`·`utcfromtimestamp()` / Apps Script `formatDate(…,"UTC")` / 워크플로 `date +%F`(TZ 없이).
- 대신: web `web/lib/dateRule.ts`(`todayKST`·`kstDateOf`·`addDaysToDate`·`daysAgoKST`), python `scripts/kst_dates.py`(`kst_today`·`kst_now`·`kst_date`), 워크플로 `TZ=Asia/Seoul date +%F`.
- 강제: `web/tests/kst-date-guard.test.ts`가 pre-push 훅과 CI에서 레포 전체를 검사한다. 검사를 끄거나 우회하지 말 것.
