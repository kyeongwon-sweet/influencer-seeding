const APIFY_BASE = 'https://api.apify.com/v2';

/** Apify 액터를 비동기로 시작하고 완료 시 webhookUrl로 POST 요청을 보냄 */
export async function startActorRun(
  actorId: string,
  input: Record<string, unknown>,
  webhookUrl: string
): Promise<void> {
  const token = process.env.APIFY_API_TOKEN!;
  const webhooks = Buffer.from(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
    requestUrl: webhookUrl,
    payloadTemplate: '{"datasetId":"{{resource.defaultDatasetId}}","status":"{{resource.status}}"}',
  }])).toString('base64url');

  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId.replace('/', '~')}/runs?token=${token}&webhooks=${webhooks}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&limit=5000`
  );
  if (!res.ok) throw new Error(`Dataset fetch 실패: ${res.status}`);
  return res.json();
}
