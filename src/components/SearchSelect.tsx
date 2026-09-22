"use client";

import { useRef, useState } from "react";

export interface PickOption {
  id: string;
  label: string;
  /** Chữ phụ cạnh nhãn, ví dụ loại khách "đối tác". */
  hint?: string;
  /** Chấm màu (dự án). */
  color?: string;
}

function norm(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/**
 * Ô chọn có tìm kiếm + "Tạo mới: …" tại chỗ (PRD §5.2.1 3b): gõ vài chữ
 * để lọc, không có kết quả thì tạo ngay, không phải rời thẻ duyệt.
 * Không phải danh sách phẳng dài — mỗi trường (Dự án / Category / Khách)
 * là một ô riêng.
 */
export function SearchSelect({
  label,
  value,
  options,
  onPick,
  onCreate,
  emptyLabel,
  placeholder,
}: {
  label: string;
  value?: string;
  options: PickOption[];
  onPick: (id: string | undefined) => void;
  /** Có mặt = cho phép tạo mới tại chỗ; trả về sau khi tạo + chọn. */
  onCreate?: (name: string) => void;
  /** Nhãn lựa chọn bỏ trống (trường không bắt buộc), ví dụ "Không có". */
  emptyLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const current = options.find((o) => o.id === value);
  const filtered = q.trim()
    ? options.filter((o) => norm(`${o.label} ${o.hint ?? ""}`).includes(norm(q.trim())))
    : options;
  const exact = options.some((o) => norm(o.label) === norm(q.trim()));

  function pick(id: string | undefined) {
    onPick(id);
    setOpen(false);
    setQ("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        className="btn small"
        style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-start", width: "100%" }}
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setOpen((v) => !v);
          setQ("");
          setTimeout(() => inputRef.current?.focus(), 30);
        }}
      >
        <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
        {current?.color && (
          <span style={{ width: 10, height: 10, borderRadius: 4, background: current.color, flex: "0 0 10px" }} />
        )}
        <b style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1, textAlign: "left" }}>
          {current ? current.label : (emptyLabel ?? "— chọn —")}
        </b>
        {current?.hint && <span className="muted small" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{current.hint}</span>}
        <span className="muted" style={{ flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div
          className="card"
          style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 8px 20px -12px rgba(30,33,80,.4)" }}
        >
          <input
            ref={inputRef}
            className="transcript"
            style={{ minHeight: 0, padding: "7px 10px" }}
            placeholder={placeholder ?? "Gõ để lọc…"}
            value={q}
            aria-label={`Tìm ${label}`}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {emptyLabel && !q.trim() && (
              <button
                className="btn ghost small"
                style={{ justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => pick(undefined)}
              >
                — {emptyLabel} —
              </button>
            )}
            {filtered.map((o) => (
              <button
                key={o.id}
                className="btn ghost small"
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  background: o.id === value ? "var(--surface-2)" : undefined,
                }}
                onClick={() => pick(o.id)}
              >
                {o.color && (
                  <span style={{ width: 10, height: 10, borderRadius: 4, background: o.color, flex: "0 0 10px" }} />
                )}
                <span>{o.label}</span>
                {o.hint && <span className="muted small">{o.hint}</span>}
              </button>
            ))}
            {filtered.length === 0 && !onCreate && (
              <span className="muted small" style={{ padding: "4px 8px" }}>Không có kết quả.</span>
            )}
            {onCreate && q.trim() && !exact && (
              <button
                className="btn small"
                style={{ justifyContent: "flex-start", textAlign: "left", borderStyle: "dashed" }}
                onClick={() => {
                  onCreate(q.trim());
                  setOpen(false);
                  setQ("");
                }}
              >
                ＋ Tạo mới: “{q.trim()}”
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
