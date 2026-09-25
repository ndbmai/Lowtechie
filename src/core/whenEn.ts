/**
 * Đọc ngày giờ TIẾNG ANH trong lệnh bot Lark (Mai 25/9: team trao đổi
 * tiếng Anh) — "Friday", "by tomorrow 3pm", "next Monday", "Sep 30",
 * "30/9" (ngày/tháng như ở VN/TH). Cùng quy ước với parse.ts: chỉ có ngày
 * → 9:00 sáng; chỉ có giờ → hôm nay (qua rồi thì ngày mai); `now` tiêm vào
 * để test được và để tính theo LÚC GỬI tin.
 */

export interface WhenEn {
  at?: Date;
  hasTime: boolean;
  hasDay: boolean;
  /** Các đoạn đã khớp (kèm chữ dẫn "by/on/due…") để gỡ khỏi tiêu đề. */
  spans: string[];
}

const LEAD = String.raw`(?:(?:due|by|on|before|until|deadline)\s+)?`;

const WEEKDAY_FULL: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
/** Viết tắt chỉ nhận khi viết HOA chữ đầu ("Fri") — "sat", "wed" thường là động từ. */
const WEEKDAY_ABBR: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Tues: 2,
  Wed: 3,
  Thu: 4,
  Thur: 4,
  Thurs: 4,
  Fri: 5,
  Sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Thứ Hai của tuần chứa d. */
function monday(d: Date): Date {
  const m = midnight(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Ngày gần nhất (sau hôm nay) rơi vào thứ `dow`; "next" → thứ đó của TUẦN SAU. */
function weekdayDate(now: Date, dow: number, next: boolean): Date {
  if (next) return addDays(monday(now), 7 + ((dow + 6) % 7));
  const delta = (((dow - now.getDay()) % 7) + 7) % 7 || 7;
  return addDays(midnight(now), delta);
}

export function parseWhenEn(text: string, now: Date): WhenEn {
  const spans: string[] = [];
  let day: Date | undefined;

  // 1) Tương đối: today / tonight / tomorrow / day after tomorrow / EOD / EOW / next week.
  const rel = text.match(
    new RegExp(
      String.raw`${LEAD}(?:the\s+)?\b(day after tomorrow|tomorrow|tmrw|tmr|today|tonight|eod|end of (?:the )?day|eow|end of (?:the )?week|next week)\b`,
      "i",
    ),
  );
  if (rel) {
    spans.push(rel[0]);
    const w = rel[1].toLowerCase();
    if (w === "day after tomorrow") day = addDays(midnight(now), 2);
    else if (w === "tomorrow" || w === "tmrw" || w === "tmr") day = addDays(midnight(now), 1);
    else if (w === "eow" || w.startsWith("end of") && w.endsWith("week")) day = weekdayDate(addDays(now, -1), 5, false);
    else if (w === "next week") day = addDays(monday(now), 7);
    else day = midnight(now);
  }

  // 2) Thứ trong tuần: "Friday", "next Monday", "by Wed" (viết tắt phải viết hoa).
  if (!day) {
    const full = text.match(
      new RegExp(String.raw`${LEAD}(?:(next|this)\s+)?\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b`, "i"),
    );
    const abbr = full
      ? null
      : text.match(new RegExp(String.raw`${LEAD}(?:(next|this)\s+)?\b(Sun|Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat)\b\.?`));
    const m = full ?? abbr;
    if (m) {
      spans.push(m[0]);
      const dow = full ? WEEKDAY_FULL[m[2].toLowerCase()] : WEEKDAY_ABBR[m[2]];
      day = weekdayDate(now, dow, (m[1] ?? "").toLowerCase() === "next");
    }
  }

  // 3) Ngày cụ thể: "Sep 30", "30 September", "30/9", "30-09-2026".
  if (!day) {
    const md = text.match(
      new RegExp(
        String.raw`${LEAD}\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?`,
        "i",
      ),
    );
    const dm = md
      ? null
      : text.match(
          new RegExp(
            String.raw`${LEAD}\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b`,
            "i",
          ),
        );
    // "1-2 days", "24/7 support" không phải ngày.
    const num =
      md || dm
        ? null
        : text.match(
            new RegExp(
              String.raw`${LEAD}\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b(?!\s*(?:days?|hours?|hrs?|weeks?|months?|mins?|minutes?|people|pax|support)\b)`,
              "i",
            ),
          );
    let d: number | undefined;
    let mo: number | undefined;
    let y: number | undefined;
    let span: string | undefined;
    if (md) {
      mo = MONTHS[md[1].toLowerCase().slice(0, md[1].toLowerCase().startsWith("sept") ? 4 : 3)];
      d = parseInt(md[2], 10);
      y = md[3] ? parseInt(md[3], 10) : undefined;
      span = md[0];
    } else if (dm) {
      d = parseInt(dm[1], 10);
      mo = MONTHS[dm[2].toLowerCase().slice(0, dm[2].toLowerCase().startsWith("sept") ? 4 : 3)];
      y = dm[3] ? parseInt(dm[3], 10) : undefined;
      span = dm[0];
    } else if (num) {
      d = parseInt(num[1], 10);
      mo = parseInt(num[2], 10) - 1;
      y = num[3] ? parseInt(num[3], 10) : undefined;
      if (y !== undefined && y < 100) y += 2000;
      span = num[0];
    }
    if (d && mo !== undefined && mo >= 0 && mo <= 11 && d <= 31 && span) {
      let cand = new Date(y ?? now.getFullYear(), mo, d);
      // Không ghi năm mà ngày đã qua → năm sau.
      if (y === undefined && cand.getTime() < midnight(now).getTime()) cand = new Date(now.getFullYear() + 1, mo, d);
      if (cand.getDate() === d) {
        day = cand;
        spans.push(span);
      }
    }
  }

  // 4) Giờ: "3pm", "3:30 pm", "15:00", "noon".
  let hour: number | undefined;
  let minute = 0;
  const ampm = text.match(/(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const h24 = ampm ? null : text.match(/(?:\bat\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const noon = ampm || h24 ? null : text.match(/(?:\bat\s+)?\bnoon\b/i);
  if (ampm) {
    hour = parseInt(ampm[1], 10) % 12 + (ampm[3].toLowerCase() === "pm" ? 12 : 0);
    minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    spans.push(ampm[0]);
  } else if (h24) {
    hour = parseInt(h24[1], 10);
    minute = parseInt(h24[2], 10);
    spans.push(h24[0]);
  } else if (noon) {
    hour = 12;
    spans.push(noon[0]);
  }
  const hasTime = hour !== undefined && hour <= 23;

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
