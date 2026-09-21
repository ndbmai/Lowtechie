import type { DueType, ParseResult, ParsedAction, ProjectId } from "./types";

/**
 * Bộ tách câu lệnh tiếng Việt viết tay (PRD §5.1): một câu chat/voice
 * → nhiều hành động, gắn dự án, hạn, phương tiện. Đây là fallback khi
 * không có ANTHROPIC_API_KEY; đường Claude API nằm ở /api/parse.
 *
 * Giới hạn chấp nhận được ở v1: chỉ tiếng Việt, mẫu câu phổ biến của Mai.
 */

// ── Thời gian ────────────────────────────────────────────────────────────

/** JS getDay(): CN=0, thứ Hai=1 … thứ Bảy=6. */
const WEEKDAY_WORDS: [RegExp, number][] = [
  [/thứ\s*(?:hai|2)\b/i, 1],
  [/thứ\s*(?:ba|3)\b/i, 2],
  [/thứ\s*(?:tư|tu|4)\b/i, 3],
  [/thứ\s*(?:năm|5)\b/i, 4],
  [/thứ\s*(?:sáu|6)\b/i, 5],
  [/thứ\s*(?:bảy|7)\b/i, 6],
  [/chủ\s*nhật|\bcn\b/i, 0],
];

const TIME_RE = /(\d{1,2})\s*(?:giờ|h|:)\s*(\d{1,2})?(?:\s*phút)?/i;
const PART_OF_DAY_RE = /\b(sáng|trưa|chiều|tối|đêm)\b/i;
const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(tiếng|giờ đồng hồ|phút)/i;

