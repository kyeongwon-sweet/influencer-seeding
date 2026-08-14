"use client";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";
import { platformFromUrl, platformLabel } from "@/lib/platform";
import { parseNumInput } from "@/lib/num";
import { matchesSearch } from "@/lib/search-filter";
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
// 언급제품이 비어 있는 행을 골라내는 특수 칩 값. 실제 제품명과 절대 겹치지 않게 밑줄 표기를 쓴다
// (제품명에 그대로 저장되는 값이 아니라 필터 상태에만 들어간다).
const UNSET_PRODUCT = "__미정__";

/** 언급제품 토큰(콤마 구분, 공백 제거). 빈 값·공백만·콤마만이면 빈 배열. */
function productTokens(mentionedProduct: string | null | undefined): string[] {
  return String(mentionedProduct ?? "").split(",").map(p => p.trim()).filter(Boolean);
}

/**
 * 표에서 감추는 광고 게시물 판정. `(광고)`·`#광고`가 있으면 광고로 보되 `내돈내산`이 있으면 통과.
 * ⚠️ '미정' 칩 건수와 표의 행 수가 어긋나지 않도록 **표 필터와 칩 카운트가 같은 함수를 쓴다.**
 */
function isHiddenAd(m: { content_summary: string | null }): boolean {
  const cap = (m.content_summary ?? "").toLowerCase();
  if (cap.includes("내돈내산")) return false;
  return cap.includes("(광고)") || cap.includes("#광고");
}

/**
 * 제품 칩을 화면에 늘어놓는 **계열 순서**. 각 계열은 [대표 칩 → 그 계열 종류들] 로 붙어서 나온다.
 * ⚠️ 접미사(endsWith)로 계열을 판정하므로 **더 긴 이름이 먼저 와야 한다.**
 *    예) `요거트바`가 `쫀득바`보다 앞: 그래야 '딸기생요거트바'가 요거트바로 잡힌다.
 *    (지금 목록엔 서로 접미사 관계인 계열이 없지만, 계열을 추가할 때 이 규칙을 지킬 것)
 */
const PRODUCT_FAMILY_ORDER = ["듬뿍바", "쫀득바", "초코바", "제로바", "요거트바", "파인트", "모나카", "빵샌드"];

/** 제품이 아니라 "브랜드 자체 언급"을 뜻하는 값 — 칩 순서에서 전체·미정 다음에 둔다. */
const BRAND_PRODUCT = "라라스윗";

const PRODUCT_PARENTS = ["쫀득바", "듬뿍바", "제로바", "요거트바", "모나카"];
function parentProductOf(p: string): string | null {
  for (const parent of PRODUCT_PARENTS) if (p !== parent && p.endsWith(parent)) return parent;
  return null;
}

