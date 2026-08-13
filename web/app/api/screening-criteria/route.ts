import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { getAdminEmail } from "@/lib/admin-server";

export async function GET() {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServerSupabase();

  // ⚠️ 버그 수정: .single() → .maybeSingle()
  // single(): 데이터 없으면 에러 (500 반환)
  // maybeSingle(): 데이터 없으면 null 반환 (정상)
  const { data, error } = await supabase
    .from("screening_criteria")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || {});
}

export async function PUT(req: NextRequest) {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, ...fields } = await req.json();
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("screening_criteria")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
