"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalEvent } from "@/core/types";

/** Trạng thái nối Google Calendar của thiết bị này. */
export function useGoogleStatus() {
  const [state, setState] = useState<{
    loading: boolean;
    configured: boolean;
    connected: boolean;
    email?: string;
  }>({ loading: true, configured: false, connected: false });

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status");
      const d = (await res.json()) as { configured: boolean; connected: boolean; email?: string };
      setState({ loading: false, ...d });
    } catch {
      setState({ loading: false, configured: false, connected: false });
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