// 상위 제품을 고르면 함께 선택되는 하위 제품(2026-08-04 사용자 지정).
// ⚠️ 접미사 자동 매칭이 아니라 **명시 목록**이다. 이름은 같은 계열이지만 함께 묶으면 안 되는 것들이 있다:
//    초코바 ← 넛티초코바·초콜릿초코바 제외 / 듬뿍바 ← 옥수수듬뿍바 제외.
//    (감귤제로바는 아직 데이터에 없지만 생기면 바로 묶이도록 미리 넣어둔다)
// 파인트·모나카·요거트바는 사용자가 제외를 지정하지 않아 계열 전체를 넣었다(2026-08-04 DB 실측 기준).
//    ⚠️ '망고요거트파인트/복숭아요거트파인트/생요거트파인트'는 이름에 요거트가 있어도 **파인트**다.
//       요거트바 그룹에 넣지 않는다.
const PRODUCT_GROUPS: Record<string, string[]> = {
  "초코바": ["바닐라초코바", "말차초코바", "쿠키앤크림초코바"],
  "쫀득바": ["멜론쫀득바", "망고쫀득바"],
  "듬뿍바": ["딸기듬뿍바", "골드키위듬뿍바", "피치망고듬뿍바"],
  "제로바": ["자두제로바", "포도제로바", "감귤제로바", "오렌지제로바", "골드파인제로바"],
  // 2026-08-06 사용자 지시로 제품명에서 '저당' 접두어를 전부 뺐다('저당 초콜릿 파인트'→'초콜릿파인트' 등).
  // 옛 이름은 목록에 남기지 않는다 — 남겨두면 잘못된 이름을 다시 쓰게 만든다(딸기요거트바 때와 같은 이유).
  "파인트": [
    "꿀고구마파인트", "딸기파인트", "레인보우샤베트파인트", "말차파인트", "망고요거트파인트",
    "밀크티파인트", "민트초코파인트", "바닐라빈파인트", "복숭아요거트파인트", "생요거트파인트",
    "생우유파인트", "옥수수파인트", "쿠앤크파인트", "초코파인트", "초콜릿파인트", "치즈케이크파인트",
  ],
  "모나카": ["꿀고구마모나카", "생우유모나카", "옥수수모나카", "쿠앤크모나카", "초코모나카"],
  // '딸기요거트바'는 2026-08-04 사용자 지시로 DB 5건을 전부 '딸기생요거트바'로 고쳤다(정식 이름).
  // 옛 이름은 목록에서도 뺀다 — 남겨두면 잘못된 이름을 다시 쓰게 만든다.
  // '복숭아요거트바'도 2026-08-06 사용자 지시로 DB 8건을 '복숭아생요거트바'로 고쳤다(정식 이름).
  // '애플망고요거트바'는 사용자가 '생' 없이 지정한 이름이라 그대로 둔다(제품별로 다르다).
  // 2026-08-06 사용자 지시로 요거트바 계열은 '생'을 붙인 정식명으로 통일했다(애플망고 포함).
  "요거트바": ["딸기생요거트바", "블루베리생요거트바", "복숭아생요거트바", "애플망고생요거트바"],
  // 빵샌드는 상위 항목, 생우유빵샌드가 그 하위(2026-08-06 사용자 확인).
  "빵샌드": ["생우유빵샌드"],
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

type Filters = { name: string; caption: string; platform: string; products: string[]; exposureType: string; dateFrom: string; dateTo: string };
const INIT_FILTERS: Filters = { name: "", caption: "", platform: "all", products: [], exposureType: "all", dateFrom: "", dateTo: "" };

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
                      <td style={{ minWidth: colWidths[0], width: colWidths[0] }} className="px-4 py-4 text-left whitespace-nowrap overflow-hidden">
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
                      <td style={{ minWidth: colWidths[1] }} className="px-4 py-4 text-xs text-a-ink-muted text-left whitespace-nowrap"
                        onDoubleClick={() => onStartEdit(m.id, "platform", normPlatform(m.platform))}>
                        {edit?.field === "platform" ? (
                          <select autoFocus value={edit!.value}
                            onChange={e => onPatchField(m.id, "platform", e.target.value)}
                            onBlur={() => onCancelEdit()}
                            onKeyDown={e => { if (e.key === "Escape") onCancelEdit(); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5">
                            {/* 표에서도 비워둘 수 있게 — 잘못 넣은 플랫폼을 되돌릴 방법이 필요하다 */}
                            <option value="">(선택 안 함)</option>
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
                      <td style={{ minWidth: colWidths[2] }} className="px-4 py-4 text-xs text-a-ink-muted text-left max-w-[320px]">
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
                      <td style={{ minWidth: colWidths[3] }} className="px-4 py-4 text-left whitespace-nowrap">
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
                              // 추가 모달과 **같은 자동완성 목록**을 쓴다. 여기가 자유 입력으로 남아 있어서
                              // 폐기한 옛 이름(딸기요거트바)이 표 편집으로 다시 들어온 적이 있다(2026-08-06).
                              list="organic-product-names"
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
                      <td style={{ minWidth: colWidths[4] }} className="px-4 py-4 text-xs text-a-ink-muted text-left whitespace-nowrap">
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
                      <td style={{ minWidth: colWidths[6] }} className="px-4 py-4 text-left whitespace-nowrap">
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
                      <td style={{ minWidth: colWidths[7] }} className="px-4 py-4 text-left">
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
  // exposure_type: 표에서만 고칠 수 있어서 추가 직후 '미분류'로 남았다 → 추가 모달에서 바로 고르게 한다.
  // platform 기본값은 **빈 값**이다. 예전엔 "인스타그램"이 미리 박혀 있어서 유튜브·X 링크를 붙여도
  // 그대로 인스타그램으로 저장됐다(조용한 오분류). 지금은 URL로 자동 판정하고, 판정 불가면 비워둔다.
  const [addForm, setAddForm] = useState({ url: "", account_name: "", platform: "", exposure_type: "", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" });
  // 사용자가 채널 유형을 직접 고른 뒤에는 URL 자동판정이 그 선택을 덮지 않게 한다.
  const [platformPicked, setPlatformPicked] = useState(false);
  // 추가 직후 자동 보강(게시일·조회수 등)이 도는 중인지 — 표 상단에 진행 표시를 띄운다.
  const [enriching, setEnriching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: "mentioned_product" | "exposure_type" | "account_name" | "content_summary" | "uploaded_at" | "view_count" | "notes" | "platform"; value: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // '수집 대상'을 수집 목적 기준으로 바꾸면서(2026-08-14) 빠진 옛 속성 기준(대상이 누구인가)을
  // 접이식으로 함께 둔다. 기본은 접힘 — 평소엔 목적 기준만 보이게.
  const [showTargetAttrs, setShowTargetAttrs] = useState(false);
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
        exposure_type: addForm.exposure_type || null,
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
    const created = (await res.json().catch(() => null)) as { id?: string } | null;
    setAddForm({ url: "", account_name: "", platform: "", exposure_type: "", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" }); setPlatformPicked(false);
    setShowAdd(false);
    await loadMentions();
    toast("게시물이 추가됐습니다.", "success");

    // 자동 보강(게시일·채널유형·언급제품·조회수). 수집이 최대 100초라 **추가를 막지 않고** 뒤에서 돌린다.
    // 빈 칸만 채우므로 위에서 사람이 입력한 값은 그대로 남는다.
    if (created?.id) {
      setEnriching(true);
      fetch("/api/organic-mentions/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: created.id }),
      })
        .then(r => r.json())
        .then(async (out: { enriched?: boolean; patch?: Record<string, unknown>; reason?: string }) => {
          if (out?.enriched) {
            const ko: Record<string, string> = { uploaded_at: "게시일", view_count: "조회수", platform: "채널 유형", mentioned_product: "언급 제품" };
            const filled = Object.keys(out.patch ?? {}).map(k => ko[k] ?? k).join("·");
            await loadMentions();
            toast(`자동 보강 완료: ${filled}`, "success");
          } else if (out?.reason) {
            // 실패해도 게시물은 이미 등록됐다 → 조용히 넘기지 않고 사유를 알린다.
            toast(`자동 보강 못 함: ${out.reason}`, "error");
          }
        })
        .catch(() => toast("자동 보강 요청이 실패했습니다. 값은 직접 입력해 주세요.", "error"))
        .finally(() => setEnriching(false));
    }
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
      // 상위 제품(PRODUCT_GROUPS 키)은 지정된 하위 제품과 함께 켜지고 함께 꺼진다.
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
  // 캡션 검색도 타자마다 전체 재필터가 돌면 버벅이므로 계정명과 같이 지연값을 쓴다.
  const deferredCaption = useDeferredValue(filters.caption);

  const filtered = useMemo(() => mentions.filter(m => {
    if (isHiddenAd(m)) return false;

    if (!matchesSearch(m.account_name, deferredName)) return false;
    if (!matchesSearch(m.content_summary, deferredCaption)) return false;
    if (filters.platform !== "all" && normPlatform(m.platform) !== filters.platform) return false;
    if (filters.products.length > 0) {
      // 콤마로 구분된 복수 제품 지원: 선택된 제품 중 하나라도 포함되면 통과
      const mentionProds = productTokens(m.mentioned_product);
      // '미정' 칩은 언급제품이 비어 있는 행을 뜻한다(다른 제품 칩과 함께 켤 수 있다).
      const wantsUnset = filters.products.includes(UNSET_PRODUCT) && mentionProds.length === 0;
      if (!wantsUnset && !filters.products.some(fp => mentionProds.includes(fp))) return false;
    }
    if (filters.exposureType !== "all" && m.exposure_type !== filters.exposureType) return false;
    if (filters.dateFrom && (!m.uploaded_at || m.uploaded_at < filters.dateFrom)) return false;
    if (filters.dateTo && (!m.uploaded_at || m.uploaded_at > filters.dateTo)) return false;
    return true;
  }), [mentions, deferredName, deferredCaption, filters.platform, filters.products, filters.exposureType, filters.dateFrom, filters.dateTo]);

  const hasFilter = filters.name !== "" || filters.caption !== "" || filters.platform !== "all" || filters.products.length > 0 || filters.exposureType !== "all" || filters.dateFrom !== "" || filters.dateTo !== "";

  // 언급 제품 옵션 — 콤마 구분 복수 값 파싱 후 **계열별로 묶어서** 정렬한다.
  // 가나다순으로 늘어놓으면 '딸기듬뿍바'와 '듬뿍바'가 멀리 떨어져 계열이 안 보인다(사용자 요청).
  // 순서: [듬뿍바 → 듬뿍바 종류들] [파인트 → 파인트 종류들] ... 그 다음 계열 없는 것들.
  const productOptions = useMemo(() => {
    const all = Array.from(new Set(mentions.flatMap(m => productTokens(m.mentioned_product)))).sort();
    const used = new Set<string>();
    const ordered: string[] = [];
    // 브랜드 자체 언급은 특정 제품이 아니라 성격이 달라 맨 앞에 둔다.
    // 화면 순서: 전체 → 미정 → 라라스윗 → 계열들 (2026-08-05 사용자 요청)
    if (all.includes(BRAND_PRODUCT)) { ordered.push(BRAND_PRODUCT); used.add(BRAND_PRODUCT); }
    for (const family of PRODUCT_FAMILY_ORDER) {
      // 계열 대표 칩이 데이터에 있으면 먼저(없어도 하위는 묶어서 보여준다)
      if (all.includes(family)) { ordered.push(family); used.add(family); }
      for (const p of all) {
        if (!used.has(p) && p !== family && p.endsWith(family)) { ordered.push(p); used.add(p); }
      }
    }
    // 계열에 안 붙는 것들(단팥바·딸기바·치즈케이크·라라스윗 등)은 뒤에 가나다순으로
    for (const p of all) if (!used.has(p)) ordered.push(p);
    return ordered;
  }, [mentions]);

  // 언급제품이 비어 있는 게시물 수 — '미정' 칩을 **보일지 말지**에만 쓴다(건수 표기는 사용자 요청으로 제거).
  // 표에서 감추는 광고 행은 빼야 "칩이 있는데 눌러도 0건" 같은 상태가 안 생긴다.
  const unsetProductCount = useMemo(
    () => mentions.filter(m => !isHiddenAd(m) && productTokens(m.mentioned_product).length === 0).length,
    [mentions],
  );

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
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [deferredName, deferredCaption, filters.platform, filters.products, filters.exposureType, filters.dateFrom, filters.dateTo, sortCol, sortDir]);
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
            {/* 정렬 화살표는 우측 정렬 열(숫자)에서 **왼쪽**에 둔다. 오른쪽에 두면 열 이름이
                숫자의 우측 끝선보다 화살표 폭만큼 밀려 "헤더와 값이 어긋나 보인다". */}
            {right && (
              <span className={`mr-1 ${active ? "text-a-blue" : "opacity-20"}`}>
                {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </span>
            )}
            {col}
            {!right && (
              <span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>
                {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </span>
            )}
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

      {/* 예전 sticky 안내 바(h-11)는 제거했다 — '사용 안내'가 기준 박스 제목 줄로 들어가서
          이 줄에 남는 게 없었다. 덕분에 세로 45px을 표에 돌려줬다. */}

      {/* 필터 + 액션 줄 — **전체 폭**으로 뺐다(2026-08-05 사용자 요청: 한 줄에 들어오게).
          실측: 한 줄에 약 938px 필요 vs 오른쪽 칸 840px → 우측 칸에 두면 항상 두 줄로 접혔다.
          전체 폭(1280px 뷰포트 기준 1232px)에서는 한 줄로 들어간다. 칩 영역도 그만큼 넓어졌다. */}
      <div className="mx-6 mt-5">
      <div className="bg-white rounded-[14px] border border-a-hairline px-3 py-2.5">
        {/* 넓은 화면에서는 한 줄, 좁아지면 액션 버튼 묶음만 아래로 접힌다(가로 스크롤로 숨기지 않는다).
            입력/날짜/버튼에 h-9(36px)를 붙여 높이를 통일한다. 원래는 filter-input 30px,
            date 32px(네이티브 달력 아이콘 때문), filter-select 36px로 셋이 제각각이었다.
            `.filter-select`의 min-height:36px가 공용 토큰이라 그 값에 나머지를 맞췄다. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            placeholder="계정명 검색"
            title="여러 단어는 모두 포함(AND) · 제외는 -단어 (예: 딸기 -광고)"
            value={filters.name}
            onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
            className={`filter-input h-9 w-24 shrink-0 ${filters.name ? "border-a-blue" : ""}`}
          />
          {/* 캡션 검색 — 본문(content_summary) 부분일치. 계정명보다 긴 문구를 넣게 되므로 폭을 더 준다. */}
          <input
            type="text"
            placeholder="캡션 검색"
            title="여러 단어는 모두 포함(AND) · 제외는 -단어 (예: 딸기 -광고)"
            value={filters.caption}
            onChange={e => setFilters(p => ({ ...p, caption: e.target.value }))}
            className={`filter-input h-9 w-32 shrink-0 ${filters.caption ? "border-a-blue" : ""}`}
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
          {hasFilter && (
            <button onClick={() => setFilters(INIT_FILTERS)} className="btn-ghost h-9 py-0 shrink-0">초기화</button>
          )}
          <div className="flex-1 min-w-0" />
          {/* 액션 버튼 — 2026-08-04 사용자 요청으로 날짜 필터 옆(같은 줄 오른쪽)으로 내렸다.
              폭이 부족한 화면(우측 칸 940px 미만 ≈ 뷰포트 1380px 미만)에서는 이 묶음만
              아래 줄로 접힌다. 가로 스크롤로 숨기지 않는 이유는 버튼이 안 보이게 되기 때문. */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setShowUpload(true)} className="btn-secondary h-9 shrink-0">CSV 업로드</button>
            <button onClick={() => setShowAdd(true)} className="btn-secondary h-9 shrink-0">+ 게시물 추가</button>
            {/* 추가 직후 자동 보강이 최대 100초 걸릴 수 있어 진행 중임을 보여준다(조용히 도는 게 제일 나쁘다). */}
            {enriching && (
              <span className="text-[11px] text-a-ink-muted whitespace-nowrap self-center">
                게시일·조회수 자동 확인 중…
              </span>
            )}
            <button onClick={downloadCSV} disabled={filtered.length === 0} className="btn-secondary h-9 whitespace-nowrap shrink-0">
              엑셀 다운로드
            </button>
            {running && (
              <>
                <span className="text-xs text-a-ink-muted tabular-nums shrink-0">{formatElapsed(elapsedSeconds)}</span>
                <button onClick={checkJob} className="btn-secondary h-9 shrink-0">지금 확인</button>
              </>
            )}
            {/* btn-primary는 테두리가 없어 secondary보다 2px 낮다. 투명 테두리로 높이를 맞춘다. */}
            <button onClick={runCollection} disabled={running} className="btn-primary h-9 border border-transparent shrink-0">
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
        </div>
      </div>
      </div>

      {/* 상단 2단 배치 — 기준(좌) / 필터(우). 세로로 길게 쌓이던 두 박스를 나란히 놓아 표가 더 보이게 한다.
          좁은 화면(lg 미만)에서는 자동으로 위아래로 쌓인다. */}
      {/* 왼쪽 기준 박스 폭 480px(2026-08-05 사용자 요청으로 380 → 480 확대).
          실측 근거: 1920px 뷰포트에서는 380~560px 사이 어느 값이어도 **제품 칩 줄 수가 4줄로 동일**
          (스크롤 없음) → 넓혀도 공짜다. 1280px에서만 칩이 7 → 8줄로 한 줄 늘어난다(이미 스크롤 상태).
          박스 세로는 어느 폭에서도 215px 유지(줄 접힘 없음).
          ⚠️ 하한은 350px — 그보다 좁히면 목록 줄이 접혀 세로가 215→233→251px로 **오히려 커진다.**
          남는 폭은 전부 오른쪽에 주고, 오른쪽 높이는 --guide-h(=왼쪽 박스 실제 높이)로 맞춘다. */}
      {/* 상한 480 → 700 (2026-08-14): '수집 대상'이 문장형으로 바뀌어 480px에선 전 항목이 2줄로 접혔다.
          라이브 실측 — 왼쪽 최장 항목 414px + 오른쪽 블록 188px + 박스 패딩 42px + 열 간격 24px = 668px 필요.
          여유를 둬 700px. 더 줄이면 다시 2줄이 된다. */}
      <div
        className="mx-6 mt-2 mb-2 grid gap-3 items-start lg:grid-cols-[minmax(0,700px)_minmax(0,1fr)]"
        style={guideHeight ? ({ "--guide-h": `${guideHeight}px` } as CSSProperties) : undefined}
      >
      {/* 오른쪽(필터+칩) 높이에 맞춰 여백을 줄인 상태. 더 줄이려면 py/mb/leading을 한 단계씩 내리면 된다. */}
      <div ref={guideBoxRef} className="bg-white border border-gray-200 rounded-lg px-5 py-3 shadow-sm self-start">
        {/* 제목 줄 오른쪽에 '사용 안내'. 버튼(18px)이 제목 줄 높이(20px)보다 낮아 박스가 커지지 않는다. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          {/* 제목 자체가 기준 문서 링크(2026-08-06 사용자 요청). 아래 '무상노출 트래킹'과 같은 페이지다.
              📌 이모지는 링크 밑줄에서 빼서 글자만 링크로 보이게 한다. */}
          <p className="text-sm font-bold text-a-ink">
            📌{" "}
            <a
              href="https://app.notion.com/p/lalasweet/5234a6a53b354a729935799603214434"
              target="_blank"
              rel="noopener noreferrer"
              title="무상 노출 트래킹 기준 문서(노션) 열기"
              className="underline underline-offset-2 decoration-gray-400 hover:text-a-blue hover:decoration-a-blue transition"
            >
              무상 노출 기준
            </a>
          </p>
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1 text-xs text-a-ink-muted hover:text-a-ink transition shrink-0">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 9.5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="6.5" r="1" fill="currentColor"/>
            </svg>
            사용 안내
          </button>
        </div>
        {/* 참고 자료 — 제목 바로 아래. 새 탭으로 열고, 외부 링크라 noopener 지정 */}
        <div className="mb-2.5 pb-2 border-b border-gray-100 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[11px] font-semibold text-a-ink whitespace-nowrap">🔗 참고 자료:</span>
          <a
            href="https://app.notion.com/p/lalasweet/c933b344ce7f820992c58103f960faa2?v=de13b344ce7f829888a488a6780ccb99"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover whitespace-nowrap"
          >
            소스DB
          </a>
          <a
            href="https://docs.google.com/spreadsheets/d/1wiMJI3c28sLyEULN1DzV3r1ewsqim25EHJr6IDCBfYk/edit?gid=0#gid=0"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover whitespace-nowrap"
          >
            연예인 노출 모음
          </a>
          <a
            href="https://app.notion.com/p/lalasweet/25e3b344ce7f8024b683d66d10518764?v=25e3b344ce7f80b588e2000c34aa4365"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover whitespace-nowrap"
          >
            성덕모먼트
          </a>
          {/* 트래킹 기준·검색 키워드·확산 매뉴얼 + 하위에 '수동 추가 방법(인수인계)' 페이지가 달려 있다.
              ⚠️ 사용자가 준 URL의 `#3433b344…` 앵커는 **제목 없는 빈 하위 페이지**를 가리켜서 뺐다
                 (그리로 보내면 빈 화면). `?source=copy_link` 추적 파라미터도 제거. */}
          <a
            href="https://app.notion.com/p/lalasweet/5234a6a53b354a729935799603214434"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover whitespace-nowrap"
          >
            무상노출 트래킹
          </a>
          {/* 아카이브 '자연 노출 컨텐츠 리스트' — 2026-08-06 이 DB에서 181건을 적재했다(프로필 URL 35건 제외).
              뷰 파라미터(?v=)는 '전체' 뷰라 그대로 둔다(필터 걸린 뷰로 보내면 일부만 보인다). */}
          <a
            href="https://app.notion.com/p/lalasweet/297ec681a805446d9f9f378516835f62?v=97662de3fa0543559e28f5b224c0d2b7"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-a-blue underline underline-offset-2 hover:text-a-blue-hover whitespace-nowrap"
          >
            자연 노출 컨텐츠
          </a>
        </div>
        {/* 왼쪽 칸은 제 글자폭(max-content)만 쓰고 나머지를 오른쪽에 넘긴다.
            '우리가 언급된 자컨/콘텐츠에 감사댓글'이 접히면 박스 세로가 늘어나기 때문. */}
        {/* '💬 댓글 작성' 블록을 **박스 오른쪽 끝에 붙인다**(2026-08-05 사용자 요청).
            두 열을 모두 max-content로 두고 justify-between으로 벌리면, 왼쪽 블록은 왼쪽 끝에
            오른쪽 블록은 오른쪽 끝에 정렬된다(실측: 시작 x 145 → 271px, 오른쪽 여백은 박스 패딩만).
            ⚠️ 간격(gap)을 키우는 방식은 못 쓴다 — 오른쪽 열이 minmax(0,1fr)이면 간격을 늘려도
               블록 내부 텍스트는 좌측에 붙어 있어 "붙었다"는 느낌이 안 나고, 열만 좁아진다. */}
        {/* ⚠️ 2026-08-14: 왼쪽 항목이 문장형으로 길어져 `max-content`(줄바꿈 없음)로 두면
            박스를 가로로 밀어낸다. 왼쪽만 minmax(0,1fr)로 바꿔 남는 폭 안에서 접히게 하고,
            오른쪽은 max-content 유지 → 위 주석의 '오른쪽 끝에 붙인다' 요건은 그대로 지켜진다. */}
        <div className="grid grid-cols-[minmax(0,1fr)_max-content] justify-between gap-6">
          <div>
            <p className="text-[12px] font-semibold text-a-ink mb-1.5">✓ 수집 대상:</p>
            {/* 2026-08-14 사용자 요청으로 교체 — 기존 '아이돌/연예인·50만+ 인플루언서·50만+ 뷰·시딩 건'(대상 속성)에서
                '무엇을 얻으려 보는가'(수집 목적) 기준으로 바꿨다. 항목이 길어 왼쪽 열 폭이 늘어난다. */}
            <ul className="text-[12px] text-a-ink-muted space-y-0.5 list-none leading-normal">
              <li>• 내부에서 시도하는 마케팅 메세지가 고객 반응 이끌어내고 있는지</li>
              <li>• 새로운 마케팅 키워드/메세지로 유효한 고객 의견 있는지</li>
              <li>• 내부에서 알아야할 것 같은 긍부정 보이스</li>
              <li>• 소재, 실체로 확보 가능한 유의미한 노출건</li>
              <li>• 유의미한 50만+ 이상 조회, 참여수</li>
            </ul>
            {/* 옛 속성 기준(누구를 보는가) — 목적 기준과 성격이 달라 접이식으로 분리. */}
            <button
              type="button"
              onClick={() => setShowTargetAttrs(v => !v)}
              aria-expanded={showTargetAttrs}
              className="mt-1.5 flex items-center gap-1 text-[11px] text-a-ink-muted hover:text-a-ink transition"
            >
              <span className={`inline-block transition-transform ${showTargetAttrs ? "rotate-90" : ""}`}>▸</span>
              대상 속성 기준
            </button>
            {showTargetAttrs && (
              <ul className="mt-1 ml-3 text-[12px] text-a-ink-muted space-y-0.5 list-none leading-normal">
                <li>• 아이돌/연예인</li>
                <li>• 50만+ 인플루언서</li>
                <li>• 50만+ 뷰</li>
                <li>• 시딩 건</li>
              </ul>
            )}
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

        {/* 오른쪽 칸 = 제품 칩만(필터 줄은 위에서 전체 폭으로 뺐다).
            높이를 왼쪽 기준 박스와 똑같이 고정하고, 넘치는 칩은 카드 안에서 스크롤한다.
            (--guide-h가 아직 없으면 h가 무효라 자동 높이 → 첫 페인트에도 깨지지 않는다) */}
        <div className="flex flex-col gap-1.5 lg:h-[var(--guide-h)]">
        {/* 언급 제품 필터 */}
        {(productOptions.length > 0 || unsetProductCount > 0) && (
          <div
            className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 lg:flex-1 lg:min-h-0 lg:overflow-y-auto"
            onClick={e => {
              // 칩이 아닌 빈 공간(카드 여백·칩 사이 간격·아래 남는 영역)을 누르면 제품 선택을 초기화한다.
              // closest("button")로 판정하므로 칩 안쪽을 눌렀을 때만 통과시킨다(칩 토글과 충돌 없음).
              if ((e.target as HTMLElement).closest("button")) return;
              // 칩이 많아 이 카드는 세로 스크롤된다 → 스크롤바를 누른 클릭은 초기화로 보지 않는다.
              // clientWidth는 스크롤바를 뺀 너비라, 그보다 오른쪽이면 스크롤바 위다.
              const box = e.currentTarget;
              if (e.clientX - box.getBoundingClientRect().left > box.clientWidth) return;
              // 이미 비어 있으면 같은 객체를 돌려 불필요한 재렌더를 막는다.
              setFilters(prev => (prev.products.length === 0 ? prev : { ...prev, products: [] }));
            }}
          >
            <div className="flex items-start gap-2.5">
              <div className="flex flex-wrap gap-1.5 flex-1">
                <button
                  onClick={() => setFilters(prev => ({ ...prev, products: [] }))}
                  className={`text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap shrink-0 transition ${
                    filters.products.length === 0
                      ? "border-a-blue bg-blue-50 text-a-blue font-medium"
                      : "border-a-hairline text-a-ink-muted hover:border-gray-400 hover:text-a-ink"
                  }`}
                >
                  전체
                </button>
                {/* 미정 — 언급제품이 비어 있는 행. 건수 표기는 2026-08-05 사용자 요청으로 뺐다
                    (unsetProductCount는 칩을 보일지 말지 판단에만 쓴다).
                    비어 있는 행이 없으면 칩 자체를 숨긴다(누를 이유가 없다). */}
                {unsetProductCount > 0 && (
                  <button
                    onClick={() => toggleProduct(UNSET_PRODUCT)}
                    title="언급제품을 아직 입력하지 않은 게시물"
                    className={`text-[11px] px-2.5 py-1 rounded-full border border-dashed whitespace-nowrap shrink-0 transition ${
                      filters.products.includes(UNSET_PRODUCT)
                        ? "border-a-blue bg-blue-50 text-a-blue font-medium"
                        : "border-gray-300 text-a-ink-muted hover:border-gray-400 hover:text-a-ink"
                    }`}
                  >
                    미정
                  </button>
                )}
                {productOptions.map(p => {
                  const active = filters.products.includes(p);
                  return (
                    <button key={p}
                      onClick={() => toggleProduct(p)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap shrink-0 transition ${
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
        {/* 액션 버튼은 위 필터 줄(날짜 필터 옆)로 옮겼다. 여기엔 표만 남는다. */}
        {/* 테이블 */}
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          {/* scrollbar-inset: 바깥 박스의 rounded-[18px]가 스크롤바 양 끝을 잘라먹어서
              트랙을 8px 들여놓는다(globals.css). */}
          <div ref={scrollBoxRef} className="scrollbar-inset overflow-auto max-h-[calc(100vh-120px)]">
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

      {/* 언급 제품 자동완성 후보 — 추가 모달과 표 셀 편집기가 **둘 다** 이걸 참조한다.
          ⚠️ 모달 안에 두면 모달이 닫힐 때 DOM에서 사라져 표 편집에선 조용히 동작하지 않는다.
          그래서 항상 렌더되는 위치에 둔다. 표기 난립(크림롤/생크림롤·딸기요거트바 재발) 방지용. */}
      <datalist id="organic-product-names">
        {productOptions.map(p => <option key={p} value={p} />)}
      </datalist>

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[440px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-4">게시물 추가</h2>
            <div className="space-y-3">
              <input placeholder="게시물 URL (필수)" value={addForm.url}
                onChange={e => {
                  const url = e.target.value;
                  // 링크를 붙이는 순간 채널 유형을 자동 판정한다(직접 고른 뒤에는 덮지 않는다).
                  setAddForm(p => ({ ...p, url, platform: platformPicked ? p.platform : (platformFromUrl(url) ?? "") }));
                }}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              <div className="flex gap-2">
                {/* 채널 유형(플랫폼) — **비워둘 수 있다.** 링크로 플랫폼이 판정되는 건 골라 넣고,
                    커뮤니티·오프라인처럼 판정이 어려운 건 아예 선택하지 않는다(2026-08-05 사용자 규칙).
                    ⚠️ DB 컬럼이 NOT NULL이라 null은 못 넣는다 → 미선택은 빈 문자열로 저장한다(실측 확인). */}
                {/* ⚠️ min-w-0 필수. flex 자식은 기본 min-width:auto라서 **옵션 텍스트보다 좁아지지 못한다**.
                    긴 안내문("채널 유형 선택 (판정 어려우면 비움)" = 247px)이 select의 최소폭을 밀어올려
                    옆 계정명 칸이 카드 밖으로 54px 튀어나왔다(실측). 안내문도 짧게 줄이고 title로 옮긴다. */}
                <select value={addForm.platform}
                  title="게시물 링크로 플랫폼이 판정되면 자동 선택됩니다. 판정이 어려우면 비워두세요."
                  onChange={e => { setPlatformPicked(true); setAddForm(p => ({ ...p, platform: e.target.value })); }}
                  className={`flex-1 min-w-0 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:border-a-blue transition ${addForm.platform ? "text-a-ink" : "text-a-ink-muted"}`}>
                  <option value="">채널 유형 선택</option>
                  {PLATFORMS.map(pl => <option key={pl} value={pl}>{pl}</option>)}
                </select>
                <input placeholder="계정명" value={addForm.account_name}
                  onChange={e => setAddForm(p => ({ ...p, account_name: e.target.value }))}
                  className="flex-1 min-w-0 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              </div>
              {/* 유형 — 비워두면 '미분류'로 들어가고 표에서 나중에 고칠 수 있다(값을 임의로 정하지 않는다). */}
              <select value={addForm.exposure_type}
                onChange={e => setAddForm(p => ({ ...p, exposure_type: e.target.value }))}
                className={`w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm focus:outline-none focus:border-a-blue transition ${addForm.exposure_type ? "text-a-ink" : "text-a-ink-muted"}`}>
                <option value="">유형 선택 (비우면 미분류)</option>
                <option value="무가시딩">무가시딩</option>
                <option value="오가닉">오가닉 노출</option>
                <option value="연예인 언급">연예인 언급</option>
              </select>
              <textarea placeholder="내용 요약" value={addForm.content_summary}
                onChange={e => setAddForm(p => ({ ...p, content_summary: e.target.value }))}
                rows={2}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition resize-none" />
              {/* 언급 제품 — 기존에 쓰인 이름을 자동완성으로 띄운다. 자유 입력이라 표기가 난립하면
                  칩이 둘로 쪼개진다(크림롤/생크림롤·'저당' 사고). 새 제품은 그대로 타이핑 가능. */}
              <input placeholder="언급 제품 (쉼표로 여러 개, 기존 이름 자동완성)" list="organic-product-names"
                value={addForm.mentioned_product}
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
                  {/* 실측이 없으면 비워둔다(0을 넣으면 '측정했더니 0'과 구분이 안 된다 — 절대 규칙). */}
                  <input type="number" placeholder="비우면 미측정" value={addForm.view_count}
                    onChange={e => setAddForm(p => ({ ...p, view_count: e.target.value }))}
                    className="w-full border border-a-hairline rounded-[10px] px-3 py-2 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setAddForm({ url: "", account_name: "", platform: "", exposure_type: "", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" }); setPlatformPicked(false); }}
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



