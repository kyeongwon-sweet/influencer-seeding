import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey } from "@/lib/url-utils";
import {
  buildTrackingUpdatePlan,
  trackingUpdateVerificationError,
  type TrackingPostRow,
  type TrackingUpdatedPostRow,
} from "@/lib/tracking-by-url";

type TrackingUpdate = { url?: unknown; ended_at?: unknown };
const DB_CHUNK_SIZE = 80;

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { rows?: TrackingUpdate[] };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: "rows is required" }, { status: 400 });
  }

  const normalized = rows
    .map((row) => {
      const rawUrl = typeof row.url === "string" ? row.url.trim() : "";
      const url = rawUrl ? (normalizeUrl(rawUrl) || rawUrl) : "";
      return {
        url,
        key: url ? postIdentityKey(url) : null,
        ended_at:
          row.ended_at === null
            ? null
            : typeof row.ended_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.ended_at)
              ? row.ended_at
              : undefined,
      };
    })
    .filter((row): row is { url: string; key: string | null; ended_at: string | null } =>
      Boolean(row.url) && row.ended_at !== undefined
    );

  if (!normalized.length) {
    return NextResponse.json({ error: "no valid rows" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  let updated = 0;
  const fetchPosts = async (column: "normalized_key" | "url", values: string[]) => {
    const unique = [...new Set(values.filter(Boolean))];
    const chunks = Array.from({ length: Math.ceil(unique.length / DB_CHUNK_SIZE) }, (_, i) =>
      unique.slice(i * DB_CHUNK_SIZE, (i + 1) * DB_CHUNK_SIZE)
    );
    const results = await Promise.all(chunks.map(chunk => supabase
      .from("sponsored_posts")
      .select("id, url, normalized_key, manual_fields")
      .in(column, chunk)));
    const failed = results.find(result => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    return results.flatMap(result => (result.data ?? []) as TrackingPostRow[]);
  };

  try {
    const keyMatches = await fetchPosts("normalized_key", normalized.flatMap(row => row.key ? [row.key] : []));
    const matchedKeys = new Set(keyMatches.flatMap(post => post.normalized_key ? [post.normalized_key] : []));
    const fallbackUrls = normalized
      .filter(row => !row.key || !matchedKeys.has(row.key))
      .map(row => row.url);
    const urlMatches = await fetchPosts("url", fallbackUrls);
    const { groups, missing } = buildTrackingUpdatePlan(normalized, [...keyMatches, ...urlMatches]);

    for (const group of groups) {
      for (let i = 0; i < group.ids.length; i += DB_CHUNK_SIZE) {
        const ids = group.ids.slice(i, i + DB_CHUNK_SIZE);
        const { data, error } = await supabase
          .from("sponsored_posts")
          .update({ ended_at: group.ended_at, manual_fields: group.manual_fields })
          .in("id", ids)
          .select("id, ended_at, manual_fields");
        if (error) throw new Error(error.message);
        const updatedRows = (data ?? []) as TrackingUpdatedPostRow[];
        const verificationError = trackingUpdateVerificationError({ ...group, ids }, updatedRows);
        if (verificationError) throw new Error(`tracking update verification failed: ${verificationError}`);
        updated += updatedRows.length;
      }
    }

    return NextResponse.json({ ok: true, updated, missing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
