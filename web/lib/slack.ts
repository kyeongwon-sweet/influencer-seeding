// Slack 알림 헬퍼 — SLACK_WEBHOOK_URL(Incoming Webhook) 미설정 시 조용히 no-op.
// 자동 수집(크론) 성공/실패를 채널로 통지해 "주말 야간 조용한 실패"를 방지한다.
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // 미설정 → no-op (로컬/미구성 환경 안전)
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // 알림 실패가 본 작업을 깨뜨리지 않도록 무시
  }
}

// 작업명을 받아 성공/실패 메시지를 표준 포맷으로 보낸다.
export async function notifyJob(
  job: string,
  status: "ok" | "fail",
  detail?: string
): Promise<void> {
  const emoji = status === "ok" ? "✅" : "🚨";
  const head = status === "ok" ? "수집 완료" : "수집 실패";
  const body = detail ? `\n${detail}` : "";
  await notifySlack(`${emoji} [${job}] ${head}${body}`);
}
