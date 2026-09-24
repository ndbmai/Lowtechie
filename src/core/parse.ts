import { BOOKING_KEYWORDS } from "./booking";
import { classify } from "./classify";
import { cityFromText } from "./location";
import type { DueType, ParseResult, ParsedAction, ProjectId } from "./types";

/**
 * Bộ tách câu lệnh tiếng Việt viết tay (PRD §5.1): một câu chat/voice
 * → nhiều hành động, gắn dự án, hạn, phương tiện. Đây là fallback khi
 * không có ANTHROPIC_API_KEY; đường Claude API nằm ở /api/parse.
 *
 * Giới hạn chấp nhận được ở v1: chỉ tiếng Việt, mẫu câu phổ biến của Mai.
 */

// ── Thời gian ────────────────────────────────────────────────────────────

/**
 * JS getDay(): CN=0, thứ Hai=1 … thứ Bảy=6. Cuối từ dùng lookahead
 * Unicode chứ KHÔNG dùng `\b` — `\b` chỉ hiểu chữ ASCII nên "thứ Tư"
 * (kết thúc bằng "ư") trước đây không bao giờ khớp (lỗi thật v3.7).
 */
const END = "(?![\\p{L}\\p{M}\\d])";
const WEEKDAY_WORDS: [RegExp, number][] = [
  [new RegExp(`thứ\\s*(?:hai|2)${END}`, "iu"), 1],
  [new RegExp(`thứ\\s*(?:ba|3)${END}`, "iu"), 2],
  [new RegExp(`thứ\\s*(?:tư|tu|4)${END}`, "iu"), 3],
  [new RegExp(`thứ\\s*(?:năm|5)${END}`, "iu"), 4],
  [new RegExp(`thứ\\s*(?:sáu|6)${END}`, "iu"), 5],
  [new RegExp(`thứ\\s*(?:bảy|7)${END}`, "iu"), 6],
  [/chủ\s*nhật|\bcn\b/i, 0],
];

const BOOKING_LEAD_RE = new RegExp(
  `^(?:đi\\s+|lịch\\s+)?(?:${BOOKING_KEYWORDS.map((k) => (k === "khám" ? "khám(?!\\s+phá)" : k)).join("|")})(?![\\p{L}\\p{M}\\d])`,
  "iu",
);

const TIME_RE = /(\d{1,2})\s*(?:giờ|h|:)\s*(\d{1,2})?(?:\s*phút)?/i;
const PART_OF_DAY_RE = /\b(sáng|trưa|chiều|tối|đêm)\b/i;
const DURATION_RE = /(\d+(?:[.,]\d+)?)\s*(tiếng|giờ đồng hồ|phút)/i;

interface WhenMatch {
  at?: Date;
  hasTime: boolean;
  /** Mai có nói NGÀY ("mai", "thứ Sáu") — không phải ngày tự suy từ giờ. */
  hasDay?: boolean;
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

  const hasDay = Boolean(day);
  if (!day && hasTime) {
    // Chỉ có giờ → hôm nay; đã qua giờ đó thì hiểu là ngày mai.
    day = atMidnight(now);
    const probe = new Date(day);
    probe.setHours(hour ?? 9, minute);
    if (probe.getTime() < now.getTime()) day.setDate(day.getDate() + 1);
  }

  if (!day) return { hasTime: false, hasDay: false, spans };

  const at = new Date(day);
  at.setHours(hasTime ? (hour ?? 9) : 9, minute, 0, 0);
  return { at, hasTime, hasDay, spans };
}

// ── Dự án ────────────────────────────────────────────────────────────────

/**
 * Nhận dạng dự án từ câu — dùng chung bảng luật với classify.ts
 * (một nguồn sự thật cho phân loại, PRD §5.2.1).
 */
