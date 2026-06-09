// ApifyClient import - 서버 사이드 전용
// 이를 통해 Turbopack이 apify-client를 detect하고 .nft.json에 포함하도록 강제
import { ApifyClient } from "apify-client";

const APIFY_BASE = 'https://api.apify.com/v2';

/** Apify 액터를 비동기로 시작하고 완료 시 webhookUrl로 POST 요청을 보냄 */
export async function startActorRun(
  actorId: string,
  input: Record<string, unknown>,
  webhookUrl: string
): Promise<void> {
  const token = process.env.APIFY_API_TOKEN!;
  // payloadTemplate 미사용: Apify 기본 페이로드(resource.status, resource.defaultDatasetId)로 수신
  const webhooks = Buffer.from(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
    requestUrl: webhookUrl,
  }])).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId.replace('/', '~')}/runs?webhooks=${webhooks}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify 실행 실패 [${actorId}]: ${res.status} ${text}`);
  }
}

/** Apify 데이터셋에서 수집된 아이템 목록을 가져옴 */
export async function fetchDatasetItems(datasetId: string): Promise<unknown[]> {
  const token = process.env.APIFY_API_TOKEN!;
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&limit=5000`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Dataset fetch 실패: ${res.status}`);
  return res.json();
}

/** ApifyClient 인스턴스 생성 (전용 함수로 Turbopack detection 강제) */
export function createApifyClient(): InstanceType<typeof ApifyClient> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("APIFY_API_TOKEN not configured");
  }
  return new ApifyClient({ token });
}
