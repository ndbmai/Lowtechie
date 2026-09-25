"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clientsFor } from "@/core/clients";
import type { LarkGroupMode } from "@/core/larkInbox";
import { activeProjects } from "@/core/projects";
import { fmtDayTime } from "@/lib/format";
import { useStore } from "@/lib/store";

/**
 * Bot "Mai Lowtechie" trong group Lark (§5.5.1 v3.7): danh sách kiểm tra
 * theo ĐÚNG thứ tự "bot không nhận được tin nhắn" của PRD — mỗi dòng ✓/✗
 * kèm việc cần làm — và gắn từng group với dự án · khách + chế độ đọc.
 */

interface BotCheck {
  connected: boolean;
  configured: boolean;
  webhookUrl: string;
  verificationToken: boolean;
  encryptKey: boolean;
  queue: boolean;
  owner: { known: boolean; isYou: boolean; you?: string };
  tenant?: { ok: boolean; action?: string };
  bot?: { ok: boolean; name?: string; activateStatus?: number; action?: string };
  chats?: { ok: boolean; items: { id: string; name: string; external: boolean }[]; action?: string };
  lastEvent?: { at: string; type: string };
  lastError?: { at: string; type?: string; detail: string; action: string };
  log?: { at: string; chat?: string; sender?: string; ask: string; reply: string }[];
}

interface Row {
  ok: boolean | null;
  label: string;
  detail?: string;
  fix?: string;
}

const MODES: { id: LarkGroupMode; label: string }[] = [
  { id: "mention", label: "Chỉ khi được @" },
  { id: "all", label: "Đọc toàn bộ" },
];

function botStatusFix(status?: number): string {
  if (status === 1 || status === 5 || status === 6) return "Bot đang bị tắt trong tổ chức — nhờ admin bật lại app.";
  return "Bật tính năng Bot của app, phát hành phiên bản mới và chờ admin tổ chức duyệt — chưa duyệt thì không có tin nào tới.";
}

function buildRows(c: BotCheck): Row[] {
  const rows: Row[] = [];
  if (!c.configured) {
    rows.push({ ok: false, label: "App Lark trên máy chủ", fix: "Thiếu LARK_APP_ID / LARK_APP_SECRET trên Vercel." });
    return rows;
  }
  const appOk = Boolean(c.tenant?.ok && c.bot?.ok);
  rows.push({
    ok: appOk,
    label: "App đã phát hành & admin đã duyệt",
    detail: appOk ? `Bot “${c.bot?.name ?? "Mai Lowtechie"}” đang bật` : undefined,
    fix: appOk ? undefined : (c.tenant?.action ?? c.bot?.action ?? botStatusFix(c.bot?.activateStatus)),
  });
  if (c.chats) {
    const n = c.chats.items.length;
    rows.push({
      ok: n > 0,
      label: "Bot đã vào group",
      detail: n > 0 ? `${n} group` : undefined,
      fix:
        n > 0
          ? undefined
          : (c.chats.action ??
            "Bật “cho phép thêm bot vào group” trong cấu hình Bot của app, rồi vào cài đặt group → Bot → thêm “Mai Lowtechie”."),
    });
  }
  rows.push({
    ok: c.verificationToken,
    label: "Webhook nhận sự kiện",
    detail: c.verificationToken ? `Verification Token đã đặt${c.encryptKey ? " · có Encrypt Key" : ""}` : undefined,
    fix: c.verificationToken
      ? undefined
      : "Chép Verification Token (và Encrypt Key nếu có) ở Events & Callbacks → Encryption Strategy vào Vercel: LARK_VERIFICATION_TOKEN, LARK_ENCRYPT_KEY → Redeploy — xong mới dán Request URL bên dưới (Lark xác minh ngay lúc lưu).",
  });
  const gotEvent = Boolean(c.lastEvent);
  rows.push({
    ok: c.queue ? gotEvent : null,
    label: "Đã nhận tin nhắn",
    detail: c.lastEvent ? `Lần cuối ${fmtDayTime(c.lastEvent.at)}` : undefined,
    fix: gotEvent
      ? undefined
      : c.queue
        ? "Chưa có sự kiện nào tới: thêm quyền đọc tin có @bot trong group, đăng ký sự kiện “nhận tin nhắn” (im.message.receive_v1) và “bot vào group” (im.chat.member.bot.added_v1) cho đúng phiên bản app, phát hành lại — rồi @Lowtechie thử trong group."
        : "Cần hàng đợi (bên dưới) để mình ghi nhận lần cuối bot nhận tin.",
  });
  rows.push({ ok: true, label: "Miền", detail: "larksuite.com (bản quốc tế)" });
  rows.push({
    ok: c.queue,
    label: "Hàng đợi Hộp duyệt",
    fix: c.queue
      ? undefined
      : "Thêm Upstash Redis cho project trên Vercel (Storage → Marketplace, giữ tên biến mặc định) — Vercel tự thêm KV_REST_API_URL / KV_REST_API_TOKEN, rồi Redeploy. Chưa có thì việc ghi trong group chỉ được nhắn riêng cho Mai.",
  });
  rows.push({
    ok: c.owner.isYou,
    label: "Bot nhận ra Mai",
    fix: c.owner.isYou
      ? undefined
      : c.owner.known
        ? `Bot đang nhận tài khoản khác làm chủ — nếu đây là Mai, đặt LARK_OWNER_OPEN_ID = ${c.owner.you ?? "(open_id)"} trên Vercel.`
        : `Chưa có chủ bot — có hàng đợi thì tự nhận; hoặc đặt LARK_OWNER_OPEN_ID = ${c.owner.you ?? "(open_id)"} trên Vercel.`,
  });
  return rows;
}

