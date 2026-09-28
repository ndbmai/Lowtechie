"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { defaultInviteMessage, inviteLanguage, type InviteLang } from "@/core/contacts";
import type { EventInvitee } from "@/core/types";
import { useStore } from "@/lib/store";
import { sendInvites } from "@/lib/useGoogle";

/**
 * GỬI LỜI MỜI — bước xác nhận RIÊNG (§5.4 v3.9), kể cả khi Mai đã bật book
 * thẳng cho loại lịch khác. Hiện rõ ai sẽ nhận (bỏ bớt bằng một chạm),
 * tiêu đề + lời nhắn sửa được, thư tiếng Anh với người ngoài / tiếng Việt
 * khi mọi người dùng tiếng Việt. Gửi lỗi / email sai → báo lại kèm tên.
 */
export function InviteConfirm({
  event,
  target,
  invitees,
  onSent,
  onClose,
}: {
  event: { title: string; startAt: string; endAt: string; meetUrl?: string; location?: string };
  /** Sự kiện trên lịch ngoài để gửi mời (Google/Lark). */
  target: { gcalId: string; account?: string; calendarId?: string };
  /** Người sẽ nhận lời mời lần này (chưa gửi hoặc gửi lỗi). */
  invitees: EventInvitee[];
  /** Kết quả từng người + tiêu đề cuối — nơi gọi lưu vào sự kiện. */
  onSent: (updated: EventInvitee[], title: string) => void;
  onClose: () => void;
}) {
  const { contacts, saveContact } = useStore();
  const [list, setList] = useState(invitees);
  const autoLang = useMemo(
    () =>
      inviteLanguage(
        list.map((i) => ({
          name: i.name,
          email: i.email,
          lang: i.lang ?? contacts.find((c) => c.id === i.contactId)?.lang,
        })),
      ),
    [list, contacts],
  );
  const [lang, setLang] = useState<InviteLang>(autoLang);
  const [title, setTitle] = useState(event.title);
  const touched = useRef(false);
  const build = (l: InviteLang, t: string, people: EventInvitee[]) =>
    defaultInviteMessage(l, { ...event, title: t }, people.map((i) => ({ call: i.call ?? i.name, name: i.name })));
  const [message, setMessage] = useState(() => build(autoLang, event.title, invitees));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: EventInvitee[]; failed: EventInvitee[] } | null>(null);

  // Mai chưa sửa lời nhắn → đổi ngôn ngữ / tiêu đề / danh sách thì soạn lại.
  useEffect(() => {
    if (!touched.current) setMessage(build(lang, title, list));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, title, list]);

  async function send() {
    if (!list.length) return;
    setBusy(true);
    const r = await sendInvites(target.gcalId, {
      account: target.account,
      calendarId: target.calendarId,
      title: title.trim() && title.trim() !== event.title ? title.trim() : undefined,
      message: message.trim() || undefined,
      attendees: list.map((i) => ({ email: i.email, openId: i.larkOpenId, name: i.name })),
    });
    const now = new Date().toISOString();
    const updated: EventInvitee[] = list.map((i) => {
      const hit = r.results.find(
        (x) => (i.email && x.email === i.email.toLowerCase()) || (i.larkOpenId && x.openId === i.larkOpenId),
      );
      return hit?.ok
        ? { ...i, sentAt: now, error: undefined, response: i.response ?? "no_reply" }
        : { ...i, error: hit?.error ?? r.error ?? "chưa gửi được" };
    });
    // Người đã mời vào danh bạ (lần sau chỉ cần nói tên) — gợi ý theo gần đây.
    for (const i of updated) {
      if (!i.sentAt || (!i.email && !i.larkOpenId)) continue;
      const fromClient = i.contactId?.startsWith("client:");
      saveContact(
        {
          name: i.name,
          email: i.email,
          larkOpenId: i.larkOpenId,
          lang: i.lang,
          clientId: fromClient ? i.contactId!.slice(7) : undefined,
          source: "invite",
        },
        { id: fromClient ? undefined : i.contactId, use: true },
      );
    }
    setBusy(false);
    setResult({ ok: updated.filter((i) => i.sentAt === now), failed: updated.filter((i) => i.error) });
    onSent(updated, title.trim() || event.title);
  }

  return (
    <div className="parsed cal" style={{ display: "flex", flexDirection: "column", gap: 8 }} role="group" aria-label="Gửi mời">
      <div className="k">Gửi mời — xác nhận riêng</div>
      {result ? (
        <>
          {result.ok.length > 0 && (
            <span className="small" style={{ color: "var(--leaf)", fontWeight: 600 }}>
              ✓ Đã gửi mời cho {result.ok.length} người: {result.ok.map((i) => i.name).join(", ")}
            </span>
          )}
          {result.failed.map((i) => (
            <span key={`${i.name}-${i.email}`} className="warn small" role="alert">
              ⚠ Chưa gửi được cho {i.name}
              {i.email ? ` (${i.email})` : ""}: {i.error}
            </span>
          ))}
          <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={onClose}>
            Xong
          </button>
        </>
      ) : (
        <>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: "6px 10px", fontWeight: 700 }}
            aria-label="Tiêu đề thư mời"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {event.meetUrl && (
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              🎥 Link họp: {event.meetUrl}
            </span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {list.map((i, k) => (
              <span key={`${i.name}-${i.email ?? i.larkOpenId}`} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <b>{i.name}</b>
                <span className="muted" style={{ flex: 1, overflowWrap: "anywhere" }}>
                  {i.email ?? "qua Lark"}
                </span>
                <button
                  className="btn ghost small"
                  aria-label={`Bỏ ${i.name} khỏi lần gửi này`}
                  onClick={() => setList((l) => l.filter((_, n) => n !== k))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Thư mời
            <select
              className="btn small"
              aria-label="Ngôn ngữ thư mời"
              value={lang}
              onChange={(e) => setLang(e.target.value as InviteLang)}
            >
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </label>
          <textarea
            className="transcript"
            style={{ minHeight: 120, padding: 10, fontSize: 13 }}
            aria-label="Lời nhắn trong thư mời"
            value={message}
            onChange={(e) => {
              touched.current = true;
              setMessage(e.target.value);
            }}
          />
          <span className="small" style={{ fontWeight: 600 }}>
            ✉️ Sẽ gửi email mời cho {list.length} người
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={busy || !list.length} onClick={() => void send()}>
              {busy ? "Đang gửi…" : `Gửi mời cho ${list.length} người`}
            </button>
            <button className="btn ghost" disabled={busy} onClick={onClose}>
              Để sau
            </button>
          </div>
        </>
      )}
    </div>
  );
}
