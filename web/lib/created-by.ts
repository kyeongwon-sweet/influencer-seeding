/**
 * 게시물 출처 라벨(`sponsored_posts.created_by`).
 *
 * 왜 별도 파일인가: `sponsored-write.ts`는 `@/` 별칭 import가 많아 테스트 러너가 못 푼다.
 * 이 규칙은 **반드시 테스트로 지켜야 하는 것**이라 별칭 없는 모듈로 뺐다.
 *
 * 배경: 1,870행 중 created_by가 1건만 채워져 있어 "연동 시트 맨 아래 새 행은 어디서 오나"
 * 같은 질문에 코드를 읽어야 답할 수 있었다. 유입 경로는 4개다:
 *   marketing-sync · sheet-bulk · sheet-stats-import · csv-upload · (대시보드는 사람 이메일)
 */

/** update/in/is 체인만 쓰는 최소 인터페이스 — 테스트에서 가짜 객체를 넣기 위해 좁게 잡는다. */
type MinimalClient = {
  from(table: string): {
    update(patch: Record<string, unknown>): {
      in(col: string, vals: string[]): {
        is(col: string, val: null): Promise<unknown>;
      };
    };
  };
};

/**
 * 신규 행에만 출처 라벨을 남긴다.
 *
 * 규칙 2가지 (테스트로 고정)
 *  1. **기존 값은 절대 덮지 않는다** — `.is("created_by", null)`로 빈 칸만.
 *     대시보드에서 사람이 추가한 행에는 이메일이 들어 있고, 동기화가 그걸 지우면 안 된다.
 *  2. **실패해도 throw하지 않는다** — 시트 동기화는 끊기면 안 되는 경로다.
 *     라벨 누락은 불편이지만, 여기서 던지면 게시물 등록 자체가 막힌다.
 */
export async function tagCreatedBy(client: unknown, ids: string[], source: string): Promise<void> {
  if (!ids.length || !source) return;
  try {
    await (client as MinimalClient)
      .from("sponsored_posts")
      .update({ created_by: source })
      .in("id", ids)
      .is("created_by", null);
  } catch (e) {
    console.warn("[created-by] 출처 라벨 기록 실패(무시)", source, e);
  }
}
