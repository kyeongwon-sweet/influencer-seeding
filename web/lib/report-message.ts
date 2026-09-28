// 증분 리포트 메시지 판정 — 자가치유 워치독이 "그날 리포트가 이미 있나"를 볼 때 쓴다.
//
// 🚨 2026-09-23 실사고: 판정이 메시지 **본문 전체**에서 제목 문구 + `(대상일)` 을 찾았다.
//    09-21 리포트를 정정하며 본문에 `정정(2026-09-22): …` 을 넣었더니 그 메시지가
//    09-22 리포트로 오인됐다. 그래서 ① 발송기가 '중복'으로 그날 리포트를 막고
//    ② 이 라우트(probe)도 posted=true 로 답해 자가치유 dispatch 까지 건너뛰었다.
//    1차와 백업이 **같은 오판을 공유**해 3시간 26분간 아무 알림도 없었다(사람이 발견).
//    → 제목줄(첫 줄)만 본다.
//
// ⚠️ 파이썬 쪽 정본 `scripts/report_message.py::is_report_for` 와 **짝**이다.
//    한쪽만 고치면 발송기와 자가치유가 서로 다른 판단을 해 또 어긋난다.
//
// 제목줄 형태: `📈 *쫀득바 조회수 일일 증분* \`(2026-09-22)\``

export const REPORT_TITLE = "쫀득바 조회수 일일 증분";

export function isReportForDate(text: string | undefined | null, target: string): boolean {
  const body = text ?? "";
  if (!body.trim()) return false;
  const head = body.split("\n", 1)[0];
  return head.includes(REPORT_TITLE) && head.includes(`(${target})`);
}
