import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey } from "@/lib/url-utils";

type TrackingUpdate = { url?: unknown; ended_at?: unknown };
type PostRow = { id: string; url: string | null; normalized_key?: string | null; manual_fields?: string[] | null };

function mergeManualFields(current: unknown, protectEndedAt: boolean): string[] {
  const fields = Array.isArray(current) ? current.map(String) : [];
  const set = new Set(fields.filter(Boolean));
  if (protectEndedAt) set.add("ended_at");
  else set.delete("ended_at");
  return [...set];
}

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
  const missing: string[] = [];

  for (const row of normalized) {
    let matches: PostRow[] = [];
    if (row.key) {
      const { data, error } = await supabase
        .from("sponsored_posts")
        .select("id, url, normalized_key, manual_fields")
        .eq("normalized_key", row.key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      matches = (data ?? []) as PostRow[];
    }
    if (!matches.length) {
      const { data, error } = await supabase
        .from("sponsored_posts")
        .select("id, url, normalized_key, manual_fields")
        .eq("url", row.url);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      matches = (data ?? []) as PostRow[];
    }
    if (!matches.length) {
      missing.push(row.url);
      continue;
    }

    const protectManualReopen = row.ended_at === null;
    for (const post of matches) {
      const { data, error } = await supabase
        .from("sponsored_posts")
        .update({
          ended_at: row.ended_at,
          manual_fields: mergeManualFields(post.manual_fields, protectManualReopen),
        })
        .eq("id", post.id)
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      updated += data?.length ?? 0;
    }
  }

  return NextResponse.json({ ok: true, updated, missing });
}
