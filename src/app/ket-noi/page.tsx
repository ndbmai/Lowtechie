"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { LarkBotSection } from "@/components/LarkBotSection";
import { CITY_LABEL, LOCATION_TTL_MS, currentCity } from "@/core/location";
import { activeProjects } from "@/core/projects";
import type { Destination } from "@/core/types";
import { useMounted } from "@/lib/hooks";
import { refreshLocation } from "@/lib/location";
import { useStore, type LocationMode } from "@/lib/store";
import { useAccounts, type ConnectedAccount } from "@/lib/useGoogle";

/**
 * Màn Kết nối (PRD §5.3.4): mỗi tài khoản một dòng, bật/tắt riêng
 * Lịch · Mail · Drive; thêm nhiều tài khoản Google song song với Lark;
 * lịch đích mặc định theo dự án.
 */

const PROVIDER_LABEL = { google: "Google", lark: "Lark" } as const;

/** Ba mức vị trí (§5.4.3) — dòng mô tả là phần "giải thích rõ dùng để làm gì". */
const LOCATION_MODES: { id: LocationMode; label: string; note: string }[] = [
  {
    id: "ondemand",
    label: "Chỉ khi cần",
    note: "Hỏi vị trí khi mở Lịch hoặc tính chuỗi di chuyển — không chạy nền, không tốn pin.",
  },
  {
    id: "light",
    label: "Khi app đang mở",
    note: "Nhận biết đã tới/đã rời các nơi đã lưu để tính điểm xuất phát và xác nhận đã đến. Chỉ lưu nơi + thành phố, không lưu đường đi, xóa sau 30 ngày.",
  },
  {
    id: "off",
    label: "Không dùng vị trí",
    note: "Suy thành phố từ chuyến bay đã lưu; đổi chỗ thì Mai nói “chị đang ở HCMC”.",
  },
];

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
  if (lerr === "noscope")
    return (
      <div className="warn">
        Lark cấp phiên KHÔNG kèm quyền lịch — thường do Lark nhớ lần cho phép cũ nên không hỏi
        lại. Mở Lark → ảnh đại diện → Settings → Security → mục ứng dụng đã cấp quyền (Authorized
        apps) → gỡ &ldquo;Mai Lowtechie&rdquo;, rồi quay lại đây bấm Kết nối lại.
      </div>
    );
  if (gerr || lerr) return <div className="warn">Nối lỗi: {gerr ?? lerr} — thử lại nhé.</div>;
  return null;
}

/** "Đồng bộ 14:05 · 23/9/2026" — giờ thiết bị Mai. */
function fmtSync(at: string): string {
  const d = new Date(at);
  return `Đồng bộ ${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · ${d.toLocaleDateString("vi-VN")}`;
}

