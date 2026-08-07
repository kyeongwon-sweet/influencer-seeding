import { NextRequest, NextResponse } from "next/server";
import { getAdminEmail } from "@/lib/admin-server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type PostUrlRow = { id: string; url: string | null };

async function normalizeStoredUrls(apply: boolean) {
  const supabase = getServerSupabase();
  const posts: PostUrlRow[] = [];

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    posts.push(...((data ?? []) as PostUrlRow[]));
    if (!data || data.length < 1000) break;
  }

  const existing = new Set(posts.map((p) => p.url).filter(Boolean));
  const planned: { id: string; before: string; after: string }[] = [];
  let alreadyNormalized = 0;
  let collision = 0;

  for (const p of posts) {
    if (!p.url) {
      alreadyNormalized++;
      continue;
    }
    const cleaned = normalizeUrl(p.url) || p.url;
    if (p.url === cleaned) {
      alreadyNormalized++;
      continue;
    }
    if (existing.has(cleaned)) {
      collision++;
      continue;
    }
    planned.push({ id: p.id, before: p.url, after: cleaned });
    existing.delete(p.url);
    existing.add(cleaned);
  }

  let updated = 0;
  if (apply) {
    for (const p of planned) {
      const { error } = await supabase
        .from("sponsored_posts")
        .update({ url: p.after })
        .eq("id", p.id);
      if (error) {
        collision++;
        continue;
      }
      updated++;
    }
  }

  return {
    dry_run: !apply,
    updated,
    planned: planned.length,
    total: posts.length,
    already_normalized: alreadyNormalized,
    collision_skipped: collision,
    samples: planned.slice(0, 20),
  };
}

export async function GET() {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await normalizeStoredUrls(false);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false && body?.apply !== true;

  try {
    const result = await normalizeStoredUrls(!dryRun);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
