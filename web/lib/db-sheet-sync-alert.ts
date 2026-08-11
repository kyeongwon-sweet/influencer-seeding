export type DbSheetSyncAlertInput = {
  status?: string;
  source?: string;
  attempt?: number;
  started_at?: string;
  finished_at?: string;
  retry_scheduled?: boolean;
  error?: string;
};

function clipped(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function formatDbSheetSyncAlert(input: DbSheetSyncAlertInput): string {
  const status = clipped(input.status || "ERROR", 50);
  const source = clipped(input.source || "scheduled", 50);
  const error = clipped(input.error || "원인 미상");
  const retry = input.retry_scheduled ? "예정" : "없음";
  return [
    "🚨 *DB→모니터링 시트 동기화 실패*",
    `상태: ${status} · 실행: ${source} · 시도: ${Number(input.attempt || 0) + 1}회`,
    `시작: ${clipped(input.started_at || "-")}`,
    `재시도: ${retry}`,
    `오류: ${error}`,
    "신규 게시글이 부정댓글 봇 대상에 늦게 반영될 수 있습니다.",
  ].join("\n");
}
