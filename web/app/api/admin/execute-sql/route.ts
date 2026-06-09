import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * SQL 직접 실행 (관리자 전용)
 * POST /api/admin/execute-sql
 * Authorization: Bearer ADMIN_SECRET
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sql } = await req.json();

    if (!sql) {
      return NextResponse.json(
        { error: "SQL statement required" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log("[LOG] SQL 실행:", sql.substring(0, 100) + "...");

    const { data, error } = await supabase.rpc("exec", {
      sql_query: sql,
    });

    if (error) {
      console.error("[ERROR] SQL 실행 실패:", error);
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      );
    }

    console.log("[SUCCESS] SQL 실행 완료");
    return NextResponse.json({
      success: true,
      message: "SQL executed successfully",
      result: data,
    });
  } catch (error) {
    console.error("[ERROR]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
