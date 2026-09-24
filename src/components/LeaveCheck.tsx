"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultModeForCity } from "@/core/location";
import type { CalEvent } from "@/core/types";
import { fmtTime } from "@/lib/format";
import { applyPosition, getDevicePosition, POSITION_ERROR } from "@/lib/location";
import { useStore } from "@/lib/store";
import { fetchRoute } from "@/lib/useGoogle";

/** Đệm đến sớm + rời nhà (phút) — cùng quy ước chuỗi tính ngược §5.4.1. */
const ARRIVE_EARLY_MIN = 10;
const LEAVE_BUFFER_MIN = 10;

/**
 * Kiểm tra lại trước giờ đi (§5.4.3 v3.7): so vị trí hiện tại với điểm hẹn,
 * tính lại theo giao thông lúc này — trễ thì báo "đi ngay". Tọa độ chỉ gửi
 * cho lần tính, không lưu.
 */
export function LeaveCheck({ event, auto }: { event: CalEvent; auto: boolean }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "ok"; totalMin: number; leaveAt: number; mode: "transit" | "car" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const ran = useRef(false);

  const check = useCallback(async () => {
    setState({ kind: "busy" });
    const pos = await getDevicePosition();
    if (!pos.ok) {
      setState({ kind: "error", message: POSITION_ERROR[pos.reason] });
      return;
    }
    const { city } = applyPosition(pos.lat, pos.lng);
    const mode = defaultModeForCity(city ?? "bkk");
    const start = Date.parse(event.startAt);
    const r = await fetchRoute({
      originLatLng: { lat: pos.lat, lng: pos.lng },
      destination: event.location!,
      mode: mode === "car" ? "drive" : "transit",
      arriveByMs: start - ARRIVE_EARLY_MIN * 60_000,
    });
    if (!r.ok) {
      setState({ kind: "error", message: `Maps chưa tính được (${r.detail}).` });
      return;
    }
    const leaveAt = start - (ARRIVE_EARLY_MIN + LEAVE_BUFFER_MIN + r.route.totalMin) * 60_000;
    setState({ kind: "ok", totalMin: r.route.totalMin, leaveAt, mode });
  }, [event.startAt, event.location]);

  useEffect(() => {
    if (!auto || ran.current) return;
    ran.current = true;
    void check();
  }, [auto, check]);

  const arrived = useStore((s) => s.events.find((e) => e.id === event.id)?.arrivedAt);
  const dirUrl = (mode: "transit" | "car") =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(event.location ?? "")}&travelmode=${mode === "car" ? "driving" : "transit"}`;

  if (arrived) {
    return (
      <div className="note-box small">
        ✓ Đã tới <b>{event.title}</b> ({fmtTime(event.startAt)}).
      </div>
    );
  }
  return (
    <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span>
        🕐 <b>{event.title}</b> lúc {fmtTime(event.startAt)} · {event.location}
      </span>
      {state.kind === "idle" && (
        <button className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => void check()}>
          📍 Tính giờ đi theo vị trí hiện tại
        </button>
      )}
      {state.kind === "busy" && <span className="muted">Đang hỏi vị trí + Google Maps…</span>}
      {state.kind === "error" && <span>{state.message}</span>}
      {state.kind === "ok" &&
        (Date.now() >= state.leaveAt ? (
          <b>
            🏃 Đi ngay — mất ~{state.totalMin} phút
            {Date.now() > state.leaveAt + 60_000
              ? `, có thể trễ ~${Math.round((Date.now() - state.leaveAt) / 60_000)} phút`
              : ""}
            .
          </b>
        ) : (
          <span>
            Rời lúc <b>{fmtTime(new Date(state.leaveAt).toISOString())}</b> là kịp (mất ~{state.totalMin} phút theo
            giao thông lúc này).
          </span>
        ))}
      {state.kind === "ok" && (
        <a className="btn ghost small" style={{ textDecoration: "none", alignSelf: "flex-start" }} href={dirUrl(state.mode)} target="_blank" rel="noreferrer">
          Mở chỉ đường
        </a>
      )}
    </div>
  );
}
