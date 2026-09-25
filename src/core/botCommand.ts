import { foldName } from "./clients";

/**
 * Lệnh "@Lowtechie …" trong group Lark (§5.5.1–5.5.2 v3.7). Bot chỉ làm
 * tác vụ chung của group; mọi thứ thuộc mức Riêng tư của Mai KHÔNG BAO GIỜ
 * trả lời trong group — không xác nhận cũng không phủ nhận.
 *
 * Mai 25/9: team trao đổi TIẾNG ANH → bot hiểu lệnh cả tiếng Anh lẫn tiếng
 * Việt, và mặc định TRẢ LỜI bằng tiếng Anh (Mai chọn tiếng Việt theo từng
 * group ở màn Kết nối). Câu chữ bot nói nằm hết trong BOT_TEXT.
 */

export type BotLang = "en" | "vi";

export type BotCommand =
  | { kind: "task"; text: string }
  | { kind: "assign"; text: string; assignee?: string }
  | { kind: "remind"; text: string; assignee?: string }
  | { kind: "decision"; text: string }
  | { kind: "summary"; hours: number }
  /** Hỏi trạng thái việc ("what's pending?") — cần dữ liệu máy chủ (Giai đoạn 3). */
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

/** Thứ thuộc mức Riêng tư (§5.5.2): lịch cá nhân, vị trí, chuyến đi, sức khỏe, email… (chữ đã bỏ dấu). */
const PRIVATE_PATTERNS = [
  // Tiếng Việt
  /\blich (?:ca nhan|rieng|cua (?:mai|chi|chi mai))\b/,
  /\b(?:mai|chi|chi mai) (?:dang )?o dau\b/,
  /\bdang o dau\b/,
  /\bve may bay\b|\bchuyen bay\b|\bbay (?:di|ve)\b|\bma dat cho\b|\bvisa\b|\bho chieu\b/,
  /\bspa\b|\bclinic\b|\bsuc khoe\b|\bkham (?:benh|rang|mat)\b|\bnha khoa\b/,
  /\bemail\b|\bhop thu\b|\bgmail\b/,
  /\bghi chu rieng\b|\brieng tu\b/,
  /\bweekly review\b|\bviec nen bo\b/,
  // English
  /\bwhere(?:'s| is)? mai\b|\bmai'?s (?:location|calendar|schedule|agenda|trip|flight)\b|\bpersonal (?:calendar|schedule|agenda)\b/,
  /\bflights?\b|\bplane tickets?\b|\bbooking (?:code|ref|reference)\b|\bpnr\b|\bpassport\b/,
  /\bhealth\b|\bdoctor\b|\bdentist\b|\bdental\b|\bmedical\b/,
  /\binbox\b|\bmailbox\b|\bemails?\b/,
  /\bprivate\b|\bpersonal notes?\b/,
];

export function isPrivateAsk(text: string): boolean {
  const t = foldName(text);
  return PRIVATE_PATTERNS.some((re) => re.test(t));
}

function afterColon(s: string): string {
  return s.replace(/^[\s:–—-]+/, "").trim();
}

function summaryHours(t: string): number {
  const n = t.match(/(\d+)\s*(?:ngay|days?|d)\b/);
  if (n) return Math.min(14, Math.max(1, parseInt(n[1], 10))) * 24;
  if (/hom qua|yesterday/.test(t)) return 48;
  if (/tuan|week/.test(t)) return 168;
  return 24;
}

/** Tách lệnh (Anh hoặc Việt); không hiểu → help (không đoán). */
export function parseBotCommand(raw: string): BotCommand {
  const text = stripMentions(raw);
  const t = foldName(text);

  // Tóm tắt: "tóm tắt 2 ngày qua" · "summarize the last 2 days" · "recap this week".
  // "chốt việc hôm nay" / "wrap up today" (§5.5.3) = tóm tắt + gói việc cho Mai duyệt.
  if (/^(?:tom tat|chot viec|summari[sz]e|summary|recap|wrap[\s-]?up)\b/.test(t)) {
    return { kind: "summary", hours: summaryHours(t) };
  }

  // ── Tiếng Việt ──
  const vi = text.match(/^(ghi việc|ghi viec|giao việc|giao viec|nhắc|nhac|ghi quyết định|ghi quyet dinh)\b\s*(.*)$/i);
  if (vi) {
    const verb = foldName(vi[1]);
    const rest = afterColon(vi[2]);
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

  // ── English ──
  const task = text.match(
    /^(?:please\s+)?(?:(?:add|create|log|note|record|new)\s+(?:a\s+|the\s+)?(?:task|todo|to-do)|task|todo|to-do)\b\s*(.*)$/i,
  );
  if (task) {
    const rest = afterColon(task[1]);
    return rest ? { kind: "task", text: rest } : { kind: "help" };
  }
  const decision = text.match(/^(?:please\s+)?(?:(?:log|record|note|add)\s+(?:a\s+|the\s+)?)?decision\b\s*(.*)$/i);
  if (decision) {
    const rest = afterColon(decision[1]);
    return rest ? { kind: "decision", text: rest } : { kind: "help" };
  }
  const assign = text.match(/^(?:please\s+)?assign\b\s*(.*)$/i);
  if (assign) {
    const rest = afterColon(assign[1]);
    if (!rest) return { kind: "help" };
    // "assign this to Linh, due Wednesday" · "assign the deck to Linh by Friday"
    const who = rest.match(
      /\bto\s+([\p{L}]+(?:\s+[\p{Lu}][\p{L}]*)?)(?=\s*,|\s+(?:due|by|on|before|until|deadline)\b|\s*[.;]|\s*$)/iu,
    )?.[1];
    return { kind: "assign", text: rest, assignee: who };
  }
  const remind = text.match(/^(?:please\s+)?remind\b\s*(.*)$/i);
  if (remind) {
    const rest = afterColon(remind[1]);
    if (!rest) return { kind: "help" };
    if (/^(?:me|us)\b/i.test(rest)) return { kind: "remind", text: rest.replace(/^(?:me|us)\b\s*(?:to\s+)?/i, "") };
    // "remind Linh Thursday about the deck" — người đứng ngay sau "remind".
    const who = rest.match(/^([\p{Lu}][\p{L}]*)/u)?.[1];
    return { kind: "remind", text: rest, assignee: who };
  }

  if (isPrivateAsk(text)) return { kind: "private" };
  if (
    /\bdang treo\b|\bcon viec gi\b|\bai dang lam\b|\bviec cua [\p{L} ]+ (?:tuan|hom)\b/u.test(t) ||
    /\bwhat(?:'s| is| are)\b.*\b(?:pending|open|left|outstanding|overdue)\b|\bwho(?:'s| is)\s+(?:working on|doing|handling)\b|\bopen tasks\b|\bstatus\b/.test(t)
  ) {
    return { kind: "status" };
  }
  return { kind: "help" };
}

// ── Câu chữ bot nói trên Lark (mặc định tiếng Anh) ──────────────────────

export interface BotCounts {
  tasks: number;
  decisions: number;
  questions: number;
}

export interface BotText {
  help: string;
  intro: string;
  recorded: (isDecision: boolean, projectName?: string) => string;
  noQueue: string;
  dmItem: (chat: string, text: string, parent?: string) => string;
  status: string;
  privateOther: string;
  privateOwnerAck: string;
  privateDm: (chat: string, ask: string, origin: string) => string;
  privateP2p: (origin: string) => string;
  p2pNotOwner: string;
  p2pNoOwner: string;
  summaryP2p: string;
  summaryNeedsAll: string;
  summaryNoAI: string;
  summaryCooldown: string;
  summaryReadFail: (code: string) => string;
  summaryEmpty: (hours: number) => string;
  summaryFail: string;
  summaryQueued: (summary: string, c: BotCounts, queued: boolean) => string;
  /** Câu dặn Claude viết tóm tắt bằng ngôn ngữ nào. */
  summaryLanguage: string;
}

function hoursEn(h: number): string {
  return h <= 24 ? "24 hours" : h % 24 === 0 ? `${h / 24} days` : `${h} hours`;
}
function hoursVi(h: number): string {
  return h <= 24 ? "24 giờ" : h % 24 === 0 ? `${h / 24} ngày` : `${h} giờ`;
}
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const BOT_TEXT: Record<BotLang, BotText> = {
  en: {
    help:
      "I'm Mai Lowtechie 🌼 Here's what I can do in this group: “@Mai Lowtechie add task: …”, “assign … to Linh, due Wednesday”, “remind Linh Thursday”, “log decision: …”, “summarize the last 2 days”. Everything I log goes to Mai's review inbox first — nothing becomes a task until Mai approves.",
    intro:
      "Hi everyone 👋 I'm Mai Lowtechie 🌼, Mai's assistant. I log tasks and decisions when you mention me, e.g. “@Mai Lowtechie add task: send the proposal to Do Thi on Friday”. Current mode: I only read messages that mention me. Everything I log goes to Mai's review inbox — nothing becomes a task until Mai approves. Mai can turn me off in the Lowtechie app; group admins can remove me in group settings.",
    recorded: (isDecision, projectName) =>
      `${isDecision ? "Decision logged" : "Logged"} to Mai's review inbox ✓${projectName ? ` · ${projectName}` : ""}`,
    noQueue: "Got it, but I couldn't pass this to Mai's review inbox yet — Mai, please check the queue in Lowtechie → Connections → Lark bot.",
    dmItem: (chat, text, parent) => `Task from ${chat}: ${text}${parent ? `\n(replying to: ${parent})` : ""}`,
    status: "I can't report task status in the group yet — the task list lives in Mai's app.",
    privateOther: "I can only share that with Mai privately.",
    privateOwnerAck: "I've messaged Mai privately.",
    privateDm: (chat, ask, origin) =>
      `You asked in «${chat}»: “${ask}”. I don't answer private matters in groups — open Lowtechie: ${origin}`,
    privateP2p: (origin) => `That lives in your Lowtechie app: ${origin}`,
    p2pNotOwner: "I'm Mai's personal assistant 🌼 — mention me in a group with Mai.",
    p2pNoOwner: "I don't know my owner yet — Mai, open Lowtechie → Connections → Lark bot to claim me.",
    summaryP2p: "Summaries work inside a group — mention me in the group you want summarized.",
    summaryNeedsAll:
      "This group is in “mention only” mode, so I don't read other messages to summarize. If everyone agrees, Mai can switch this group to “Read all” in the Lowtechie app.",
    summaryNoAI: "I can't summarize yet — AI isn't enabled on the server.",
    summaryCooldown: "I just posted a summary — please try again in a minute.",
    summaryReadFail: (code) =>
      `I can't read this group's messages yet — the app needs the “read all group messages” permission approved${code ? ` (code ${code})` : ""}.`,
    summaryEmpty: (h) => `No messages in the last ${hoursEn(h)}.`,
    summaryFail: "I couldn't summarize right now — please try again in a few minutes.",
    summaryQueued: (summary, c, queued) => {
      const parts = [
        c.tasks && plural(c.tasks, "task", "tasks"),
        c.decisions && plural(c.decisions, "decision", "decisions"),
        c.questions && plural(c.questions, "open question", "open questions"),
      ].filter(Boolean);
      if (!parts.length) return summary;
      return `${summary}\n\nSuggested: ${parts.join(" · ")} — ${queued ? "sent to Mai's review inbox." : "couldn't reach Mai's review inbox (queue not set up)."}`;
    },
    summaryLanguage: "Write the summary in English.",
  },
  vi: {
    help:
      "Mình là Mai Lowtechie 🌼 Trong group này mình làm được: “@Lowtechie ghi việc: …”, “giao việc … cho Linh, hạn thứ Tư”, “nhắc Linh thứ Năm”, “ghi quyết định: …”, “tóm tắt 2 ngày qua”. Việc ghi được đi vào Hộp duyệt của Mai — Mai duyệt xong mới thành việc.",
    intro:
      "Chào cả nhà 👋 Mình là Mai Lowtechie 🌼, trợ lý của Mai. Mình ghi nhận việc và quyết định khi được gọi, ví dụ “@Lowtechie ghi việc: gửi proposal cho Đô Thị thứ Sáu”. Chế độ đang bật: chỉ đọc tin có @Lowtechie. Việc mình ghi đi vào Hộp duyệt của Mai — Mai duyệt xong mới thành việc. Mai tắt được trong app Lowtechie; admin group gỡ bot trong cài đặt group.",
    recorded: (isDecision, projectName) =>
      `Đã ghi ${isDecision ? "quyết định" : "việc"} vào Hộp duyệt của Mai ✓${projectName ? ` · ${projectName}` : ""}`,
    noQueue: "Mình nhận rồi nhưng chưa chuyển được vào Hộp duyệt — Mai kiểm tra hàng đợi ở Kết nối → Bot Lark nhé.",
    dmItem: (chat, text, parent) => `Việc từ ${chat}: ${text}${parent ? `\n(trả lời tin: ${parent})` : ""}`,
    status: "Mình chưa trả lời được trạng thái việc ngay trong group — danh sách việc đang nằm trong app của Mai.",
    privateOther: "Việc này mình chỉ trả lời riêng với Mai.",
    privateOwnerAck: "Mình nhắn riêng cho Mai rồi.",
    privateDm: (chat, ask, origin) =>
      `Mai hỏi trong group «${chat}»: “${ask}”. Chuyện riêng mình không trả lời trong group — xem trong app: ${origin}`,
    privateP2p: (origin) => `Phần này nằm trong app của Mai: ${origin}`,
    p2pNotOwner: "Mình là trợ lý riêng của Mai 🌼 — gọi mình trong group có Mai nhé.",
    p2pNoOwner: "Mình chưa biết ai là chủ — Mai mở app Lowtechie → Kết nối → Bot Lark để nhận bot nhé.",
    summaryP2p: "Tóm tắt dùng trong group nhé — gọi @Lowtechie ngay trong group cần tóm tắt.",
    summaryNeedsAll:
      "Group này đang ở chế độ «chỉ khi được gọi» nên mình không đọc các tin khác để tóm tắt. Nếu mọi người đồng ý, Mai bật «Đọc toàn bộ» cho group này trong app Lowtechie.",
    summaryNoAI: "Mình chưa tóm tắt được — server chưa bật AI.",
    summaryCooldown: "Mình vừa tóm tắt xong — đợi một phút rồi gọi lại nhé.",
    summaryReadFail: (code) =>
      `Mình chưa đọc được tin trong group — cần quyền đọc toàn bộ tin group được duyệt${code ? ` (mã ${code})` : ""}.`,
    summaryEmpty: (h) => `Không có tin nào trong ${hoursVi(h)} qua.`,
    summaryFail: "Mình chưa tóm tắt được lúc này — thử lại sau ít phút nhé.",
    summaryQueued: (summary, c, queued) => {
      const parts = [
        c.tasks && `${c.tasks} việc`,
        c.decisions && `${c.decisions} quyết định`,
        c.questions && `${c.questions} câu hỏi chưa ai trả lời`,
      ].filter(Boolean);
      if (!parts.length) return summary;
      return `${summary}\n\nĐề xuất ${parts.join(" · ")} — ${queued ? "đã gửi vào Hộp duyệt của Mai." : "chưa gửi được vào Hộp duyệt (hàng đợi chưa bật)."}`;
    },
    summaryLanguage: "Viết tóm tắt bằng tiếng Việt.",
  },
};

/** Giữ tên cũ cho chỗ đang dùng: trợ giúp tiếng Việt. */
export const BOT_HELP = BOT_TEXT.vi.help;

export function botLang(lang: string | undefined): BotLang {
  return lang === "vi" ? "vi" : "en";
}
