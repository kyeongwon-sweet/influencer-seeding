"use client";
import { memo, useRef, useState } from "react";
import { CHART, weeklySum, weekLabelOf, padDomain, smoothCurvePath, NAVER_DATALAB_URL, META_ADS_MANAGER_URL } from "../lib";

function LineChart({ data, height = 160, gradId = "lcGrad", postsOnDate, lsData, secondaryData, secondaryColor = "#ea580c", extraSeries, hidePrimary, hiddenLines, smooth }: {
  data: { date: string; value: number }[];
  height?: number;
  gradId?: string;
  postsOnDate?: (date: string) => { name: string; url: string }[];
  lsData?: { date: string; ratio: number; value: number | null }[];
  secondaryData?: { date: string; value: number }[];
  secondaryColor?: string;
  extraSeries?: { name: string; color: string; group?: string; members: { label: string; data: { date: string; value: number | null }[] }[] }[];
  hidePrimary?: boolean;
  // 선(라인)만 숨길 시리즈 이름 집합("검색량"·"전체 전환 광고비"·extraSeries 이름). 데이터는 그대로 받아 툴팁엔 계속 노출.
  hiddenLines?: Set<string>;
  smooth?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [tipOtherOpen, setTipOtherOpen] = useState(false); // 툴팁 '그외' 토글
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeIdx = pinnedIdx ?? hoverIdx;
  // 주별 합계 — 모든 시리즈를 같은 주차 키로 묶어 합산(원본 prop만 교체, 이하 계산은 그대로).
  // date가 주차 키("YYYY-MM-W")로 바뀌므로 라벨/툴팁은 weekLabelOf로 표기, 시리즈 간 정렬은 그대로 키 일치.
  if (smooth) {
    data = weeklySum(data, ["value"]);
    if (lsData) lsData = weeklySum(lsData, ["ratio", "value"]);
    if (secondaryData) secondaryData = weeklySum(secondaryData, ["value"]);
    if (extraSeries) extraSeries = extraSeries.map(s => ({ ...s, members: s.members.map(m => ({ ...m, data: weeklySum(m.data, ["value"]) })) }));
  }
  if (data.length < 2) return <div className="flex items-center justify-center py-8 text-xs text-a-ink-muted">데이터 없음</div>;
  const pl = 38, pr = 18, pt = 4, pb = 30;
  const VW = 560, VH = height;
  const cw = VW - pl - pr, ch = VH - pt - pb;
  // 봉우리가 천장에 닿지 않게 상단 헤드룸 확보(12%). 하단(pb)은 x라벨 여유 위해 확대. (오버슛 클램프+overflow hidden 병행)
  const chTop = Math.round(ch * 0.12);
  const vals = data.map(d => d.value);
  const [min, max] = padDomain(Math.min(...vals), Math.max(...vals));
  const range = max - min || 1;
  const xS = (i: number) => (i / (data.length - 1)) * cw;
  const yS = (v: number) => ch - ((v - min) / range) * (ch - chTop);
  const pts: [number, number][] = data.map((d, i) => [xS(i), yS(d.value)]);
  const linePath = smoothCurvePath(pts);
  const areaPath = `${linePath} L ${xS(data.length - 1).toFixed(2)},${ch} L 0,${ch} Z`;
  const yTicks = [0, 0.5, 1].map(t => min + t * range);
  const step = Math.max(1, Math.ceil(data.length / 6));
  // 스텝 간격 라벨 + 마지막 날짜 항상 표시. 단 마지막이 직전 라벨과 너무 가까우면(겹침) 직전 것을 제거.
  const xLabelIdxs = data.map((_, i) => i).filter(i => i % step === 0);
  const lastIdx = data.length - 1;
  if (xLabelIdxs[xLabelIdxs.length - 1] !== lastIdx) {
    if (lastIdx - xLabelIdxs[xLabelIdxs.length - 1] < step * 0.6) xLabelIdxs.pop();
    xLabelIdxs.push(lastIdx);
  }
  // 틱 간격이 좁으면 만/천 반올림 시 라벨이 중복(예: 127만·127만)되므로 간격에 맞춰 소수 1자리 표시
  const yStep = range / 2;
  const fmtY = (v: number) => v >= 10000 ? `${(v / 10000).toFixed(yStep < 10000 ? 1 : 0)}만`
    : v >= 1000 ? `${(v / 1000).toFixed(yStep < 1000 ? 1 : 0)}천`
    : Math.round(v).toLocaleString();
  const cellW = cw / Math.max(1, data.length - 1);

  const hoveredDate = activeIdx !== null ? data[activeIdx].date : null;
  const hoveredPosts = hoveredDate && postsOnDate ? postsOnDate(hoveredDate) : [];

  // 라라스윗 검색량 점선 — 데이터 날짜를 주 차트에 맞춰 매핑 후 독립 정규화
  const lsPath = (() => {
    if (!lsData || lsData.length === 0) return null;
    const lsMap = new Map(lsData.map(d => [d.date, d.ratio]));
    const mapped = data.map((d, i) => ({ i, ratio: lsMap.get(d.date) ?? null })).filter(p => p.ratio !== null) as { i: number; ratio: number }[];
    if (mapped.length < 2) return null;
    const ratios = mapped.map(p => p.ratio);
    const lsMin = Math.min(...ratios), lsMax = Math.max(...ratios);
    const lsRange = lsMax - lsMin || 1;
    const lsY = (r: number) => ch - ((r - lsMin) / lsRange) * (ch - chTop);
    return mapped.map((p, j) => `${j === 0 ? "M" : "L"}${xS(p.i).toFixed(1)},${lsY(p.ratio).toFixed(1)}`).join(" ");
  })();

  const hoveredLsEntry = (() => {
    if (!lsData || activeIdx === null) return null;
    return lsData.find(d => d.date === data[activeIdx].date) ?? null;
  })();

  // 상품별 검색량 등 — 같은 group(예: 검색량 계열)은 공통 세로축(공유 max)으로 정규화해
  // 절대값이 작은 시리즈(예: 골드키위 5)가 화면을 꽉 채우는 왜곡을 방지. group 없으면 시리즈별 독립 정규화.
  const extraComputed = (() => {
    const series = extraSeries ?? [];
    // 1) 각 시리즈의 합산(summed) 값 먼저 계산
    const base = series.map(s => {
      const memberMaps = s.members.map(m => ({ label: m.label, map: new Map(m.data.map(d => [d.date, d.value])) }));
      const summed = data.map(d => {
        let sum = 0, any = false;
        for (const mm of memberMaps) { const v = mm.map.get(d.date); if (v != null) { sum += v; any = true; } }
        return { date: d.date, value: (any ? sum : null) as number | null };
      });
      return { s, memberMaps, summed };
    });
    // 2) group별 공통 도메인(그 그룹 모든 시리즈 값을 통틀어 min/max)
    const groupVals: Record<string, number[]> = {};
    for (const b of base) if (b.s.group) for (const p of b.summed) if (p.value != null) (groupVals[b.s.group] ??= []).push(p.value);
    const groupDomain: Record<string, [number, number]> = {};
    for (const g in groupVals) if (groupVals[g].length) groupDomain[g] = padDomain(Math.min(...groupVals[g]), Math.max(...groupVals[g]));
    // 3) 정규화 (group 있으면 공통 도메인, 없으면 시리즈별)
    return base.map(({ s, memberMaps, summed }) => {
      const mapped = summed.map((p, i) => ({ i, v: p.value })).filter(p => p.v !== null) as { i: number; v: number }[];
      let path: string | null = null;
      let dots: [number, number][] = [];
      if (mapped.length >= 1) {
        const vs = mapped.map(p => p.v);
        const shared = s.group ? groupDomain[s.group] : undefined;
        const rawMn = Math.min(...vs), rawMx = Math.max(...vs);
        const allEqual = !shared && rawMn === rawMx; // 단일/동일값(독립일 때만) → 중앙
        const [mn, mx] = shared ?? padDomain(rawMn, rawMx);
        const rg = mx - mn || 1;
        const y = (v: number) => allEqual ? ch / 2 : ch - ((v - mn) / rg) * (ch - chTop);
        dots = mapped.map(p => [xS(p.i), y(p.v)] as [number, number]);
        if (mapped.length >= 2) {
          path = mapped.map((p, j) => `${j === 0 ? "M" : "L"}${xS(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
        }
      }
      return { name: s.name, color: s.color, memberMaps, summed, path, dots };
    });
  })();

  // Secondary data (오른쪽 Y축)
  const secondaryPath = (() => {
    if (!secondaryData || secondaryData.length === 0) return null;
    // 날짜 정규화: YYYY-MM-DD 형식만 추출 (시간 부분 제거)
    const normalizeDate = (d: string): string => d.split('T')[0];
    const secMap = new Map(secondaryData.map(d => [normalizeDate(d.date), d.value]));
    const secVals = data.map(d => secMap.get(normalizeDate(d.date))).filter(v => v != null) as number[];
    if (secVals.length < 1) return null;
    const secMin = Math.min(...secVals), secMax = Math.max(...secVals);
    const secRange = secMax - secMin || 1;
    const secYS = (v: number) => ch - ((v - secMin) / secRange) * (ch - chTop); // 다른 선과 동일하게 상단 여유 확보(맨 위 붙어 넘침 방지)
    // secondaryData가 있는 모든 점을 포함 (필터링 안 함)
    const secPts = data.map<[number, number] | null>((d, i) => {
      const v = secMap.get(normalizeDate(d.date));
      if (v == null) return null;
      return [xS(i), secYS(v)];
    }).filter((p): p is [number, number] => p !== null);
    if (secPts.length === 0) return null;
    if (secPts.length === 1) {
      // 1개 포인트: 점 표시용 경로 (반경 2px 원)
      const [x, y] = secPts[0];
      return `M ${x} ${y - 2} A 2 2 0 0 1 ${x} ${y + 2} A 2 2 0 0 1 ${x} ${y - 2}`;
    }
    return smoothCurvePath(secPts);
  })();

  const secondaryTicks = (() => {
    if (!secondaryData || secondaryData.length === 0) return null;
    // 날짜 정규화: YYYY-MM-DD 형식만 추출 (시간 부분 제거)
    const normalizeDate = (d: string): string => d.split('T')[0];
    const secMap = new Map(secondaryData.map(d => [normalizeDate(d.date), d.value]));
    const secVals = data.map(d => secMap.get(normalizeDate(d.date))).filter(v => v != null) as number[];
    if (secVals.length === 0) return null;
    const secMin = Math.min(...secVals), secMax = Math.max(...secVals);
    const secRange = secMax - secMin || 1;
    const secYS = (v: number) => ch - ((v - secMin) / secRange) * ch;
    return [0, 0.5, 1].map(t => ({ val: secMin + t * secRange, y: secYS(secMin + t * secRange) }));
  })();

  const fmtYSecondary = (v: number) => {
    if (v >= 10000000) return `${(v / 10000000).toFixed(1)}천만`;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}백만`;
    if (v >= 10000) return `${Math.round(v / 10000)}만`;
    if (v >= 1000) return `${Math.round(v / 1000)}천`;
    return Math.round(v).toLocaleString();
  };

  const hoveredSecondaryValue = (() => {
    if (!secondaryData || activeIdx === null) return null;
    // 날짜 정규화: YYYY-MM-DD 형식만 비교
    const normalizeDate = (d: string): string => d.split('T')[0];
    const hoveredDate = normalizeDate(data[activeIdx].date);
    return secondaryData.find(d => normalizeDate(d.date) === hoveredDate)?.value ?? null;
  })();

  return (
    <div className="relative w-full">
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ overflow: "hidden", display: "block" }}
        onMouseLeave={(e) => {
          // 툴팁 위로 이동한 경우 hoverIdx 유지 (pinnedIdx가 처리)
          if (tooltipRef.current?.contains(e.relatedTarget as Node)) return;
          setHoverIdx(null);
          setPinnedIdx(null);
        }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.primary} stopOpacity="0.08" />
            <stop offset="100%" stopColor={CHART.primary} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${pl},${pt})`}>
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={0} y1={yS(tick)} x2={cw} y2={yS(tick)} stroke={CHART.grid} strokeWidth="1" strokeDasharray="4,4" />
              <text x={-6} y={yS(tick)} textAnchor="end" dominantBaseline="middle" fontSize="8" fill={CHART.axis}>{fmtY(tick)}</text>
            </g>
          ))}
          {secondaryTicks && secondaryTicks.map((tick, i) => (
            <g key={`sec-${i}`} opacity="0">
              <text x={cw + 8} y={tick.y} textAnchor="start" dominantBaseline="middle" fontSize="6" fill="#666666">{fmtYSecondary(tick.val)}</text>
            </g>
          ))}
          {!hidePrimary && <path d={areaPath} fill={`url(#${gradId})`} />}
          {lsPath && !hiddenLines?.has("검색량") && <path d={lsPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="5 3" strokeLinecap="round" />}
          {extraComputed.map((s, i) => {
            if (!s.path || hiddenLines?.has(s.name)) return null;
            const important = s.name === "B2B 발주량";
            const faint = s.name === "인스타 프로필 방문" || s.name.startsWith("유튜브");
            return (
              <path key={`extra-${i}`} d={s.path} fill="none" stroke={s.color}
                strokeWidth={important ? 2.5 : faint ? 1 : 1.5}
                opacity={important ? 1 : faint ? 0.4 : 0.85}
                strokeLinejoin="round" strokeLinecap="round" />
            );
          })}
          {extraComputed.map((s, si) => !s.path && !hiddenLines?.has(s.name) && s.dots.map((d, di) => (
            <circle key={`xdot-${si}-${di}`} cx={d[0]} cy={d[1]} r={2.2} fill={s.color} />
          )))}
          {!hidePrimary && (
            <path d={linePath} fill="none" stroke={CHART.primary} strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
          )}
          {secondaryPath && !hiddenLines?.has("전체 전환 광고비") && (
            <path d={secondaryPath} fill="none" stroke={secondaryColor} strokeWidth="1"
              strokeLinejoin="round" strokeLinecap="round" />
          )}
          {data.map((_, i) => (
            <rect key={i} x={Math.max(0, xS(i) - cellW / 2)} y={0}
              width={cellW} height={ch} fill="transparent"
              onMouseEnter={() => { setHoverIdx(i); setPinnedIdx(null); }} />
          ))}
          {activeIdx !== null && (
            <>
              <line x1={xS(activeIdx)} y1={0} x2={xS(activeIdx)} y2={ch}
                stroke={CHART.primary} strokeWidth="1" strokeDasharray="3,3" />
              {!hidePrimary && <circle cx={xS(activeIdx)} cy={yS(data[activeIdx].value)} r={3.5} fill={CHART.primary} />}
            </>
          )}
          {xLabelIdxs.map(i => (
            <text key={i} x={xS(i)} y={ch + 14} textAnchor="middle" fontSize="8" fill={CHART.axis}>
              {smooth ? weekLabelOf(data[i].date) : data[i].date.slice(5).replace("-", "/")}
            </text>
          ))}
        </g>
      </svg>
      {activeIdx !== null && (
        <div ref={tooltipRef}
          className="absolute top-1 bg-white border border-a-hairline rounded-[10px] px-3.5 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.10)] text-xs z-20 min-w-[250px] w-max whitespace-nowrap"
          style={{ left: `${Math.min(Math.max(((pl + xS(activeIdx)) / VW) * 100, 15), 85)}%`, transform: "translateX(-50%)" }}
          onMouseEnter={() => setPinnedIdx(activeIdx)}
          onMouseLeave={() => { setPinnedIdx(null); setHoverIdx(null); }}>
          {/* 1. 날짜 (검정 볼드) · 조회수 일별 증분 */}
          <p className="font-bold text-a-ink mb-1">{smooth ? weekLabelOf(data[activeIdx].date) : data[activeIdx].date.replace(/-/g, ".")} · <span className="text-a-blue tabular-nums">조회수 +{data[activeIdx].value.toLocaleString()}</span></p>
          {/* 2. 라라스윗 검색량 */}
          {hoveredLsEntry?.value != null && (
            <a href={NAVER_DATALAB_URL} target="_blank" rel="noreferrer"
              className="text-gray-500 tabular-nums hover:underline pointer-events-auto flex items-center gap-0.5">
              라라스윗 검색량: {hoveredLsEntry.value.toLocaleString()} ↗
            </a>
          )}
          {/* 3. B2B 발주량 (듬뿍바 발주량 N + 쫀득바 발주량 N) */}
          {(() => {
            const b = extraComputed.find(s => s.name === "B2B 발주량");
            if (!b) return null;
            const date = data[activeIdx].date;
            const v = b.summed.find(p => p.date === date)?.value;
            if (v == null) return null;
            return (
              <div>
                <p className="tabular-nums font-medium" style={{ color: b.color }}>B2B 발주량: {v.toLocaleString()}</p>
                <div className="pl-2">
                  {b.memberMaps.map(mm => {
                    const mv = mm.map.get(date);
                    return <p key={mm.label} className="text-[11px] text-a-ink-muted tabular-nums">· {mm.label} {mv != null ? mv.toLocaleString() : "-"}</p>;
                  })}
                </div>
              </div>
            );
          })()}
          {/* 4. 전체 전환 광고비 */}
          {hoveredSecondaryValue != null && (
            <a href={META_ADS_MANAGER_URL} target="_blank" rel="noreferrer"
              className="text-orange-600 tabular-nums hover:underline pointer-events-auto flex items-center gap-0.5">
              전체 전환 광고비: {hoveredSecondaryValue.toLocaleString()}원 ↗
            </a>
          )}
          {/* 5. 그외 (토글) — 유튜브 검색량 / 인스타 프로필 방문 / 상품별 */}
          {(() => {
            const date = data[activeIdx].date;
            const others = extraComputed.filter(s => s.name !== "B2B 발주량" && s.summed.find(p => p.date === date)?.value != null);
            if (others.length === 0) return null;
            return (
              <div className="mt-1">
                <button type="button" onClick={() => setTipOtherOpen(o => !o)}
                  className="text-a-ink-muted hover:text-a-ink pointer-events-auto flex items-center gap-1">
                  그 외 <span className="text-[11px] leading-none">{tipOtherOpen ? "▲" : "▼"}</span>
                </button>
                {tipOtherOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {others.map((s, i) => {
                      const total = s.summed.find(p => p.date === date)!.value!;
                      return (
                        <div key={`xo-${i}`}>
                          <p className="tabular-nums" style={{ color: s.color }}>{s.name}: {total.toLocaleString()}</p>
                          {s.memberMaps.length > 1 && (
                            <div className="pl-2 space-y-0.5">
                              {s.memberMaps.map(mm => {
                                const v = mm.map.get(date);
                                return <p key={mm.label} className="text-[11px] text-a-ink-muted tabular-nums">· {mm.label} {v != null ? v.toLocaleString() : "-"}</p>;
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
          {hoveredPosts.length > 0 && (
            <div className="border-t border-a-hairline pt-1.5 mt-1 space-y-0.5 max-h-24 overflow-y-auto">
              {hoveredPosts.map((p, i) => (
                <div key={i}>
                  <a href={p.url} target="_blank" rel="noreferrer"
                    className="text-a-ink font-medium pointer-events-auto hover:text-a-blue hover:underline transition-colors">
                    {p.name}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// props가 안정적이면(부모에서 memo화) 호버 등 무관한 부모 리렌더에 재계산/재렌더 안 함.
export default memo(LineChart);
