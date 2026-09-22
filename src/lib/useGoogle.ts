"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalEvent } from "@/core/types";

/** Trạng thái nối Google + dịch vụ server (Maps, Claude) của thiết bị này. */
export function useGoogleStatus() {
  const [state, setState] = useState<{
    loading: boolean;
    configured: boolean;
    connected: boolean;
    email?: string;
    gmail: boolean;
    maps: boolean;
    claude: boolean;
  }>({ loading: true, configured: false, connected: false, gmail: false, maps: false, claude: false });

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status");
      const d = (await res.json()) as {
        configured: boolean;
        connected: boolean;
        email?: string;
        gmail?: boolean;
        maps?: boolean;
        claude?: boolean;
      };
      setState({
        loading: false,
        configured: d.configured,
        connected: d.connected,
        email: d.email,
        gmail: Boolean(d.gmail),
        maps: Boolean(d.maps),
        claude: Boolean(d.claude),
      });
    } catch {
      setState({ loading: false, configured: false, connected: false, gmail: false, maps: false, claude: false });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const disconnect = useCallback(async () => {
    await fetch("/api/google/disconnect", { method: "POST" });
    await reload();
  }, [reload]);

  return { ...state, reload, disconnect };
}

export interface GcalEvent extends Omit<CalEvent, "id" | "kind"> {
  gcalId: string;
  allDay?: boolean;
}

/** Sự kiện Google trong khoảng thời gian; [] khi chưa nối. */
export function useGoogleEvents(fromMs: number, toMs: number, enabled: boolean) {
  const [events, setEvents] = useState<GcalEvent[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/calendar/events?fromMs=${fromMs}&toMs=${toMs}`);
      if (!res.ok) {
        setEvents([]);
        return;
      }
      const d = (await res.json()) as { events: GcalEvent[] };
      setEvents(d.events ?? []);
    } catch {
      setEvents([]);
    }
  }, [fromMs, toMs, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { events, reload };
}

/** Ghi một block vào Google Calendar; trả gcalId hoặc null nếu lỗi. */
export async function createGcalEvent(ev: {
  title: string;
  startAt: string;
  endAt: string;
  description?: string;
}): Promise<string | null> {
  try {
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ev),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { gcalId?: string };
    return d.gcalId ?? null;
  } catch {
    return null;
  }
}

export async function deleteGcalEvent(gcalId: string): Promise<void> {
  try {
    await fetch(`/api/calendar/events/${encodeURIComponent(gcalId)}`, { method: "DELETE" });
  } catch {
    /* xóa lỗi thì Mai xóa tay trên Google, block local vẫn gỡ */
  }
}

// ── Gmail: vé máy bay → chuyến đi ứng viên (PRD §5.9) ──────────────────

export interface FlightTripCandidate {
  destination: "tokyo" | "hcmc" | "bkk" | "other";
  destinationName?: string;
  departAt: string;
  returnAt?: string;
  pnr?: string;
  /** "SGN (nhà ga 2) → BKK" — hướng bay rõ ràng (PRD §5.9 6b). */
  route?: string;
  /** Đệm sân bay theo quy định ghi trên vé (phút). */
  airportBufferMin?: number;
  flights: string;
  subject: string;
  confidence: number;
}

export async function fetchFlightTrips(): Promise<
  | {
      ok: true;
      trips: FlightTripCandidate[];
      skipped: string[];
      scanned: number;
      todayLocal: string;
    }
  | { ok: false; reason: "no-gmail-scope" | "no-key" | "not-connected" | "failed"; detail?: string }
> {
  try {
    // Mốc thời gian thật của thiết bị Mai đi kèm mọi lần trích (PRD §5.9/§7).
    const p = new URLSearchParams({
      epochMs: String(Date.now()),
      tzOffsetMin: String(new Date().getTimezoneOffset()),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const res = await fetch(`/api/gmail/flights?${p}`);
    if (res.status === 403) return { ok: false, reason: "no-gmail-scope" };
    if (res.status === 501) return { ok: false, reason: "no-key" };
    if (res.status === 401) return { ok: false, reason: "not-connected" };
    const body = (await res.json().catch(() => null)) as
      | {
          trips?: FlightTripCandidate[];
          skipped?: string[];
          scanned?: number;
          todayLocal?: string;
          detail?: string;
        }
      | null;
    if (!res.ok) return { ok: false, reason: "failed", detail: body?.detail };
    return {
      ok: true,
      trips: body?.trips ?? [],
      skipped: body?.skipped ?? [],
      scanned: body?.scanned ?? 0,
      todayLocal: body?.todayLocal ?? "",
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

// ── Google Maps Routes: thời gian di chuyển (PRD §5.4.1) ───────────────

export interface RouteResult {
  mode: "transit" | "drive";
  totalMin: number;
  driveMin?: number;
  walkToMin?: number;
  transitMin?: number;
  walkFromMin?: number;
}

export async function fetchRoute(params: {
  origin: string;
  destination: string;
  mode: "transit" | "drive";
  arriveByMs: number;
}): Promise<{ ok: true; route: RouteResult } | { ok: false; detail: string }> {
  try {
    const res = await fetch("/api/maps/route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => null)) as (RouteResult & { detail?: string }) | null;
    if (res.status === 501) return { ok: false, detail: "Server chưa có GOOGLE_MAPS_API_KEY" };
    if (!res.ok || !body) return { ok: false, detail: body?.detail ?? `mã ${res.status}` };
    return { ok: true, route: body };
  } catch {
    return { ok: false, detail: "mạng chập chờn" };
  }
}
