// 인지광고 시트 '조회수' 칸 정합 검사 — 쫀득바(/api/awareness-ads)·파인트(awareness-pint) 공용.
//
// 조회수(Thruplay·참여)는 횟수라 항상 정수다. 소수가 읽히면 바로 옆 '조회당비용' 칸을 읽은 것 = 열 밀림.
// 2026-11-13·14 사고: 인지_쫀득바 탭 교체 중 리포트가 조회당비용(3.38·17.26)을 조회수로 읽어 소수 증분·
//   엉뚱한 CPV가 채널에 나갔다. 기존 '₩ 감지'는 값을 UNFORMATTED 숫자로 받으면서 ₩가 아예 안 와 무력했다.
// 시트 실측(11-16): 광고 조회수 칸 소수 0건(쫀득바 590여·파인트 74칸). ⚠️ 전환 조회수 칸은 계산식이라
//   소수가 정상(쫀득바 54건) → 이 검사를 걸지 않는다.
// warn 이 붙으면 발송 전 검수(presend_sync_audit.check_awareness)가 발송을 보류하고 자가치유가 재시도한다.

export type ViewCell = string | number | null | undefined;

/** 조회수 칸 값이 열 밀림 신호(₩ 광고비 표기 또는 소수)면 사유 문구, 정상이면 null. */
export function viewCellProblem(raw: ViewCell, n: number | null): string | null {
  if (typeof raw === "string" && raw.includes("₩")) return "₩값 감지(광고비 오독 의심)";
  if (n != null && !Number.isInteger(n)) return `소수 ${n} 감지(조회당비용 오독 의심 — 조회수는 정수)`;
  return null;
}

export function viewCellWarn(label: string, col: number, problem: string): string {
  return `${label} 조회수 칸(열 ${col})에 ${problem} — 시트 열 정렬 확인 필요`;
}
