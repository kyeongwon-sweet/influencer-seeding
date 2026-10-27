// 자정 주 수집(primary) 판정 — "오늘 밤 주 수집이 이미 돌고 있나/끝났나".
//
// 배경(2026-10-27 실측): GitHub 예약(00:41 KST)이 최근 31일 동안 한 번도 1시간 안에 뜨지 않았다
//   (첫 수집 시작 중앙값 +4.0시간, 최대 +6.9시간). 사용자: "최대한 00시 자정 가까이 수집되었으면 좋겠어".
// → 구글 Apps Script 시간 트리거(00:05~00:35 KST)가 /api/ops/ensure-daily-collect 를 부르고,
//   그 라우트가 주 수집을 workflow_dispatch(final_snapshot=true)로 즉시 시작한다.
//   GitHub 예약 3개(00:41·02:41·04:41)는 그대로 두되, 주 수집이 이미 있으면 백업(누락분만)으로 동작한다.
//
// ⚠️ 이 판정은 scripts/collect_role.py 와 **같은 규칙**이어야 한다(라우트=TS, 워크플로=Python).
//   주 수집으로 보는 실행 = 오늘(KST) 00:00 이후 생성되고
//     ① 제목에 [final_snapshot] 이 붙은 실행(라우트가 dispatch한 주 수집), 또는
//     ② 02:30 KST 이전에 생성된 예약 실행(= 00:41 슬롯. 02:41 슬롯은 GitHub이 앞당겨 띄우지 않는다).

export const FINAL_SNAPSHOT_TAG = "[final_snapshot]";
export const PRIMARY_SCHEDULE_CUTOFF_KST = "02:30";

export type CollectRun = {
  id?: number;
  display_title?: string | null;
  event: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
};

export type PrimaryState = "running" | "done" | "none";

const RUNNING_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function kstMs(kdate: string, hhmm: string): number {
  return Date.parse(`${kdate}T${hhmm}:00+09:00`);
}

/** 이 실행이 kdate(KST 실행일) 밤의 주 수집인가. */
export function isPrimaryRun(run: CollectRun, kdate: string): boolean {
  const created = Date.parse(run.created_at);
  if (!Number.isFinite(created) || created < kstMs(kdate, "00:00")) return false;
  if ((run.display_title ?? "").includes(FINAL_SNAPSHOT_TAG)) return true;
  return run.event === "schedule" && created < kstMs(kdate, PRIMARY_SCHEDULE_CUTOFF_KST);
}

/** 오늘 밤 주 수집 상태. 진행 중이 하나라도 있으면 running, 성공이 있으면 done, 아니면 none(실패·취소만 있어도 none). */
export function primaryState(runs: readonly CollectRun[], kdate: string): PrimaryState {
  const primary = runs.filter((r) => isPrimaryRun(r, kdate));
  if (primary.some((r) => r.status != null && RUNNING_STATUSES.has(r.status))) return "running";
  if (primary.some((r) => r.conclusion === "success")) return "done";
  return "none";
}

export type EnsureCollectDecision = { action: "dispatch" | "skip"; reason: string; state: PrimaryState | null };

/** 자정 주 수집을 시작해도 되는 KST 시각 창: 00:00 ≤ t < 06:00. */
export const ENSURE_COLLECT_WINDOW_END_HOUR = 6;

/**
 * 라우트 판정. kstHour = 지금 KST 시(0~23).
 * 00~05시에만 시작한다. 자정 직전에 불리면 '어제'가 아직 끝나지 않았고, 낮에 불리면 전일 '최종값' 자리에
 * 낮 값을 덮어쓰게 된다(final_snapshot 은 같은 날 기존 자동값을 교체). 창 밖이면 GitHub 예약이 맡는다.
 */
export function decideEnsureCollect(runs: readonly CollectRun[] | null, kdate: string, kstHour: number): EnsureCollectDecision {
  if (!(kstHour >= 0 && kstHour < ENSURE_COLLECT_WINDOW_END_HOUR)) return { action: "skip", reason: "outside_midnight_window", state: null };
  // 실행 목록을 못 읽으면 중복 수집(Apify 이중 과금·낮 값 덮어쓰기) 위험이 있어 시작하지 않는다.
  // GitHub 예약 00:41 슬롯이 그대로 주 수집 역할을 하므로 데이터는 비지 않는다(늦을 뿐).
  if (runs == null) return { action: "skip", reason: "runs_unreadable", state: null };
  const state = primaryState(runs, kdate);
  if (state === "running") return { action: "skip", reason: "primary_running", state };
  if (state === "done") return { action: "skip", reason: "primary_done", state };
  return { action: "dispatch", reason: "no_primary_yet", state };
}
