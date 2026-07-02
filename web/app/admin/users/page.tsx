"use client";
import { useEffect, useState, useCallback } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  banned: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
};

function fmtDate(ms: number | null): string {
  if (!ms) return "-";
  const d = new Date(ms + 9 * 3600 * 1000); // KST
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // 처리 중인 user id / "invite"
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users", { cache: "no-store" });
      if (r.status === 403) { setState("forbidden"); return; }
      if (!r.ok) { setState("error"); return; }
      const d = await r.json();
      setUsers(d.users ?? []);
      setState("ok");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function flash(text: string, ok: boolean) {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  }

  async function toggleBan(u: AdminUser) {
    const next = !u.banned;
    if (next && !confirm(`${u.email} 계정을 차단할까요? 차단되면 대시보드에 접근할 수 없습니다.`)) return;
    setBusy(u.id);
    try {
      const r = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setUsers(prev => prev.map(x => x.id === u.id ? { ...x, banned: next } : x)); flash(next ? "차단했습니다." : "차단을 해제했습니다.", true); }
      else flash(d.error ?? "처리에 실패했습니다.", false);
    } catch { flash("처리에 실패했습니다.", false); }
    finally { setBusy(null); }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = invite.trim().toLowerCase();
    if (!email) return;
    setBusy("invite");
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setInvite(""); flash(`${email} 로 초대를 보냈습니다.`, true); }
      else flash(d.error ?? "초대에 실패했습니다.", false);
    } catch { flash("초대에 실패했습니다.", false); }
    finally { setBusy(null); }
  }

  if (state === "loading") return <div className="p-10 text-sm text-a-ink-muted">불러오는 중…</div>;
  if (state === "forbidden") return (
    <div className="p-10">
      <h1 className="text-lg font-semibold text-a-ink">접근 권한이 없습니다</h1>
      <p className="mt-2 text-sm text-a-ink-muted">이 페이지는 대시보드 관리자만 이용할 수 있습니다.</p>
    </div>
  );
  if (state === "error") return (
    <div className="p-10 text-sm text-rose-500">목록을 불러오지 못했습니다. <button onClick={load} className="underline">다시 시도</button></div>
  );

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-10">
      <h1 className="text-xl font-semibold text-a-ink">유저 관리</h1>
      <p className="mt-1 text-sm text-a-ink-muted">대시보드에 접근할 수 있는 사용자를 초대·차단합니다. (@lalasweet.kr 계정만)</p>

      {/* 초대(추가) */}
      <form onSubmit={sendInvite} className="mt-5 flex gap-2">
        <input
          type="email" value={invite} onChange={e => setInvite(e.target.value)}
          placeholder="초대할 이메일 (name@lalasweet.kr)"
          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-a-blue" />
        <button type="submit" disabled={busy === "invite" || !invite.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-a-blue text-white hover:opacity-90 disabled:opacity-40 transition">
          {busy === "invite" ? "초대 중…" : "+ 초대"}
        </button>
      </form>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-600" : "text-rose-500"}`}>{msg.text}</p>
      )}

      {/* 사용자 목록 */}
      <div className="mt-5 border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-a-ink-muted text-xs">
              <th className="text-left font-medium px-4 py-2.5">이메일</th>
              <th className="text-left font-medium px-3 py-2.5">이름</th>
              <th className="text-left font-medium px-3 py-2.5 whitespace-nowrap">최근 로그인</th>
              <th className="text-right font-medium px-4 py-2.5">상태 / 작업</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-4 py-3 text-a-ink">{u.email || "(이메일없음)"}</td>
                <td className="px-3 py-3 text-a-ink-muted">{u.name ?? "-"}</td>
                <td className="px-3 py-3 text-a-ink-muted whitespace-nowrap">{fmtDate(u.lastSignInAt)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {u.banned && <span className="mr-2 text-[11px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-200">차단됨</span>}
                  <button
                    onClick={() => toggleBan(u)} disabled={busy === u.id}
                    className={`text-xs font-medium px-2.5 py-1 rounded-md border transition disabled:opacity-40 ${
                      u.banned
                        ? "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        : "border-rose-200 text-rose-600 hover:bg-rose-50"
                    }`}>
                    {busy === u.id ? "처리 중…" : u.banned ? "차단 해제" : "차단"}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-a-ink-muted">사용자가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-a-ink-muted">
        · 차단하면 즉시 대시보드에 접근할 수 없습니다(계정은 유지, 언제든 해제 가능).<br />
        · 초대는 이메일로 가입 링크가 발송됩니다. 도메인 제한(@lalasweet.kr)은 항상 함께 적용됩니다.
      </p>
    </div>
  );
}
