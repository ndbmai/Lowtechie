import type { CalEvent } from "./types";

/**
 * Tìm khung giờ trống (PRD §5.4): v1 chỉ dựa trên lịch local, chưa tính
 * múi giờ chuyến đi hay vùng bảo vệ nâng cao. 3 đề xuất kèm lý do.
 */

export interface Slot {
  startAt: string;
  endAt: string;
  reason: string;
}

const DAY_NAMES = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Khoảng trống trong một ngày, trong giờ làm việc. */
export function freeSlotsOnDay(
  events: CalEvent[],
  day: Date,
  durationMin: number,
  workStartHour = 8,
  workEndHour = 18,
): { startAt: Date; endAt: Date }[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), workStartHour);
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), workEndHour);

  const busy = events
    .map((e) => ({ s: new Date(e.startAt).getTime(), e: new Date(e.endAt).getTime() }))
    .filter((b) => overlaps(b.s, b.e, dayStart.getTime(), dayEnd.getTime()))
    .sort((a, b) => a.s - b.s);

  const out: { startAt: Date; endAt: Date }[] = [];
  let cursor = dayStart.getTime();
  for (const b of busy) {
    if (b.s - cursor >= durationMin * 60_000) {
      out.push({ startAt: new Date(cursor), endAt: new Date(b.s) });
    }
    cursor = Math.max(cursor, b.e);
  }
  if (dayEnd.getTime() - cursor >= durationMin * 60_000) {
    out.push({ startAt: new Date(cursor), endAt: dayEnd });
  }
  return out;
}

/**
 * Hạn "chỉ ngày" (0:00 / 9:00 — quy ước fmtDue) nghĩa là HẾT ngày đó;
 * hạn có giờ thật thì đúng giờ đó.
 */
export function deadlineEnd(dueIso: string): number {
  const d = new Date(dueIso);
  const dateOnly = (d.getHours() === 0 || d.getHours() === 9) && d.getMinutes() === 0;
  return dateOnly
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime()
    : d.getTime();
}

/**
 * Đề xuất 3 khung cho MỘT VIỆC (§5.2.2 v3.7 — book lịch từ việc): trước
 * deadline; có `onDay` ("thứ Năm") thì chỉ ngày đó. Hết khung trước hạn
 * → đề xuất sau hạn và báo rõ (`afterDeadline`), không im lặng trả rỗng.
 */
export function proposeTaskSlots(
  events: CalEvent[],
  now: Date,
  durationMin: number,
  opts: { deadline?: string; onDay?: string } = {},
): { slots: Slot[]; afterDeadline: boolean } {
  if (opts.onDay) {
    const d = new Date(opts.onDay);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const from = dayStart.getTime() > now.getTime() ? dayStart : now;
    return { slots: proposeSlots(events, from, durationMin, 1), afterDeadline: false };
  }
  if (opts.deadline) {
    const end = deadlineEnd(opts.deadline);
    const days = Math.min(14, Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000) + 1));
    const before = proposeSlots(events, now, durationMin, days, end);
    if (before.length) return { slots: before, afterDeadline: false };
    return { slots: proposeSlots(events, now, durationMin, 5), afterDeadline: true };
  }
  return { slots: proposeSlots(events, now, durationMin, 5), afterDeadline: false };
}

/** 3 đề xuất tốt nhất trong `days` ngày tới, sáng được ưu tiên; `untilMs` = không vượt mốc này. */
export function proposeSlots(
  events: CalEvent[],
  now: Date,
  durationMin: number,
  days = 5,
  untilMs?: number,
): Slot[] {
  const candidates: { start: Date; score: number; reason: string; busyCount: number }[] = [];

  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const busyCount = events.filter(
      (e) => new Date(e.startAt).toDateString() === day.toDateString(),
    ).length;

    for (const gap of freeSlotsOnDay(events, day, durationMin)) {
      let start = gap.startAt;
      // Hôm nay thì chỉ lấy khung còn ở tương lai (tròn 30 phút kế tiếp).
      if (i === 0) {
        const soonest = new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000);
        if (soonest > start) start = soonest;
        if (gap.endAt.getTime() - start.getTime() < durationMin * 60_000) continue;
      }
      if (untilMs !== undefined && start.getTime() + durationMin * 60_000 > untilMs) continue;
      const morning = start.getHours() < 12;
      const score = (days - i) * 2 + (morning ? 1.5 : 0) - busyCount * 0.5;
      const reason = morning
        ? busyCount <= 1
          ? "Buổi sáng, ngày ít họp"
          : "Buổi sáng, đầu óc còn tươi"
        : busyCount === 0
          ? "Cả ngày đang trống"
          : "Khoảng trống đủ dài buổi chiều";
      candidates.push({ start, score, reason, busyCount });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => ({
      startAt: c.start.toISOString(),
      endAt: new Date(c.start.getTime() + durationMin * 60_000).toISOString(),
      reason: `${DAY_NAMES[c.start.getDay()]} · ${c.reason}`,
    }));
}
