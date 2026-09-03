// 업체별 성과 패널 — monitoring/page.tsx 에서 사용(읽기 전용 프레젠테이션, 상태/훅 없음).
// 업체별 '누적 총합': 영상 = Σ누적 조회수 · CPV(Σ비용÷Σ조회수), 배너 = Σ도달수 · CPR(Σ비용÷Σ도달수).
// CPV/CPR은 대시보드 조회당비용·슬랙 리포트와 동일 기준. 바이럴 소재만(업체명 있는 것).

import TopPostsMemo, { type TopMemo } from "./TopPostsMemo";

// videoTop/bannerTop: 그 업체 소재의 성과 상위 목록(호버 메모박스용). 합계만으로는 "어느 계정 덕인지"를 알 수 없어 함께 내려받는다.
export type CompanyRow = {
  company: string;
  // measured = 실측값이 있는 소재 수. count(물량)와 분리해 '측정 없음'을 0으로 표시하지 않는다(공백≠0).
  video: { count: number; measured: number; total: number; cpv: number | null };
  banner: { count: number; measured: number; total: number; cpr: number | null };
  videoTop: TopMemo;
  bannerTop: TopMemo;
};
export type CompanyData = CompanyRow[];

// 요일별 패널과 동일한 막대+값 패턴: 트랙 위 비례 막대, 값은 트랙 오른쪽 끝(눈 이동 최소화)
function BarCell({ v, max, strong, color }: { v: { count: number; measured: number; total: number }; max: number; strong: boolean; color: "blue" | "amber" }) {
  const pct = v.measured > 0 && max > 0 ? Math.max(3, Math.round((v.total / max) * 100)) : 0;
  const fill = color === "blue"
    ? (strong ? "bg-a-blue" : "bg-a-blue/35")
    : (strong ? "bg-amber-400" : "bg-amber-400/40");
  // 최대값(strong)은 막대가 꽉 차 숫자와 겹침. 진한 파랑 위에선 흰색으로 대비 확보(밝은 amber는 어두운 글씨가 더 선명).
  const onDark = strong && color === "blue";
  return (
    <div className="flex-1 h-6 bg-a-parchment/50 rounded relative overflow-hidden">
      {v.measured > 0 && <div className={`h-full rounded ${fill}`} style={{ width: `${pct}%` }} />}
      {/* 소재는 있는데 실측이 하나도 없으면 합계 0이 아니라 '—'. 0으로 쓰면 미수집·미입력이 실제 0으로 읽힌다. */}
      <span className={`absolute inset-y-0 right-2 flex items-center text-[12.5px] tabular-nums ${onDark ? "text-white font-bold" : "text-a-ink font-semibold"}`}>
        {v.measured > 0 ? v.total.toLocaleString() : "—"}
      </span>
    </div>
  );
}

function MetaCell({ count, cost, unit, bestCost }: { count: number; cost: number | null; unit: string; bestCost: boolean }) {
  if (count === 0) return <span className="w-[92px] text-right text-[11px] text-a-ink-muted">—</span>;
  return (
    <span className="w-[92px] text-right tabular-nums text-[11px] text-a-ink-muted whitespace-nowrap">
      {count}개{cost != null && (
        <>
          {" · "}
          <span className={bestCost ? "text-green-600 font-bold" : ""} title={`비용 ÷ 누적${unit === "회" ? " 조회수" : " 도달수"} · 낮을수록 효율적`}>
            {cost.toFixed(1)}원
          </span>
        </>
      )}
    </span>
  );
}

