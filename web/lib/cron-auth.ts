// 크론/시트 라우트 인증 — CRON_SECRET 무중단 로테이션 지원.
//
// CRON_SECRET(신규)과 CRON_SECRET_PREV(직전) 둘 다 수용한다. 로테이션 시:
//   1) CRON_SECRET=신규, CRON_SECRET_PREV=구값 설정 후 배포 → 신·구 모두 통과
//   2) 모든 클라이언트(GitHub Actions 시크릿, Apps Script 속성)를 신규로 교체
//   3) CRON_SECRET_PREV 제거 후 재배포 → 구값 폐기
//
// 라우트마다 fail-closed / fail-open 의미가 달라 3-상태로 반환한다.
import type { NextRequest } from "next/server";

export type CronAuthResult = "ok" | "no-secret" | "bad";

function validSecrets(): string[] {
  return [process.env.CRON_SECRET, process.env.CRON_SECRET_PREV].filter((s): s is string => !!s);
}

/**
 * "ok"        : 헤더가 유효 시크릿(신 또는 구) 중 하나와 일치
 * "no-secret" : 서버에 시크릿이 하나도 설정 안 됨 (fail-open 라우트는 통과시킴)
 * "bad"       : 시크릿은 설정됐으나 헤더 불일치 (항상 차단)
 */
export function checkCronAuth(req: NextRequest): CronAuthResult {
  const secrets = validSecrets();
  if (secrets.length === 0) return "no-secret";
  const provided = req.headers.get("authorization");
  return secrets.some(s => provided === `Bearer ${s}`) ? "ok" : "bad";
}
