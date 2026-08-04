"use client";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";
import { platformLabel } from "@/lib/platform";
import { parseNumInput } from "@/lib/num";
import { maxDateKST, isValidEntryDate } from "@/lib/dateRule";

const PLATFORMS = ["인스타그램", "유튜브", "블로그", "틱톡", "스레드", "트위터"];

// DB에 영문으로 저장된 플랫폼값 → 한글 정규화
const PLATFORM_KO: Record<string, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  blog: "블로그",
  tiktok: "틱톡",
  threads: "스레드",
  twitter: "트위터",
  x: "트위터",
};
function normPlatform(p: string): string {
  return PLATFORM_KO[p.toLowerCase()] ?? p;
}

// 제품 상위 라인 — 변형(예: 멜론쫀득바) 선택 시 상위(쫀득바)도 함께 선택되게 한다.
const PRODUCT_PARENTS = ["쫀득바", "듬뿍바", "제로바", "요거트바", "모나카"];
function parentProductOf(p: string): string | null {
  for (const parent of PRODUCT_PARENTS) if (p !== parent && p.endsWith(parent)) return parent;
  return null;
}

// 상위 제품을 고르면 함께 선택되는 하위 제품(2026-08-04 사용자 지정).
// ⚠️ 접미사 자동 매칭이 아니라 **명시 목록**이다. 이름은 같은 계열이지만 함께 묶으면 안 되는 것들이 있다:
//    초코바 ← 넛티초코바·초콜릿초코바 제외 / 듬뿍바 ← 옥수수듬뿍바 제외.
//    (감귤제로바는 아직 데이터에 없지만 생기면 바로 묶이도록 미리 넣어둔다)
const PRODUCT_GROUPS: Record<string, string[]> = {
  "초코바": ["바닐라초코바", "말차초코바", "쿠키앤크림초코바"],
  "쫀득바": ["멜론쫀득바", "망고쫀득바"],
  "듬뿍바": ["딸기듬뿍바", "골드키위듬뿍바", "피치망고듬뿍바"],
  "제로바": ["자두제로바", "포도제로바", "감귤제로바", "오렌지제로바", "골드파인제로바"],
};

type Mention = {
  id: string;
  url: string;
  account_name: string | null;
  platform: string;
  content_summary: string | null;
  mentioned_product: string | null;
  uploaded_at: string | null;
  view_count: number | null;
  exposure_type: string | null;
  notes: string | null;
  thumbnail_url: string | null;
  created_at: string;
};

type Filters = { name: string; platform: string; products: string[]; exposureType: string; dateFrom: string; dateTo: string };
const INIT_FILTERS: Filters = { name: "", platform: "all", products: [], exposureType: "all", dateFrom: "", dateTo: "" };

type CsvRow = {
  platform: string; url: string; account_name: string | null;
  content_summary: string | null; mentioned_product: string | null;
  uploaded_at: string | null; view_count: number | null;
};

// [사용자이름, 플랫폼, 캡션, 언급제품, 업로드일, 조회수, 유형, 특이사항]
const INIT_COL_WIDTHS = [180, 90, 300, 160, 100, 90, 90, 160];

// 한 번에 그리는 행 수 = 첫 요청으로 받아오는 행 수. 화면·네트워크 양쪽의 첫 부담을 같이 줄인다.
const PAGE_SIZE = 100;

