import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

type TrackingUpdate = { url?: unknown; ended_at?: unknown };

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
    .map((row) => ({
      url: typeof row.url === "string" ? row.url.trim() : "",
      ended_at:
        row.ended_at === null
          ? null
          : typeof row.ended_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.ended_at)
            ? row.ended_at
            : undefined,
    }))
    .filter((row): row is { url: string; ended_at: string | null } =>
      Boolean(row.url) && row.ended_at !== undefined
    );

  if (!normalized.length) {
    return NextResponse.json({ error: "no valid rows" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  let updated = 0;
  const missing: string[] = [];

  for (const row of normalized) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .update({ ended_at: row.ended_at })
      .eq("url", row.url)
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) missing.push(row.url);
    else updated += data.length;
  }

  return NextResponse.json({ ok: true, updated, missing });
}
