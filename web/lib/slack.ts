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

// 여믄봇(SLACK_BOT_TOKEN)으로 특정 대상에 직접 알림 — 황경원 DM(STATUS_USER) 우선, 없으면 리포트 채널(SLACK_CHANNEL).
// 둘 다 없으면 Incoming Webhook(notifySlack)으로 폴백. 봇/대상 미설정 환경에서도 안전(알림은 나감).
// notify_status.py 여믄봇과 동일 대상 규칙(SLACK_CHANNEL/STATUS_USER). 실시간 알림이라 thread_ts는 안 씀(새 메시지로 눈에 띄게).
export async function notifyBot(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.STATUS_USER || process.env.SLACK_CHANNEL;
  if (!token || !channel) { await notifySlack(text); return; } // 봇 대상 미설정 → 웹훅 폴백
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel, text }),
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
