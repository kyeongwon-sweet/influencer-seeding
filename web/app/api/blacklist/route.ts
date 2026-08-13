import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { getAdminEmail } from "@/lib/admin-server";

export type BlacklistEntry = {
  id: string;
  account_name: string | null;
  url: string | null;
  reason: string | null;
};

export async function GET() {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("influencer_blacklist")
    .select("id, account_name, url, reason")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
