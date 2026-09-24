"use client";

import { DEFAULT_BOOKING_LEAD_DAYS, bookingDueAt } from "@/core/booking";
import { shiftIso } from "@/core/eventOps";
import type { CalEvent } from "@/core/types";
import { attachBooking, bookingTaskTitle, type BookingOutcome } from "@/lib/booking";
import { useStore } from "@/lib/store";
import { createGcalEvent, deleteGcalEvent, patchGcalEvent, type GcalEvent } from "@/lib/useGoogle";

/**
 * Sửa · Dời · Xóa · Nhân bản sự kiện ở MỌI nơi (§5.4.0 v3.7): trong app,
 * trên Google/Lark (đúng tài khoản + lịch con), chuỗi block chuẩn bị/di
 * chuyển dời theo, việc đặt chỗ đi theo. Mọi hàm chỉ chạy SAU khi Mai đã
 * xem thẻ trước → sau / xác nhận xóa.
 */

/** Thông tin lịch ngoài của sự kiện chỉ có trên Google/Lark (id "g:…"). */
export type RemoteMeta = Pick<
  GcalEvent,
  | "account"
  | "accountEmail"
  | "provider"
  | "calendarId"
  | "calendarName"
  | "readOnly"
  | "seriesId"
  | "attendees"
  | "meetUrl"
  | "openUrl"
  | "description"
  | "allDay"
>;

export type EventPatch = Partial<Pick<CalEvent, "title" | "startAt" | "endAt" | "location" | "notes">>;

/** Sự kiện Google/Lark → dạng CalEvent của app (id "g:…"), kèm dấu đặt chỗ app gắn thêm. */
export function gcalToCal(g: GcalEvent, booking?: "pending" | "booked"): CalEvent {
  return {
    id: `g:${g.gcalId}`,
    title: g.title,
    startAt: g.startAt,
    endAt: g.endAt,
    location: g.location,
    kind: "event",
    gcalId: g.gcalId,
    bookingStatus: booking,
  };
}

export function remoteMetaOf(g: GcalEvent): RemoteMeta {
  return {
    account: g.account,
    accountEmail: g.accountEmail,
    provider: g.provider,
    calendarId: g.calendarId,
    calendarName: g.calendarName,
    readOnly: g.readOnly,
    seriesId: g.seriesId,
    attendees: g.attendees,
    meetUrl: g.meetUrl,
    openUrl: g.openUrl,
    description: g.description,
    allDay: g.allDay,
  };
}

/** Lưu sửa/dời: trong app + lịch ngoài; chuỗi block dời cùng khoảng; hạn việc đặt chỗ tính lại. */
export async function saveEventEdit(
  ev: CalEvent,
  patch: EventPatch,
  remote?: RemoteMeta,
  opts: { notify?: boolean } = {},
): Promise<{ remoteOk: boolean }> {
  const st = useStore.getState();
  const local = st.events.find((e) => e.id === ev.id);
  const delta = patch.startAt ? Date.parse(patch.startAt) - Date.parse(ev.startAt) : 0;
  const remotePatch = {
    title: patch.title,
    startAt: patch.startAt,
    endAt: patch.endAt,
    location: patch.location,
    description: patch.notes,
    notify: opts.notify,
  };
  let remoteOk = true;

  if (local) {
    st.updateEvent(ev.id, patch);
    if (delta) {
      // Đổi giờ → chuỗi chuẩn bị + di chuyển tự dời theo (§5.4.1).
      for (const b of st.events.filter((x) => x.chainOf === ev.id)) {
        const next = { startAt: shiftIso(b.startAt, delta), endAt: shiftIso(b.endAt, delta) };
        st.updateEvent(b.id, next);
        if (b.gcalId) void patchGcalEvent(b.gcalId, { account: b.calAccount, ...next });
      }
      bumpBookingTasks(ev.id, patch.startAt!, local.placeId);
    }
    if (local.gcalId) remoteOk = await patchGcalEvent(local.gcalId, { account: local.calAccount, ...remotePatch });
  } else if (ev.gcalId) {
    remoteOk = await patchGcalEvent(ev.gcalId, {
      account: remote?.account,
      calendarId: remote?.calendarId,
      ...remotePatch,
    });
    if (remoteOk && delta) bumpBookingTasks(ev.id, patch.startAt!, undefined);
  }
  return { remoteOk };
}

/** Sự kiện dời giờ → việc "Đặt lịch…" gắn với nó đổi tên + hạn theo giờ mới. */
function bumpBookingTasks(eventId: string, newStart: string, placeId: string | undefined) {
  const st = useStore.getState();
  const place = placeId ? st.places.find((p) => p.id === placeId) : undefined;
  for (const t of st.tasks) {
    if (t.bookingEventId !== eventId || (t.status !== "todo" && t.status !== "doing")) continue;
    const name = t.title.match(/^Đặt lịch (.+?) cho /)?.[1];
    if (name) st.updateTaskTitle(t.id, bookingTaskTitle(name, newStart));
    st.setTaskDue(
      t.id,
      bookingDueAt(newStart, place?.bookingLeadDays ?? DEFAULT_BOOKING_LEAD_DAYS, new Date()),
      "hard",
    );
  }
}

