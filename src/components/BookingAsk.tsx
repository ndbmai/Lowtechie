"use client";

import { answerBookingAsk, type BookingAsk } from "@/lib/booking";

const LEAD_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Trong ngày", days: 0 },
  { label: "1 ngày", days: 1 },
  { label: "3 ngày", days: 3 },
  { label: "1 tuần", days: 7 },
  { label: "Không cần đặt", days: null },
];

/**
 * Lần đầu gặp một nơi cần đặt chỗ (§5.4.2 v3.7): hỏi ĐÚNG MỘT câu rồi nhớ.
 * Việc đặt chỗ đã có sẵn (mặc định 3 ngày) — trả lời chỉ chỉnh hạn cho đúng.
 */
export function BookingAskCard({ ask, onDone }: { ask: BookingAsk; onDone: (line: string) => void }) {
  return (
    <div className="note-box small" role="group" aria-label="Hỏi thời gian đặt trước">
      <b>{ask.placeName}</b> cần đặt trước bao lâu?
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {LEAD_OPTIONS.map((o) => (
          <button
            key={o.label}
            className={o.days === null ? "btn ghost small" : "btn small"}
            onClick={() => onDone(answerBookingAsk(ask, o.days))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
