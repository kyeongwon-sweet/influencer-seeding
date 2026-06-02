import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export type BlacklistEntry = {
  id: string;
  account_name: string | null;
  url: string | null;
  reason: string | null;
};

// URL에서 username 추출 (인스타·유튜브 공통)
export function extractHandle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // 유튜브: /@handle → handle
    if (u.hostname.includes("youtube")) {
      const at = parts.find(p => p.startsWith("@"));
      return at ? at.slice(1).toLowerCase() : "";
    }
    // 인스타: /username/reels/ → username
    return (parts[0] ?? "").toLowerCase().replace(/@/g, "");
  } catch { return ""; }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("influencer_blacklist")
    .select("id, account_name, url, reason")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