export default function CompanyPanel({ data }: { data: CompanyData }) {
  const totalN = data.reduce((s, d) => s + d.video.count + d.banner.count, 0);
  const maxVideo = Math.max(0, ...data.filter(d => d.video.measured > 0).map(d => d.video.total));
  const maxBanner = Math.max(0, ...data.filter(d => d.banner.measured > 0).map(d => d.banner.total));
  const cpvVals = data.filter(d => d.video.measured > 0 && d.video.cpv != null).map(d => d.video.cpv as number);
  const cprVals = data.filter(d => d.banner.measured > 0 && d.banner.cpr != null).map(d => d.banner.cpr as number);
  const bestCpv = cpvVals.length ? Math.min(...cpvVals) : null;
  const bestCpr = cprVals.length ? Math.min(...cprVals) : null;
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-base font-semibold text-a-ink">
          업체별 성과 <span className="font-normal text-a-ink-muted text-[13px]">· 누적 총합 — 영상=조회수 / 배너=도달수</span>
        </p>
        <span className="text-[12px] text-a-ink-muted whitespace-nowrap flex-shrink-0">소재 {totalN}개</span>
      </div>
      <p className="text-[12px] text-a-ink-muted mb-3 leading-relaxed">
        업체별 <b className="text-a-ink">전체 소재의 누적 합계</b>. CPV/CPR = Σ비용÷Σ누적(대시보드 조회당비용과 동일 기준. CPR=도달당비용). 날짜 필터를 걸면 그 범위 말일 기준 누적.
      </p>
      {totalN === 0 ? (
        <div className="text-sm text-a-ink-muted py-6 text-center">표본 없음 — 업체명 있는 바이럴 소재가 필요합니다.</div>
      ) : (
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 px-1 pb-1.5 border-b border-a-hairline text-[11px] font-semibold text-a-ink-muted">
            <span className="w-20">업체</span>
            <span className="flex-1">영상 · 조회수 증분</span>
            <span className="w-[92px] text-right">개수 · CPV</span>
            <span className="flex-1">배너 · 누적 도달수</span>
            <span className="w-[92px] text-right">개수 · CPR</span>
          </div>
          <div className="divide-y divide-a-divider">
            {data.map((d) => {
              const isBestVideo = d.video.measured > 0 && d.video.total === maxVideo && maxVideo > 0;
              const isBestBanner = d.banner.measured > 0 && d.banner.total === maxBanner && maxBanner > 0;
              return (
                <div key={d.company} className="relative group flex items-center gap-3 px-1 py-1.5 hover:bg-a-parchment/40">
                  {/* 오른쪽 패널이라 right-0. 이 메모는 영상·배너 두 섹션이라 요일별(238px)보다 훨씬 높아
                      (실측 365px) 아래로 열면 카드(overflow-hidden) 밖으로 잘린다 — 항상 위로 연다.
                      패널 위에는 항상 차트가 있어(차트를 접으면 패널도 함께 숨음) 위쪽 공간은 확보돼 있다. */}
                  <TopPostsMemo heading={`${d.company} · 성과 상위`} align="right" openUp
                    sections={[
                      { label: "영상 · 누적 조회수", unit: "회", costLabel: "CPV", memo: d.videoTop },
                      { label: "배너 · 누적 도달수", unit: "", costLabel: "CPR", memo: d.bannerTop },
                    ]} />
                  <span className={`w-20 text-[13px] font-bold truncate ${isBestVideo || isBestBanner ? "text-a-blue" : "text-a-ink"}`} title={d.company}>{d.company}</span>
                  <BarCell v={d.video} max={maxVideo} strong={isBestVideo} color="blue" />
                  <MetaCell count={d.video.count} cost={d.video.cpv} unit="회" bestCost={d.video.measured > 0 && d.video.cpv != null && d.video.cpv === bestCpv} />
                  <BarCell v={d.banner} max={maxBanner} strong={isBestBanner} color="amber" />
                  <MetaCell count={d.banner.count} cost={d.banner.cpr} unit="도달" bestCost={d.banner.measured > 0 && d.banner.cpr != null && d.banner.cpr === bestCpr} />
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-a-ink-muted mt-2 px-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-a-blue align-middle mr-0.5" /> 영상 ·
            <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 align-middle mx-0.5" /> 배너 (진한 막대 = 유형별 최대 누적) ·
            <span className="text-green-600 font-semibold"> 녹색</span> = 최저 CPV/CPR(가장 효율적) · 배너 도달수 = 입력값 우선, 없으면 조회수×0.8 · <b className="text-a-ink">—</b> = 실측 없음(0 아님) · 행에 커서를 올리면 상위 계정
          </p>
        </div>
      )}
    </div>
  );
}
