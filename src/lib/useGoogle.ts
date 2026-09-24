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
  /** Tài khoản chứa sự kiện (§5.3.4). */
  account?: string;
  accountEmail?: string;
  provider?: "google" | "lark";
  /** Màn chi tiết sự kiện (§5.4.0 v3.7). */
  calendarId?: string;
  calendarName?: string;
  /** Lịch chỉ xem / Mai chỉ là khách mời → không cho sửa/xóa. */
  readOnly?: boolean;
  /** Sự kiện lặp: id của cả chuỗi. */
  seriesId?: string;
  attendees?: string[];
  meetUrl?: string;
  openUrl?: string;
  description?: string;
}

// ── Nhiều tài khoản (§5.3.4) ────────────────────────────────────────────

export interface ConnectedAccount {
  id: string;
  provider: "google" | "lark";
  email?: string;
  gmail: boolean;
  parts: { cal: boolean; mail: boolean; drive: boolean };
}

/** Kết quả "Đồng bộ ngay" một tài khoản (PRD v3.2). */
export interface AccountProbe {
  id: string;
  provider: "google" | "lark";
  email?: string;
  calendars: number;
  events: number;
  /** Chi tiết từng lịch con — soi lịch nào rỗng/lỗi. */
  note?: string;
  error?: { detail: string; action: string };
}

/** Lỗi đọc lịch một tài khoản — kèm hành động rõ ràng (v3.2). */
export interface CalendarSyncError {
  email?: string;
  provider?: "google" | "lark";
  detail: string;
  action?: string;
}

/** Danh sách tài khoản đã nối trên thiết bị này + bật/tắt từng phần. */
export function useAccounts() {
  const [state, setState] = useState<{
    loading: boolean;
    configured: { google: boolean; lark: boolean };
    accounts: ConnectedAccount[];
  }>({ loading: true, configured: { google: false, lark: false }, accounts: [] });

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts");
      const d = (await res.json()) as {
        configured?: { google?: boolean; lark?: boolean };
        accounts?: ConnectedAccount[];
      };
      setState({
        loading: false,
        configured: { google: Boolean(d.configured?.google), lark: Boolean(d.configured?.lark) },
        accounts: d.accounts ?? [],
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setParts = useCallback(
    async (id: string, parts: Partial<ConnectedAccount["parts"]>) => {
      // Đổi ngay trên màn (optimistic) rồi mới ghi cookie — tick không bị trễ.
      setState((s) => ({
        ...s,
        accounts: s.accounts.map((a) =>
          a.id === id ? { ...a, parts: { ...a.parts, ...parts } } : a,
        ),
      }));
      await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, parts }),
      });
      await reload();
    },
    [reload],
  );

  const disconnect = useCallback(
    async (id: string) => {
      await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await reload();
    },
    [reload],
  );

  /** "Đồng bộ ngay" (v3.2): đọc thử từng tài khoản, đếm lịch con + sự kiện. */
  const probe = useCallback(async (fromMs: number, toMs: number): Promise<AccountProbe[] | null> => {
    try {
      const res = await fetch(`/api/accounts?probe=1&fromMs=${fromMs}&toMs=${toMs}`);
      if (!res.ok) return null;
      const d = (await res.json()) as { probe?: AccountProbe[] };
      return d.probe ?? [];
    } catch {
      return null;
    }
  }, []);

  return { ...state, reload, setParts, disconnect, probe };
}

/** Tìm trên TOÀN BỘ lịch Google (quá khứ + tương lai, §5.4.0 v2.3). */
export async function searchGcalEvents(q: string): Promise<GcalEvent[]> {
  try {
    const res = await fetch(`/api/calendar/events?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const d = (await res.json()) as { events?: GcalEvent[] };
    return d.events ?? [];
  } catch {
    return [];
  }
}

/**
 * Sự kiện lịch ngoài (mọi tài khoản bật Lịch) trong khoảng thời gian;
 * [] khi chưa nối. v3.2: trả kèm `errors` (tài khoản đọc lỗi + hành động)
 * và tự làm mới ~15 phút khi màn còn mở — sự kiện mới trên Lark/Google
 * tự xuất hiện, không cần thoát app.
 */
export function useGoogleEvents(fromMs: number, toMs: number, enabled: boolean) {
  const [events, setEvents] = useState<GcalEvent[]>([]);
  const [errors, setErrors] = useState<CalendarSyncError[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/calendar/events?fromMs=${fromMs}&toMs=${toMs}`);
      if (!res.ok) {
        setEvents([]);
        setErrors([]);
        return;
      }
      const d = (await res.json()) as { events: GcalEvent[]; errors?: CalendarSyncError[] };
      setEvents(d.events ?? []);
      setErrors(d.errors ?? []);
    } catch {
      setEvents([]);
      setErrors([]);
    }
  }, [fromMs, toMs, enabled]);

  useEffect(() => {
    void reload();
    if (!enabled) return;
    const t = window.setInterval(() => void reload(), 15 * 60_000);
    return () => window.clearInterval(t);
  }, [reload, enabled]);

  return { events, errors, reload };
}

