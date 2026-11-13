/**
 * 자정 수집 전 시트→DB 신규 등록(syncNew) 결과 판정 (2026-11-13 사용자 지시: "수집 전에 자동동기화를 무조건 진행하고 수집").
 *
 * 배경: 자정 syncNew 트리거(Apps Script atHour(0))가 실제로는 00:51 전후에 떠서 00:4x 주 수집보다 늦었다.
 *   → 전날 시트에 넣은 URL이 자정 수집을 놓치고 다음날 오후 보충 수집에서 처음 측정
 *   → '첫 측정=업로드일 증분' 규칙 때문에 아침에 적은 전일 증분이 오후에 커졌다(11/11 협찬 +67,680, 1건 00:51 등록).
 * 이제 Apps Script `ensureDailyCollect` 가 dispatch 전에 syncNew 를 먼저 돌리고, 결과를 `pre_sync` 로 넘긴다.
 *
 * 규약: 동기화가 실패해도 수집은 막지 않는다(수집 누락이 더 큰 사고) — 실패만 Slack 경고.
 *   `pre_sync` 가 없으면(옛 Apps Script·GET 호출) 판정하지 않는다(경고도 없음).
 */
export type PreCollectSync = {
  ok?: boolean;
  error?: string;
  created?: number;
  compared?: number;
  attempt?: number;
  ms?: number;
};

export function parsePreCollectSync(body: unknown): PreCollectSync | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { pre_sync?: unknown }).pre_sync;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    ok: r.ok === true,
    error: typeof r.error === "string" ? r.error.slice(0, 300) : undefined,
    created: num(r.created),
    compared: num(r.compared),
    attempt: num(r.attempt),
    ms: num(r.ms),
  };
}

/** 경고 문구(실패일 때만). 성공·미보고는 null = 조용히. */
export function preCollectSyncAlert(kdate: string, s: PreCollectSync | null): string | null {
  if (!s || s.ok === true) return null;
  const why = s.error ? s.error : "원인 미상";
  return (
    `⚠️ *수집 전 신규 등록 동기화 실패* \`${kdate}\` — ${why}\n` +
    `수집은 그대로 시작했습니다. 다만 어젯밤 시트에 새로 넣은 URL은 이번 자정 수집에서 빠졌을 수 있어요` +
    `(다음 동기화 때 등록되고, 첫 조회수는 오후 보충 수집에 잡혀 전일 증분이 나중에 커질 수 있음).`
  );
}