export default function ConnectionsPage() {
  const mounted = useMounted();
  const { loading, configured, accounts, setParts, disconnect, reload, probe } = useAccounts();
  const {
    projects,
    settings,
    trips,
    locationState,
    researchUsage,
    setProjectCalendar,
    setAutoBookBanner,
    setSyncStatus,
    setLocationMode,
    setLocationState,
    setResearchLimit,
  } = useStore();
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const calAccounts = accounts.filter((a) => a.parts.cal);
  const [syncing, setSyncing] = useState(false);
  const probedOnce = useRef(false);

  // "Đồng bộ ngay" (v3.2): đọc thử tháng HIỆN TẠI theo giờ thiết bị Mai.
  const runProbe = useCallback(async () => {
    setSyncing(true);
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const got = await probe(from, to);
    if (got) {
      const at = new Date().toISOString();
      for (const p of got) {
        setSyncStatus(p.id, {
          at,
          calendars: p.calendars,
          events: p.events,
          error: p.error?.action,
          note: p.note,
        });
      }
    }
    setSyncing(false);
  }, [probe, setSyncStatus]);

  // Vừa nối xong (hoặc tài khoản chưa đồng bộ lần nào) → tự chạy một lần,
  // để trong 1 phút sau khi nối Mai thấy ngay số sự kiện (PRD v3.2).
  useEffect(() => {
    if (!mounted || loading || probedOnce.current) return;
    const cal = accounts.filter((a) => a.parts.cal);
    if (cal.length === 0) return;
    probedOnce.current = true;
    if (cal.some((a) => !useStore.getState().settings.syncStatus[a.id])) void runProbe();
  }, [mounted, loading, accounts, runProbe]);

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

      {mounted && !loading && configured.lark && <LarkBotSection />}

      {mounted &&
        (() => {
          const here = currentCity(locationState, trips, new Date());
          const d = new Date();
          const used = researchUsage[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`] ?? 0;
          return (
            <>
              <div className="group-title">Vị trí</div>
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="seg" role="radiogroup" aria-label="Mức dùng vị trí">
                  {LOCATION_MODES.map((m) => (
                    <button
                      key={m.id}
                      aria-pressed={settings.locationMode === m.id}
                      onClick={async () => {
                        setLocationMode(m.id);
                        setLocMsg(null);
                        // Bật vị trí → xin quyền ngay lúc này (ranh giới §5.4.3).
                        if (m.id !== "off") {
                          const r = await refreshLocation();
                          setLocMsg(r.ok ? `Đã lấy vị trí — Mai đang ở ${r.city ? CITY_LABEL[r.city] : "ngoài 3 thành phố quen"}.` : r.message);
                        }
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="small muted">
                  {LOCATION_MODES.find((m) => m.id === settings.locationMode)?.note}
                </span>
                <span className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  Đang ở <b>{CITY_LABEL[here.city]}</b>
                  <span className="muted">
                    ({here.source === "gps" ? "vị trí máy" : here.source === "manual" ? "Mai tự nói" : "suy từ chuyến bay"})
                  </span>
                  · đổi tay:
                  {(Object.keys(CITY_LABEL) as Destination[]).map((c) => (
                    <button
                      key={c}
                      className="btn ghost small"
                      aria-pressed={here.city === c && here.source === "manual"}
                      onClick={() => {
                        const now = Date.now();
                        setLocationState({
                          city: c,
                          source: "manual",
                          updatedAt: new Date(now).toISOString(),
                          expiresAt: new Date(now + LOCATION_TTL_MS).toISOString(),
                        });
                        setLocMsg(null);
                      }}
                    >
                      {CITY_LABEL[c]}
                    </button>
                  ))}
                </span>
                {locMsg && <div className="note-box small">{locMsg}</div>}
              </div>

              <div className="group-title">Nghiên cứu</div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <span className="t">
                  <b>🔎 Hạn mức mỗi tháng</b>
                  <span className="muted small">Đã dùng {used} lượt tháng này</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  aria-label="Số lượt nghiên cứu mỗi tháng"
                  value={settings.researchMonthlyLimit}
                  onChange={(e) => setResearchLimit(Number(e.target.value) || 0)}
                  style={{ width: 72, padding: "6px 8px", borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--surface-2)" }}
                />
              </div>
            </>
          );
        })()}

      {mounted && calAccounts.length > 0 && (
        <>
          <div className="group-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Trạng thái đồng bộ</span>
            <button
              className="btn small"
              style={{ marginLeft: "auto" }}
              disabled={syncing}
              onClick={() => void runProbe()}
            >
              {syncing ? "Đang đồng bộ…" : "Đồng bộ ngay"}
            </button>
          </div>
          {calAccounts.map((a) => {
            const st = settings.syncStatus[a.id];
            return (
              <div key={a.id}>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <span
                    className="chip"
                    style={{ background: a.provider === "lark" ? "#3370FF" : "#4285F4" }}
                  >
                    {PROVIDER_LABEL[a.provider]}
                  </span>
                  <span className="t">
                    <b style={{ overflowWrap: "anywhere" }}>{a.email ?? PROVIDER_LABEL[a.provider]}</b>
                    <span className="muted small">
                      {st
                        ? `${fmtSync(st.at)} · ${st.calendars} lịch con · ${st.events} sự kiện tháng này`
                        : "Chưa đồng bộ lần nào — bấm Đồng bộ ngay."}
                    </span>
                    {st?.note && (
                      <span className="muted small" style={{ display: "block" }}>
                        {st.note}
                      </span>
                    )}
                  </span>
                </div>
                {st?.error && (
                  <div className="warn small" style={{ marginTop: 4 }}>
                    ⚠ {st.error}
                  </div>
                )}
                {st && !st.error && st.events === 0 && (
                  <div className="note-box small" style={{ marginTop: 4 }}>
                    0 sự kiện tháng này — nếu lịch {PROVIDER_LABEL[a.provider]} của Mai có sự kiện
                    mà đây vẫn 0, bấm Kết nối lại giúp mình nhé.
                  </div>
                )}
              </div>
            );
          })}

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
