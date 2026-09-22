import type { ProjectId } from "./types";

/**
 * Hẹn định kỳ dài hạn (PRD §5.4.0 v2.3) — gia hạn visa mỗi 3 tháng, khám
 * định kỳ mỗi năm… Chu kỳ tính lại từ NGÀY LÀM THẬT ("gia hạn xong hôm
 * nay, lần sau sau 3 tháng"), không bám máy móc lịch kế hoạch.
 * Mọi ngày là chuỗi "yyyy-mm-dd" (không giờ, không múi giờ).
 */

export type SeriesUnit = "day" | "week" | "month" | "year";

export interface RecurringSeries {
  id: string;
  title: string;
  intervalUnit: SeriesUnit;
  intervalCount: number;
  /** Ngày kế hoạch của LẦN KẾ TIẾP (yyyy-mm-dd). */
  nextDate: string;
  /** Nhắc trước bao nhiêu ngày (mặc định 30/14/7/1). */
  reminderOffsets: number[];
  /** Mẫu việc chuẩn bị, mỗi dòng một việc — tự vào Hộp duyệt trước hẹn. */
  prepTemplate: string;
  projectId: ProjectId;
  categoryId?: string;
  isHard: boolean;
  /** Lịch sử từng lần: kế hoạch + ngày làm thật + ghi chú. */
  history: { plannedDate: string; actualDate: string; notes?: string }[];
  /** nextDate đã tạo việc chuẩn bị rồi (chống tạo lại mỗi lần mở app). */
  prepCreatedFor?: string;
}

export const DEFAULT_REMINDER_OFFSETS = [30, 14, 7, 1];
export const DEFAULT_PREP_TEMPLATE = "Chuẩn bị giấy tờ\nĐặt lịch hẹn";

function toParts(dateIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

function fromParts(y: number, m: number, d: number): string {
  // Ngày tháng thuần — dùng UTC noon để không lệch vì múi giờ.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Cộng chu kỳ, kẹp cuối tháng (31/1 + 1 tháng = 28/2). */
export function addInterval(dateIso: string, unit: SeriesUnit, count: number): string {
  const { y, m, d } = toParts(dateIso);
  if (unit === "day") return fromParts(y, m, d + count);
  if (unit === "week") return fromParts(y, m, d + 7 * count);
  const months = unit === "month" ? count : 12 * count;
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Số ngày (địa phương thiết bị) từ hôm nay đến một ngày kế hoạch. */
export function daysUntil(dateIso: string, now: Date): number {
  const { y, m, d } = toParts(dateIso);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

/**
 * Ghi nhận đã làm xong một lần (ngày thật) → lần sau = ngày thật + chu kỳ
 * (v2.3: "tính theo ngày thực tế").
 */
export function completeOccurrence(
  s: RecurringSeries,
  actualDateIso: string,
  notes?: string,
): RecurringSeries {
  const actual = actualDateIso.slice(0, 10);
  return {
    ...s,
    history: [{ plannedDate: s.nextDate, actualDate: actual, notes }, ...s.history].slice(0, 50),
    nextDate: addInterval(actual, s.intervalUnit, s.intervalCount),
    prepCreatedFor: undefined,
  };
}

/** Mốc nhắc đang hiệu lực (band nhỏ nhất bao số ngày còn lại), null nếu còn xa/đã qua. */
export function activeReminder(s: RecurringSeries, now: Date): number | null {
  const left = daysUntil(s.nextDate, now);
  if (left < 0) return null;
  const within = s.reminderOffsets.filter((o) => left <= o);
  return within.length ? Math.min(...within) : null;
}

/** Ngày này có phải ngày hẹn (kế tiếp hoặc một lần trong lịch sử)? */
export function isSeriesDay(s: RecurringSeries, date: Date): boolean {
  const iso = fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return s.nextDate === iso || s.history.some((h) => h.actualDate === iso);
}

/** Nhãn chu kỳ: "mỗi 3 tháng", "mỗi năm", "mỗi 90 ngày". */
export function intervalLabel(unit: SeriesUnit, count: number): string {
  const name = unit === "day" ? "ngày" : unit === "week" ? "tuần" : unit === "month" ? "tháng" : "năm";
  return count === 1 ? `mỗi ${name}` : `mỗi ${count} ${name}`;
}
