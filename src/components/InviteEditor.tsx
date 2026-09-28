"use client";

import { useMemo, useState } from "react";
import {
  contactLabel,
  draftFromContact,
  emailQuestion,
  invitePool,
  isEmail,
  needsEmail,
  resolveInvitee,
  splitInviteeList,
  suggestContacts,
  type InviteeDraft,
} from "@/core/contacts";
import { useSpeech } from "@/lib/speech";
import { useStore } from "@/lib/store";

/** Người này đã sẵn sàng để gửi mời trên lịch đích này chưa. */
export function inviteeReady(d: InviteeDraft, provider?: "google" | "lark"): boolean {
  return d.status !== "pick" && !needsEmail(d, provider);
}

/**
 * Ô MỜI NGƯỜI (§5.4 v3.9): gõ tên hoặc email, hoặc nói tên → khớp danh bạ
 * liên hệ, điền sẵn email. Chưa có email → hỏi ĐÚNG MỘT câu một lúc
 * ("Email của anh Tuấn là gì?") rồi nhớ vào danh bạ; trùng tên → 2 lựa
 * chọn gần nhất kèm công ty. Bỏ ai đó bằng một chạm (✕).
 */
export function InviteEditor({
  drafts,
  onChange,
  provider,
}: {
  drafts: InviteeDraft[];
  onChange: (next: InviteeDraft[]) => void;
  /** Lịch đích — Lark mời được người trong tổ chức bằng open_id, không cần email. */
  provider?: "google" | "lark";
}) {
  const { contacts, clients, saveContact } = useStore();
  const pool = useMemo(() => invitePool(contacts, clients), [contacts, clients]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const pendingIdx = drafts.findIndex((d) => !inviteeReady(d, provider));
  const pending = pendingIdx >= 0 ? drafts[pendingIdx] : undefined;
  const readyCount = drafts.filter((d) => inviteeReady(d, provider)).length;
  const suggestions = useMemo(
    () =>
      q.trim().length >= 1
        ? suggestContacts(q.trim(), pool).filter(
            (c) => !drafts.some((d) => (d.contactId && d.contactId === c.id) || (d.email && d.email === c.email)),
          )
        : [],
    [q, pool, drafts],
  );

  function add(list: InviteeDraft[]) {
    const next = [...drafts];
    for (const d of list) {
      const dup = next.some(
        (x) => (d.email && x.email === d.email) || (d.contactId && x.contactId === d.contactId),
      );
      if (!dup) next.push(d);
    }
    onChange(next);
  }

  function addTyped(text: string) {
    const names = splitInviteeList(text.replace(/^\s*(?:mời|invite)\s+/iu, ""));
    if (!names.length) return;
    add(names.map((n) => resolveInvitee(n, pool, clients)));
    setQ("");
  }

  const speech = useSpeech((final) => addTyped(final));

  function replace(i: number, d: InviteeDraft) {
    onChange(drafts.map((x, k) => (k === i ? d : x)));
    setAnswer("");
    setErr(null);
  }

  function saveEmail() {
    if (!pending) return;
    const email = answer.trim().toLowerCase();
    if (!isEmail(email)) {
      setErr("Email chưa đúng — ví dụ ten@congty.com");
      return;
    }
    // Nhớ vào danh bạ ngay (lần sau chỉ cần nói tên).
    const c = saveContact(
      {
        name: pending.name,
        email,
        company: pending.company,
        larkOpenId: pending.larkOpenId,
        source: "invite",
        lang: pending.viHint ? "vi" : undefined,
      },
      { id: pending.contactId },
    );
    replace(pendingIdx, { ...pending, email: c.email, contactId: c.id, status: "ready", options: undefined });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {drafts.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Người được mời">
          {drafts.map((d, i) => (
            <span
              key={`${d.said}-${i}`}
              className="chip"
              style={{
                background: inviteeReady(d, provider) ? "var(--bg)" : "var(--note)",
                color: inviteeReady(d, provider) ? "var(--ink)" : "var(--note-ink)",
                border: "1px solid var(--line)",
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
              }}
            >
              <b>{d.name}</b>
              <span className="muted">
                {d.email ?? (d.larkOpenId && provider === "lark" ? "Lark" : d.status === "pick" ? "chọn người" : "chưa có email")}
              </span>
              <button
                type="button"
                className="btn ghost small"
                style={{ padding: "0 4px", minHeight: 0 }}
                aria-label={`Bỏ ${d.name} khỏi danh sách mời`}
                onClick={() => onChange(drafts.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {pending?.status === "pick" && pending.options && (
        <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }} role="group" aria-label="Chọn người được mời">
          <b>Mời {pending.call} nào?</b>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {pending.options.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn small"
                onClick={() => replace(pendingIdx, draftFromContact(c, pending.said, pending.viHint))}
              >
                {contactLabel(c)}
              </button>
            ))}
            <button
              type="button"
              className="btn ghost small"
              onClick={() => replace(pendingIdx, { ...pending, status: "ask_email", options: undefined, contactId: undefined })}
            >
              Người khác
            </button>
          </div>
        </div>
      )}

      {pending && pending.status !== "pick" && (
        <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b>{emailQuestion(pending)}</b>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="transcript"
              style={{ minHeight: 0, padding: "6px 10px", flex: 1, minWidth: 180 }}
              type="email"
              inputMode="email"
              placeholder="ten@congty.com"
              aria-label={emailQuestion(pending)}
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEmail();
                }
              }}
            />
            <button type="button" className="btn primary small" onClick={saveEmail}>
              Lưu email
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onChange(drafts.filter((_, k) => k !== pendingIdx))}
            >
              Bỏ người này
            </button>
          </div>
          {err && <span style={{ color: "var(--petal)" }}>{err}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
        <input
          className="transcript"
          style={{ minHeight: 0, padding: "6px 10px", flex: 1 }}
          placeholder="Mời thêm: tên hoặc email"
          aria-label="Mời thêm: tên hoặc email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) {
              e.preventDefault();
              addTyped(q);
            }
          }}
        />
        {speech.supported && (
          <button
            type="button"
            className="btn ghost small"
            aria-label={speech.listening ? "Dừng nghe" : "Nói tên người mời"}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
          >
            {speech.listening ? "⏹" : speech.processing ? "…" : "🎤"}
          </button>
        )}
        <button type="button" className="btn small" disabled={!q.trim()} onClick={() => addTyped(q)}>
          Thêm
        </button>
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Gợi ý từ danh bạ">
          {suggestions.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn ghost small"
              onClick={() => {
                add([draftFromContact(c)]);
                setQ("");
              }}
            >
              {contactLabel(c)}
            </button>
          ))}
        </div>
      )}
      {speech.error && <span className="small muted">{speech.error}</span>}

      {readyCount > 0 && (
        <span className="small" style={{ fontWeight: 600 }}>
          ✉️ Sẽ gửi email mời cho {readyCount} người
          {drafts.length > readyCount ? ` · còn ${drafts.length - readyCount} người chưa đủ thông tin` : ""}
        </span>
      )}
    </div>
  );
}
