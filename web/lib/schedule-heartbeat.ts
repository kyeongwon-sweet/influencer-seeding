// GitHub 스케줄러 생존 감시(크로스 프로바이더 하트비트) — 순수 로직
//
// 왜 필요한가(2026-07-30 실사고): GitHub Actions 스케줄이 09:11 KST 이후 두 repo 모두에서
// 전면 정지했다. 우리 감시(cron-watchdog)도 **같은 GitHub 스케줄러**에 실려 있어 경보조차 뜨지
// 못했고, 사람이 먼저 발견했다. 그래서 감시자는 반드시 **다른 제공자의 스케줄러**(Google
// Apps Script 시간 트리거 / 외부 핑)로 굴려야 한다. 이 모듈은 그 판정 로직만 담는다.
//
// 판정 기준: 워크플로별 '최근 **스케줄** 성공'이 기대 주기를 넘으면 이상.
// (수동 dispatch 성공은 세지 않는다 — 사람이 손으로 돌린 실행이 정지를 가리는 맹점을 이미 겪었다.)

export type WatchTarget = { workflow: string; label: string; maxAgeHours: number };

// 4종 아침 점검 + 시간당 sync. cron_watchdog.py의 FRESHNESS_HOURS와 의미를 맞춘다.
export const WATCH_TARGETS: WatchTarget[] = [
  { workflow: "cron-daily-collect.yml", label: "자정수집", maxAgeHours: 26 },
  { workflow: "formula-audit.yml", label: "수식감사", maxAgeHours: 26 },
  { workflow: "injibot-daily-report.yml", label: "오류게시글 리포트", maxAgeHours: 26 },
  { workflow: "monitoring-validate.yml", label: "데이터검증", maxAgeHours: 26 },
  { workflow: "banner-reach-sync.yml", label: "배너 sync", maxAgeHours: 3 },
];

export type HeartbeatFinding = { workflow: string; label: string; ageHours: number | null; lastAt: string | null };
export type HeartbeatRun = {
  updatedAt: string;
  conclusion: string | null;
  event: string;
  url: string;
};

export function evaluateSchedules(
  lastScheduleSuccess: Record<string, string | null>,
  now: Date,
  targets: WatchTarget[] = WATCH_TARGETS,
): HeartbeatFinding[] {
  const findings: HeartbeatFinding[] = [];
  for (const t of targets) {
    const ts = lastScheduleSuccess[t.workflow] ?? null;
    if (!ts) {
      findings.push({ workflow: t.workflow, label: t.label, ageHours: null, lastAt: null });
      continue;
    }
    const ageHours = (now.getTime() - new Date(ts).getTime()) / 3_600_000;
    if (ageHours > t.maxAgeHours) {
      findings.push({ workflow: t.workflow, label: t.label, ageHours, lastAt: ts });
    }
  }
  return findings;
}

function kst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function recoveryNote(run: HeartbeatRun | null | undefined): string {
  if (!run || run.event === "schedule") return "";
  return ` / 최근 성공 실행(${run.event}) ${kst(run.updatedAt)} KST — 데이터 복구됨`;
}

export function formatHeartbeat(
  findings: HeartbeatFinding[],
  repo: string,
  latestSchedule: Record<string, HeartbeatRun | null> = {},
  latestSuccess: Record<string, HeartbeatRun | null> = {},
): { text: string; healthy: boolean } {
  if (findings.length === 0) {
    return { text: `✅ [스케줄 하트비트] ${repo} — 감시 대상 ${WATCH_TARGETS.length}종 모두 정상 주기 내`, healthy: true };
  }
  const lines = [
    `🔴 [스케줄 하트비트] ${repo} — GitHub 스케줄 이상 ${findings.length}건`,
    "(이 알림은 Google/외부 스케줄러가 보냅니다 — GitHub 크론이 죽어도 도착합니다)",
    ...findings.map((f) => {
      const latest = latestSchedule[f.workflow];
      const recovery = recoveryNote(latestSuccess[f.workflow]);
      if (latest && latest.conclusion && latest.conclusion !== "success") {
        const previousSuccess = f.ageHours == null
          ? "이전 스케줄 성공 기록 없음"
          : `최근 스케줄 성공 ${f.ageHours.toFixed(1)}시간 전(${kst(f.lastAt!)} KST)`;
        return `• ${f.label}(${f.workflow}) — 스케줄은 발화했지만 ${latest.conclusion}(${kst(latest.updatedAt)} KST), ${previousSuccess}${recovery}`;
      }
      return f.ageHours == null
        ? `• ${f.label}(${f.workflow}) — 스케줄 실행/성공 기록 없음${recovery}`
        : `• ${f.label}(${f.workflow}) — 최근 스케줄 성공 ${f.ageHours.toFixed(1)}시간 전(${kst(f.lastAt!)} KST), 미발화·지연 의심${recovery}`;
    }),
  ];
  return { text: lines.join("\n"), healthy: false };
}
