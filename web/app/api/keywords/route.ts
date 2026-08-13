import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { getAdminEmail } from "@/lib/admin-server";

export async function GET() {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("search_keywords")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" } });
}

export async function POST(req: NextRequest) {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("search_keywords")
    .insert(body)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
