export const COLLECTION_COMPLETE_STEP = "Collection completion marker";
export const COLLECTION_MARKER_REQUIRED_AFTER = "2026-08-28T03:00:00Z";

export type CollectionWorkflowRun = {
  id: number;
  conclusion: string | null;
  created_at: string;
  event: string;
  html_url?: string;
};

export type GitHubJob = {
  name: string;
  conclusion: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
};

function isoDateKST(value: string): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function collectionRunKstDate(targetDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const time = Date.parse(`${targetDate}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  if (new Date(time).toISOString().slice(0, 10) !== targetDate) return null;
  return new Date(time + 86_400_000).toISOString().slice(0, 10);
}

export function isCandidateCollectionRun(run: CollectionWorkflowRun, targetDate: string): boolean {
  const wanted = collectionRunKstDate(targetDate);
  // The report is dispatched from inside the collection workflow immediately
  // after the marker. At that moment the run conclusion is still null.
  return !!wanted && isoDateKST(run.created_at) === wanted;
}

export type CollectionJobDecision = {
  completed: boolean;
  markerSeen: boolean;
  reason: "marker_success" | "marker_not_success" | "marker_missing" | "legacy_schedule" | "legacy_manual_collect" | "not_collect_job";
};

/**
 * A successful workflow run is not necessarily a completed stats collection.
 * `status_test`, `api_only`, and `metadata_only` can all finish green without
 * writing the target day's metrics. New runs carry an explicit marker step.
 * The legacy fallbacks only keep runs created before that marker was deployed
 * readable during the transition.
 */
export function collectionCompletedFromJobs(
  jobs: GitHubJob[],
  event: string,
  markerRequired = false,
  runConclusion: string | null = "success",
): CollectionJobDecision {
  const collectJob = jobs.find((job) => job.name === "collect");
  if (!collectJob) return { completed: false, markerSeen: false, reason: "not_collect_job" };

  const marker = (collectJob.steps ?? []).find((step) => step.name === COLLECTION_COMPLETE_STEP);
  if (marker) {
    const completed = marker.conclusion === "success";
    return { completed, markerSeen: true, reason: completed ? "marker_success" : "marker_not_success" };
  }

  if (markerRequired) {
    return { completed: false, markerSeen: false, reason: "marker_missing" };
  }

  // Legacy scheduled runs cannot be api_only/metadata_only. A green collect job
  // therefore means either a real collection or the deliberate "nothing missing" skip.
  if (runConclusion === "success" && event === "schedule" && collectJob.conclusion === "success") {
    return { completed: true, markerSeen: false, reason: "legacy_schedule" };
  }

  // Before the marker existed, a manual full recovery is recognizable only when
  // the actual collector step completed successfully. A skipped manual step is
  // intentionally not accepted because it may have been api_only.
  const collector = (collectJob.steps ?? []).find((step) => step.name.startsWith("협찬 전체 수집"));
  if (runConclusion === "success" && event === "workflow_dispatch" && collector?.conclusion === "success") {
    return { completed: true, markerSeen: false, reason: "legacy_manual_collect" };
  }
  return { completed: false, markerSeen: false, reason: "not_collect_job" };
}