export interface DeleteOutcome {
  remoteOk: boolean;
  /** Hoàn tác trong vài phút — trả về dòng báo lại cho Mai. */
  undo: () => Promise<string>;
}

/**
 * Xóa sự kiện + chuỗi block (+ việc đặt chỗ nếu Mai đồng ý). Sự kiện lặp:
 * `series` = xóa cả chuỗi. `notify` = báo hủy cho người được mời (Mai đã
 * xác nhận riêng). Hoàn tác: sự kiện trong app trả về nguyên vẹn; bản
 * trên lịch ngoài được TẠO LẠI (không kèm người mời/lặp lại).
 */
export async function deleteEventEverywhere(
  ev: CalEvent,
  remote: RemoteMeta | undefined,
  opts: { series?: boolean; notify?: boolean; dropBookingTask?: boolean } = {},
): Promise<DeleteOutcome> {
  const st = useStore.getState();
  const local = st.events.find((e) => e.id === ev.id);
  let remoteOk = true;
  if (local) {
    const withRemote = st.events.filter((e) => (e.id === ev.id || e.chainOf === ev.id) && e.gcalId);
    const results = await Promise.all(
      withRemote.map((e) => deleteGcalEvent(e.gcalId!, e.calAccount, { notify: opts.notify && e.id === ev.id })),
    );
    remoteOk = results.every(Boolean);
  } else if (ev.gcalId) {
    const id = opts.series && remote?.seriesId ? remote.seriesId : ev.gcalId;
    remoteOk = await deleteGcalEvent(id, remote?.account, {
      calendar: remote?.calendarId,
      notify: opts.notify,
    });
    if (!remoteOk) return { remoteOk, undo: async () => "Chưa xóa được nên không cần hoàn tác." };
  }
  const entry = st.trashEvent(ev.id, { dropBookingTasks: opts.dropBookingTask });

  const undo = async (): Promise<string> => {
    const s2 = useStore.getState();
    const restored = entry ? s2.restoreTrash(entry.id) : null;
    if (local && restored) {
      // Bản trên lịch ngoài đã xóa → tạo lại, ghi id mới vào block.
      for (const e of restored.filter((x) => x.gcalId)) {
        const created = await createGcalEvent(
          { title: e.title, startAt: e.startAt, endAt: e.endAt, location: e.location, description: e.notes },
          e.calAccount,
        );
        s2.updateEvent(e.id, { gcalId: created?.gcalId, calAccount: created?.accountId ?? e.calAccount });
      }
      return `Đã hoàn tác — “${ev.title}” trở lại lịch.`;
    }
    if (!local && ev.gcalId) {
      if (opts.series)
        return `Mở lại việc đi kèm rồi — nhưng chuỗi lặp “${ev.title}” phải tạo lại trên ${remote?.provider === "lark" ? "Lark" : "Google"}.`;
      const created = await createGcalEvent(
        {
          title: ev.title,
          startAt: ev.startAt,
          endAt: ev.endAt,
          location: ev.location,
          description: remote?.description,
        },
        remote?.account,
      );
      return created
        ? `Đã tạo lại “${ev.title}” (không kèm người được mời).`
        : `Tạo lại “${ev.title}” không thành — Mai kiểm tra kết nối lịch giúp mình.`;
    }
    return `Đã hoàn tác — “${ev.title}” trở lại lịch.`;
  };
  return { remoteOk, undo };
}

/** Nhân bản sang giờ mới (giữ thời lượng, địa điểm, dự án) — tùy chọn book lên lịch đích. */
export async function duplicateEvent(
  ev: CalEvent,
  startAt: string,
  opts: { book?: boolean; accountId?: string } = {},
): Promise<{ event: CalEvent; booking: BookingOutcome; remoteOk: boolean }> {
  const st = useStore.getState();
  const dur = Date.parse(ev.endAt) - Date.parse(ev.startAt);
  const endAt = new Date(Date.parse(startAt) + dur).toISOString();
  let gcalId: string | undefined;
  let calAccount: string | undefined;
  let remoteOk = true;
  if (opts.book) {
    const created = await createGcalEvent(
      { title: ev.title, startAt, endAt, location: ev.location, description: ev.notes },
      opts.accountId,
    );
    gcalId = created?.gcalId;
    calAccount = created?.accountId;
    remoteOk = Boolean(created);
  }
  const copy = st.addEvent({
    title: ev.title,
    startAt,
    endAt,
    location: ev.location,
    kind: ev.kind === "block" ? "block" : "event",
    projectId: ev.projectId,
    categoryId: ev.categoryId,
    clientId: ev.clientId,
    notes: ev.notes,
    linkUrl: ev.linkUrl,
    gcalId,
    calAccount,
  });
  return { event: copy, booking: attachBooking(copy), remoteOk };
}
