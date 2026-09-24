"use client";

import { DEFAULT_BOOKING_LEAD_DAYS, bookingDueAt, detectBooking } from "@/core/booking";
import { foldName } from "@/core/clients";
import { sanitizeTaxonomy } from "@/core/projects";
import { fmtDayFull, fmtDayTime } from "@/lib/format";
import { useStore } from "@/lib/store";

/**
 * Việc đặt chỗ nằm TRONG danh sách việc (§5.4.2 v3.7): tạo sự kiện ở
 * spa/clinic/salon… là tự có việc "Đặt lịch [nơi] cho [giờ]" (Cá nhân ·
 * Sức khỏe & làm đẹp), hiện ở Hôm nay như mọi việc — không phải thông báo
 * trôi qua. Lần đầu gặp một nơi thì hỏi MỘT câu "cần đặt trước bao lâu".
 */

export interface BookingAsk {
  placeName: string;
  eventId: string;
  taskId: string;
  startAt: string;
}

export interface BookingOutcome {
  taskId?: string;
  /** Lần đầu gặp nơi này → hỏi đúng một câu (việc đã tạo với mặc định 3 ngày). */
  ask?: BookingAsk;
  line?: string;
}

export function bookingTaskTitle(placeName: string, startIso: string): string {
  return `Đặt lịch ${placeName} cho ${fmtDayTime(startIso)}`;
}

/**
 * Gọi NGAY SAU khi tạo một sự kiện. `id` bắt đầu bằng "g:" = sự kiện chỉ có
 * trên Google/Lark (trạng thái giữ ở eventMarks).
 */
export function attachBooking(ev: {
  id: string;
  title: string;
  startAt: string;
  location?: string;
}): BookingOutcome {
  const st = useStore.getState();
  if (st.tasks.some((t) => t.bookingEventId === ev.id && t.status !== "dropped")) return {};
  const det = detectBooking(ev.title, ev.location, st.places);
  if (det.kind === "none") return {};
  const placeName = det.kind === "place" ? det.place.name : det.placeName;
  const lead = det.kind === "place" ? det.place.bookingLeadDays : DEFAULT_BOOKING_LEAD_DAYS;
  const { projectId, categoryId } = sanitizeTaxonomy(st.projects, st.categories, "canhan", "canhan:suckhoe");
  const dueAt = bookingDueAt(ev.startAt, lead, new Date());
  const task = st.addTask({
    title: bookingTaskTitle(placeName, ev.startAt),
    projectId,
    categoryId,
    assignee: "mai",
    dueAt,
    dueType: "hard",
    dueSource: "nguon",
    source: {
      channel: "manual",
      quote:
        det.kind === "place"
          ? `“${ev.title}” — ${placeName} cần đặt trước ${lead} ngày`
          : `“${ev.title}” — nơi cần đặt chỗ (từ khóa “${det.keyword}”)`,
    },
    confidence: 1,
    bookingEventId: ev.id,
  });
  if (ev.id.startsWith("g:")) st.setEventMark(ev.id, { booking: "pending" });
  else
    st.updateEvent(ev.id, {
      bookingStatus: "pending",
      placeId: det.kind === "place" ? det.place.id : undefined,
    });
  const line = `🔖 Đã thêm việc “${task.title}” (hạn ${fmtDayFull(dueAt)}) vào danh sách việc.`;
  return det.kind === "place"
    ? { taskId: task.id, line }
    : { taskId: task.id, line, ask: { placeName, eventId: ev.id, taskId: task.id, startAt: ev.startAt } };
}

/**
 * Mai trả lời "nơi này cần đặt trước bao lâu": nhớ vào danh bạ nơi (lần
 * sau không hỏi), cập nhật hạn việc; "không cần" → bỏ việc + gỡ trạng thái.
 */
export function answerBookingAsk(ask: BookingAsk, leadDays: number | null): string {
  const st = useStore.getState();
  const existing = st.places.find((p) => foldName(p.name) === foldName(ask.placeName));
  if (leadDays === null) {
    if (existing) st.updatePlace(existing.id, { needsBooking: false, bookingDecided: true });
    else st.addPlace({ name: ask.placeName, needsBooking: false, bookingLeadDays: 0, bookingDecided: true });
    st.dropTask(ask.taskId);
    st.setEventBooking(ask.eventId, undefined);
    return `Ok, ${ask.placeName} không cần đặt trước — mình nhớ rồi, lần sau không hỏi nữa.`;
  }
  const place = existing
    ? (st.updatePlace(existing.id, { needsBooking: true, bookingLeadDays: leadDays, bookingDecided: true }),
      existing)
    : st.addPlace({ name: ask.placeName, needsBooking: true, bookingLeadDays: leadDays, bookingDecided: true });
  const due = bookingDueAt(ask.startAt, leadDays, new Date());
  st.setTaskDue(ask.taskId, due, "hard");
  if (place && !ask.eventId.startsWith("g:")) st.updateEvent(ask.eventId, { placeId: place.id });
  return `Đã nhớ: ${ask.placeName} đặt trước ${leadDays} ngày — việc đặt chỗ hạn ${fmtDayFull(due)}.`;
}