/**
 * Ghi một block vào lịch ngoài; `accountId` chọn LỊCH ĐÍCH (§5.3.4 —
 * mặc định theo dự án), bỏ trống thì server lấy tài khoản bật Lịch đầu.
 * Trả về id sự kiện + tài khoản đã ghi để lưu kèm block (xóa đúng nơi).
 */
export async function createGcalEvent(
  ev: { title: string; startAt: string; endAt: string; description?: string; location?: string },
  accountId?: string,
): Promise<{ gcalId: string; accountId?: string } | null> {
  try {
    const res = await fetch("/api/calendar/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...ev, accountId }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { gcalId?: string; accountId?: string };
    return d.gcalId ? { gcalId: d.gcalId, accountId: d.accountId } : null;
  } catch {
    return null;
  }
}

export async function deleteGcalEvent(
  gcalId: string,
  account?: string,
  opts: { calendar?: string; notify?: boolean } = {},
): Promise<boolean> {
  try {
    const p = new URLSearchParams();
    if (account) p.set("account", account);
    if (opts.calendar) p.set("calendar", opts.calendar);
    if (opts.notify) p.set("notify", "1");
    const q = p.toString() ? `?${p}` : "";
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(gcalId)}${q}`, { method: "DELETE" });
    return res.ok;
  } catch {
    /* xóa lỗi thì Mai xóa tay trên lịch, block local vẫn gỡ */
    return false;
  }
}

/**
 * Sửa/dời sự kiện trên lịch ngoài (§5.4.0 v3.7) — gọi SAU khi Mai xem thẻ
 * trước → sau và bấm Lưu. `notify` chỉ bật khi Mai đã xác nhận riêng.
 */
export async function patchGcalEvent(
  gcalId: string,
  patch: {
    account?: string;
    calendarId?: string;
    title?: string;
    startAt?: string;
    endAt?: string;
    location?: string;
    description?: string;
    notify?: boolean;
  },
): Promise<boolean> {
  try {
    const res = await fetch(`/api/calendar/events/${encodeURIComponent(gcalId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Gmail: vé máy bay → chuyến đi ứng viên (PRD §5.9) ──────────────────

export interface FlightTripCandidate {
  destination: "tokyo" | "hcmc" | "bkk" | "other";
  destinationName?: string;
  departAt: string;
  /** Giờ hạ cánh chặng đi — cho chuỗi ngày bay hai đầu (v2.0). */
  arriveAt?: string;
  returnAt?: string;
  pnr?: string;
  /** "SGN (nhà ga 2) → BKK" — hướng bay rõ ràng (PRD §5.9 6b). */
  route?: string;
  /** Đệm sân bay theo quy định ghi trên vé (phút). */
  airportBufferMin?: number;
  flights: string;
  subject: string;
  /** Hộp thư tìm thấy vé (§5.3.4). */
  mailbox?: string;
  confidence: number;
}

/** Ref file PDF trong email vé — tải về khi Mai xác nhận chuyến (v2.0). */
export interface GmailAttachmentRef {
  messageId: string;
  attachmentId: string;
  filename: string;
  size: number;
  subject: string;
  /** Tài khoản chứa email (§5.3.4) — thiếu = cookie Google đời đầu. */
  account?: string;
}

export async function fetchFlightTrips(): Promise<
  | {
      ok: true;
      trips: FlightTripCandidate[];
      skipped: string[];
      attachments: GmailAttachmentRef[];
      scanned: number;
      todayLocal: string;
      /** Hộp thư quét lỗi/chưa đọc được (Lark Mail chưa bật…) — §5.3.4. */
      mailboxNotes: string[];
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
          attachments?: GmailAttachmentRef[];
          scanned?: number;
          todayLocal?: string;
          mailboxNotes?: string[];
          detail?: string;
        }
      | null;
    if (!res.ok) return { ok: false, reason: "failed", detail: body?.detail };
    return {
      ok: true,
      trips: body?.trips ?? [],
      skipped: body?.skipped ?? [],
      attachments: body?.attachments ?? [],
      scanned: body?.scanned ?? 0,
      todayLocal: body?.todayLocal ?? "",
      mailboxNotes: body?.mailboxNotes ?? [],
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Tải một file đính kèm Gmail thành Blob (PDF vé); null khi lỗi. */
export async function fetchGmailAttachment(ref: GmailAttachmentRef): Promise<Blob | null> {
  try {
    const p = new URLSearchParams({ messageId: ref.messageId, attachmentId: ref.attachmentId });
    if (ref.account) p.set("account", ref.account);
    const res = await fetch(`/api/gmail/attachment?${p}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: string };
    if (!body.data) return null;
    const bin = atob(body.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = /\.pdf$/i.test(ref.filename) ? "application/pdf" : "application/octet-stream";
    return new Blob([bytes], { type });
  } catch {
    return null;
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
  origin?: string;
  /** Vị trí hiện tại (§5.4.3) — chỉ gửi cho lần tính này. */
  originLatLng?: { lat: number; lng: number };
  destination: string;
  /** "bike" = xe máy: server dùng chế độ hai bánh, không có thì lái xe. */
  mode: "transit" | "drive" | "bike";
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
