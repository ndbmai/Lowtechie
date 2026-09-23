import type { BannerEvent } from "./types";

/**
 * Ảnh banner sự kiện → lịch (PRD §5.1.1 v3.0) — phần logic thuần:
 * AI chỉ trích thô (kể cả suy năm theo mốc thời gian thực); việc kiểm
 * "đã diễn ra chưa", "thiếu giờ phải hỏi" và chống trùng là của CODE.
 */

export type BannerTiming =
  /** Ngày trên banner đã qua → báo "đã diễn ra", không tạo lịch. */
  | { status: "past" }
  /** Thiếu giờ hoặc nhiều khung giờ → hỏi Mai đúng một câu. */
  | { status: "needs-time"; options: string[] }
  | { status: "ok"; startAt: string; endAt: string };

const DEFAULT_DURATION_MIN = 120;

export function resolveBannerTiming(ev: BannerEvent, nowMs: number): BannerTiming {
  const futureOptions = (ev.timeOptions ?? []).filter((o) => {
    const t = Date.parse(o);
    return Number.isFinite(t) && t > nowMs;
  });

  if (!ev.startAt || Number.isNaN(Date.parse(ev.startAt))) {
    // Không có giờ chắc chắn: còn ứng viên tương lai → hỏi chọn; toàn
    // ứng viên quá khứ → sự kiện đã diễn ra; không có gì → hỏi giờ tay.
    if ((ev.timeOptions?.length ?? 0) > 0 && futureOptions.length === 0) return { status: "past" };
    return { status: "needs-time", options: futureOptions.slice(0, 3) };
  }

  // Banner ghi nhiều khung giờ → vẫn để Mai chọn, không tự lấy một cái.
  if (futureOptions.length > 1) return { status: "needs-time", options: futureOptions.slice(0, 3) };

  const start = Date.parse(ev.startAt);
  const end =
    ev.endAt && !Number.isNaN(Date.parse(ev.endAt))
      ? Date.parse(ev.endAt)
      : start + DEFAULT_DURATION_MIN * 60_000;
  // Sự kiện đang diễn ra (bắt đầu rồi nhưng chưa kết thúc) vẫn tạo được.
  if (end <= nowMs) return { status: "past" };
  return {
    status: "ok",
    startAt: ev.startAt,
    endAt: ev.endAt && !Number.isNaN(Date.parse(ev.endAt)) ? ev.endAt : new Date(end).toISOString(),
  };
}

/** Ghi chú đính vào sự kiện: tổ chức, giá, hạn đăng ký, yêu cầu (v3.0). */
export function bannerNote(ev: BannerEvent): string {
  return [
    ev.organizer && `Tổ chức: ${ev.organizer}`,
    ev.price && `Giá vé: ${ev.price}`,
    ev.requirements && `Lưu ý: ${ev.requirements}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sameLocalDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Book thẳng theo dự án (v3.1 — Mai opt-in từng dự án): chỉ khi đủ ngày
 * giờ CHẮC CHẮN (không phải đang hỏi khung giờ), có địa điểm, không
 * trùng sự kiện đã có. Banner không mời ai nên không đụng quy tắc "mời
 * người luôn hỏi"; thiếu bất kỳ điều kiện nào → về thẻ xem trước.
 */
export function canAutoBookBanner(
  timing: BannerTiming,
  hasLocation: boolean,
  hasDuplicate: boolean,
): boolean {
  return timing.status === "ok" && hasLocation && !hasDuplicate;
}

/**
 * Chống tạo trùng (v3.0): đã có sự kiện CÙNG TÊN (so fold dấu/hoa
 * thường) trong CÙNG NGÀY → trả về sự kiện đó để đề xuất "Cập nhật".
 */
export function findDuplicateEvent<T extends { title: string; startAt: string }>(
  events: T[],
  title: string,
  startAt: string,
): T | undefined {
  const q = fold(title);
  if (!q) return undefined;
  return events.find((e) => fold(e.title) === q && sameLocalDay(e.startAt, startAt));
}