export function LarkBotSection() {
  const { projects, clients, larkGroups, setLarkGroup } = useStore();
  const [check, setCheck] = useState<BotCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ran = useRef(false);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/lark/bot", { cache: "no-store" });
      setCheck((await res.json()) as BotCheck);
    } catch {
      setErr("Không gọi được máy chủ — thử lại sau.");
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void run();
  }, [run]);

  // Chế độ từng group phải lên máy chủ để bot biết group nào được đọc toàn bộ.
  const sync = useCallback(async () => {
    const st = useStore.getState();
    const groups: Record<string, { name: string; mode: LarkGroupMode; projectName?: string; clientName?: string }> = {};
    for (const [id, g] of Object.entries(st.larkGroups)) {
      groups[id] = {
        name: g.name,
        mode: g.mode,
        projectName: st.projects.find((p) => p.id === g.projectId)?.name,
        clientName: st.clients.find((c) => c.id === g.clientId)?.name,
      };
    }
    await fetch("/api/lark/bot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groups }),
    }).catch(() => undefined);
  }, []);

  const rows = check ? buildRows(check) : [];
  const chats = check?.chats?.items ?? [];
  const allOk = rows.length > 0 && rows.every((r) => r.ok !== false);

  return (
    <>
      <div className="group-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>🤖 Bot Lark trong group</span>
        <button className="btn small" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void run()}>
          {busy ? "Đang kiểm tra…" : "Kiểm tra bot"}
        </button>
      </div>
      {err && <div className="warn small">⚠ {err}</div>}
      {check && !check.connected && (
        <div className="note-box small">Nối tài khoản Lark ở trên trước — bot nhận ra Mai nhờ tài khoản này.</div>
      )}
      {check && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.label} className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ width: 18, flex: "0 0 auto" }}>
                {r.ok === true ? "✅" : r.ok === false ? "❌" : "⚪"}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span>
                  <b>{r.label}</b>
                  {r.detail && <span className="muted"> — {r.detail}</span>}
                </span>
                {r.fix && <span style={{ color: "var(--ink-2)" }}>{r.fix}</span>}
              </span>
            </div>
          ))}
          {check.configured && (
            <div className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className="muted">Request URL:</span>
              <code style={{ overflowWrap: "anywhere", fontSize: 12 }}>{check.webhookUrl}</code>
              <button
                className="btn ghost small"
                onClick={() => {
                  void navigator.clipboard?.writeText(check.webhookUrl).then(() => setCopied(true));
                }}
              >
                {copied ? "Đã chép" : "Chép"}
              </button>
            </div>
          )}
          {check.lastError && (
            <div className="warn small">
              ⚠ Lỗi gần nhất ({fmtDayTime(check.lastError.at)}): {check.lastError.action}
            </div>
          )}
          {allOk && !check.lastEvent && (
            <div className="note-box small">
              Thử nhắn “@Lowtechie ghi việc: gửi proposal cho Đô Thị thứ Sáu” trong group — việc hiện ở Hộp duyệt sau vài giây.
            </div>
          )}
        </div>
      )}

      {chats.map((chat) => {
        const g = larkGroups[chat.id];
        const pid = g?.projectId;
        const pickClients = pid ? clientsFor(clients, pid) : clients;
        const save = (patch: Parameters<typeof setLarkGroup>[1]) => {
          setLarkGroup(chat.id, patch);
          void sync();
        };
        return (
          <div className="card" key={chat.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <b style={{ overflowWrap: "anywhere" }}>
              {chat.name}
              {chat.external && (
                <span className="chip" style={{ marginLeft: 6, background: "var(--petal)" }}>
                  có người ngoài
                </span>
              )}
            </b>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select
                className="btn small"
                style={{ flex: 1, minWidth: 0 }}
                aria-label={`Dự án của group ${chat.name}`}
                value={pid ?? ""}
                onChange={(e) =>
                  save({
                    name: chat.name,
                    projectId: e.target.value || undefined,
                    clientId: g?.clientId && e.target.value && !clientsFor(clients, e.target.value).some((c) => c.id === g.clientId) ? undefined : g?.clientId,
                  })
                }
              >
                <option value="">Dự án: tự đoán</option>
                {activeProjects(projects).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className="btn small"
                style={{ flex: 1, minWidth: 0 }}
                aria-label={`Khách của group ${chat.name}`}
                value={g?.clientId ?? ""}
                onChange={(e) => save({ name: chat.name, clientId: e.target.value || undefined })}
              >
                <option value="">Khách: không gắn</option>
                {pickClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="seg" role="radiogroup" aria-label={`Chế độ đọc của group ${chat.name}`}>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  aria-pressed={(g?.mode ?? "mention") === m.id}
                  onClick={() => save({ name: chat.name, mode: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {(g?.mode ?? "mention") === "all" && (
              <span className="small muted">
                Cần quyền đọc toàn bộ tin group (admin duyệt) và mọi người trong group đồng ý — dùng cho “@Lowtechie tóm tắt 2 ngày qua”.
              </span>
            )}
          </div>
        );
      })}

      {check?.log && check.log.length > 0 && (
        <details className="card small">
          <summary>Nhật ký truy vấn ({check.log.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {check.log.map((l, i) => (
              <div key={i}>
                <span className="muted">
                  {fmtDayTime(l.at)} · {l.sender ?? "?"} @ {l.chat ?? "?"}
                </span>
                <div>“{l.ask}”</div>
                <div className="muted">→ {l.reply}</div>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
