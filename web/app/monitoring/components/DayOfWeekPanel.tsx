// 요일별 성과 패널 — monitoring/page.tsx 에서 사용(읽기 전용 프레젠테이션, 상태/훅 없음).
// 게시 요일(posted_at)별 '게시 후 7일 시점' 조회수 median 비교. (영상)만·배너 제외.
// 일별 증분과 달리 수집 누락·백로그에 안 흔들려 "언제 올릴까" 판단용으로 신뢰 가능.

export type DowData = { label: string; count: number; median: number; cpv: number | null }[];

export default function DayOfWeekPanel({ data }: { data: DowData }) {
  const max = Math.max(1, ...data.map((d) => d.median));
  const best = Math.max(0, ...data.map((d) => d.median));
  const totalN = data.reduce((s, d) => s + d.count, 0);
  const cpvVals = data.map((d) => d.cpv).filter((v): v is number => v != null);
  const bestCpv = cpvVals.length ? Math.min(...cpvVals) : null; // 가장 저렴한(효율적) CPV
  return (
    <div className="px-6 pb-5 pt-4 border-t border-a-hairline">
      <p className="text-base font-semibold text-a-ink mb-1.5">
        요일별 성과 <span className="font-normal text-a-ink-muted">· 게시 요일별 게시 후 7일 조회수 (영상, 배너 제외)</span>
      </p>
      <div className="text-[12px] text-a-ink-muted mb-3 leading-relaxed">
        게시물을 <b className="text-a-ink">올린 요일</b>로 묶어 각 영상의 <b className="text-a-ink">게시 후 7일 시점 조회수 중앙값</b>과 <b className="text-a-ink">CPV(조회당 비용)</b>를 비교합니다.
        일별 증분과 달리 수집 누락·백로그에 흔들리지 않아 &quot;언제 올릴까&quot; 판단에 적합합니다. (표본 {totalN}개 · CPV=비용/조회수, 낮을수록 효율적)
      </div>
      {totalN === 0 ? (
        <div className="text-sm text-a-ink-muted py-6 text-center">표본 없음 — 영상 게시물의 게시 후 7일 데이터가 필요합니다.</div>
      ) : (
        <div className="space-y-1.5">
          {data.map((d) => {
            const pct = d.count > 0 ? Math.round((d.median / max) * 100) : 0;
            const isBest = d.count > 0 && d.median === best && best > 0;
            return (
              <div key={d.label} className="flex items-center gap-2">
                <span className={`w-6 text-sm font-bold ${isBest ? "text-a-blue" : "text-a-ink"}`}>{d.label}</span>
                <div className="flex-1 h-5 bg-a-parchment/60 rounded relative overflow-hidden">
                  <div className={`h-full rounded ${isBest ? "bg-a-blue" : "bg-a-blue/40"}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-24 text-right tabular-nums text-sm font-semibold text-a-ink">
                  {d.count > 0 ? d.median.toLocaleString() : "—"}
                </span>
                <span className={`w-20 text-right tabular-nums text-[12px] font-medium ${d.cpv != null && d.cpv === bestCpv ? "text-green-600" : "text-a-ink-muted"}`}
                  title="CPV(조회당 비용) = 비용 ÷ 게시 후 7일 조회수 · 낮을수록 효율적">
                  {d.cpv != null ? `${d.cpv.toFixed(1)}원` : "—"}
                </span>
                <span className="w-14 text-right tabular-nums text-[11px] text-a-ink-muted">{d.count}개</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
