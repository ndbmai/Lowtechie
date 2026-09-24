import { classify } from "./classify";
import { matchClient } from "./clients";
import { parseWhen, stripSpans, tidyTitle } from "./parse";
import { sanitizeTaxonomy } from "./projects";
import type { Category, Client, FeedbackEntry, Project, ProjectId, Task } from "./types";

/**
 * Bot Lark trong group (§5.5.1–5.5.3 v3.7): server nhận "@Lowtechie …",
 * cất THÔ vào hàng đợi; app kéo về rồi dựng thẻ Hộp duyệt ở ĐÂY — ngày
 * "thứ Sáu" tính theo giờ thiết bị của Mai và mốc là lúc tin được gửi
 * (không phải lúc app kéo về), dự án/khách lấy theo group đã gắn.
 */

export interface LarkInboxItem {
  /** message_id (việc trong gói tóm tắt thêm "#n"). */
  id: string;
  kind: "task" | "assign" | "remind" | "decision" | "question";
  /** Nội dung lệnh đã gỡ @mention. */
  text: string;
  assignee?: string;
  /** "YYYY-MM-DD" — hạn Claude trích từ đoạn chat (gói tóm tắt). */
  dueDate?: string;
  /** Tin gốc (tin được trả lời, hoặc câu trong đoạn chat). */
  quote?: string;
  chatId: string;
  chatName?: string;
  chatType: "group" | "p2p";
  sender?: string;
  /** ISO — lúc tin nhắn được gửi. */
  at: string;
  /** Link mở group/tin gốc trong Lark. */
  url?: string;
  /** Các mục cùng một gói tóm tắt → cùng một nhóm trong Hộp duyệt. */
  bundleId?: string;
  confidence?: number;
}

export type LarkGroupMode = "mention" | "all";

/** Gắn group Lark ↔ dự án · khách hàng + chế độ đọc (Mai chọn ở Kết nối). */
export interface LarkGroupSetting {
  name: string;
  projectId?: ProjectId;
  clientId?: string;
  mode: LarkGroupMode;
}

export type LarkTaskDraft = Omit<Task, "id" | "status" | "createdAt" | "deferCount">;

export interface LarkDraftContext {
  projects: Project[];
  categories: Category[];
  clients: Client[];
  feedback: FeedbackEntry[];
  group?: LarkGroupSetting;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "YYYY-MM-DD" → 9:00 sáng giờ thiết bị (quy ước "chỉ ngày" như parse.ts). */
function localNine(date: string): string | undefined {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const PREFIX: Record<LarkInboxItem["kind"], string> = {
  task: "",
  assign: "",
  remind: "Nhắc ",
  decision: "Quyết định: ",
  question: "Trả lời: ",
};

export function larkItemToDraft(item: LarkInboxItem, ctx: LarkDraftContext): LarkTaskDraft {
  const sentAt = new Date(item.at);
  const now = Number.isNaN(sentAt.getTime()) ? new Date() : sentAt;
  let text = item.text.trim();
  // "giao việc gửi proposal cho Linh, hạn thứ Tư" → người làm tách riêng.
  if (item.kind === "assign" && item.assignee) {
    text = text.replace(new RegExp(`(?:^|\\s)cho\\s+${escapeRe(item.assignee)}(?=[\\s,.]|$)`, "iu"), " ");
  }
  const decision = item.kind === "decision" || item.kind === "question";
  const when = decision ? { at: undefined, spans: [] as string[] } : parseWhen(text, now);
  let body = tidyTitle(
    stripSpans(text, when.spans)
      .replace(/(?:^|[\s,])hạn(?:\s+chót)?(?=[\s,.]|$)/giu, " ")
      .replace(/^\s*(?:việc\s+)?này\b/iu, " "),
  );
  // "nhắc Linh thứ Năm" trả lời một tin → lấy tin đó làm nội dung.
  if (item.quote && (!body || body.split(/\s+/).length <= 2)) {
    body = body ? `${body}: ${item.quote}` : tidyTitle(item.quote);
  }
  if (!body) body = item.quote ?? item.text;
  const title = PREFIX[item.kind] + body;

  const dueAt = decision ? undefined : item.dueDate ? localNine(item.dueDate) : when.at?.toISOString();
  const hard = /\bgấp\b|hạn chót|deadline/i.test(item.text);

  const cls = classify(`${title} ${item.quote ?? ""}`, ctx.feedback);
  const groupProject =
    ctx.group?.projectId && ctx.projects.some((p) => p.id === ctx.group!.projectId && p.status !== "archived")
      ? ctx.group.projectId
      : undefined;
  const wantProject = groupProject ?? cls.projectId;
  const tax = sanitizeTaxonomy(
    ctx.projects,
    ctx.categories,
    wantProject,
    cls.projectId === wantProject ? cls.categoryId : undefined,
  );
  const groupClient = ctx.group?.clientId && ctx.clients.some((c) => c.id === ctx.group!.clientId) ? ctx.group.clientId : undefined;
  const clientId = groupClient ?? matchClient(`${title} ${item.quote ?? ""}`, ctx.clients)?.id;

  const assignee = item.kind === "assign" && item.assignee ? item.assignee : "mai";
  const where = [item.sender, item.chatName ?? (item.chatType === "p2p" ? "nhắn riêng" : undefined)]
    .filter(Boolean)
    .join(" · ");
  const quoted = item.quote && item.quote !== item.text ? `“${item.text}” (trả lời: “${item.quote}”)` : `“${item.text}”`;

  return {
    title,
    projectId: tax.projectId,
    categoryId: tax.categoryId,
    clientId,
    assignee,
    ...(assignee !== "mai" ? { waitingOn: { person: assignee, followUpAt: dueAt } } : {}),
    dueAt,
    dueType: dueAt ? (hard ? "hard" : "soft") : undefined,
    dueSource: dueAt ? "nguon" : undefined,
    source: {
      channel: "lark",
      quote: where ? `${quoted} — ${where}` : quoted,
      ref: item.url,
    },
    confidence: item.confidence ?? 0.9,
  };
}

/** Gom theo gói: mục có bundleId đi chung một nhóm Hộp duyệt, còn lại mỗi mục một nhóm. */
export function groupLarkItems(items: LarkInboxItem[]): LarkInboxItem[][] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const out: LarkInboxItem[][] = [];
  const byBundle = new Map<string, LarkInboxItem[]>();
  for (const it of sorted) {
    if (!it.bundleId) {
      out.push([it]);
      continue;
    }
    const g = byBundle.get(it.bundleId);
    if (g) g.push(it);
    else {
      const ng = [it];
      byBundle.set(it.bundleId, ng);
      out.push(ng);
    }
  }
  return out;
}

/** Link mở group trong app Lark (bản quốc tế) — dùng làm "link về tin gốc". */
export function larkChatLink(chatId: string): string {
  return `https://applink.larksuite.com/client/chat/open?openChatId=${encodeURIComponent(chatId)}`;
}
