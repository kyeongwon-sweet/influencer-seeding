import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { triggerWorkflow } from "@/lib/github";

function getServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, type, status, payload, user_email, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const userEmail = user?.emailAddresses?.[0]?.emailAddress ?? null;

  const { type, payload } = await req.json();

  const supabase = getServerSupabase();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ type, payload, status: "pending", user_email: userEmail })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await triggerWorkflow(type, { job_id: job.id, ...payload });
  } catch (e) {
    await supabase.from("jobs").update({ status: "failed", error: String(e) }).eq("id", job.id);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  return NextResponse.json({ job });
}