function getThumbnailUrl(url: string): string | null {
  let m = url.match(/youtube\.com\/shorts\/([^/?&#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/[?&]v=([^&]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/youtu\.be\/([^/?#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  return null;
}

function formatTimestamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // KST 고정
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return d.slice(0, 10).replace(/-/g, ".");
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

// 업로드일 유효 범위 — 공용 규칙(lib/dateRule)과 동일해 로컬 중복 제거, alias만 유지
const maxUploadDate = maxDateKST;
const isValidUploadDate = isValidEntryDate;


type EditField = "mentioned_product" | "exposure_type" | "account_name" | "content_summary" | "uploaded_at" | "view_count" | "notes" | "platform";

type MentionRowProps = {
  m: Mention;
  colWidths: number[];
  /** 이 행이 편집 중일 때만 값이 있다. 다른 행의 편집은 이 행을 다시 그리지 않는다. */
  edit: { field: EditField; value: string } | null;
  // ⚠️ 아래 콜백은 부모에서 **한 번 만들어 재사용**해야 한다(매 렌더 새 화살표 함수를 넘기면 memo가 무력화됨).
  //    그래서 행 id를 인자로 받는 형태로 둔다.
  onStartEdit: (id: string, field: EditField, value: string) => void;
  onEditValue: (value: string) => void;
  onCancelEdit: () => void;
  onPatchField: (id: string, field: EditField, value: string) => void;
  onPatchProduct: (id: string, value: string) => void;
  onDelete: (id: string) => void;
};

// 행을 memo로 감싸 셀 하나를 편집할 때 나머지 행이 다시 그려지지 않게 한다.
// (100행 × 셀 8개 + 아이콘들 = 편집 중 타자마다 수천 개 엘리먼트를 재조정하던 비용 제거)
const MentionRow = memo(function MentionRow({
  m, colWidths, edit, onStartEdit, onEditValue, onCancelEdit, onPatchField, onPatchProduct, onDelete,
}: MentionRowProps) {
  const thumb = m.thumbnail_url || getThumbnailUrl(m.url);
  const platformShort = platformLabel(m.platform);
  return (
                    <tr key={m.id} className="group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_57px]">
                      {/* 썸네일 */}
                      <td className="px-2 py-2 w-16">
                        <a href={m.url} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">
                          {thumb
                            ? <img src={thumb} alt="" loading="lazy" decoding="async" className="w-12 h-9 object-cover rounded" />
                            : <div className="w-12 h-9 bg-a-parchment rounded flex items-center justify-center text-[10px] text-a-ink-muted font-medium">{platformShort}</div>
                          }
                        </a>
                      </td>
                      <td style={{ minWidth: colWidths[0], width: colWidths[0] }} className="px-4 py-4 whitespace-nowrap overflow-hidden">
                        {edit?.field === "account_name" ? (
                          <input autoFocus value={edit!.value}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "account_name", edit!.value)}
                            onKeyDown={e => { if (e.key === "Enter") onPatchField(m.id, "account_name", edit!.value); if (e.key === "Escape") onCancelEdit(); }}
                            className="w-full text-sm font-medium bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <a href={m.url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium hover:text-a-blue transition-colors group/link">
                              {m.account_name ?? <span className="text-a-ink-muted text-xs">링크</span>}
                              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="opacity-0 group-hover/link:opacity-50 flex-shrink-0 transition-opacity">
                                <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </a>
                            <button onClick={() => onStartEdit(m.id, "account_name", m.account_name ?? "")}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[1] }} className="px-4 py-4 text-xs text-a-ink-muted whitespace-nowrap"
                        onDoubleClick={() => onStartEdit(m.id, "platform", normPlatform(m.platform))}>
                        {edit?.field === "platform" ? (
                          <select autoFocus value={edit!.value}
                            onChange={e => onPatchField(m.id, "platform", e.target.value)}
                            onBlur={() => onCancelEdit()}
                            onKeyDown={e => { if (e.key === "Escape") onCancelEdit(); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5">
                            {!PLATFORMS.includes(normPlatform(m.platform)) && m.platform && (
                              <option value={m.platform}>{platformLabel(m.platform)}</option>
                            )}
                            {PLATFORMS.map(pl => <option key={pl} value={pl}>{pl}</option>)}
                          </select>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span>{platformLabel(m.platform)}</span>
                            <button onClick={() => onStartEdit(m.id, "platform", normPlatform(m.platform))}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="플랫폼 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[2] }} className="px-4 py-4 text-xs text-a-ink-muted max-w-[320px]">
                        {edit?.field === "content_summary" ? (
                          <textarea autoFocus value={edit!.value}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "content_summary", edit!.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onPatchField(m.id, "content_summary", edit!.value); } if (e.key === "Escape") onCancelEdit(); }}
                            rows={2}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 resize-none leading-relaxed" />
                        ) : (
                          <div className="flex items-start gap-1 cursor-text" onDoubleClick={() => onStartEdit(m.id, "content_summary", m.content_summary ?? "")}>
                            <span className="line-clamp-2 leading-relaxed flex-1">{m.content_summary ?? "-"}</span>
                            <button onClick={() => onStartEdit(m.id, "content_summary", m.content_summary ?? "")}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0 mt-0.5" title="내용 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[3] }} className="px-4 py-4 whitespace-nowrap">
                        {edit?.field === "mentioned_product" ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={edit!.value}
                              onChange={e => onEditValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") onPatchProduct(m.id, edit!.value);
                                if (e.key === "Escape") onCancelEdit();
                              }}
                              placeholder="쉼표로 구분해 복수 입력"
                              className="flex-1 text-xs bg-transparent border-b border-a-blue outline-none py-0.5 min-w-0"
                            />
                            <button onClick={() => onPatchProduct(m.id, edit!.value)}
                              className="text-a-blue hover:text-a-blue-hover flex-shrink-0 transition" title="저장">
                              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                                <path d="M4 10l5 5 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button onClick={() => onCancelEdit()}
                              className="text-a-ink-muted hover:text-a-ink flex-shrink-0 transition" title="취소">
                              <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
                                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span
                            onClick={() => onStartEdit(m.id, "mentioned_product", m.mentioned_product ?? "")}
                            className="flex flex-wrap gap-1 cursor-text">
                            {m.mentioned_product
                              ? m.mentioned_product.split(",").map(p => p.trim()).filter(Boolean).map(p => (
                                  <span key={p} className="text-xs bg-a-parchment px-2 py-0.5 rounded-full text-a-ink hover:text-a-blue transition-colors">{p}</span>
                                ))
                              : <span className="text-xs text-gray-300">클릭해서 입력</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[4] }} className="px-4 py-4 text-xs text-a-ink-muted whitespace-nowrap">
                        {edit?.field === "uploaded_at" ? (
                          <input autoFocus type="date" value={edit!.value} min="2020-01-01" max={maxUploadDate()}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "uploaded_at", edit!.value)}
                            onKeyDown={e => { if (e.key === "Enter") onPatchField(m.id, "uploaded_at", edit!.value); if (e.key === "Escape") onCancelEdit(); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1 cursor-text" onDoubleClick={() => onStartEdit(m.id, "uploaded_at", m.uploaded_at?.slice(0, 10) ?? "")}>
                            <span>{formatDate(m.uploaded_at)}</span>
                            <button onClick={() => onStartEdit(m.id, "uploaded_at", m.uploaded_at?.slice(0, 10) ?? "")}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="업로드일 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[5] }} className="px-4 py-4 text-xs text-right tabular-nums whitespace-nowrap text-a-ink">
                        {edit?.field === "view_count" ? (
                          <input autoFocus type="number" value={edit!.value}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "view_count", edit!.value)}
                            onKeyDown={e => { if (e.key === "Enter") onPatchField(m.id, "view_count", edit!.value); if (e.key === "Escape") onCancelEdit(); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <div className="flex items-center justify-end gap-1 cursor-text" onDoubleClick={() => onStartEdit(m.id, "view_count", m.view_count != null ? String(m.view_count) : "")}>
                            <button onClick={() => onStartEdit(m.id, "view_count", m.view_count != null ? String(m.view_count) : "")}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="조회수 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            {m.view_count != null ? m.view_count.toLocaleString() : <span className="text-gray-300">-</span>}
                          </div>
                        )}
                      </td>
                      {/* 유형 */}
                      <td style={{ minWidth: colWidths[6] }} className="px-4 py-4 whitespace-nowrap">
                        {edit?.field === "exposure_type" ? (
                          <select autoFocus value={edit!.value}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "exposure_type", edit!.value)}
                            onKeyDown={e => { if (e.key === "Enter") onPatchField(m.id, "exposure_type", edit!.value); if (e.key === "Escape") onCancelEdit(); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5 w-full">
                            <option value="">-</option>
                            <option value="무가시딩">무가시딩</option>
                            <option value="오가닉">오가닉</option>
                            <option value="연예인 언급">연예인 언급</option>
                          </select>
                        ) : (
                          <span
                            onClick={() => onStartEdit(m.id, "exposure_type", m.exposure_type ?? "")}
                            className={`text-xs cursor-text ${m.exposure_type ? "bg-a-parchment px-2 py-0.5 rounded-full text-a-ink" : "text-gray-300"}`}>
                            {m.exposure_type ?? "클릭"}
                          </span>
                        )}
                      </td>
                      {/* 특이사항 */}
                      <td style={{ minWidth: colWidths[7] }} className="px-4 py-4">
                        {edit?.field === "notes" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={edit!.value}
                            onChange={e => onEditValue(e.target.value)}
                            onBlur={() => onPatchField(m.id, "notes", edit!.value)}
                            onKeyDown={e => { if (e.key === "Escape") onCancelEdit(); }}
                            className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                          />
                        ) : (
                          <span
                            onClick={() => onStartEdit(m.id, "notes", m.notes ?? "")}
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors line-clamp-2 block"
                          >
                            {m.notes || <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onStartEdit(m.id, "mentioned_product", m.mentioned_product ?? "")}
                            className="text-a-ink-muted hover:text-a-ink transition"
                            title="수정">
                            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                              <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button onClick={() => onDelete(m.id)}
                            className="text-a-ink-muted hover:text-red-500 text-xs transition">삭제</button>
                        </div>
                      </td>
                    </tr>
  );
});

export default function OrganicPage() {
  const { toasts, show: toast } = useToast();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colWidths, setColWidths] = useState<number[]>(INIT_COL_WIDTHS);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: "mentioned_product" | "exposure_type" | "account_name" | "content_summary" | "uploaded_at" | "view_count" | "notes" | "platform"; value: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const resizingRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 오른쪽(필터+제품 칩) 높이를 왼쪽 기준 박스와 똑같이 맞춘다.
  // 상수로 박아두면 문구를 한 줄만 고쳐도 어긋나므로 실제 높이를 관측해서 쓴다.
  useEffect(() => {
    const el = guideBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setGuideHeight(el.offsetHeight || null);
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    loadMentions().finally(() => setLoading(false));
    checkAndResumeJob();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // 첫 화면을 빨리 띄우기 위해 2단계로 받는다.
  //   1) 첫 100행(약 41KB) → 표가 바로 보인다(표는 어차피 100행만 그린다)
  //   2) 나머지(약 283KB) → 뒤이어 붙는다. 필터·정렬·제품목록·엑셀은 전량이 있어야 정확하므로 반드시 채운다.
  // 서버는 uploaded_at + id 2차 정렬이라 페이지 경계에서 누락/중복이 생기지 않는다.
  async function loadMentions() {
    const first = await fetch(`/api/organic-mentions?limit=${PAGE_SIZE}&offset=0`).then(r => r.json()).catch(() => null);
    if (Array.isArray(first)) setMentions(first);
    if (!Array.isArray(first) || first.length < PAGE_SIZE) return;   // 100행 이하면 이미 전부다

    const rest = await fetch(`/api/organic-mentions?offset=${PAGE_SIZE}`).then(r => r.json()).catch(() => null);
    if (Array.isArray(rest) && rest.length > 0) {
      setMentions(prev => {
        const seen = new Set(prev.map(m => m.id));
        return [...prev, ...(rest as Mention[]).filter(m => !seen.has(m.id))];
      });
    }
  }

  async function checkAndResumeJob() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "organic" && j.status === "running");
      if (!inProgress) return;
      runningJobIdRef.current = inProgress.id;
      setRunning(true);
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
      startPolling(Date.now());
    } catch { /* 무시 */ }
  }

  function startPolling(startTime: number) {
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - startTime >= 300_000) {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        setShowTimeoutError(true);
        return;
      }
      await checkJob();
    }, 10_000);
  }

  async function checkJob() {
    if (document.hidden) return; // 백그라운드 탭에선 /api/jobs 폴링 스킵(Vercel 호출 절감)
    try {
      const res = await fetch("/api/jobs");
      const jobs: { id: string; status: string; payload?: { added?: number }; error?: string }[] = await res.json();
      const cur = jobs.find(j => j.id === runningJobIdRef.current);
      if (cur?.status === "done") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        await loadMentions();
        toast(`수집 완료! ${cur.payload?.added ?? 0}건 추가됐습니다.`, "success");
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`수집 실패: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch { /* 폴링 오류 무시 */ }
  }

  async function runCollection() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);
    setElapsedSeconds(0);

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "organic", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      const errBody = await res.json().catch(() => null);
      toast(`수집 실행 실패 (${res.status}): ${errBody?.error ?? "알 수 없는 오류"}`, "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("무상 노출 수집이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");
    elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    startPolling(Date.now());

    // 기존 게시글 조회수 백그라운드 갱신 (fire-and-forget)
    fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "organic_refresh", payload: {} }),
    }).catch(() => {});
  }

  async function addMention() {
    if (!addForm.url) return;
    if (addForm.uploaded_at && !isValidUploadDate(addForm.uploaded_at)) {
      toast("업로드일이 올바르지 않습니다. (2020-01-01 ~ 오늘 범위로 입력)", "error");
      return;
    }
    setAdding(true);
    const res = await fetch("/api/organic-mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: addForm.url,
        account_name: addForm.account_name || null,
        platform: addForm.platform,
        content_summary: addForm.content_summary || null,
        mentioned_product: addForm.mentioned_product || null,
        uploaded_at: addForm.uploaded_at || null,
        view_count: parseNumInput(addForm.view_count),
        source: "manual",
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(`추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}`, "error");
      return;
    }
    setAddForm({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" });
    setShowAdd(false);
    await loadMentions();
    toast("게시물이 추가됐습니다.", "success");
  }

  async function deleteMention(id: string) {
    if (!confirm("게시물을 삭제하시겠습니까?")) return;
    await fetch(`/api/organic-mentions/${id}`, { method: "DELETE" });
    setMentions(prev => prev.filter(m => m.id !== id));
  }

  async function patchProduct(id: string, value: string) {
    await patchMentionField(id, "mentioned_product", value);
  }

  async function patchMentionField(id: string, field: string, value: string) {
    if (field === "uploaded_at" && value && !isValidUploadDate(value)) {
      toast("업로드일이 올바르지 않습니다. (2020-01-01 ~ 오늘 범위로 입력)", "error");
      return;
    }
    const isNumeric = field === "view_count";
    const parsed = isNumeric ? parseNumInput(value) : (value || null);
    const res = await fetch(`/api/organic-mentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    if (res.ok) {
      setMentions(prev => prev.map(m => m.id === id ? { ...m, [field]: parsed } : m));
    } else {
      const err = await res.json().catch(() => null);
      console.error("[organic PATCH 실패]", field, res.status, err);
      toast(`저장 실패 (${res.status}): ${err?.error ?? "알 수 없음"}`, "error");
    }
    setEditCell(null);
  }

  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (line[i] === ',' && !inQ) {
        result.push(cur.trim()); cur = "";
      } else cur += line[i];
    }
    result.push(cur.trim());
    return result;
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = (ev.target?.result as string) ?? "";
      const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast("데이터가 없습니다. 헤더 포함 2줄 이상 필요합니다.", "error"); return; }
      const rows: CsvRow[] = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        return {
          platform: cols[0] || "인스타그램",
          url: cols[1] ?? "",
          account_name: cols[2] || null,
          content_summary: cols[3] || null,
          mentioned_product: cols[4] || null,
          uploaded_at: isValidUploadDate(cols[5] || "") ? cols[5] : null,
          view_count: parseNumInput(cols[6]),
        };
      }).filter(r => r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "플랫폼,URL,계정명,캡션,언급제품,업로드일,조회수\n인스타그램,https://www.instagram.com/p/xxxxx/,계정명,라라스윗 언급 내용,라라스윗 아이스크림,2024-01-01,10000";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "무상노출_업로드_템플릿.csv";
    a.click();
  }

  // 노션 불러오기 버튼은 2026-08-04 사용자 요청으로 제거했다.
  // API 라우트(/api/organic-mentions/import-notion)는 남겨 뒀다 — 다시 필요하면 버튼만 되살리면 된다.

  async function uploadCsvRows() {
    if (csvRows.length === 0) return;
    setUploading(true);
    const payload = csvRows.map(r => ({ ...r, source: "csv" }));
    const res = await fetch("/api/organic-mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setUploading(false);
    if (!res.ok) { toast("업로드 중 오류가 발생했습니다.", "error"); return; }
    // 서버가 이미 등록된 링크(utm 등 파라미터 차이 포함)를 걸러내므로 실제 추가 건수로 안내한다.
    const result = await res.json().catch(() => null) as { inserted?: number; skipped?: number } | null;
    const inserted = result?.inserted ?? csvRows.length;
    const skipped = result?.skipped ?? 0;
    setCsvRows([]);
    setShowUpload(false);
    await loadMentions();
    toast(
      skipped > 0
        ? `${inserted}개 추가됐습니다. 중복 링크 ${skipped}개는 건너뛰었습니다.`
        : `${inserted}개 게시물이 추가됐습니다.`,
      "success",
    );
  }

  function downloadCSV() {
    const headers = ["계정명", "플랫폼", "URL", "캡션", "언급제품", "업로드일", "조회수"];
    const rows = sorted.map(m => [
      m.account_name ?? "",
      normPlatform(m.platform),
      m.url,
      m.content_summary ?? "",
      m.mentioned_product ?? "",
      m.uploaded_at ?? "",
      m.view_count ?? "",
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `무상노출_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    // mousemove마다 setState하면 표 전체가 매 프레임 다시 그려져 드래그가 뚝뚝 끊긴다.
    // 프레임당 1회로 합쳐서 반영한다(rAF 스로틀).
    let frame: number | null = null;
    let pendingX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      pendingX = ev.clientX;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const r = resizingRef.current;
        if (!r) return;
        const newW = Math.max(50, r.startW + pendingX - r.startX);
        setColWidths(prev => {
          if (prev[r.colIdx] === newW) return prev;   // 같은 값이면 리렌더 자체를 건너뛴다
          const next = [...prev];
          next[r.colIdx] = newW;
          return next;
        });
      });
    };
    const onUp = () => {
      resizingRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  // 제품 칩 토글 — 변형(멜론쫀득바 등) 선택 시 상위 라인(쫀득바)도 자동 포함. 변형 해제 시 같은 상위의 다른 변형이 없으면 상위도 해제.
  function toggleProduct(p: string) {
    setFilters(prev => {
      // 상위 제품(초코바·쫀득바·듬뿍바·제로바)은 지정된 하위 제품과 함께 켜지고 함께 꺼진다.
      const group = PRODUCT_GROUPS[p];
      if (group) {
        if (prev.products.includes(p)) {
          const drop = new Set([p, ...group]);
          return { ...prev, products: prev.products.filter(x => !drop.has(x)) };
        }
        const add = [p, ...group].filter(x => !prev.products.includes(x));
        return { ...prev, products: [...prev.products, ...add] };
      }

      const parent = parentProductOf(p);
      if (prev.products.includes(p)) {
        let next = prev.products.filter(x => x !== p);
        if (parent && next.includes(parent) && !next.some(x => parentProductOf(x) === parent)) {
          next = next.filter(x => x !== parent);
        }
        return { ...prev, products: next };
      }
      const next = [...prev.products, p];
      if (parent && !next.includes(parent)) next.push(parent);
      return { ...prev, products: next };
    });
  }

  // 매 렌더(검색 타이핑 등) 전체 재필터/재정렬 방지
  // 행에 넘기는 콜백은 **한 번만 만들어 재사용**한다. 매 렌더 새 화살표 함수를 넘기면
  // MentionRow의 memo가 매번 "props가 바뀌었다"고 판단해 아무 효과가 없다.
  // 실제 구현(patch/delete)은 렌더마다 새로 만들어지므로 ref로 최신 것을 가리킨다.
  const rowActionsRef = useRef({ patchMentionField, patchProduct, deleteMention });
  rowActionsRef.current = { patchMentionField, patchProduct, deleteMention };
  const rowHandlers = useMemo(() => ({
    onStartEdit: (id: string, field: EditField, value: string) => setEditCell({ id, field, value }),
    onEditValue: (value: string) => setEditCell(c => (c ? { ...c, value } : null)),
    onCancelEdit: () => setEditCell(null),
    onPatchField: (id: string, field: EditField, value: string) => rowActionsRef.current.patchMentionField(id, field, value),
    onPatchProduct: (id: string, value: string) => rowActionsRef.current.patchProduct(id, value),
    onDelete: (id: string) => rowActionsRef.current.deleteMention(id),
  }), []);

  // 검색어는 타자마다 전체 목록을 다시 거르면 입력이 버벅인다 → 지연값으로 걸러 입력 자체는 즉시 반응하게.
  const deferredName = useDeferredValue(filters.name);

  const filtered = useMemo(() => mentions.filter(m => {
    // (광고) 또는 #광고 패턴만 제외 (내돈내산 있으면 통과)
    const cap = (m.content_summary ?? '').toLowerCase();
    if (!cap.includes('내돈내산') && (cap.includes('(광고)') || cap.includes('#광고'))) return false;

    if (deferredName && !(m.account_name ?? "").toLowerCase().includes(deferredName.toLowerCase())) return false;
    if (filters.platform !== "all" && normPlatform(m.platform) !== filters.platform) return false;
    if (filters.products.length > 0) {
      // 콤마로 구분된 복수 제품 지원: 선택된 제품 중 하나라도 포함되면 통과
      const mentionProds = (m.mentioned_product ?? "").split(",").map(p => p.trim()).filter(Boolean);
      if (!filters.products.some(fp => mentionProds.includes(fp))) return false;
    }
    if (filters.exposureType !== "all" && m.exposure_type !== filters.exposureType) return false;
    if (filters.dateFrom && (!m.uploaded_at || m.uploaded_at < filters.dateFrom)) return false;
    if (filters.dateTo && (!m.uploaded_at || m.uploaded_at > filters.dateTo)) return false;
    return true;
  }), [mentions, deferredName, filters.platform, filters.products, filters.exposureType, filters.dateFrom, filters.dateTo]);

  const hasFilter = filters.name !== "" || filters.platform !== "all" || filters.products.length > 0 || filters.exposureType !== "all" || filters.dateFrom !== "" || filters.dateTo !== "";

  // 언급 제품 옵션 — 콤마 구분 복수 값 파싱
  const productOptions = useMemo(() => Array.from(
    new Set(
      mentions.flatMap(m =>
        m.mentioned_product
          ? m.mentioned_product.split(",").map(p => p.trim()).filter(Boolean)
          : []
      )
    )
  ).sort(), [mentions]);

  // 최근 업데이트 시간
  const lastUpdatedAt = useMemo(() => mentions.length > 0
    ? mentions.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at
    : null, [mentions]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (!sortCol) return 0;
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "사용자이름": av = (a.account_name ?? "").toLowerCase(); bv = (b.account_name ?? "").toLowerCase(); break;
      case "플랫폼": av = a.platform; bv = b.platform; break;
      case "언급제품": av = (a.mentioned_product ?? "").toLowerCase(); bv = (b.mentioned_product ?? "").toLowerCase(); break;
      case "업로드일": av = a.uploaded_at ?? ""; bv = b.uploaded_at ?? ""; break;
      case "조회수": av = a.view_count ?? -1; bv = b.view_count ?? -1; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  }), [filtered, sortCol, sortDir]);

  // 화면에 그릴 행 수 제한 — 700행 전부를 DOM에 올리면(행마다 셀 8개 + 수정 아이콘 여러 개)
  // 첫 렌더가 느리고, 필터·정렬·셀 편집 같은 사소한 상태 변화마다 전부 다시 그려 버벅인다.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  // 왼쪽 '무상 노출 기준' 박스의 실제 높이 → 오른쪽 칸 높이로 그대로 쓴다.
  const guideBoxRef = useRef<HTMLDivElement | null>(null);
  const [guideHeight, setGuideHeight] = useState<number | null>(null);
  // 조건이 바뀌면 처음부터 다시 보여준다(스크롤 위치와 어긋나지 않게).
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [deferredName, filters.platform, filters.products, filters.exposureType, filters.dateFrom, filters.dateTo, sortCol, sortDir]);
  const visibleRows = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);
  const hasMore = visibleCount < sorted.length;

  // 표 바닥에 닿으면 자동으로 다음 100행을 붙인다(표가 자체 스크롤 박스라 root를 그 박스로 지정).
  // rootMargin으로 조금 미리 당겨 로드해 끊기는 느낌을 줄인다.
  useEffect(() => {
    const target = sentinelRef.current;
    const root = scrollBoxRef.current;
    if (!target || !hasMore) return;
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) setVisibleCount(c => Math.min(c + PAGE_SIZE, sorted.length));
      },
      { root: root ?? null, rootMargin: "300px 0px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasMore, sorted.length, visibleCount]);

  function rsTH(col: string, colIdx: number, sortable = true, right = false) {
    const active = sortCol === col;
    return (
      <th
        key={col}
        style={{ minWidth: colWidths[colIdx] }}
        className={`relative px-4 py-3 ${right ? "text-right" : "text-left"} text-xs font-medium whitespace-nowrap bg-white select-none ${
          sortable ? (active ? "text-a-ink" : "text-gray-400") : "text-gray-400"
        }`}
      >
        {sortable ? (
          <span onClick={() => handleSort(col)} className="cursor-pointer hover:text-gray-600 transition-colors">
            {col}
            <span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>
              {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
            </span>
          </span>
        ) : col}
        <div onMouseDown={e => startResize(e, colIdx)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-100 z-10" />
      </th>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/home" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">무상 노출</span>
          {mentions.length > 0 && (
            <span className="text-gray-400 text-xs">
              {hasFilter && filtered.length !== mentions.length
                ? `${filtered.length} / ${mentions.length}건`
                : `${mentions.length}건`}
            </span>
          )}
        </div>
        {lastUpdatedAt && (
          <span className="text-xs text-a-ink-muted">
            마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastUpdatedAt)}</span>
          </span>
        )}
      </header>

      {/* 액션 버튼(CSV 업로드/게시물 추가/엑셀 다운로드/지금 수집)은 표 바로 위로 내렸다.
          여기 남은 건 '사용 안내'뿐이다. */}
      <div className="sticky top-14 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center">
        <button onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 text-xs text-a-ink-muted hover:text-a-ink transition">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 9.5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="6.5" r="1" fill="currentColor"/>
          </svg>
          사용 안내
        </button>
      </div>

      {/* 상단 2단 배치 — 기준(좌) / 필터(우). 세로로 길게 쌓이던 두 박스를 나란히 놓아 표가 더 보이게 한다.
          좁은 화면(lg 미만)에서는 자동으로 위아래로 쌓인다. */}
      {/* 왼쪽 기준 박스는 380px로 고정. 실측 하한은 350px이고 그보다 좁히면 목록 줄이 접혀
          박스 세로가 215→233→251px로 **오히려 커진다**(1280px 뷰포트, 12px 본문 기준).
          남는 폭은 전부 오른쪽에 주고, 오른쪽 높이는 --guide-h(=왼쪽 박스 실제 높이)로 맞춘다. */}
      <div
        className="mx-6 mt-5 mb-2 grid gap-3 items-start lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]"
        style={guideHeight ? ({ "--guide-h": `${guideHeight}px` } as CSSProperties) : undefined}
      >
      {/* 오른쪽(필터+칩) 높이에 맞춰 여백을 줄인 상태. 더 줄이려면 py/mb/leading을 한 단계씩 내리면 된다. */}
      <div ref={guideBoxRef} className="bg-white border border-gray-200 rounded-lg px-5 py-3 shadow-sm self-start">
        <p className="text-sm font-bold text-a-ink mb-2">📌 무상 노출 기준</p>
        {/* 참고 자료 — 제목 바로 아래. 새 탭으로 열고, 외부 링크라 noopener 지정 */}
        <div className="mb-2.5 pb-2 border-b border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[13px] font-semibold text-a-ink">🔗 참고 자료:</span>
          <a
            href="https://app.notion.com/p/lalasweet/c933b344ce7f820992c58103f960faa2?v=de13b344ce7f829888a488a6780ccb99"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover"
          >
            소스DB
          </a>
          <a
            href="https://docs.google.com/spreadsheets/d/1wiMJI3c28sLyEULN1DzV3r1ewsqim25EHJr6IDCBfYk/edit?gid=0#gid=0"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover"
          >
            연예인 노출 모음
          </a>
        </div>
        {/* 왼쪽 칸은 제 글자폭(max-content)만 쓰고 나머지를 오른쪽에 넘긴다.
            '우리가 언급된 자컨/콘텐츠에 감사댓글'이 접히면 박스 세로가 늘어나기 때문. */}
        <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-4">
          <div>
            <p className="text-[12px] font-semibold text-a-ink mb-1.5">✓ 수집 대상:</p>
            <ul className="text-[12px] text-a-ink-muted space-y-0.5 list-none leading-normal">
              <li>• 아이돌/연예인</li>
              <li>• 50만+ 인플루언서</li>
              <li>• 50만+ 뷰</li>
              <li>• 시딩 건</li>
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-a-ink mb-1.5">💬 댓글 작성:</p>
            <ul className="text-[12px] text-a-ink-muted space-y-0.5 list-none leading-normal">
              <li>• 우리가 언급된 자컨/콘텐츠에 감사댓글</li>
              <li>• 공계로 샤라웃 (태그 필수!)</li>
              <li>• 주력 인물들에게만 좋아요+답글</li>
              <li>• 귀여운 말투, 밈, 유행 센스있게</li>
              <li>• 최대한 빠르게 달기</li>
            </ul>
          </div>
        </div>
      </div>

        {/* 오른쪽 칸 = 필터(한 줄) + 그 아래 제품 칩.
            높이를 왼쪽 박스와 똑같이 고정하고, 남는 제품 칩은 칩 카드 안에서 스크롤한다.
            (--guide-h가 아직 없으면 h가 무효라 자동 높이 → 첫 페인트에도 깨지지 않는다) */}
        <div className="flex flex-col gap-1.5 lg:h-[var(--guide-h)]">
        <div className="bg-white rounded-[14px] border border-a-hairline px-3 py-2.5 shrink-0">
          {/* 한 줄 유지: 줄바꿈 금지 + 좁아지면 가로 스크롤(요소가 잘려 안 보이는 것 방지)
              입력/날짜/버튼에 h-9(36px)를 붙여 높이를 통일한다. 원래는 filter-input 30px,
              date 32px(네이티브 달력 아이콘 때문), filter-select 36px로 셋이 제각각이었다.
              `.filter-select`의 min-height:36px가 공용 토큰이라 그 값에 나머지를 맞췄다. */}
          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto">
            <input
              type="text"
              placeholder="계정명 검색"
              value={filters.name}
              onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
              className={`filter-input h-9 w-24 shrink-0 ${filters.name ? "border-a-blue" : ""}`}
            />
            <select
              value={filters.platform}
              onChange={e => setFilters(p => ({ ...p, platform: e.target.value }))}
              className={`filter-select shrink-0 ${filters.platform !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
            >
              <option value="all">전체 플랫폼</option>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {/* 유형 필터 드롭다운 */}
            <select value={filters.exposureType}
              onChange={e => setFilters(p => ({ ...p, exposureType: e.target.value }))}
              className={`filter-select shrink-0 ${filters.exposureType !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}>
              <option value="all">전체 유형</option>
              <option value="무가시딩">무가시딩</option>
              <option value="오가닉">오가닉 노출</option>
              <option value="연예인 언급">연예인 언급</option>
            </select>
            <div className="w-px h-4 bg-a-hairline mx-0.5 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <input type="date" value={filters.dateFrom}
                onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))}
                className={`filter-input h-9 px-2 w-[118px] ${filters.dateFrom ? "border-a-blue" : ""}`} />
              <span className="text-xs text-a-ink-muted">–</span>
              <input type="date" value={filters.dateTo}
                onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))}
                className={`filter-input h-9 px-2 w-[118px] ${filters.dateTo ? "border-a-blue" : ""}`} />
            </div>
            <div className="flex-1" />
            {hasFilter && (
              <button onClick={() => setFilters(INIT_FILTERS)} className="btn-ghost h-9 py-0 shrink-0">초기화</button>
            )}
          </div>
        </div>
        {/* 언급 제품 필터 — 오른쪽 칸의 필터 바로 아래 */}
        {productOptions.length > 0 && (
          <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="flex items-start gap-2.5">
              <div className="flex flex-wrap gap-1.5 flex-1">
                <button
                  onClick={() => setFilters(prev => ({ ...prev, products: [] }))}
                  className={`text-[11px] px-3 py-1 rounded-full border whitespace-nowrap shrink-0 transition ${
                    filters.products.length === 0
                      ? "border-a-blue bg-blue-50 text-a-blue font-medium"
                      : "border-a-hairline text-a-ink-muted hover:border-gray-400 hover:text-a-ink"
                  }`}
                >
                  전체
                </button>
                {productOptions.map(p => {
                  const active = filters.products.includes(p);
                  return (
                    <button key={p}
                      onClick={() => toggleProduct(p)}
                      className={`text-[11px] px-3 py-1 rounded-full border whitespace-nowrap shrink-0 transition ${
                        active
                          ? "border-a-blue bg-blue-50 text-a-blue font-medium"
                          : "border-a-hairline text-a-ink-muted hover:border-gray-400 hover:text-a-ink"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      <div className="px-6 pt-2 pb-6">
        {/* 액션 버튼 줄 — 상단 sticky 바에서 여기로 내렸다(표 바로 위, 오른쪽 정렬).
            좁은 화면에서 잘리지 않도록 넘치면 가로 스크롤한다. */}
        <div className="mb-2 flex items-center justify-end gap-1.5 overflow-x-auto">
          <button onClick={() => setShowUpload(true)} className="btn-secondary shrink-0">CSV 업로드</button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary shrink-0">+ 게시물 추가</button>
          <button onClick={downloadCSV} disabled={filtered.length === 0} className="btn-secondary whitespace-nowrap shrink-0">
            엑셀 다운로드
          </button>
          {running && (
            <>
              <span className="text-xs text-a-ink-muted tabular-nums shrink-0">{formatElapsed(elapsedSeconds)}</span>
              <button onClick={checkJob} className="btn-secondary shrink-0">지금 확인</button>
            </>
          )}
          {/* btn-primary는 테두리가 없어 secondary(30px)보다 2px 낮다. 투명 테두리로 높이를 맞춘다. */}
          <button onClick={runCollection} disabled={running} className="btn-primary border border-transparent shrink-0">
            {running ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                실행 중
              </span>
            ) : "지금 수집"}
          </button>
        </div>
        {/* 테이블 */}
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          <div ref={scrollBoxRef} className="overflow-auto max-h-[calc(100vh-120px)]">
            {loading ? (
              <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30 bg-white">
                  <tr className="border-b border-a-hairline">
                    <th className="px-2 py-3 bg-white w-16 text-[10px] font-medium text-gray-400 uppercase tracking-wider"></th>
                    {rsTH("사용자이름", 0)}
                    {rsTH("플랫폼", 1)}
                    {rsTH("캡션", 2, false)}
                    {rsTH("언급제품", 3)}
                    {rsTH("업로드일", 4)}
                    {rsTH("조회수", 5, true, true)}
                    {rsTH("유형", 6, false)}
                    {rsTH("특이사항", 7, false)}
                    <th className="px-4 py-3 bg-white w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(m => (
                    <MentionRow
                      key={m.id}
                      m={m}
                      colWidths={colWidths}
                      edit={editCell?.id === m.id ? { field: editCell.field, value: editCell.value } : null}
                      {...rowHandlers}
                    />
                  ))}
                  {mentions.length === 0 && !loading && (
                    <tr>
                      <td colSpan={10} className="px-5 py-14 text-center">
                        <p className="text-sm font-medium text-a-ink mb-1">수집된 게시물이 없습니다</p>
                        <p className="text-xs text-a-ink-muted">&apos;지금 수집&apos; 버튼으로 라라스윗 언급 게시물을 자동 수집하거나, 직접 추가할 수 있습니다.</p>
                      </td>
                    </tr>
                  )}
                  {mentions.length > 0 && filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-5 py-12 text-center">
                        <p className="text-sm text-a-ink-muted mb-2">필터 조건에 맞는 게시물이 없습니다.</p>
                        <button onClick={() => setFilters(INIT_FILTERS)} className="text-xs text-a-blue hover:underline">필터 초기화</button>
                      </td>
                    </tr>
                  )}
                  {hasMore && (
                    // 이 행이 화면에 들어오면 위 IntersectionObserver가 다음 100행을 붙인다.
                    // 관찰이 동작하지 않는 환경(구형 브라우저 등)을 대비해 수동 버튼도 남겨둔다.
                    <tr ref={sentinelRef}>
                      <td colSpan={10} className="px-5 py-4 text-center border-t border-a-hairline">
                        <span className="text-xs text-a-ink-muted mr-3 tabular-nums">
                          {visibleRows.length.toLocaleString()} / {sorted.length.toLocaleString()} 표시 중 · 스크롤하면 계속 불러옵니다
                        </span>
                        <button onClick={() => setVisibleCount(c => Math.min(c + PAGE_SIZE, sorted.length))} className="btn-ghost">
                          더 보기
                        </button>
                        <button onClick={() => setVisibleCount(sorted.length)} className="btn-ghost ml-1">
                          전체 표시
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[440px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-4">게시물 추가</h2>
            <div className="space-y-3">
              <input placeholder="게시물 URL (필수)" value={addForm.url}
                onChange={e => setAddForm(p => ({ ...p, url: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              <div className="flex gap-2">
                <select value={addForm.platform}
                  onChange={e => setAddForm(p => ({ ...p, platform: e.target.value }))}
                  className="flex-1 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm text-a-ink focus:outline-none focus:border-a-blue transition">
                  {PLATFORMS.map(pl => <option key={pl} value={pl}>{pl}</option>)}
                </select>
                <input placeholder="계정명" value={addForm.account_name}
                  onChange={e => setAddForm(p => ({ ...p, account_name: e.target.value }))}
                  className="flex-1 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              </div>
              <textarea placeholder="내용 요약" value={addForm.content_summary}
                onChange={e => setAddForm(p => ({ ...p, content_summary: e.target.value }))}
                rows={2}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition resize-none" />
              <input placeholder="언급 제품" value={addForm.mentioned_product}
                onChange={e => setAddForm(p => ({ ...p, mentioned_product: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-a-ink-muted mb-1 block">업로드일</label>
                  <input type="date" value={addForm.uploaded_at} min="2020-01-01" max={maxUploadDate()}
                    onChange={e => setAddForm(p => ({ ...p, uploaded_at: e.target.value }))}
                    className="w-full border border-a-hairline rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:border-a-blue transition" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-a-ink-muted mb-1 block">조회수</label>
                  <input type="number" placeholder="0" value={addForm.view_count}
                    onChange={e => setAddForm(p => ({ ...p, view_count: e.target.value }))}
                    className="w-full border border-a-hairline rounded-[10px] px-3 py-2 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setAddForm({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" }); }}
                className="btn-ghost">취소</button>
              <button onClick={addMention} disabled={adding || !addForm.url} className="btn-primary px-5 py-2 text-sm">
                {adding ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV 업로드 모달 */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[480px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-1">CSV 일괄 업로드</h2>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 플랫폼, URL, 계정명, 캡션, 언급제품, 업로드일, 조회수 (헤더 행 필수)</p>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={downloadTemplate}
                className="text-xs px-3.5 py-1.5 rounded-full border border-a-hairline text-a-ink-muted hover:bg-a-parchment transition">
                템플릿 다운로드
              </button>
              <label className="text-xs px-3.5 py-1.5 rounded-full border border-a-blue text-a-blue bg-blue-50 hover:bg-blue-100 transition cursor-pointer">
                파일 선택
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
              </label>
            </div>
            {csvRows.length > 0 && (
              <div className="border border-a-hairline rounded-[10px] overflow-hidden mb-4">
                <div className="px-3 py-2 bg-a-parchment/60 text-xs text-a-ink-muted border-b border-a-hairline">
                  {csvRows.length}개 행 인식됨
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-a-hairline text-a-ink-muted">
                        <th className="px-3 py-1.5 text-left font-medium">플랫폼</th>
                        <th className="px-3 py-1.5 text-left font-medium">계정명</th>
                        <th className="px-3 py-1.5 text-left font-medium">언급제품</th>
                        <th className="px-3 py-1.5 text-left font-medium">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.platform}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.account_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.mentioned_product ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-blue max-w-[160px] truncate">{r.url}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowUpload(false); setCsvRows([]); }} className="btn-ghost">취소</button>
              <button onClick={uploadCsvRows} disabled={uploading || csvRows.length === 0} className="btn-primary px-5 py-2 text-sm">
                {uploading ? "업로드 중..." : `${csvRows.length}개 등록`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 타임아웃 모달 */}
      {showTimeoutError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowTimeoutError(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-red-500 tracking-[0.1em] uppercase mb-1">시간 초과</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">수집 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 수집이 완료되지 않았습니다. 작업은 백그라운드에서 계속 실행 중입니다. 완료 후 페이지를 새로고침하면 결과를 확인할 수 있습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTimeoutError(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">닫기</button>
              <button onClick={() => { setShowTimeoutError(false); window.location.reload(); }}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover transition">새로고침</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <HelpModal title="무상 노출 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">유튜브·X(트위터)·틱톡·네이버 블로그·스레드 등에서 라라스윗을 자발적으로 언급한 게시물을 수집·관리합니다. 협찬 없이 자연 발생한 노출을 추적합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="지금 수집 —">Apify로 유튜브·X·틱톡·네이버 블로그·스레드에서 &apos;라라스윗&apos; 언급 게시물을 자동 수집합니다. (인스타그램은 검색 대신 기존 게시물의 조회수만 갱신)</HelpItem>
            <HelpItem label="CSV 업로드 —">자동 수집에서 누락된 게시물이나 수기 정리분을 CSV로 일괄 등록합니다.</HelpItem>
            <HelpItem label="+ 게시물 추가 —">게시물을 개별 수동 등록합니다.</HelpItem>
            <HelpItem label="엑셀 다운로드 —">현재 필터가 적용된 목록을 CSV로 내려받습니다.</HelpItem>
          </HelpSection>
          <HelpSection title="유형 분류">
            <p className="text-a-ink-muted leading-relaxed">각 게시물의 &apos;유형&apos; 셀을 클릭해 무가시딩·오가닉 노출·연예인 언급으로 분류할 수 있고, 상단 필터로 유형별 조회가 가능합니다.</p>
          </HelpSection>
          <HelpSection title="셀 편집">
            <p className="text-a-ink-muted leading-relaxed">계정명·캡션·언급 제품·업로드일·조회수·유형·특이사항 셀을 클릭하면 바로 수정됩니다. 언급 제품은 쉼표로 여러 개를 입력할 수 있습니다.</p>
          </HelpSection>
          <HelpSection title="열 너비 조정">
            <p className="text-a-ink-muted leading-relaxed">각 열 오른쪽 경계선을 드래그하면 너비를 자유롭게 조정할 수 있습니다.</p>
          </HelpSection>
        </HelpModal>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}



