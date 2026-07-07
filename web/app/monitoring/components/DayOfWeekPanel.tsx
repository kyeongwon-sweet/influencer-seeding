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
    <div className="px-5 pb-5 pt-4">
      <p className="text-base font-semibold text-a-ink mb-1">
        요일별 성과 <span className="font-normal text-a-ink-muted text-[13px]">· 게시 요일별 게시 후 7일 조회수·CPV (영상, 배너 제외)</span>
      </p>
      <p className="text-[12px] text-a-ink-muted mb-3 leading-relaxed">
        각 영상의 <b className="text-a-ink">게시 후 7일 시점</b> 성과를 올린 요일로 묶은 <b className="text-a-ink">중앙값</b>. 수집 누락·백로그에 안 흔들려 &quot;언제 올릴까&quot; 판단용. (표본 {totalN}개)
      </p>
      {totalN === 0 ? (
        <div className="text-sm text-a-ink-muted py-6 text-center">표본 없음 — 영상 게시물의 게시 후 7일 데이터가 필요합니다.</div>
      ) : (
        <div className="max-w-2xl">
          {/* 컬럼 헤더 */}
          <div className="flex items-center gap-3 px-1 pb-1.5 border-b border-a-hairline text-[11px] font-semibold text-a-ink-muted">
            <span className="w-6">요일</span>
            <span className="flex-1">조회수 (중앙값)</span>
            <span className="w-16 text-right">CPV</span>
            <span className="w-12 text-right">게시물</span>
          </div>
          <div className="divide-y divide-a-divider">
            {data.map((d) => {
              const pct = d.count > 0 ? Math.max(3, Math.round((d.median / max) * 100)) : 0;
              const isBestViews = d.count > 0 && d.median === best && best > 0;
              const isBestCpv = d.cpv != null && d.cpv === bestCpv;
              return (
                <div key={d.label} className="flex items-center gap-3 px-1 py-1.5">
                  <span className={`w-6 text-sm font-bold ${isBestViews ? "text-a-blue" : "text-a-ink"}`}>{d.label}</span>
                  {/* 막대 + 조회수 값을 막대 트랙 끝에 얹어 눈 이동 최소화 */}
                  <div className="flex-1 h-6 bg-a-parchment/50 rounded relative overflow-hidden">
                    <div className={`h-full rounded ${isBestViews ? "bg-a-blue" : "bg-a-blue/35"}`} style={{ width: `${pct}%` }} />
                    <span className="absolute inset-y-0 right-2 flex items-center text-[12.5px] font-semibold tabular-nums text-a-ink">
                      {d.count > 0 ? d.median.toLocaleString() : "—"}
                    </span>
                  </div>
                  <span className={`w-16 text-right tabular-nums text-[12.5px] ${isBestCpv ? "text-green-600 font-bold" : "text-a-ink-muted font-medium"}`}
                    title="CPV(조회당 비용) = 비용 ÷ 게시 후 7일 조회수 · 낮을수록 효율적">
                    {d.cpv != null ? `${d.cpv.toFixed(1)}원` : "—"}
                  </span>
                  <span className="w-12 text-right tabular-nums text-[11px] text-a-ink-muted">{d.count}개</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-a-ink-muted mt-2 px-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-a-blue align-middle mr-0.5" /> 최다 조회수 요일 ·
            <span className="text-green-600 font-semibold"> 녹색 CPV</span> = 최저(가장 효율적, 비용÷조회수)
          </p>
        </div>
      )}
    </div>
  );
}
