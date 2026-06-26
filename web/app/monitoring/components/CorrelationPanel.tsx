// 상관 분석 패널 — monitoring/page.tsx 에서 추출(읽기 전용 프레젠테이션).
// 입력 데이터(correlations useMemo 결과)만 props로 받는다. 상태/훅 없음.

export type CorrelationData = {
  pairs: { a: string; b: string; r: number | null; n: number }[];
  hiddenWeak: number;
  models: { target: string; preds: string[]; r2: number | null; n: number }[];
  lags: { b: string; lag: number; r: number }[];
};

export default function CorrelationPanel({ data }: { data: CorrelationData }) {
  // 상관계수 색/세기 표기 — 절대값 기준, 부호로 방향
  const fmtR = (r: number | null) => r == null || Number.isNaN(r) ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}`;
  const strength = (r: number | null) => r == null || Number.isNaN(r) ? "표본 부족"
    : Math.abs(r) >= 0.7 ? "강함" : Math.abs(r) >= 0.4 ? "중간" : "약함";
  const rColor = (r: number | null) => r == null || Number.isNaN(r) ? "text-a-ink-muted"
    : Math.abs(r) < 0.4 ? "text-gray-500" : r > 0 ? "text-green-600" : "text-red-500";
  const barColor = (r: number | null) => r == null || Number.isNaN(r) ? "#e5e7eb"
    : Math.abs(r) < 0.4 ? "#cbd5e1" : r > 0 ? "#16a34a" : "#ef4444";
  const badgeCls = (r: number | null) => r == null || Number.isNaN(r) ? "bg-gray-100 text-gray-400"
    : Math.abs(r) < 0.4 ? "bg-gray-100 text-gray-500" : r > 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500";
  const absPct = (r: number | null) => r == null || Number.isNaN(r) ? 0 : Math.round(Math.min(1, Math.abs(r)) * 100);
  const lagLabel = (lag: number) => lag === 0 ? "당일" : lag > 0 ? `${lag}일 뒤` : `${-lag}일 전`;
  return (
    <div className="px-6 pb-5 pt-4 border-t border-a-hairline">
      <p className="text-base font-semibold text-a-ink mb-1.5">
        상관 분석 <span className="font-normal text-a-ink-muted">· 선택 기간 일별 흐름</span>
      </p>
      <div className="text-[12px] text-a-ink-muted mb-3 leading-relaxed space-y-1">
        <p>※ <b className="text-a-ink">설명력(R²)</b> — 여러 지표가 합쳐 결과의 변동을 몇 % 설명하는지 (100%=완전).</p>
        <p><b className="text-a-ink">상관계수</b> — 인과가 아닌 동행성. <span className="text-green-600 font-medium">±0.7↑ 강함</span> · <span className="text-a-ink">±0.4↑ 중간</span>, 막대=세기, 색=방향(<span className="text-green-600">＋같이</span>/<span className="text-red-500">－반대</span>).</p>
        <p><b className="text-a-ink">선행효과</b> — 광고비 집행이 며칠 뒤 해당 지표에 가장 강하게 동행하는지 (−3~+3일).</p>
      </div>

      {data.models.length > 0 && (
        <>
          <p className="text-[13px] font-semibold text-a-ink-muted mb-2">함께 보는 설명력 <span className="font-normal">· 여러 지표가 결합해 설명하는 정도(R²)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {data.models.map(m => {
              const pct = Math.round((m.r2 ?? 0) * 100);
              const col = pct >= 50 ? "#16a34a" : pct >= 25 ? "#f59e0b" : "#cbd5e1";
              const tcol = pct >= 50 ? "text-green-600" : pct >= 25 ? "text-amber-500" : "text-gray-500";
              return (
                <div key={m.target} className="rounded-[10px] border border-a-hairline bg-white px-3.5 py-3" title={`표본 ${m.n}일`}>
                  <div className="text-[13px] text-a-ink-muted mb-1.5 truncate">
                    <span className="font-semibold text-a-ink">{m.target}</span> <span className="text-gray-300">←</span> {m.preds.join(" · ")}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[22px] font-bold tabular-nums leading-none ${tcol}`}>{pct}%</span>
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: col }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="text-[13px] font-semibold text-a-ink-muted mb-2">강한 1:1 상관 <span className="font-normal">· 중간 이상만(|r|≥0.4)</span></p>
      {data.pairs.length === 0 ? (
        <p className="text-[13px] text-a-ink-muted mb-1">선택 기간에 중간 이상(|r|≥0.4) 상관이 없어요.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-1">
          {data.pairs.map(p => (
            <div key={`${p.a}-${p.b}`} className="rounded-[10px] border border-a-hairline bg-white px-3 py-2.5" title={`표본 ${p.n}일`}>
              <div className="flex items-center justify-between gap-1.5 mb-1.5">
                <span className="text-[13px] text-a-ink-muted truncate">{p.a}<span className="mx-0.5 text-gray-300">↔</span>{p.b}</span>
                <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${badgeCls(p.r)}`}>{strength(p.r)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[20px] font-bold tabular-nums leading-none ${rColor(p.r)}`}>{fmtR(p.r)}</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${absPct(p.r)}%`, backgroundColor: barColor(p.r) }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data.hiddenWeak > 0 && (
        <p className="text-[12px] text-a-ink-muted mb-4">약한 상관(|r|&lt;0.4) {data.hiddenWeak}개는 숨겼어요.</p>
      )}

      <p className="text-[13px] font-semibold text-a-ink-muted mb-2 mt-1">광고비 선행효과 <span className="font-normal">· 가장 강한 시차</span></p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {data.lags.map(l => (
          <div key={l.b} className="rounded-[10px] border border-a-hairline bg-white px-3 py-2.5">
            <div className="text-[13px] text-a-ink-muted mb-1 truncate">광고비 <span className="text-gray-300">→</span> {l.b}</div>
            {Number.isNaN(l.r) ? (
              <span className="text-[13px] text-a-ink-muted">표본 부족</span>
            ) : (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[17px] font-bold text-a-ink leading-none">{lagLabel(l.lag)}</span>
                <span className={`text-[13px] font-medium tabular-nums ${rColor(l.r)}`}>{fmtR(l.r)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
