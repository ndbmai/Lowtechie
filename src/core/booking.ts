import { foldName } from "./clients";
import type { CalEvent, Place } from "./types";

/**
 * Việc đặt chỗ nằm TRONG danh sách việc (§5.4.2 v3.7): spa, clinic, salon,
 * phòng khám… tạo sự kiện là có việc "Đặt lịch [nơi] cho [giờ]".
 */

/** Từ khóa trong tên sự kiện cho biết nơi cần đặt trước (PRD v3.7 + salon/làm tóc). */
export const BOOKING_KEYWORDS = [
  "spa",
  "triệt lông",
  "cắt tóc",
  "làm tóc",
  "khám",
  "nha khoa",
  "tiêm",
  "clinic",
  "massage",
  "nail",
  "salon",
] as const;

/** Mặc định khi Mai chưa trả lời "cần đặt trước bao lâu" — sớm an toàn hơn muộn. */
export const DEFAULT_BOOKING_LEAD_DAYS = 3;

const KEYWORD_RES = BOOKING_KEYWORDS.map((k) => ({
  k,
  // Ranh giới chữ trên chuỗi đã bỏ dấu; "khám phá" (đi chơi) không phải đi khám.
  re: new RegExp(`(?:^|[^a-z0-9])${foldName(k)}(?![a-z0-9])${k === "khám" ? "(?!\\s+pha)" : ""}`),
}));

export function bookingKeyword(text: string): string | undefined {
  const t = foldName(text);
  return KEYWORD_RES.find(({ re }) => re.test(t))?.k;
}

/** "Triệt lông tại Ngọc Dung" → "Ngọc Dung"; có địa điểm thì lấy địa điểm. */
export function bookingPlaceName(title: string, location?: string, keyword?: string): string {
  if (location?.trim()) return location.trim();
  const m = title.match(/(?:^|\s)(?:tại|ở|@)\s+(.+)$/iu);
  if (m?.[1]?.trim()) return m[1].trim();
  if (keyword) return keyword.charAt(0).toUpperCase() + keyword.slice(1);
  return title.trim();
}

export type BookingDetection =
  | { kind: "place"; place: Place }
  | { kind: "keyword"; keyword: string; placeName: string }
  | { kind: "none" };

/**
 * Sự kiện này có cần đặt chỗ không: nơi đã lưu thắng (tên dài khớp
 * trước); nơi Mai đã trả lời "không cần" thì thôi; còn lại theo từ khóa.
 */
export function detectBooking(
  title: string,
  location: string | undefined,
  places: Place[],
): BookingDetection {
  const hay = foldName(`${location ?? ""} ${title}`);
  const sorted = [...places].sort((a, b) => b.name.length - a.name.length);
  const place = sorted.find((p) => {
    const n = foldName(p.name);
    if (n.length < 2 || !hay.includes(n)) return false;
    // Nơi chưa từng quyết định chuyện đặt chỗ (ví dụ "Nhà") không che từ khóa.
    return p.needsBooking || p.bookingDecided;
  });
  if (place) return place.needsBooking ? { kind: "place", place } : { kind: "none" };
  const keyword = bookingKeyword(`${title} ${location ?? ""}`);
  if (keyword) return { kind: "keyword", keyword, placeName: bookingPlaceName(title, location, keyword) };
  return { kind: "none" };
}

/**
 * Hạn việc đặt chỗ = ngày hẹn − số ngày đặt trước, 9:00 sáng. Mốc đó đã
 * qua → việc gấp HÔM NAY (giờ kế tiếp). Không bao giờ muộn hơn giờ hẹn.
 */
export function bookingDueAt(startIso: string, leadDays: number, now: Date): string {
  const start = new Date(startIso);
  const due = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() - Math.max(0, leadDays),
    9,
    0,
    0,
    0,
  ).getTime();
  let at = due;
  if (due < now.getTime()) {
    const nineToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9).getTime();
    at = Math.max(nineToday, Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
  }
  return new Date(Math.min(at, start.getTime())).toISOString();
}

/** Lịch CHƯA đặt chỗ trong 7 ngày tới — cho brief sáng ("2 lịch tuần này chưa đặt chỗ"). */
export function unbookedSoon(
  events: Pick<CalEvent, "id" | "startAt" | "bookingStatus">[],
  now: Date,
  days = 7,
): string[] {
  const from = now.getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days + 1).getTime();
  return events
    .filter((e) => {
      const s = Date.parse(e.startAt);
      return e.bookingStatus === "pending" && s >= from && s < to;
    })
    .map((e) => e.id);
}
