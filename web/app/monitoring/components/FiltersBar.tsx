"use client";
// 필터 바 — monitoring/page.tsx 에서 추출.
// filters 상태/세터는 부모 소유(prop). 드롭다운 열림상태는 필터바 전용이라 내부 보관.
import { useState } from "react";
import { type Filters, INIT_FILTERS, CHANNEL_TYPES, fmtChannelType } from "../lib";
import { productCodeOf } from "@/lib/productCode";

type Props = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  pdOptions: string[];
  productOptions: string[];
  companyOptions: string[];
  hasFilter: boolean;
};

export default function FiltersBar({ filters, setFilters, pdOptions, productOptions, companyOptions, hasFilter }: Props) {
  const [showChannelTypeDropdown, setShowChannelTypeDropdown] = useState(false);
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [showPdDropdown, setShowPdDropdown] = useState(false);
  return (
    <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 mb-4 flex items-center gap-x-2.5 gap-y-1 flex-wrap">
      <input
        type="text"
        placeholder="인플루언서 검색"
        value={filters.name}
        onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
        className={`filter-input w-32 ${filters.name ? "border-a-blue" : ""}`}
      />
      <input
        type="text"
        placeholder="프로젝트명"
        value={filters.project}
        onChange={e => setFilters(p => ({ ...p, project: e.target.value }))}
        className={`filter-input w-28 ${filters.project ? "border-a-blue" : ""}`}
      />
      <input
        type="text"
        placeholder="캡션 검색"
        value={filters.caption}
        onChange={e => setFilters(p => ({ ...p, caption: e.target.value }))}
        className={`filter-input w-32 ${filters.caption ? "border-a-blue" : ""}`}
      />
      <div className="relative">
        <button
          onClick={() => setShowChannelTypeDropdown(!showChannelTypeDropdown)}
          className={`filter-select ${filters.channelTypes.length > 0 ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
        >
          {filters.channelTypes.length === 0
            ? "전체 채널 분류"
            : filters.channelTypes.length === 1
            ? fmtChannelType(filters.channelTypes[0])
            : `${fmtChannelType(filters.channelTypes[0])} 외 ${filters.channelTypes.length - 1}`
          }
        </button>
        {showChannelTypeDropdown && (
          <>
          <div className="fixed inset-0 z-40" onClick={() => setShowChannelTypeDropdown(false)} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-a-hairline rounded-[8px] shadow-lg z-50 w-48">
            <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
              <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                <input
                  type="checkbox"
                  checked={filters.channelTypes.length === 0}
                  onChange={() => {
                    setFilters(p => ({ ...p, channelTypes: [] }));
                  }}
                  className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                />
                전체
              </label>
              {CHANNEL_TYPES.map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                  <input
                    type="checkbox"
                    checked={filters.channelTypes.includes(t)}
                    onChange={e => {
                      if (e.target.checked) {
                        setFilters(p => ({ ...p, channelTypes: [...p.channelTypes, t] }));
                      } else {
                        setFilters(p => ({ ...p, channelTypes: p.channelTypes.filter(x => x !== t) }));
                      }
                    }}
                    className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                  />
                  {fmtChannelType(t)}
                </label>
              ))}
            </div>
          </div>
          </>
        )}
      </div>
      {companyOptions.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
            className={`filter-select ${filters.companies.length > 0 ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            {filters.companies.length === 0
              ? "업체명"
              : filters.companies.length === 1
              ? filters.companies[0]
              : `${filters.companies[0]} 외 ${filters.companies.length - 1}`}
          </button>
          {showCompanyDropdown && (
            <>
            <div className="fixed inset-0 z-40" onClick={() => setShowCompanyDropdown(false)} />
            <div className="absolute top-full left-0 mt-1 bg-white border border-a-hairline rounded-[8px] shadow-lg z-50 w-48">
              <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                  <input type="checkbox" checked={filters.companies.length === 0}
                    onChange={() => setFilters(p => ({ ...p, companies: [] }))}
                    className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                  전체
                </label>
                {companyOptions.map(c => (
                  <label key={c} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                    <input type="checkbox" checked={filters.companies.includes(c)}
                      onChange={e => {
                        if (e.target.checked) setFilters(p => ({ ...p, companies: [...p.companies, c] }));
                        else setFilters(p => ({ ...p, companies: p.companies.filter(x => x !== c) }));
                      }}
                      className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      )}
      {pdOptions.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowPdDropdown(!showPdDropdown)}
            className={`filter-select ${filters.pdNames.length > 0 ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            {filters.pdNames.length === 0
              ? "PD/디자이너"
              : filters.pdNames.length === 1
              ? filters.pdNames[0]
              : `${filters.pdNames[0]} 외 ${filters.pdNames.length - 1}`}
          </button>
          {showPdDropdown && (
            <>
            <div className="fixed inset-0 z-40" onClick={() => setShowPdDropdown(false)} />
            <div className="absolute top-full left-0 mt-1 bg-white border border-a-hairline rounded-[8px] shadow-lg z-50 w-48">
              <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                  <input type="checkbox" checked={filters.pdNames.length === 0}
                    onChange={() => setFilters(p => ({ ...p, pdNames: [] }))}
                    className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                  전체
                </label>
                {pdOptions.map(name => (
                  <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                    <input type="checkbox" checked={filters.pdNames.includes(name)}
                      onChange={e => {
                        if (e.target.checked) setFilters(p => ({ ...p, pdNames: [...p.pdNames, name] }));
                        else setFilters(p => ({ ...p, pdNames: p.pdNames.filter(x => x !== name) }));
                      }}
                      className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      )}
      {productOptions.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap scrollbar-none pb-0.5 flex-1 min-w-0">
          {productOptions.map(p => {
            const active = filters.products.includes(p);
            return (
              <button key={p}
                onClick={() => setFilters(prev => ({
                  ...prev,
                  products: active ? prev.products.filter(x => x !== p) : [...prev.products, p],
                }))}
                title={p}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  active ? "border-a-blue bg-blue-50 text-a-blue font-medium" : "border-a-hairline text-a-ink-muted hover:border-gray-400"
                }`}
              >{productCodeOf(p) ?? p}</button>
            );
          })}
        </div>
      )}
      {/* 강제 줄바꿈: 상품 칩까지를 1행에 두고, 날짜 필터는 항상 2행으로 내려 필터바를 2줄로 고정 */}
      <div className="basis-full h-0" aria-hidden />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-a-ink-muted whitespace-nowrap">게시일</span>
        <input type="date" value={filters.postedFrom}
          max={filters.postedTo || undefined}
          onChange={e => {
            const v = e.target.value;
            setFilters(p => ({ ...p, postedFrom: v, postedTo: p.postedTo && v > p.postedTo ? v : p.postedTo }));
          }}
          className={`filter-input ${filters.postedFrom ? "border-a-blue" : ""}`} />
        <span className="text-xs text-a-ink-muted">–</span>
        <input type="date" value={filters.postedTo}
          min={filters.postedFrom || undefined}
          onChange={e => {
            const v = e.target.value;
            setFilters(p => ({ ...p, postedTo: v, postedFrom: p.postedFrom && v < p.postedFrom ? v : p.postedFrom }));
          }}
          className={`filter-input ${filters.postedTo ? "border-a-blue" : ""}`} />
      </div>
      <div className="w-px h-4 bg-a-hairline mx-0.5" />
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-a-ink-muted whitespace-nowrap">조회수 기간</span>
        <input type="date" value={filters.dateFrom}
          max={filters.dateTo || undefined}
          onChange={e => {
            const v = e.target.value;
            setFilters(p => ({ ...p, dateFrom: v, dateTo: p.dateTo && v > p.dateTo ? v : p.dateTo }));
          }}
          className={`filter-input ${filters.dateFrom ? "border-a-blue" : ""}`} />
        <span className="text-xs text-a-ink-muted">–</span>
        <input type="date" value={filters.dateTo}
          min={filters.dateFrom || undefined}
          onChange={e => {
            const v = e.target.value;
            setFilters(p => ({ ...p, dateTo: v, dateFrom: p.dateFrom && v < p.dateFrom ? v : p.dateFrom }));
          }}
          className={`filter-input ${filters.dateTo ? "border-a-blue" : ""}`} />
        {/* 빠른 선택 버튼 — 날짜 인풋 바로 우측 */}
        {(() => {
          // KST 고정: toISOString은 UTC라 00~09시(KST)엔 날짜가 하루 밀림 → +9h 시프트 후 UTC 필드로만 계산.
          const fmt = (d: Date) => d.toISOString().slice(0, 10);
          const today = new Date(Date.now() + 9 * 60 * 60 * 1000);
          const todayStr = fmt(today);
          // 일요일(getUTCDay=0)을 7로 처리해 월요일 시작 기준 올바르게 계산
          const dayOfWeek = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
          // 주말: 가장 최근 '완료된' 금~일 (월요일에 누르면 직전 금/토/일 3일). 일요일이면 지난주 주말.
          const lastSun = new Date(today.getTime() - (today.getUTCDay() === 0 ? 7 : today.getUTCDay()) * 86400000);
          const lastFri = new Date(lastSun.getTime() - 2 * 86400000);
          // 지난달: 이번 달 1일의 전날(=지난달 말일) 기준으로 지난달 1일~말일
          const firstThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
          const lastMonthEnd = new Date(firstThisMonth.getTime() - 86400000);
          const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
          const presets = [
            { label: "전체",   from: "",          to: "" },
            // '오늘'은 수집 중이라 미완성 — 표가 전일자까지만 노출하므로 프리셋에서 제외
            // '어제/그제'는 각각 '전날~그날'(2일) — 하루만 잡으면 전일 대비 증분·트렌드가 안 나와서 그날 증분이 보이게 2일 범위로.
            { label: "어제",   from: fmt(new Date(today.getTime() - 2 * 86400000)), to: fmt(new Date(today.getTime() - 86400000)) },
            { label: "그제",   from: fmt(new Date(today.getTime() - 3 * 86400000)), to: fmt(new Date(today.getTime() - 2 * 86400000)) },
            { label: "주말",   from: fmt(lastFri), to: fmt(lastSun) },
            { label: "이번주", from: fmt(new Date(today.getTime() - (dayOfWeek - 1) * 86400000)), to: todayStr },
            { label: "지난주", from: fmt(new Date(today.getTime() - (dayOfWeek + 6) * 86400000)), to: fmt(new Date(today.getTime() - dayOfWeek * 86400000)) },
            { label: "이번달", from: `${todayStr.slice(0, 7)}-01`, to: todayStr },
            { label: "지난달", from: fmt(lastMonthStart), to: fmt(lastMonthEnd) },
          ];
          return (
            <div className="flex rounded-[10px] border border-a-hairline bg-a-parchment/60 p-0.5 gap-0.5">
              {presets.map(p => {
                const active = filters.dateFrom === p.from && filters.dateTo === p.to;
                return (
                  <button key={p.label}
                    onClick={() => setFilters(prev => active ? { ...prev, dateFrom: "", dateTo: "" } : { ...prev, dateFrom: p.from, dateTo: p.to })}
                    className={`px-3.5 py-1.5 rounded-[7px] text-xs transition whitespace-nowrap ${active ? "bg-white shadow-sm text-a-ink font-semibold" : "text-a-ink-muted hover:text-a-ink"}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          );
        })()}
        {/* 하루만 선택 시 안내 — 증분/트렌드는 '전일 대비'라 최소 2일 필요 */}
        {filters.dateFrom && filters.dateTo && filters.dateFrom === filters.dateTo && (
          <span className="text-[11px] text-amber-600 font-medium whitespace-nowrap ml-1">
            ⚠️ 하루만 선택하면 증분·트렌드가 안 나와요 — 2일 이상 선택하세요
          </span>
        )}
      </div>
      <div className="flex-1" />
      {hasFilter && (
        <button onClick={() => setFilters(INIT_FILTERS)} className="btn-ghost py-1">
          초기화
        </button>
      )}
    </div>
  );
}
