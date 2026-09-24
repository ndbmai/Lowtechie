import { foldName } from "./clients";
import { freeSlotsOnDay } from "./slots";
import type { CalEvent } from "./types";

/**
 * Thao tác trên sự kiện đã có (§5.4.0 v3.7): trùng giờ, tìm theo tên Mai
 * nói, so trước → sau cho thẻ xem trước khi sửa/dời.
 */

/** Loại sự kiện chiếm chỗ — block chuẩn bị/di chuyển cố ý nằm sát sự kiện chính nên không xét trùng. */
const MAIN_KINDS = new Set<CalEvent["kind"]>(["event", "block", "flight"]);

type Timed = Pick<CalEvent, "id" | "kind" | "startAt" | "endAt" | "chainOf" | "gcalId">;

/**
 * Sự kiện chồng giờ nhau (lỗi thấy 25/9: "Triệt lông… tại Ngọc Dung" và
 * "Cắt tóc" cùng 15:00–16:00) → map id → các id trùng với nó. Liền kề
 * (hết 15:00, bắt đầu 15:00) KHÔNG tính trùng.
 */
export function findOverlaps(events: Timed[], ignoreIds: Set<string> = new Set()): Map<string, string[]> {
  const main = events
    .filter((e) => MAIN_KINDS.has(e.kind) && !ignoreIds.has(e.id))
    .map((e) => ({ e, s: Date.parse(e.startAt), en: Date.parse(e.endAt) }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.en) && x.en > x.s)
    .sort((x, y) => x.s - y.s);
  const out = new Map<string, string[]>();
  const push = (a: string, b: string) => out.set(a, [...(out.get(a) ?? []), b]);
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length && main[j].s < main[i].en; j++) {
      const a = main[i].e;
      const b = main[j].e;
      if (a.chainOf === b.id || b.chainOf === a.id) continue;
      // Cùng một sự kiện hiện ở hai nơi (block app đã book sang lịch ngoài).
      if (a.gcalId && a.gcalId === b.gcalId) continue;
      push(a.id, b.id);
      push(b.id, a.id);
    }
  }
  return out;
}

/**
 * Khung dời gần giờ cũ nhất (cùng ngày, rồi 2 ngày sau), đủ thời lượng,
 * không trùng sự kiện khác — hòa nhau thì chọn khung SAU giờ cũ.
 */
export function suggestMoveSlot(
  target: Timed,
  events: Timed[],
  now: Date,
): { startAt: string; endAt: string } | null {
  const start = Date.parse(target.startAt);
  const dur = Date.parse(target.endAt) - start;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const others = events.filter(
    (e) => e.id !== target.id && e.chainOf !== target.id && MAIN_KINDS.has(e.kind),
  ) as CalEvent[];
  const soonest = Math.ceil(now.getTime() / 1_800_000) * 1_800_000;
  const base = new Date(start);
  const best = { s: NaN, score: Infinity };
  for (let d = 0; d < 3 && !Number.isFinite(best.s); d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    for (const gap of freeSlotsOnDay(others, day, dur / 60_000, 8, 21)) {
      const gapStart = Math.max(gap.startAt.getTime(), soonest);
      // Thử mọi mốc 30 phút trong khoảng trống.
      for (let s = Math.ceil(gapStart / 1_800_000) * 1_800_000; s + dur <= gap.endAt.getTime(); s += 1_800_000) {
        if (s === start) continue;
        const score = Math.abs(s - start) - (s > start ? 1 : 0);
        if (score < best.score) {
          best.s = s;
          best.score = score;
        }
      }
    }
  }
  return Number.isFinite(best.s)
    ? { startAt: new Date(best.s).toISOString(), endAt: new Date(best.s + dur).toISOString() }
    : null;
}

function sameLocalDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Tìm sự kiện theo tên Mai nói ("cắt tóc", "tarot") — không phân biệt dấu;
 * có ngày ("thứ Sáu") thì chọn đúng ngày; không có thì sự kiện SẮP TỚI gần
 * nhất, hết thì cái vừa qua gần nhất.
 */
export function matchEventByName<T extends { title: string; startAt: string }>(
  events: T[],
  what: string,
  dayIso: string | undefined,
  now: Date,
): T | undefined {
  const q = foldName(what);
  if (!q) return undefined;
  const words = q.split(" ").filter((w) => w.length >= 2);
  const hits = events.filter((e) => {
    const t = foldName(e.title);
    return t.includes(q) || (words.length > 1 && words.every((w) => t.includes(w)));
  });
  if (hits.length === 0) return undefined;
  const pool = dayIso ? hits.filter((e) => sameLocalDay(e.startAt, dayIso)) : hits;
  if (pool.length === 0) return undefined;
  const t = now.getTime();
  const future = pool
    .filter((e) => Date.parse(e.startAt) >= t - 60 * 60_000)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  if (future.length) return future[0];
  return [...pool].sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0];
}

export type EventField = "title" | "time" | "location" | "notes";

export interface EventChange {
  field: EventField;
  before?: string;
  after?: string;
  /** Với field "time": cặp ISO để UI định dạng "15:00–16:00 → 17:00–18:00". */
  beforeEnd?: string;
  afterEnd?: string;
}

type Editable = Pick<CalEvent, "title" | "startAt" | "endAt" | "location" | "notes">;

/** Thẻ xem trước khi sửa CHỈ hiện phần thay đổi (trước → sau) — §5.4. */
export function diffEvent(before: Editable, after: Editable): EventChange[] {
  const out: EventChange[] = [];
  const norm = (s?: string) => (s ?? "").trim();
  if (norm(before.title) !== norm(after.title))
    out.push({ field: "title", before: before.title, after: after.title });
  if (
    Date.parse(before.startAt) !== Date.parse(after.startAt) ||
    Date.parse(before.endAt) !== Date.parse(after.endAt)
  ) {
    out.push({
      field: "time",
      before: before.startAt,
      beforeEnd: before.endAt,
      after: after.startAt,
      afterEnd: after.endAt,
    });
  }
  if (norm(before.location) !== norm(after.location))
    out.push({ field: "location", before: before.location, after: after.location });
  if (norm(before.notes) !== norm(after.notes))
    out.push({ field: "notes", before: before.notes, after: after.notes });
  return out;
}

/**
 * Giờ mới khi dời bằng chat/voice: chỉ nói NGÀY ("sang thứ Năm") → giữ
 * giờ cũ; chỉ nói GIỜ ("sang 17:00") → giữ ngày cũ; nói cả hai → lấy nguyên.
 */
export function rescheduleTarget(
  originalStartIso: string,
  toWhenIso: string,
  opts: { keepTime?: boolean; keepDate?: boolean },
): string {
  const orig = new Date(originalStartIso);
  const to = new Date(toWhenIso);
  const out = new Date(to);
  if (opts.keepTime) out.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
  if (opts.keepDate) out.setFullYear(orig.getFullYear(), orig.getMonth(), orig.getDate());
  return out.toISOString();
}

/** Dời chuỗi block theo cùng khoảng với sự kiện chính (đổi giờ → chuỗi tự dời, §5.4.1). */
export function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}
