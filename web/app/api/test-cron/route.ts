import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Test Cron endpoint works!",
    timestamp: new Date().toISOString(),
  });
}

export async function POST() {
  return NextResponse.json({
    success: true,
    message: "Test Cron endpoint works!",
    timestamp: new Date().toISOString(),
  });
}
