import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { endedAtPolicyError, endedBeforePosted, ymd } from "../lib/ended-at-policy.ts";

test("blocks the structurally impossible case: ended before posted", () => {
  // 실측: 2026-06-12 게시분 9건이 ended_at 2026-06-08로 등록돼 도달수가 전부 폐기됐다.
  assert.equal(endedBeforePosted("2026-06-12", "2026-06-08"), true);
  const msg = endedAtPolicyError("2026-06-12", "2026-06-08");
  assert.match(String(msg), /2026-06-08/);
  assert.match(String(msg), /2026-06-12/);
});

test("allows same-day end and any end after posting", () => {
  assert.equal(endedBeforePosted("2026-06-12", "2026-06-12"), false);   // 게시일 당일 종료는 가능
  assert.equal(endedBeforePosted("2026-06-12", "2026-06-20"), false);
  assert.equal(endedAtPolicyError("2026-08-19", "2026-09-01"), null);   // 무디 건 = 정상 범위
});

test("does not judge when either date is missing or unparseable", () => {
  // 진행 중(ended_at null)·게시일 미기재·잘못된 형식은 이 정책의 대상이 아니다(다른 검증이 담당).
  for (const [p, e] of [[null, "2026-06-08"], ["2026-06-12", null], ["", ""], ["2026-06-12", "어제"], [undefined, undefined]] as const) {
    assert.equal(endedBeforePosted(p, e), false, `${p} / ${e}`);
    assert.equal(endedAtPolicyError(p, e), null);
  }
});

test("accepts timestamps by comparing the date part only", () => {
  assert.equal(ymd("2026-06-08T10:00:00+00:00"), "2026-06-08");
  assert.equal(endedBeforePosted("2026-06-12T00:00:00Z", "2026-06-08T23:59:59Z"), true);
});

test("소급 등록(created_at > ended_at)은 이 정책이 차단하지 않는다", () => {
  // 과거 자료 정리로 정당할 수 있어 차단 대상이 아니다 — 감지는 scripts/ended_at_anomalies.py.
  assert.equal(endedAtPolicyError("2026-08-19", "2026-09-01"), null);
});

test("the dashboard write path actually enforces the policy", () => {
  // 정책 함수만 있고 라우트가 호출하지 않으면 아무것도 막지 못한다 → 호출을 계약으로 고정.
  const src = fs.readFileSync("app/api/sponsored-posts/[id]/route.ts", "utf8");
  assert.match(src, /endedAtPolicyError/);
  assert.match(src, /status:\s*400/);
  // 저장 전에 검사해야 한다(update 호출보다 앞).
  assert.ok(src.indexOf("endedAtPolicyError") < src.indexOf('.from("sponsored_posts").update(updates)'));
});
