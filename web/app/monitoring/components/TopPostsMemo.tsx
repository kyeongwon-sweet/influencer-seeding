// 요일별·업체별 성과 패널 공용 호버 메모박스 — "그 숫자를 만든 계정이 누구냐"를 바로 보여준다.
// 순수 CSS(group-hover)로만 열려서 두 패널은 계속 상태·훅 없는 프레젠테이션 컴포넌트로 남는다.
// ⚠️ 부모(monitoring/page.tsx 차트 카드)가 overflow-hidden이라 카드 밖으로 나가면 잘린다.
//    그래서 항상 자기 패널 안쪽을 향해 열게 한다 — 아래쪽 행은 openUp, 오른쪽 패널은 align="right".

export type TopPost = {
  account: string;         // 계정명(없으면 인플루언서명)
  asset: string;           // 소재명(없으면 빈 문자열)
  value: number;           // 영상=조회수 · 배너=도달수
  unitCost: number | null; // 게시물 단가 CPV/CPR = 비용÷value (비용 없으면 null)
};

export type TopMemo = {
  items: TopPost[];        // value 내림차순 상위
  more: number;            // 목록에 못 들어간 나머지 개수
  best: TopPost | null;    // 최저 단가(가장 효율적) — 조회수 상위와 다를 수 있어 따로 보여준다
};

export const MEMO_TOP_N = 5;
export const EMPTY_MEMO: TopMemo = { items: [], more: 0, best: null };

/** 버킷(요일·업체)에 속한 게시물들을 메모박스용 상위 목록으로 압축. 값 없는 게시물은 호출부에서 제외. */
export function buildTopMemo(rows: TopPost[], n: number = MEMO_TOP_N): TopMemo {
  if (!rows.length) return EMPTY_MEMO;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const priced = rows.filter((r): r is TopPost & { unitCost: number } => r.unitCost != null);
  // 단가는 낮을수록 효율적 → 최소값. 동률이면 먼저 나온 것 유지.
  const best = priced.length ? priced.reduce((a, b) => (b.unitCost < a.unitCost ? b : a)) : null;
  return { items: sorted.slice(0, n), more: Math.max(0, sorted.length - n), best };
}

export type MemoSection = { label: string; unit: string; costLabel: string; memo: TopMemo };

export default function TopPostsMemo({ heading, sections, align = "left", openUp = false }: {
  heading: string;
  sections: MemoSection[];
  align?: "left" | "right";
  openUp?: boolean;
}) {
  const live = sections.filter(s => s.memo.items.length > 0);
  if (!live.length) return null;
  return (
    // pointer-events-none: 메모가 커서를 가로채 깜빡이거나 아래 행 클릭을 막지 않게 함(그래서 링크는 두지 않음)
    <div className={`pointer-events-none hidden group-hover:block absolute z-30 w-[330px] rounded-[10px] border border-a-hairline bg-white shadow-lg px-3 py-2.5
      ${align === "right" ? "right-0" : "left-0"} ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
      <p className="text-[11.5px] font-bold text-a-ink mb-1.5 truncate">{heading}</p>
      {live.map((sec, si) => (
        <div key={sec.label || si} className={si > 0 ? "mt-2 pt-2 border-t border-a-divider" : ""}>
          {sec.label && <p className="text-[10.5px] font-semibold text-a-ink-muted mb-1">{sec.label}</p>}
          {sec.memo.items.map((it, i) => (
            <div key={i} className="flex items-baseline gap-1.5 leading-[1.55]">
              <span className="w-3 flex-shrink-0 text-[10px] text-a-ink-muted tabular-nums">{i + 1}</span>
              <span className="flex-1 min-w-0 text-[11.5px] text-a-ink truncate">
                <b>{it.account}</b>
                {it.asset && <span className="text-a-ink-muted"> · {it.asset}</span>}
              </span>
              <span className="flex-shrink-0 text-[11.5px] font-semibold text-a-ink tabular-nums">
                {it.value.toLocaleString()}{sec.unit}
              </span>
              <span className="w-[50px] flex-shrink-0 text-right text-[10.5px] text-a-ink-muted tabular-nums">
                {it.unitCost != null ? `${it.unitCost.toFixed(1)}원` : "—"}
              </span>
            </div>
          ))}
          {sec.memo.more > 0 && <p className="text-[10.5px] text-a-ink-muted pl-[18px] mt-0.5">외 {sec.memo.more}개</p>}
          {sec.memo.best != null && sec.memo.best.unitCost != null && (
            <p className="text-[10.5px] text-a-ink-muted mt-1 pl-[18px]">
              최저 {sec.costLabel} <b className="text-green-600">{sec.memo.best.account}</b> {sec.memo.best.unitCost.toFixed(1)}원
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
