"use client";

import { useMemo, useState } from "react";
import { foldName } from "@/core/clients";
import { isEmail } from "@/core/contacts";
import type { Contact } from "@/core/types";
import { useStore } from "@/lib/store";
import { fetchContactCandidates } from "@/lib/useGoogle";

const SOURCE_LABEL: Record<Contact["source"], string> = {
  invite: "đã mời",
  mail: "hộp thư",
  lark_group: "group Lark",
  manual: "tự thêm",
  client: "khách hàng",
};

function ContactRow({
  c,
  selected,
  onSelect,
}: {
  c: Contact;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  const { updateContact, deleteContact } = useStore();
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [name, setName] = useState(c.name);
  const [email, setEmail] = useState(c.email ?? "");
  const [company, setCompany] = useState(c.company ?? "");
  const [aliases, setAliases] = useState(c.aliases.join(", "));
  const [lang, setLang] = useState<"" | "vi" | "en">(c.lang ?? "");
  const [err, setErr] = useState<string | null>(null);

  function save() {
    if (!name.trim()) return;
    if (email.trim() && !isEmail(email)) {
      setErr("Email chưa đúng định dạng.");
      return;
    }
    updateContact(c.id, {
      name: name.trim(),
      email: email.trim(),
      company: company.trim() || undefined,
      aliases: aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .slice(0, 12),
      lang: lang || undefined,
    });
    setEditing(false);
    setErr(null);
  }

  if (editing) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10 }}>
        <input className="transcript" style={{ minHeight: 0, padding: 8 }} aria-label="Tên liên hệ" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="transcript" style={{ minHeight: 0, padding: 8 }} aria-label="Email liên hệ" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="transcript" style={{ minHeight: 0, padding: 8 }} aria-label="Công ty" placeholder="Công ty" value={company} onChange={(e) => setCompany(e.target.value)} />
        <input className="transcript" style={{ minHeight: 0, padding: 8 }} aria-label="Tên gọi khác" placeholder="Tên gọi khác, cách nhau dấu phẩy" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Thư mời
          <select className="btn small" aria-label="Ngôn ngữ thư mời của liên hệ" value={lang} onChange={(e) => setLang(e.target.value as "" | "vi" | "en")}>
            <option value="">Tự đoán</option>
            <option value="en">English</option>
            <option value="vi">Tiếng Việt</option>
          </select>
        </label>
        {err && <span className="small" style={{ color: "var(--petal)" }}>{err}</span>}
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn primary small" onClick={save}>
            Lưu
          </button>
          <button className="btn ghost small" onClick={() => setEditing(false)}>
            Thôi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
      <input
        type="checkbox"
        className="check"
        aria-label={`Chọn ${c.name} để gộp`}
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
      />
      <span className="t" style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <b>{c.name}</b>
        <span className="small muted" style={{ overflowWrap: "anywhere" }}>
          {[c.company, c.email ?? (c.larkOpenId ? "Lark (chưa có email)" : "chưa có email")].filter(Boolean).join(" · ")}
          {" · "}
          {SOURCE_LABEL[c.source]}
          {c.useCount ? ` · mời ${c.useCount} lần` : ""}
        </span>
        {c.aliases.length > 0 && <span className="small muted">Còn gọi: {c.aliases.join(", ")}</span>}
      </span>
      {confirmDel ? (
        <span style={{ display: "flex", gap: 4 }}>
          <button className="btn small" onClick={() => deleteContact(c.id)}>
            Xóa
          </button>
          <button className="btn ghost small" onClick={() => setConfirmDel(false)}>
            Giữ
          </button>
        </span>
      ) : (
        <span style={{ display: "flex", gap: 4 }}>
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            Sửa
          </button>
          <button className="btn ghost small" aria-label={`Xóa ${c.name}`} onClick={() => setConfirmDel(true)}>
            ✕
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * Danh bạ liên hệ (§5.4 v3.9) — người để mời họp: tự nhớ khi Mai trả lời
 * "Email của anh Tuấn là gì?", khi gửi mời, khi nhập từ hộp thư / group
 * Lark. Mai sửa, gộp (chọn 2 người trùng), xóa ở đây.
 */
export function ContactsManager() {
  const { contacts, saveContact, importContacts, mergeContactInto } = useStore();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [nName, setNName] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nCompany, setNCompany] = useState("");

  const list = useMemo(() => {
    const fq = foldName(q);
    return contacts
      .filter(
        (c) =>
          !fq ||
          [c.name, c.company ?? "", c.email ?? "", ...c.aliases].some((v) => foldName(v).includes(fq)),
      )
      .sort(
        (a, b) =>
          (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") ||
          (b.useCount ?? 0) - (a.useCount ?? 0) ||
          a.name.localeCompare(b.name, "vi"),
      );
  }, [contacts, q]);

  async function importNow() {
    setBusy(true);
    setMsg(null);
    const r = await fetchContactCandidates();
    setBusy(false);
    if (!r) {
      setMsg("Chưa nhập được — kiểm tra đã nối Gmail/Lark ở màn Kết nối chưa nhé.");
      return;
    }
    const added = importContacts(
      r.people.map((p) => ({
        name: p.name,
        email: p.email,
        company: p.company,
        larkOpenId: p.larkOpenId,
        source: p.source,
      })),
    );
    setMsg(
      [
        `Đã thêm ${added} liên hệ mới${r.people.length > added ? ` (${r.people.length - added} người đã có, mình cập nhật thêm thông tin)` : ""}.`,
        ...(r.notes ?? []),
      ].join(" · "),
    );
  }

  function addManual() {
    if (!nName.trim()) return;
    if (nEmail.trim() && !isEmail(nEmail)) {
      setMsg("Email chưa đúng định dạng.");
      return;
    }
    saveContact({ name: nName.trim(), email: nEmail.trim() || undefined, company: nCompany.trim() || undefined, source: "manual" });
    setNName("");
    setNEmail("");
    setNCompany("");
    setMsg(null);
  }

  function merge() {
    if (picked.length !== 2) return;
    // Giữ người có email / hay mời hơn; tên người kia thành tên gọi khác.
    const [a, b] = picked.map((id) => contacts.find((c) => c.id === id)!);
    const keep = (a.email ? 1 : 0) + (a.useCount ?? 0) >= (b.email ? 1 : 0) + (b.useCount ?? 0) ? a : b;
    const drop = keep === a ? b : a;
    mergeContactInto(keep.id, drop.id);
    setPicked([]);
    setMsg(`Đã gộp “${drop.name}” vào “${keep.name}”.`);
  }

  const shown = showAll ? list : list.slice(0, 30);

  return (
    <div id="danh-ba" className="card" style={{ display: "flex", flexDirection: "column", gap: 8, scrollMarginTop: 12 }} aria-label="Danh bạ liên hệ">
      <b>📇 Danh bạ liên hệ ({contacts.length})</b>
      {contacts.length === 0 && (
        <span className="small muted">
          Người Mai mời họp sẽ tự vào đây kèm email — lần sau chỉ cần nói tên. Có thể nhập sẵn từ hộp thư và group Lark.
        </span>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn small" disabled={busy} onClick={() => void importNow()}>
          {busy ? "Đang nhập…" : "Nhập từ hộp thư & group Lark"}
        </button>
        {picked.length === 2 && (
          <button className="btn primary small" onClick={merge}>
            Gộp 2 liên hệ
          </button>
        )}
      </div>
      {msg && (
        <div className="note-box small" role="status">
          {msg}
        </div>
      )}
      {contacts.length > 5 && (
        <input
          className="transcript"
          style={{ minHeight: 0, padding: 8 }}
          placeholder="Tìm tên, email, công ty"
          aria-label="Tìm liên hệ"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {shown.map((c) => (
        <ContactRow
          key={c.id}
          c={c}
          selected={picked.includes(c.id)}
          onSelect={(on) => setPicked((p) => (on ? [...p.filter((x) => x !== c.id), c.id].slice(-2) : p.filter((x) => x !== c.id)))}
        />
      ))}
      {list.length > shown.length && (
        <button className="btn ghost small" onClick={() => setShowAll(true)}>
          Xem tất cả ({list.length})
        </button>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="transcript" style={{ minHeight: 0, padding: 8, flex: 1, minWidth: 120 }} placeholder="+ tên" aria-label="Tên liên hệ mới" value={nName} onChange={(e) => setNName(e.target.value)} />
        <input className="transcript" style={{ minHeight: 0, padding: 8, flex: 1, minWidth: 150 }} placeholder="email" type="email" aria-label="Email liên hệ mới" value={nEmail} onChange={(e) => setNEmail(e.target.value)} />
        <input className="transcript" style={{ minHeight: 0, padding: 8, flex: 1, minWidth: 100 }} placeholder="công ty" aria-label="Công ty của liên hệ mới" value={nCompany} onChange={(e) => setNCompany(e.target.value)} />
        <button className="btn small" disabled={!nName.trim()} onClick={addManual}>
          Thêm
        </button>
      </div>
    </div>
  );
}
