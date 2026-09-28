/**
 * Đọc ngày giờ TIẾNG THÁI trong lệnh bot Lark (PRD v3.9: bot hiểu cả tiếng
 * Anh, Việt và Thái) — วันนี้ (hôm nay) · พรุ่งนี้ (mai) · มะรืนนี้ (ngày kia)
 * · วันศุกร์ (thứ Sáu) · วันจันทร์หน้า (thứ Hai tuần sau) · สัปดาห์หน้า (tuần
 * sau) · สิ้นเดือน (cuối tháng) · 15:00 / 15.00 น. · บ่ายสาม (3 giờ chiều) ·
 * 9 โมงเช้า · 3 ทุ่ม (21:00) · เที่ยง (trưa). Cùng quy ước với parse.ts /
 * whenEn.ts: chỉ có ngày → 9:00; chỉ có giờ → hôm nay (qua rồi thì mai).
 */

export interface WhenTh {
  at?: Date;
  hasTime: boolean;
  hasDay: boolean;
  spans: string[];
}

/** Chữ số Thái ๐–๙ → số Ả Rập. */
export function thaiDigits(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
}

const WEEKDAY: Record<string, number> = {
  จันทร์: 1,
  อังคาร: 2,
  พุธ: 3,
  พฤหัสบดี: 4,
  พฤหัส: 4,
  ศุกร์: 5,
  เสาร์: 6,
  อาทิตย์: 0,
};

/** Số đếm 1–6 viết bằng chữ ("บ่ายสาม"). */
const NUM_WORD: Record<string, number> = { โมง: 1, หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6 };

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function monday(d: Date): Date {
  const m = midnight(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function parseWhenTh(raw: string, now: Date): WhenTh {
  const text = thaiDigits(raw);
  const spans: string[] = [];
  let day: Date | undefined;

  // 1) Thứ trong tuần: "วันศุกร์", "ภายในวันพุธ", "วันจันทร์หน้า" (tuần sau), "วันเสาร์นี้".
  const wd = text.match(/(?:ภายใน|ก่อน)?\s*วัน(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)\s*(หน้า|นี้)?/u);
  if (wd) {
    spans.push(wd[0]);
    const dow = WEEKDAY[wd[1]];
    if (wd[2] === "หน้า") day = addDays(monday(now), 7 + ((dow + 6) % 7));
    else {
      const delta = (((dow - now.getDay()) % 7) + 7) % 7 || 7;
      day = addDays(midnight(now), delta);
    }
  }

  // 2) Tương đối.
  if (!day) {
    const rel = text.match(/(?:ภายใน|ก่อน)?\s*(วันนี้|คืนนี้|พรุ่งนี้|มะรืนนี้|มะรืน|สัปดาห์หน้า|อาทิตย์หน้า|สิ้นเดือน|ปลายเดือน)/u);
    if (rel) {
      spans.push(rel[0]);
      const w = rel[1];
      if (w === "พรุ่งนี้") day = addDays(midnight(now), 1);
      else if (w.startsWith("มะรืน")) day = addDays(midnight(now), 2);
      else if (w === "สัปดาห์หน้า" || w === "อาทิตย์หน้า") day = addDays(monday(now), 7);
      else if (w === "สิ้นเดือน" || w === "ปลายเดือน") day = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      else day = midnight(now);
    }
  }

  // 3) Giờ.
  let hour: number | undefined;
  let minute = 0;
  const hm = text.match(/(?:เวลา\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:น\.)?/u);
  const afternoon = hm ? null : text.match(/บ่าย\s*(\d{1,2}|โมง|หนึ่ง|สอง|สาม|สี่|ห้า)(?:\s*โมง)?/u);
  const evening = hm || afternoon ? null : text.match(/(\d{1,2})\s*โมง\s*เย็น/u);
  const morning = hm || afternoon || evening ? null : text.match(/(\d{1,2})\s*โมง(?:\s*เช้า)?/u);
  const night = hm || afternoon || evening || morning ? null : text.match(/(\d{1,2}|หนึ่ง|สอง|สาม|สี่|ห้า)\s*ทุ่ม/u);
  const noon = hm || afternoon || evening || morning || night ? null : text.match(/เที่ยง(?!คืน)(?:วัน)?/u);
  const num = (s: string) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUM_WORD[s]);
  if (hm) {
    hour = parseInt(hm[1], 10);
    minute = parseInt(hm[2], 10);
    spans.push(hm[0]);
  } else if (afternoon) {
    const n = num(afternoon[1]);
    if (n >= 1 && n <= 6) hour = 12 + n;
    else if (n >= 13 && n <= 18) hour = n;
    spans.push(afternoon[0]);
  } else if (evening) {
    const n = num(evening[1]);
    hour = n <= 6 ? 12 + n : n;
    spans.push(evening[0]);
  } else if (morning) {
    const n = num(morning[1]);
    if (n >= 1 && n <= 11) hour = n;
    spans.push(morning[0]);
  } else if (night) {
    const n = num(night[1]);
    if (n >= 1 && n <= 5) hour = 18 + n;
    spans.push(night[0]);
  } else if (noon) {
    hour = 12;
    spans.push(noon[0]);
  }
  // "คืนนี้" (tối nay) không kèm giờ → 19:00.
  if (hour === undefined && /คืนนี้/u.test(text)) hour = 19;
  const hasTime = hour !== undefined;

  if (!day && !hasTime) return { hasTime: false, hasDay: false, spans: [] };
  let at: Date;
  if (day) {
    at = new Date(day);
    at.setHours(hasTime ? hour! : 9, hasTime ? minute : 0, 0, 0);
  } else {
    at = new Date(now);
    at.setHours(hour!, minute, 0, 0);
    if (at.getTime() <= now.getTime()) at = addDays(at, 1);
  }
  return { at, hasTime, hasDay: Boolean(day), spans };
}

/** Câu có chữ Thái không (để thử bộ đọc tiếng Thái). */
export function hasThai(s: string): boolean {
  return /[฀-๿]/.test(s);
}
