"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { activeProjects } from "@/core/projects";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { useAccounts, type ConnectedAccount } from "@/lib/useGoogle";

/**
 * Màn Kết nối (PRD §5.3.4): mỗi tài khoản một dòng, bật/tắt riêng
 * Lịch · Mail · Drive; thêm nhiều tài khoản Google song song với Lark;
 * lịch đích mặc định theo dự án.
 */

const PROVIDER_LABEL = { google: "Google", lark: "Lark" } as const;

function AccountRow({
  account,
  onParts,
  onDisconnect,
}: {
  account: ConnectedAccount;
  onParts: (parts: Partial<ConnectedAccount["parts"]>) => void;
  onDisconnect: () => void;
}) {
  const toggles: { key: keyof ConnectedAccount["parts"]; label: string }[] = [
    { key: "cal", label: "Lịch" },
    { key: "mail", label: "Mail" },
    { key: "drive", label: "Drive" },
  ];
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="chip" style={{ background: account.provider === "lark" ? "#3370FF" : "#4285F4" }}>
          {PROVIDER_LABEL[account.provider]}
        </span>
        <b style={{ overflowWrap: "anywhere" }}>{account.email ?? "(chưa rõ email)"}</b>
        {account.provider === "google" && !account.gmail && (
          <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 8px" }}>
            chưa cấp quyền Mail
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {toggles.map((t) => (
          <label key={t.key} className="small" style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input
              type="checkbox"
              className="check"
              checked={account.parts[t.key]}
              onChange={(e) => onParts({ [t.key]: e.target.checked })}
              aria-label={`${t.label} của ${account.email ?? account.id}`}
            />
            {t.label}
          </label>
        ))}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <a
            className="btn ghost small"
            style={{ textDecoration: "none" }}
            href={account.provider === "google" ? "/api/google/auth?add=1" : "/api/lark/auth"}
          >
            Kết nối lại
          </a>
          <button
            className="btn ghost small"
            onClick={() => {
              if (
                window.confirm(
                  `Ngắt ${account.email ?? PROVIDER_LABEL[account.provider]}? Dữ liệu đã lưu trong app vẫn giữ nguyên.`,
                )
              )
                onDisconnect();
            }}
          >
            Ngắt
          </button>
        </span>
      </div>
    </div>
  );
}

function OAuthNotice() {
  const sp = useSearchParams();
  const gok = sp.get("gok");
  const lok = sp.get("lok");
  const gerr = sp.get("gerr");
  const lerr = sp.get("lerr");
  if (gok || lok) return <div className="warn" style={{ background: "var(--surface)" }}>Đã nối xong ✓</div>;
  if (gerr === "config") return <div className="warn">Server chưa có GOOGLE_CLIENT_ID/SECRET.</div>;
  if (lerr === "config") return <div className="warn">Server chưa có LARK_APP_ID/LARK_APP_SECRET (Vercel → Environment Variables).</div>;
  if (gerr || lerr) return <div className="warn">Nối lỗi: {gerr ?? lerr} — thử lại nhé.</div>;
  return null;
}

export default function ConnectionsPage() {
  const mounted = useMounted();
  const { loading, configured, accounts, setParts, disconnect, reload } = useAccounts();
  const { projects, settings, setProjectCalendar, setAutoBookBanner } = useStore();
  const calAccounts = accounts.filter((a) => a.parts.cal);

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Kết nối</h1>
        <Link href="/lich" className="muted small">
          ← Lịch
        </Link>
      </div>

      <Suspense fallback={null}>
        <OAuthNotice />
      </Suspense>

      {mounted && !loading && accounts.length === 0 && (
        <div className="empty card">
          <p>
            Chưa nối tài khoản nào. Nối Google để đọc lịch + quét vé trong Gmail, nối Lark cho
            email và lịch của The Circle — mỗi tài khoản bật/tắt riêng từng phần, thêm bao nhiêu
            tài khoản cũng được.
          </p>
        </div>
      )}

      {mounted &&
        accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            onParts={(parts) => void setParts(a.id, parts)}
            onDisconnect={() => void disconnect(a.id)}
          />
        ))}

      {mounted && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a
            className="btn primary"
            style={{ textDecoration: "none", flex: 1, textAlign: "center", opacity: configured.google ? 1 : 0.5 }}
            href="/api/google/auth?add=1"
          >
            ＋ Tài khoản Google
          </a>
          <a
            className="btn"
            style={{ textDecoration: "none", flex: 1, textAlign: "center", opacity: configured.lark ? 1 : 0.5 }}
            href="/api/lark/auth"
          >
            ＋ Tài khoản Lark
          </a>
        </div>
      )}

      {mounted && calAccounts.length > 0 && (
        <>
          <div className="group-title">Lịch đích theo dự án</div>
          {activeProjects(projects).map((p) => (
            <div className="row" key={p.id} style={{ flexWrap: "wrap" }}>
              <span className="dot" style={{ background: p.color }} />
              <span className="t">
                <b>{p.name}</b>
              </span>
              <select
                className="btn small"
                style={{ maxWidth: "58%", minWidth: 0 }}
                value={settings.projectCalendar[p.id] ?? ""}
                aria-label={`Lịch đích của ${p.name}`}
                onChange={(e) => setProjectCalendar(p.id, e.target.value || undefined)}
              >
                <option value="">Mặc định</option>
                {calAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {PROVIDER_LABEL[c.provider]} · {c.email ?? c.id}
                  </option>
                ))}
              </select>
              {/* v3.1: banner đủ ngày giờ + địa điểm → book thẳng, báo sau. */}
              <label
                className="small"
                style={{ display: "flex", gap: 5, alignItems: "center", width: "100%", paddingLeft: 20 }}
              >
                <input
                  type="checkbox"
                  className="check"
                  checked={settings.autoBookBanner[p.id] ?? false}
                  aria-label={`Book thẳng banner của ${p.name}`}
                  onChange={(e) => setAutoBookBanner(p.id, e.target.checked)}
                />
                ⚡ Book thẳng sự kiện từ banner
              </label>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
