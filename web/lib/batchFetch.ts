// 대량 행 작업(선택 삭제/일괄 변경)을 청크 병렬로 실행하고 성공/실패를 집계.
// 전량 동시 발사(수백 요청 → 브라우저·서버 부하)와 '일부 실패해도 성공처럼 UI 갱신'되는 문제를 함께 방지.
export async function batchFetch(
  ids: string[],
  run: (id: string) => Promise<Response>,
  chunk = 20
): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [], failed: string[] = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const results = await Promise.all(
      ids.slice(i, i + chunk).map(async id => {
        try { const r = await run(id); return { id, ok: r.ok }; }
        catch { return { id, ok: false }; }
      })
    );
    for (const r of results) (r.ok ? ok : failed).push(r.id);
  }
  return { ok, failed };
}
