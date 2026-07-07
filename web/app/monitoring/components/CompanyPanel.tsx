// 업체별 성과 패널 — monitoring/page.tsx 에서 사용(읽기 전용 프레젠테이션, 상태/훅 없음).
// 요일별 패널(DayOfWeekPanel)과 동일 기준: 각 게시물의 '게시 후 7일 시점' 값을 업체로 묶은 중앙값.
// 영상 = 조회수·CPV(비용÷조회수), 배너 = 도달수·CPR(비용÷도달수). 바이럴 소재만(업체명 있는 것).

export type CompanyRow = {
  company: string;
  video: { count: number; median: number; cpv: number | null };
  banner: { count: number; median: number; cpr: number | null };
};
export type CompanyData = CompanyRow[];

function Cell({ v, cost, unit, best }: { v: { count: number; median: number }; cost: number | null; unit: string; best: boolean }) {
  if (v.count === 0) return <span className="text-a-ink-muted">—</span>;
  return (
    <span className="tabular-nums">
      <b className={best ? "text-a-blue" : "text-a-ink"}>{v.median.toLocaleString()}</b>
      <span className="text-a-ink-muted text-[11px]"> ·{v.count}개</span>
      {cost != null && <span className="text-a-ink-muted text-[11.5px]"> · {cost.toFixed(1)}원/{unit}</span>}
    </span>
  );
}

export default function CompanyPanel({ data }: { data: CompanyData }) {
  const totalN = data.reduce((s, d) => s + d.video.count + d.banner.count, 0);
  const bestVideo = Math.max(0, ...data.filter(d => d.video.count > 0).map(d => d.video.median));
  const bestBanner = Math.max(0, ...data.filter(d => d.banner.count > 0).map(d => d.banner.median));
  return (
    <div className="px-6 pb-5 pt-4 border-t border-a-hairline">
      <p className="text-base font-semibold text-a-ink mb-1">
        업체별 성과 <span className="font-normal text-a-ink-muted text-[13px]">· 게시 후 7일 시점 — 영상=조회수·CPV / 배너=도달수·CPR</span>
      </p>
      <p className="text-[12px] text-a-ink-muted mb-3 leading-relaxed">
        각 소재의 <b className="text-a-ink">게시 후 7일 시점</b> 성과를 업체로 묶은 <b className="text-a-ink">중앙값</b>. 요일별과 동일 기준(수집 누락·백로그에 안 흔들림) — &quot;어느 업체에 맡길까&quot; 판단용. (표본 {totalN}개)
      </p>
      {totalN === 0 ? (
        <div className="text-sm text-a-ink-muted py-6 text-center">표본 없음 — 업체명 있는 바이럴 소재의 게시 후 7일 데이터가 필요합니다.</div>
      ) : (
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 px-1 pb-1.5 border-b border-a-hairline text-[11px] font-semibold text-a-ink-muted">
            <span className="w-24">업체</span>
            <span className="flex-1">영상 (조회수 중앙값 · 개수 · CPV)</span>
            <span className="flex-1">배너 (도달수 중앙값 · 개수 · CPR)</span>
          </div>
          <div className="divide-y divide-a-divider">
            {data.map(d => (
              <div key={d.company} className="flex items-center gap-3 px-1 py-1.5 text-[12.5px]">
                <span className="w-24 text-sm font-bold text-a-ink truncate" title={d.company}>{d.company}</span>
                <span className="flex-1"><Cell v={d.video} cost={d.video.cpv} unit="회" best={d.video.count > 0 && d.video.median === bestVideo && bestVideo > 0} /></span>
                <span className="flex-1"><Cell v={d.banner} cost={d.banner.cpr} unit="도달" best={d.banner.count > 0 && d.banner.median === bestBanner && bestBanner > 0} /></span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-a-ink-muted mt-2 px-1">
            <span className="text-a-blue font-semibold">파란 값</span> = 유형별 최고 중앙값 · CPV/CPR = 비용÷(게시 후 7일 조회수/도달수), 낮을수록 효율적
          </p>
        </div>
      )}
    </div>
  );
}
