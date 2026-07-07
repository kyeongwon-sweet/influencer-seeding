// 업체별 성과 패널 — monitoring/page.tsx 에서 사용(읽기 전용 프레젠테이션, 상태/훅 없음).
// 업체별 '누적 총합': 영상 = Σ누적 조회수 · CPV(Σ비용÷Σ조회수), 배너 = Σ도달수 · CPR(Σ비용÷Σ도달수).
// CPV/CPR은 대시보드 조회당비용·슬랙 리포트와 동일 기준. 바이럴 소재만(업체명 있는 것).

export type CompanyRow = {
  company: string;
  video: { count: number; total: number; cpv: number | null };
  banner: { count: number; total: number; cpr: number | null };
};
export type CompanyData = CompanyRow[];

function Cell({ v, cost, unit, best }: { v: { count: number; total: number }; cost: number | null; unit: string; best: boolean }) {
  if (v.count === 0) return <span className="text-a-ink-muted">—</span>;
  return (
    <span className="tabular-nums">
      <b className={best ? "text-a-blue" : "text-a-ink"}>{v.total.toLocaleString()}</b>
      <span className="text-a-ink-muted text-[11px]"> ·{v.count}개</span>
      {cost != null && <span className="text-a-ink-muted text-[11.5px]"> · {cost.toFixed(1)}원/{unit}</span>}
    </span>
  );
}

export default function CompanyPanel({ data }: { data: CompanyData }) {
  const totalN = data.reduce((s, d) => s + d.video.count + d.banner.count, 0);
  const bestVideo = Math.max(0, ...data.filter(d => d.video.count > 0).map(d => d.video.total));
  const bestBanner = Math.max(0, ...data.filter(d => d.banner.count > 0).map(d => d.banner.total));
  return (
    <div className="px-6 pb-5 pt-4 border-t border-a-hairline">
      <p className="text-base font-semibold text-a-ink mb-1">
        업체별 성과 <span className="font-normal text-a-ink-muted text-[13px]">· 누적 총합 — 영상=조회수·CPV / 배너=도달수·CPR</span>
      </p>
      <p className="text-[12px] text-a-ink-muted mb-3 leading-relaxed">
        업체별 <b className="text-a-ink">전체 소재의 누적 합계</b>. CPV/CPR = Σ비용÷Σ누적(대시보드 조회당비용과 동일 기준). 날짜 필터를 걸면 그 범위 말일 기준 누적으로 계산. (소재 {totalN}개)
      </p>
      {totalN === 0 ? (
        <div className="text-sm text-a-ink-muted py-6 text-center">표본 없음 — 업체명 있는 바이럴 소재가 필요합니다.</div>
      ) : (
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 px-1 pb-1.5 border-b border-a-hairline text-[11px] font-semibold text-a-ink-muted">
            <span className="w-24">업체</span>
            <span className="flex-1">영상 (누적 조회수 · 개수 · CPV)</span>
            <span className="flex-1">배너 (누적 도달수 · 개수 · CPR)</span>
          </div>
          <div className="divide-y divide-a-divider">
            {data.map(d => (
              <div key={d.company} className="flex items-center gap-3 px-1 py-1.5 text-[12.5px]">
                <span className="w-24 text-sm font-bold text-a-ink truncate" title={d.company}>{d.company}</span>
                <span className="flex-1"><Cell v={d.video} cost={d.video.cpv} unit="회" best={d.video.count > 0 && d.video.total === bestVideo && bestVideo > 0} /></span>
                <span className="flex-1"><Cell v={d.banner} cost={d.banner.cpr} unit="도달" best={d.banner.count > 0 && d.banner.total === bestBanner && bestBanner > 0} /></span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-a-ink-muted mt-2 px-1">
            <span className="text-a-blue font-semibold">파란 값</span> = 유형별 최대 누적 · CPV/CPR 낮을수록 효율적 · 배너 도달수 = 입력값 우선, 없으면 조회수×0.8
          </p>
        </div>
      )}
    </div>
  );
}
