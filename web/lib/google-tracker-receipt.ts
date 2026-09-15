import { createHmac, timingSafeEqual } from "node:crypto";
import type { TrackerConfig } from "./google-search-tracker";
export type TrackerRun = { userId: string; runId: string; kind: "trends" | "youtube" | "instagram"; config: TrackerConfig; group: number; date: string; expires: number };
const secret = () => {
  const key = process.env.WEBHOOK_SECRET || process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("분석 실행 서명 키가 설정되지 않았습니다.");
  return key;
};
export function signRun(run: TrackerRun) {
  const payload = Buffer.from(JSON.stringify(run)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function verifyRun(token: string, userId: string): TrackerRun {
  if (typeof token !== "string" || token.length > 24000) throw new Error("잘못된 실행 정보입니다.");
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret()).update(payload || "").digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("실행 정보의 서명이 올바르지 않습니다.");
  const run = JSON.parse(Buffer.from(payload, "base64url").toString()) as TrackerRun;
  if (run.userId !== userId || run.expires < Date.now()) throw new Error("실행 정보가 만료됐거나 다른 사용자의 분석입니다.");
  return run;
}