interface WhenMatch {
  at?: Date;
  hasTime: boolean;
  /** Các đoạn chữ đã khớp, để gỡ khỏi tiêu đề. */
  spans: string[];
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function mondayOfWeek(d: Date): Date {
  const m = atMidnight(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Tìm ngày + giờ trong một mệnh đề. `now` tiêm vào để test được. */
export function parseWhen(clause: string, now: Date): WhenMatch {
  const spans: string[] = [];
  let day: Date | undefined;

  // "hôm nay / ngày mai / ngày kia" và biến thể có buổi ("tối nay", "sáng mai")
  const rel = clause.match(/\b(?:(hôm|sáng|trưa|chiều|tối|đêm)\s+nay|(?:ngày|sáng|trưa|chiều|tối|đêm)\s+(mai|kia)|(mai)\s)/i);
  if (rel) {
    spans.push(rel[0].trim());
    const plus = rel[2] === "kia" ? 2 : rel[2] || rel[3] ? 1 : 0;
    day = atMidnight(now);
    day.setDate(day.getDate() + plus);
  }

  // "thứ X (tuần sau|tuần này)?"
  if (!day) {
    for (const [re, jsDay] of WEEKDAY_WORDS) {
      const m = clause.match(re);
      if (!m) continue;
      spans.push(m[0]);
      const week = clause.match(/tuần\s*(sau|tới|này)/i);
      if (week) spans.push(week[0]);
      if (week && week[1] !== "này") {
        const mon = mondayOfWeek(now);
        mon.setDate(mon.getDate() + 7 + ((jsDay + 6) % 7));
        day = mon;
      } else if (week) {
        const mon = mondayOfWeek(now);
        mon.setDate(mon.getDate() + ((jsDay + 6) % 7));
        day = mon;
      } else {
        const delta = ((((jsDay - now.getDay()) % 7) + 7) % 7) || 7;
        const d = atMidnight(now);
        d.setDate(d.getDate() + delta);
        day = d;
      }
      break;
    }
  }

  // Giờ: "7 giờ", "7h30", "19:00" — tránh nhầm với thời lượng "2 tiếng"
  let hasTime = false;
  let hour: number | undefined;
  let minute = 0;
  const t = clause.match(TIME_RE);
  const afterTime = t
    ? clause.slice(clause.indexOf(t[0]) + t[0].length, clause.indexOf(t[0]) + t[0].length + 10)
    : "";
  // "2 giờ đồng hồ" là thời lượng, không phải mốc giờ.
  if (t && !/^\s*đồng\s*hồ/i.test(afterTime)) {
    hour = parseInt(t[1], 10);
    minute = t[2] ? parseInt(t[2], 10) : 0;
    if (hour <= 24 && minute <= 59) {
      spans.push(t[0]);
      hasTime = true;
    } else {
      hour = undefined;
    }
  }

  // Buổi trong ngày điều chỉnh giờ 12h → 24h, hoặc cho giờ mặc định
  const pod = clause.match(PART_OF_DAY_RE)?.[1]?.toLowerCase();
  if (hasTime && hour !== undefined && hour <= 12) {
    if (pod === "chiều" && hour < 12) hour += 12;
    if ((pod === "tối" || pod === "đêm") && hour < 12) hour += 12;
  }
  if (!hasTime && pod && (day || rel)) {
    hour = { sáng: 9, trưa: 12, chiều: 15, tối: 19, đêm: 21 }[pod];
    if (hour !== undefined) hasTime = true;
  }

  if (!day && hasTime) {
    // Chỉ có giờ → hôm nay; đã qua giờ đó thì hiểu là ngày mai.
    day = atMidnight(now);
    const probe = new Date(day);
    probe.setHours(hour ?? 9, minute);
    if (probe.getTime() < now.getTime()) day.setDate(day.getDate() + 1);
  }

  if (!day) return { hasTime: false, spans };

  const at = new Date(day);
  at.setHours(hasTime ? (hour ?? 9) : 9, minute, 0, 0);
  return { at, hasTime, spans };
}

// ── Dự án ────────────────────────────────────────────────────────────────

const PROJECT_KEYWORDS: [RegExp, ProjectId][] = [
  [/sorene|pitch\s*deck/i, "sorene"],
  [/circle|\baio\b/i, "circle"],
  [/favstay|favultimate|khách sạn|\bota\b/i, "favstay"],
  [/\bedge\b|intelligent edge|newsletter/i, "edge"],
  [/tiếng thái|học tiếng/i, "hoctap"],
  [/\bspa\b|làm tóc|nail|bác sĩ|khám/i, "canhan"],
];

export function detectProject(text: string): { id: ProjectId; explicit: boolean } {
  for (const [re, id] of PROJECT_KEYWORDS) {
    if (re.test(text)) return { id, explicit: true };
  }
  return { id: "canhan", explicit: false };
}

// ── Tách mệnh đề ─────────────────────────────────────────────────────────

const ACTION_VERBS =
  "dời|đổi|chuyển|book|đặt|nhắc|nhớ|gửi|gọi|viết|học|chuẩn bị|thêm|sửa|duyệt|làm|mua|hẹn|kiểm tra|trả lời|soạn";

/** Tách một câu thành các mệnh đề hành động ("… rồi …", "…, và đặt …"). */
export function splitClauses(text: string): string[] {
  const cleaned = text.trim().replace(/\s+/g, " ");
  const parts = cleaned
    .split(new RegExp(`(?:,?\\s+rồi\\s+|;\\s*|,?\\s+và\\s+(?=(?:${ACTION_VERBS})\\b))`, "i"))
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
}

// ── Nhận dạng từng mệnh đề ───────────────────────────────────────────────

const MODE_TRANSIT_RE = /đi tàu|tàu điện|\bbts\b|\bmrt\b/i;
const MODE_CAR_RE = /ô tô|\bgrab\b|\btaxi\b|xe hơi/i;
const POLITE_RE = /\s*(?:nha|nhé|nhá|nhỉ|ạ|đi|giùm|giúp (?:chị|em|mình)|hộ (?:chị|em|mình))\s*[.!?]*$/i;
const LEAD_RE = /^(?:nhắc (?:chị|em|mình)\s*|nhắc\s+|nhớ\s+|chị\s+|em\s+|mình\s+|tuần này\s+|tuần sau\s+)+/i;

function tidyTitle(raw: string): string {
  const s = raw
    .trim()
    .replace(POLITE_RE, "")
    .replace(LEAD_RE, "")
    .replace(/,?\s*dự án\s+[\p{L}\d ]+/giu, "")
    .replace(/,?\s*gấp\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function stripSpans(clause: string, spans: string[]): string {
  let out = clause;
  for (const s of spans) out = out.replace(s, " ");
  return out;
}

function parseClause(clause: string, now: Date): ParsedAction {
  const when = parseWhen(clause, now);
  const project = detectProject(clause);
  const urgent = /\bgấp\b/i.test(clause);
  const baseConfidence = Math.min(
    0.85,
    0.6 + (project.explicit ? 0.15 : 0) + (when.at ? 0.1 : 0),
  );

  // Đổi lịch: "dời X sang thứ Năm"
  const resched = clause.match(/\b(?:dời|đổi|chuyển)\s+(.+?)\s+(?:sang|qua|tới|đến)\s+(.+)$/i);
  if (resched) {
    const to = parseWhen(resched[2], now);
    return {
      kind: "reschedule",
      what: tidyTitle(resched[1]),
      toWhen: to.at?.toISOString(),
      keepTime: !to.hasTime,
      confidence: baseConfidence,
      note: to.hasTime ? undefined : "Giữ nguyên giờ cũ nếu chỉ đổi ngày",
    };
  }

  // Sự kiện / block lịch: hẹn, gặp, book, đặt lịch, họp, bay, deep work
  const isEvent =
    /\bhẹn\b|\bgặp\b|\bbook\b|đặt lịch|\bhọp\b|\bbay\b|deep work/i.test(clause);
  if (isEvent) {
    const mode = MODE_CAR_RE.test(clause)
      ? ("car" as const)
      : MODE_TRANSIT_RE.test(clause)
        ? ("transit" as const)
        : undefined;
    // Lưu ý: \b của JS không hoạt động cạnh chữ có dấu ("ở") → dùng (?:^|\s).
    const loc = clause.match(/(?:^|\s)ở\s+([\p{L}\d][\p{L}\d ]*?)(?=,|\.|$|\s+(?:lúc|vào|đi\b))/iu);
    const dur = clause.match(DURATION_RE);
    const durationMinutes = dur
      ? Math.round(parseFloat(dur[1].replace(",", ".")) * (dur[2] === "phút" ? 1 : 60))
      : undefined;

    let title = stripSpans(clause, when.spans);
    // Địa điểm đã tách riêng → gỡ "ở X" khỏi tiêu đề, tránh lặp khi hiển thị.
    if (loc) title = title.replace(loc[0], " ");
    title = title
      .replace(MODE_TRANSIT_RE, "")
      .replace(MODE_CAR_RE, "")
      .replace(/\bđi\s*,?\s*$/i, "")
      .replace(DURATION_RE, "")
      .replace(/\bbook\b|\bđặt lịch\b/gi, "");
    title = tidyTitle(title);

    return {
      kind: "event",
      title: title || "Cuộc hẹn",
      startAt: when.hasTime ? when.at?.toISOString() : undefined,
      durationMinutes,
      location: loc?.[1]?.trim(),
      mode,
      confidence: baseConfidence,
    };
  }

  // Mặc định: một việc (task)
  const title = tidyTitle(stripSpans(clause, when.spans));
  const dueType: DueType | undefined = when.at ? (urgent ? "hard" : "soft") : undefined;
  return {
    kind: "task",
    title: title || clause.trim(),
    projectId: project.id,
    dueAt: when.at?.toISOString(),
    dueType,
    confidence: project.explicit ? baseConfidence : baseConfidence - 0.1,
    note: urgent && !when.at ? "Gấp" : undefined,
  };
}

/**
 * Tách một câu chat/voice thành danh sách hành động + tối đa MỘT câu hỏi
 * lại khi thiếu thông tin quan trọng (PRD §5.0).
 */
export function parseCommand(text: string, now: Date = new Date()): ParseResult {
  const actions = splitClauses(text).map((c) => parseClause(c, now));

  let question: string | undefined;
  for (const a of actions) {
    if (a.kind === "reschedule" && !a.toWhen) {
      question = `Dời "${a.what}" sang khi nào?`;
      break;
    }
    if (a.kind === "event" && !a.startAt && !a.durationMinutes) {
      question = `"${a.title}" vào lúc mấy giờ?`;
      break;
    }
  }

  return { actions, question, source: "rules" };
}
