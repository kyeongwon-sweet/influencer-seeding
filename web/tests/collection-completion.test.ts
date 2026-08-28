import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLLECTION_COMPLETE_STEP,
  collectionCompletedFromJobs,
  collectionRunKstDate,
  isCandidateCollectionRun,
} from "../lib/collection-completion.ts";

const collectJob = (marker: string | null, collector: string | null = "success") => [{
  name: "collect",
  conclusion: "success",
  steps: [
    ...(collector ? [{ name: "협찬 전체 수집 (IG+YT+틱톡+페북+스레드+트위터)", conclusion: collector }] : []),
    ...(marker ? [{ name: COLLECTION_COMPLETE_STEP, conclusion: marker }] : []),
  ],
}];

test("target date D maps to a collection run created on KST D+1", () => {
  assert.equal(collectionRunKstDate("2026-08-27"), "2026-08-28");
  assert.equal(collectionRunKstDate("bad"), null);
  assert.equal(collectionRunKstDate("2026-02-31"), null);
  assert.equal(isCandidateCollectionRun({
    id: 1, conclusion: "success", event: "schedule", created_at: "2026-08-28T00:35:00Z",
  }, "2026-08-27"), true);
  assert.equal(isCandidateCollectionRun({
    id: 2, conclusion: "failure", event: "schedule", created_at: "2026-08-28T00:35:00Z",
  }, "2026-08-27"), true, "a later auxiliary failure must not hide an already-successful marker");
  assert.equal(isCandidateCollectionRun({
    id: 3, conclusion: null, event: "schedule", created_at: "2026-08-28T00:35:00Z",
  }, "2026-08-27"), true);
});

test("explicit completion marker is authoritative", () => {
  assert.deepEqual(collectionCompletedFromJobs(collectJob("success"), "workflow_dispatch"), {
    completed: true, markerSeen: true, reason: "marker_success",
  });
  assert.deepEqual(collectionCompletedFromJobs(collectJob("skipped"), "workflow_dispatch"), {
    completed: false, markerSeen: true, reason: "marker_not_success",
  });
  assert.equal(
    collectionCompletedFromJobs(collectJob("success"), "schedule", true, null).completed,
    true,
    "marker success must pass while the parent workflow is still in progress",
  );
});

test("api-only style skipped manual runs do not pass the legacy fallback", () => {
  assert.equal(collectionCompletedFromJobs(collectJob(null, "skipped"), "workflow_dispatch").completed, false);
  assert.equal(collectionCompletedFromJobs([{ name: "status-test", conclusion: "success", steps: [] }], "workflow_dispatch").completed, false);
});

test("post-deployment runs cannot use the legacy fallback when a marker is absent", () => {
  assert.equal(collectionCompletedFromJobs(collectJob(null, "success"), "workflow_dispatch", true).completed, false);
  assert.equal(collectionCompletedFromJobs(collectJob(null, "skipped"), "schedule", true).completed, false);
});

test("in-progress runs never use a legacy no-marker fallback", () => {
  assert.equal(collectionCompletedFromJobs(collectJob(null, "success"), "workflow_dispatch", false, null).completed, false);
  assert.equal(collectionCompletedFromJobs(collectJob(null, "skipped"), "schedule", false, null).completed, false);
});

test("pre-marker scheduled and actual manual collector runs remain readable", () => {
  assert.equal(collectionCompletedFromJobs(collectJob(null, "skipped"), "schedule").reason, "legacy_schedule");
  assert.equal(collectionCompletedFromJobs(collectJob(null, "success"), "workflow_dispatch").reason, "legacy_manual_collect");
});

test("collection status route is cron-authenticated and public at middleware only", () => {
  const route = readFileSync(new URL("../app/api/ops/collection-status/route.ts", import.meta.url), "utf8");
  const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(route, /collectionCompletedFromJobs/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(middleware, /\/api\/ops\/collection-status/);
});
