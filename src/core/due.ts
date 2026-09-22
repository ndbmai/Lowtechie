import type { CalEvent, Trip } from "./types";

/**
 * Deadline cho từng việc (PRD §5.2.1 3c).
 *
 * Nguồn không ghi hạn → ô Deadline ĐỂ TRỐNG, không đoán; Mai điền bằng
 * nút chọn nhanh / lịch / gõ tự do. Hạn chỉ có ngày lưu 9:00 sáng giờ
 * địa phương (cùng quy ước với parse.ts).
 */

export interface DuePreset {
  key: string;
  label: string;
  at: Date;
}

function atMorning(d: Date): Date {
  const x = new Date(d);
  x.setHours(9, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Nút điền nhanh: Hôm nay · Ngày mai · Thứ Sáu này · Tuần sau · Cuối tháng. */
export function duePresets(now: Date): DuePreset[] {
  // "Thứ Sáu này": thứ Sáu sắp tới (hôm nay là thứ Sáu → chính hôm nay).
  const dow = now.getDay(); // CN=0 … T7=6
  const toFriday = (5 - dow + 7) % 7;
  const friday = atMorning(addDays(now, toFriday));
  // "Tuần sau": thứ Hai kế tiếp sau hôm nay.
  const nextMonday = atMorning(addDays(now, ((1 - dow + 7) % 7) || 7));
  // "Cuối tháng": ngày cuối của tháng hiện tại.
  const endOfMonth = atMorning(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return [
    { key: "today", label: "Hôm nay", at: atMorning(now) },
    { key: "tomorrow", label: "Ngày mai", at: atMorning(addDays(now, 1)) },
    { key: "friday", label: "Thứ Sáu này", at: friday },
    { key: "nextweek", label: "Tuần sau", at: nextMonday },
    { key: "endmonth", label: "Cuối tháng", at: endOfMonth },
  ];
}

function sameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Cảnh báo nhẹ khi điền hạn (PRD 3c) — Mai vẫn giữ được:
 * hạn đã qua · rơi vào ngày bay · ngày đã dày lịch.
 */
export function dueWarnings(
  dueAtIso: string,
  ctx: { nowMs: number; trips: Pick<Trip, "departAt" | "returnAt">[]; events: Pick<CalEvent, "startAt" | "endAt">[] },
): string[] {
  const due = Date.parse(dueAtIso);
  if (!Number.isFinite(due)) return [];
  const out: string[] = [];
  if (due < ctx.nowMs) out.push("hạn đã qua");
  for (const t of ctx.trips) {
    if (
      sameLocalDay(due, Date.parse(t.departAt)) ||
      (t.returnAt && sameLocalDay(due, Date.parse(t.returnAt)))
    ) {
      out.push("rơi vào ngày Mai bay");
      break;
    }
  }
  const busyMin = ctx.events
    .filter((e) => sameLocalDay(due, Date.parse(e.startAt)))
    .reduce((sum, e) => sum + Math.max(0, (Date.parse(e.endAt) - Date.parse(e.startAt)) / 60_000), 0);
  if (busyMin >= 6 * 60) out.push("ngày đó lịch đã dày");
  return out;
}