export function detectProject(text: string): { id: ProjectId; explicit: boolean } {
  const c = classify(text);
  return { id: c.projectId, explicit: c.confidence >= 0.65 };
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

export function tidyTitle(raw: string): string {
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

export function stripSpans(clause: string, spans: string[]): string {
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

  // Ghi chú vào việc đã có (3d): "ghi chú cho việc hợp đồng Đô Thị: …"
  const noteM = clause.match(/^ghi chú (?:cho |vào )?(?:việc )?(.+?)\s*[:—]\s*(.+)$/i);
  if (noteM) {
    return { kind: "note", what: tidyTitle(noteM[1]), text: noteM[2].trim(), confidence: 0.85 };
  }

  // Đóng việc qua chat (5.2.2) — UI luôn hiện thẻ xác nhận tên việc trước.
  const doneM = clause.match(/^(?:đã |vừa )?(?:xong|hoàn thành)(?: việc)?\s+(.+?)(?:\s+rồi)?\s*$/i);
  if (doneM) {
    return { kind: "complete", what: tidyTitle(doneM[1]), confidence: 0.85 };
  }

  // Mai tự nói đang ở đâu (§5.4.3 v3.7): "chị đang ở HCMC", "vừa tới Tokyo".
  const locM = clause.match(
    /^(?:(?:chị|em|mình)\s+)?(?:đang ở|đã tới|đã đến|vừa tới|vừa đến|đã về|vừa về)\s+(.{2,30}?)(?:\s+rồi)?\s*[.!]?$/i,
  );
  if (locM) {
    const city = cityFromText(locM[1]);
    if (city) return { kind: "location", city, confidence: 0.9 };
  }

  // "Spa thứ Năm đặt rồi" (§5.4.2): đánh dấu đã đặt chỗ + đóng việc đặt.
  const bookedM = clause.match(/^(.+?)\s+(?:đã\s+)?đặt(?:\s+(?:chỗ|lịch|xong))?\s+rồi\s*[.!]?$/i);
  if (bookedM) {
    const w = parseWhen(bookedM[1], now);
    return {
      kind: "booked",
      what: tidyTitle(stripSpans(bookedM[1], w.spans)),
      day: w.hasDay ? w.at?.toISOString() : undefined,
      confidence: 0.85,
    };
  }

  // Xóa lịch (§5.4.0 v3.7): "xóa lịch tarot" — UI luôn hỏi xác nhận.
  const delM = clause.match(/^(?:xóa|xoá|hủy|huỷ)\s+(?:lịch|sự kiện|cuộc hẹn|buổi|hẹn)\s+(.+)$/i);
  if (delM) {
    const w = parseWhen(delM[1], now);
    return {
      kind: "delete_event",
      what: tidyTitle(stripSpans(delM[1], w.spans)),
      day: w.hasDay ? w.at?.toISOString() : undefined,
      confidence: 0.85,
    };
  }

  // Book lịch cho một việc (§5.2.2 v3.7): "book 2 tiếng cho việc pitch deck thứ Năm".
  const bookM = clause.match(
    /^(?:book|đặt|giữ)\s+(?:lịch\s+)?(?:(\d+(?:[.,]\d+)?)\s*(tiếng|giờ(?:\s+đồng\s+hồ)?|phút)\s+)?(?:lịch\s+)?cho\s+việc\s+(.+)$/i,
  );
  if (bookM) {
    const w = parseWhen(bookM[3], now);
    return {
      kind: "book_task",
      what: tidyTitle(stripSpans(bookM[3], w.spans)),
      durationMinutes: bookM[1]
        ? Math.round(parseFloat(bookM[1].replace(",", ".")) * (bookM[2] === "phút" ? 1 : 60))
        : undefined,
      day: w.hasDay ? w.at?.toISOString() : undefined,
      confidence: 0.85,
    };
  }

  // Nghiên cứu (§5.9.1): "tìm giúp chị 5 công ty AI automation ở Bangkok, lưu vào Circle".
  const resM = clause.match(
    /^(?:(?:chị|em)\s+)?(tìm (?:giúp|hộ)(?:\s+(?:chị|em|mình))?|tìm hiểu|nghiên cứu|tra cứu|so sánh|chuẩn bị hồ sơ(?:\s+về)?)\s+(.+)$/i,
  );
  if (resM && !/^(?:giờ|khung|lịch|slot|chỗ trống)\b/i.test(resM[2])) {
    let query = resM[2].trim();
    let projectId: ProjectId | undefined;
    const save = query.match(/,?\s*(?:và\s+)?lưu\s+(?:vào|cho|trong)\s+(?:dự án\s+)?(.+)$/i);
    if (save && save.index !== undefined) {
      const p = detectProject(save[1]);
      if (p.explicit) projectId = p.id;
      query = query.slice(0, save.index).trim();
    }
    const verb = resM[1].toLowerCase();
    return {
      kind: "research",
      query: /so sánh|chuẩn bị hồ sơ/.test(verb) ? `${verb} ${query}` : query,
      projectId,
      confidence: 0.85,
    };
  }

  // Đổi lịch: "dời X sang thứ Năm", "dời cắt tóc thứ Sáu sang 17:00".
  const resched = clause.match(/\b(?:dời|đổi|chuyển)\s+(.+?)\s+(?:sang|qua|tới|đến)\s+(.+)$/i);
  if (resched) {
    const to = parseWhen(resched[2], now);
    // Ngày/giờ trong phần "X" dùng để chỉ ĐÚNG lịch ("cắt tóc thứ Sáu").
    const q = parseWhen(resched[1], now);
    const qualifier = q.hasDay ? q.at : undefined;
    let toWhen = to.at;
    let keepDate = false;
    if (to.at && to.hasTime && !to.hasDay) {
      // Chỉ nói giờ mới → giữ NGÀY của lịch đó (không nhảy về hôm nay).
      if (qualifier) {
        toWhen = new Date(qualifier);
        toWhen.setHours(to.at.getHours(), to.at.getMinutes(), 0, 0);
      } else {
        keepDate = true;
      }
    }
    return {
      kind: "reschedule",
      what: tidyTitle(q.at ? stripSpans(resched[1], q.spans) : resched[1]),
      toWhen: toWhen?.toISOString(),
      keepTime: !to.hasTime,
      keepDate: keepDate || undefined,
      day: qualifier?.toISOString(),
      confidence: baseConfidence,
      note: to.hasTime ? undefined : "Giữ nguyên giờ cũ nếu chỉ đổi ngày",
    };
  }

  // Sự kiện / block lịch: hẹn, gặp, book, đặt lịch, họp, bay, deep work —
  // và "spa thứ Bảy 10h", "cắt tóc thứ Sáu 15h": nơi cần đặt chỗ đứng đầu
  // câu + GIỜ cụ thể là lịch hẹn, không phải việc có hạn (§5.4.2 v3.7).
  const isEvent =
    /\bhẹn\b|\bgặp\b|\bbook\b|đặt lịch|\bhọp\b|\bbay\b|deep work/i.test(clause) ||
    (when.hasTime && BOOKING_LEAD_RE.test(clause.trim()));
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

  // Mặc định: một việc (task). Category lấy từ luật phân loại trên cả
  // mệnh đề (trước khi gỡ "dự án X" khỏi tiêu đề).
  const title = tidyTitle(stripSpans(clause, when.spans));
  const cls = classify(clause);
  const dueType: DueType | undefined = when.at ? (urgent ? "hard" : "soft") : undefined;
  return {
    kind: "task",
    title: title || clause.trim(),
    projectId: project.id,
    categoryId: cls.projectId === project.id ? cls.categoryId : undefined,
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
