// GitHub repository_dispatch로 캡션 보강 워크플로(caption-backfill.yml)를 즉시 1회 트리거한다.
// 목적: 게시물이 추가되는 순간 새 IG 글의 캡션을 ~1분 내 채우기(폴링 대신 이벤트 기반).
// GH_DISPATCH_TOKEN(Actions dispatch 권한) 미설정 시 조용히 skip → 스케줄 안전망(1회/일)이 커버.
const REPO = "kyeongwon-sweet/influencer-seeding";

// url이 인스타이고 캡션이 비어 있으면 true(=자동 수집이 채워줄 대상 → 트리거할 가치 있음)
export function needsCaption(url?: unknown, caption?: unknown): boolean {
  return /instagram\.com/i.test(String(url || "")) && !String(caption ?? "").trim();
}

export async function triggerCaptionBackfill(reason: string): Promise<void> {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return; // 토큰 없으면 스케줄 안전망에 맡김(조용히 skip)
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_type: "caption-backfill", client_payload: { reason } }),
    });
    if (!res.ok) {
      console.error("[caption-dispatch] 실패", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    // 트리거 실패해도 게시물 추가 자체엔 영향 없음(스케줄이 나중에 채움)
    console.error("[caption-dispatch] 예외(무시):", e);
  }
}
