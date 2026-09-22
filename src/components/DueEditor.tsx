"use client";

import { useMemo, useState } from "react";
import { duePresets, dueWarnings } from "@/core/due";
import type { CalEvent, DueType, Trip } from "@/core/types";
import { fmtDayFull, fmtTime } from "@/lib/format";

/** ISO → giá trị yyyy-mm-dd cho <input type="date"> theo giờ địa phương. */
function toDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Ô Deadline riêng của từng việc (PRD §5.2.1 3c): nguồn không ghi hạn thì
 * ĐỂ TRỐNG và làm nổi — không đoán; Mai điền bằng nút nhanh, lịch, hoặc
 * chọn rõ "Không có hạn". Hạn luôn hiện dạng đầy đủ để kiểm tra.
 */
export function DueEditor({
  value,
  dueType,
  quote,
  onChange,
  trips,
  events,
}: {
  value?: string;
  dueType?: DueType;
  /** Trích dẫn đoạn nguồn chứa hạn (nếu hạn lấy từ nguồn). */
  quote?: string;
  onChange: (dueAt: string | undefined, dueType: DueType | undefined) => void;
  trips: Pick<Trip, "departAt" | "returnAt">[];
  events: Pick<CalEvent, "startAt" | "endAt">[];
}) {
  const [open, setOpen] = useState(false);
  const [timeText, setTimeText] = useState("");

  const presets = useMemo(() => duePresets(new Date()), []);
  const warnings = useMemo(
    () => (value ? dueWarnings(value, { nowMs: Date.now(), trips, events }) : []),
    [value, trips, events],
  );
  // 0:00 và 9:00 là quy ước "chỉ ngày" — không hiện giờ (lỗi "hạn 30/10 0:00").
  const hasTime = value
    ? !([0, 9].includes(new Date(value).getHours()) && new Date(value).getMinutes() === 0)
    : false;

  function setDate(d: Date) {
    const next = new Date(d);
    if (timeText) {
      const m = timeText.match(/^(\d{1,2}):(\d{2})$/);
      if (m) next.setHours(Number(m[1]), Number(m[2]), 0, 0);
    }
    onChange(next.toISOString(), dueType ?? "soft");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        className="btn small"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: "flex-start",
          width: "100%",
          // Ô trống được làm nổi để Mai tự điền (3c).
          borderColor: value ? undefined : "var(--mai)",
          borderWidth: value ? undefined : 2,
        }}
        aria-expanded={open}
        aria-label="Deadline"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="muted" style={{ fontSize: 11.5 }}>Deadline</span>
        <b style={{ fontWeight: 600 }}>
          {value ? `${fmtDayFull(value)}${hasTime ? `, ${fmtTime(value)}` : ""}` : "Chưa có hạn"}
        </b>
        {value && dueType === "hard" && (
          <span className="small" style={{ background: "#FF8FA3", color: "#fff", borderRadius: 999, padding: "0 8px" }}>
            hạn cứng
          </span>
        )}
        <span className="muted" style={{ marginLeft: "auto" }}>▾</span>
      </button>

      {value && quote && <div className="quote small">{quote}</div>}
      {warnings.length > 0 && (
        <div className="note-box small">⚠ {warnings.join(" · ")} — Mai vẫn giữ được.</div>
      )}

      {open && (
        <div className="card" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p.key} className="btn small" onClick={() => setDate(p.at)}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              className="btn small"
              aria-label="Chọn ngày"
              value={toDateInput(value)}
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split("-").map(Number);
                setDate(new Date(y, m - 1, d, 9, 0, 0, 0));
              }}
            />
            <input
              type="time"
              className="btn small"
              aria-label="Thêm giờ (tùy chọn)"
              value={timeText}
              onChange={(e) => {
                setTimeText(e.target.value);
                if (value && e.target.value) {
                  const m = e.target.value.match(/^(\d{1,2}):(\d{2})$/);
                  if (m) {
                    const next = new Date(value);
                    next.setHours(Number(m[1]), Number(m[2]), 0, 0);
                    onChange(next.toISOString(), dueType ?? "soft");
                  }
                }
              }}
            />
            <span className="seg" role="radiogroup" aria-label="Loại hạn">
              <button aria-pressed={dueType !== "hard"} onClick={() => value && onChange(value, "soft")}>
                mềm
              </button>
              <button aria-pressed={dueType === "hard"} onClick={() => value && onChange(value, "hard")}>
                cứng
              </button>
            </span>
          </div>
          <button
            className="btn ghost small"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              onChange(undefined, undefined);
              setOpen(false);
            }}
          >
            Không có hạn
          </button>
        </div>
      )}
    </div>
  );
}
