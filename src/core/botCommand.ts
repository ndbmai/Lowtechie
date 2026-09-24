import { foldName } from "./clients";

/**
 * Lệnh "@Lowtechie …" trong group Lark (§5.5.1–5.5.2 v3.7). Bot chỉ làm
 * tác vụ chung của group; mọi thứ thuộc mức Riêng tư của Mai KHÔNG BAO GIỜ
 * trả lời trong group — không xác nhận cũng không phủ nhận.
 */

export type BotCommand =
  | { kind: "task"; text: string }
  | { kind: "assign"; text: string; assignee?: string }
  | { kind: "remind"; text: string; assignee?: string }
  | { kind: "decision"; text: string }
  | { kind: "summary"; hours: number }
  /** Hỏi trạng thái việc ("việc nào đang treo?") — cần dữ liệu máy chủ (Giai đoạn 3). */
  | { kind: "status" }
  | { kind: "private" }
  | { kind: "help" };

/** Gỡ "@_user_1" (khóa mention của Lark) và "@Lowtechie" khỏi tin nhắn. */
export function stripMentions(text: string): string {
  return text
    .replace(/@_user_\d+/g, " ")
    .replace(/@\s*(?:mai\s+)?lowtechie\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Thứ thuộc mức Riêng tư (§5.5.2): lịch cá nhân, vị trí, chuyến đi, sức khỏe, email… */
const PRIVATE_PATTERNS = [
  /\blich (?:ca nhan|rieng|cua (?:mai|chi|chi mai))\b/,
  /\b(?:mai|chi|chi mai) (?:dang )?o dau\b/,
  /\bdang o dau\b/,
  /\bve may bay\b|\bchuyen bay\b|\bbay (?:di|ve)\b|\bma dat cho\b|\bvisa\b|\bho chieu\b/,
  /\bspa\b|\bclinic\b|\bsuc khoe\b|\bkham (?:benh|rang|mat)\b|\bnha khoa\b/,
  /\bemail\b|\bhop thu\b|\bgmail\b/,
  /\bghi chu rieng\b|\brieng tu\b/,
  /\bweekly review\b|\bviec nen bo\b/,
];

export function isPrivateAsk(text: string): boolean {
  const t = foldName(text);
  return PRIVATE_PATTERNS.some((re) => re.test(t));
}

function afterColon(s: string): string {
  return s.replace(/^[\s:–—-]+/, "").trim();
}

/** Tách lệnh; không hiểu → help (không đoán). */
export function parseBotCommand(raw: string): BotCommand {
  const text = stripMentions(raw);
  const t = foldName(text);

  // Tóm tắt: "tóm tắt 2 ngày qua", "…từ hôm qua tới giờ", "…hôm nay", "…tuần này".
  // "chốt việc hôm nay" (§5.5.3) = tóm tắt + gói việc đề xuất cho Mai duyệt.
  if (/^(?:tom tat|chot viec)\b/.test(t)) {
    const n = t.match(/(\d+)\s*ngay/);
    const hours = n
      ? Math.min(14, Math.max(1, parseInt(n[1], 10))) * 24
      : /hom qua/.test(t)
        ? 48
        : /tuan/.test(t)
          ? 168
          : 24;
    return { kind: "summary", hours };
  }
  const m = text.match(/^(ghi việc|ghi viec|giao việc|giao viec|nhắc|nhac|ghi quyết định|ghi quyet dinh)\b\s*(.*)$/i);
  if (m) {
    const verb = foldName(m[1]);
    const rest = afterColon(m[2]);
    if (!rest) return { kind: "help" };
    if (verb.startsWith("ghi quyet")) return { kind: "decision", text: rest };
    if (verb === "ghi viec") return { kind: "task", text: rest };
    if (verb === "giao viec") {
      // "giao việc này cho Linh, hạn thứ Tư" / "giao việc X cho Linh"
      const who = rest.match(/\bcho\s+([\p{L}]+(?:\s+[\p{L}]+)?)(?=,|\s+hạn|\s+han|$)/iu)?.[1];
      return { kind: "assign", text: rest, assignee: who };
    }
    // "nhắc Linh thứ Năm" — người đứng ngay sau "nhắc".
    const who = rest.match(/^([\p{Lu}][\p{L}]*)/u)?.[1];
    return { kind: "remind", text: rest, assignee: who };
  }
  if (isPrivateAsk(text)) return { kind: "private" };
  if (/\bdang treo\b|\bcon viec gi\b|\bai dang lam\b|\bviec cua [\p{L} ]+ (?:tuan|hom)\b/u.test(t)) {
    return { kind: "status" };
  }
  return { kind: "help" };
}

export const BOT_HELP =
  "Mình là Mai Lowtechie 🌼 Trong group này mình làm được: “@Lowtechie ghi việc: …”, “giao việc … cho Linh, hạn thứ Tư”, “nhắc Linh thứ Năm”, “ghi quyết định: …”, “tóm tắt 2 ngày qua”. Việc ghi được đi vào Hộp duyệt của Mai — Mai duyệt xong mới thành việc.";
