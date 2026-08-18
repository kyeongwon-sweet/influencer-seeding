import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { isBannerChannel } from "@/app/monitoring/lib";
import { maxDateKST } from "@/lib/dateRule";
import { fetchSheetTabValues } from "@/lib/google-sheets";
import { extractBannerReachRows } from "@/lib/sheet-banner-reach";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
const SHEET_GID = 1937186871;
const SHEET_RANGE = "A1:ZZ5000";

type SponsoredPostRow = {
  id: string;
  url: string;
  normalized_key?: string | null;
  channel_type?: string | null;
  posted_at?: string | null;
  ended_at?: string | null;
  cost?: number | null;
};

function identityKey(url: string): string {
  const normalized = normalizeUrl(url) ?? url;
  return postIdentityKey(normalized) ?? normalized;
}

function ymd(value: string | null | undefined): string | null {
  return value ? String(value).slice(0, 10) : null;
}

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  let values;
  try {
    values = await fetchSheetTabValues(SHEET_ID, SHEET_GID, SHEET_RANGE);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const shared = !/403/.test(msg);
    return NextResponse.json(
      {
        error: msg,
        hint: shared
          ? "Sheet read failed"
          : "Service account is not shared to the Sheet. Share it to GOOGLE_SA_CLIENT_EMAIL as viewer.",
      },
      { status: 502 },
    );
  }

  let extracted;
  try {
    extracted = extractBannerReachRows(values, { today: maxDateKST(), isBanner: isBannerChannel });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const supabase = getServerSupabase();
  const postByKey = new Map<string, SponsoredPostRow>();
  const postByUrl = new Map<string, SponsoredPostRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url, normalized_key, channel_type, posted_at, ended_at, cost")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const post of (data ?? []) as SponsoredPostRow[]) {
      postByUrl.set(post.url, post);
      postByUrl.set(normalizeUrl(post.url) ?? post.url, post);
      postByKey.set(String(post.normalized_key ?? identityKey(post.url)), post);
    }
    if (!data || data.length < 1000) break;
  }

  const missing = new Set<string>();
  const nonBannerDb = new Set<string>();
  const prePosted: Array<{ url: string; date: string; posted_at: string }> = [];
  const postEnded: Array<{ url: string; date: string; ended_at: string }> = [];
  const costAsReach: Array<{ url: string; date: string; value: number }> = [];
  const conflicts: Array<{ url: string; date: string; values: number[] }> = [];
  const candidates = new Map<string, { post_id: string; measured_at: string; reach_count: number; manual: boolean; url: string }>();
  const valueSets = new Map<string, Set<number>>();

  for (const row of extracted.rows) {
    const normalizedUrl = normalizeUrl(row.url) ?? row.url;
    const key = identityKey(row.url);
    const post = postByKey.get(key) ?? postByUrl.get(normalizedUrl) ?? postByUrl.get(row.url);
    if (!post) {
      missing.add(row.url);
      continue;
    }
    if (!isBannerChannel(post.channel_type ?? row.channelType, post.posted_at ?? row.postedAt)) {
      nonBannerDb.add(row.url);
      continue;
    }

    const measured = row.measuredAt.slice(0, 10);
    const postedAt = ymd(post.posted_at) ?? row.postedAt;
    if (postedAt && measured < postedAt) {
      prePosted.push({ url: row.url, date: measured, posted_at: postedAt });
      continue;
    }
    const endedAt = ymd(post.ended_at);
    if (endedAt && measured > endedAt) {
      postEnded.push({ url: row.url, date: measured, ended_at: endedAt });
      continue;
    }
    if (Number(post.cost) > 0 && Number(post.cost) === row.reachCount) {
      costAsReach.push({ url: row.url, date: measured, value: row.reachCount });
      continue;
    }

    const candidateKey = `${post.id}|${measured}`;
    const set = valueSets.get(candidateKey) ?? new Set<number>();
    set.add(row.reachCount);
    valueSets.set(candidateKey, set);
    candidates.set(candidateKey, {
      post_id: post.id,
      measured_at: measured,
      reach_count: row.reachCount,
      manual: true,
      url: row.url,
    });
  }

  for (const [key, set] of valueSets) {
    if (set.size < 2) continue;
    const row = candidates.get(key);
    if (row) conflicts.push({ url: row.url, date: row.measured_at, values: [...set] });
    candidates.delete(key);
  }

  const upsertRows = [...candidates.values()].map((row) => ({
    post_id: row.post_id,
    measured_at: row.measured_at,
    reach_count: row.reach_count,
    manual: row.manual,
  }));
  let upserted = 0;
  if (!dryRun && upsertRows.length > 0) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .upsert(upsertRows, { onConflict: "post_id,measured_at" })
      .select("post_id, measured_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    upserted = (data ?? []).length;
  }

  return NextResponse.json(
    {
      ok: true,
      dry_run: dryRun,
      upserted,
      would_upsert: upsertRows.length,
      sheet_rows: extracted.sheetRows,
      banner_rows: extracted.bannerRows,
      date_columns: extracted.dateColumns,
      extracted_cells: extracted.rows.length,
      missing_urls: missing.size,
      missing_sample: [...missing].slice(0, 10),
      non_banner_db_skipped: nonBannerDb.size,
      non_banner_db_sample: [...nonBannerDb].slice(0, 10),
      pre_posted_skipped: prePosted.length,
      pre_posted_sample: prePosted.slice(0, 10),
      post_ended_skipped: postEnded.length,
      post_ended_sample: postEnded.slice(0, 10),
      cost_as_reach_skipped: costAsReach.length,
      cost_as_reach_sample: costAsReach.slice(0, 10),
      duplicate_conflict_skipped: conflicts.length,
      duplicate_conflict_sample: conflicts.slice(0, 10),
      future_date_cells_skipped: extracted.futureDateCellsSkipped,
      future_post_rows_skipped: extracted.futurePostRowsSkipped,
      pre_posted_cells_skipped_from_sheet: extracted.prePostedCellsSkipped,
      blank_cells_skipped: extracted.blankCellsSkipped,
      zero_cells_skipped: extracted.zeroCellsSkipped,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
