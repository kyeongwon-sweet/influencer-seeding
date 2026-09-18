import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { validateConfig, validDate } from "@/lib/google-search-tracker";
import { startTrackerRun, pollTrackerRun } from "@/lib/google-tracker-runs";
import { verifyRun } from "@/lib/google-tracker-receipt";
export const maxDuration = 60;
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 32000) throw new Error("분석 요청이 너무 큽니다.");
    const body = JSON.parse(raw);
    if (body.action === "poll") {
      const run = verifyRun(body.receipt, userId);
      return NextResponse.json(await pollTrackerRun({ ...run, config: validateConfig(run.config) }), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "start" || !["trends", "youtube", "instagram"].includes(body.kind)) throw new Error("지원하지 않는 분석 요청입니다.");
    const config = validateConfig(body.config);
    const group = body.kind === "trends" ? 0 : body.group;
    const date = body.kind === "trends" ? config.start : body.date;
    if (!Number.isInteger(group) || group < 0 || group >= config.groups.length || !validDate(date) || date < config.start || date > config.end) throw new Error("콘텐츠 조회할 상품과 이벤트 날짜를 확인하세요.");
    const receipt = await startTrackerRun(userId, body.kind, config, group, date);
    return NextResponse.json({ status: "running", receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "수집에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
