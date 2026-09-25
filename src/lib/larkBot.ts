import { OPEN_BASE } from "@/lib/larkServer";

/**
 * Bot "Mai Lowtechie" trong group Lark (PRD §5.5.1–5.5.2 v3.7) — dùng
 * CHÍNH app đã nối lịch, gọi API bằng tenant access token (danh nghĩa bot),
 * chỉ chạy phía server. Như mọi lời gọi Lark khác: HTTP 200 KÈM code != 0
 * vẫn là lỗi — luôn check code (bài học v3.2).
 */

// ── Xác thực webhook (sự kiện Lark gửi tới /api/lark/events) ─────────────

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** So hai chuỗi không lộ thời gian (chữ ký, verification token). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Giải mã body `{"encrypt": "..."}` khi app đặt Encrypt Key: AES-256-CBC,
 * khóa = SHA-256(encrypt key), 16 byte đầu là IV, đệm PKCS7.
 */
export async function decryptLarkPayload(encrypted: string, encryptKey: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", enc.encode(encryptKey));
  const buf = base64ToBytes(encrypted);
  if (buf.length < 32) throw new Error("lark-encrypt-short");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: buf.slice(0, 16) }, key, buf.slice(16));
  return new TextDecoder().decode(plain);
}

/** Chữ ký sự kiện: sha256(timestamp + nonce + encryptKey + body thô), dạng hex. */
export async function larkSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
): Promise<string> {
  return sha256Hex(timestamp + nonce + encryptKey + rawBody);
}

// ── Nội dung tin nhắn ────────────────────────────────────────────────────

export interface LarkMention {
  key: string;
  id?: { open_id?: string } | string;
  id_type?: string;
  name?: string;
}

function mentionOpenId(m: LarkMention): string | undefined {
  return typeof m.id === "string" ? (m.id_type === "open_id" || !m.id_type ? m.id : undefined) : m.id?.open_id;
}

interface PostNode {
  tag?: string;
  text?: string;
  user_name?: string;
  href?: string;
}

/** Chữ thuần của tin text/post (tin rich text "post" gộp các dòng). */
export function larkMessageText(msgType: string | undefined, content: string | undefined): string {
  if (!content) return "";
  let d: unknown;
  try {
    d = JSON.parse(content);
  } catch {
    return "";
  }
  if (!d || typeof d !== "object") return "";
  const o = d as { text?: unknown; title?: unknown; content?: unknown };
  if ((msgType ?? "text") === "text" && typeof o.text === "string") return o.text;
  // post: {title, content: [[{tag, text}…]…]} — có khi bọc thêm theo ngôn ngữ {vi_vn: {...}}.
  const body =
    Array.isArray(o.content)
      ? o
      : (Object.values(o).find((v) => v && typeof v === "object" && Array.isArray((v as { content?: unknown }).content)) as
          | typeof o
          | undefined);
  if (!body || !Array.isArray(body.content)) return typeof o.text === "string" ? o.text : "";
  const lines = (body.content as PostNode[][]).map((line) =>
    (Array.isArray(line) ? line : [])
      .map((n) => (n.tag === "at" ? `@${n.user_name ?? ""}` : (n.text ?? "")))
      .join(""),
  );
  const title = typeof body.title === "string" && body.title ? [body.title] : [];
  return [...title, ...lines].join("\n").trim();
}

/** Thay khóa "@_user_1" bằng "@Tên" (để đọc lịch sử cho dễ hiểu). */
export function resolveMentionKeys(text: string, mentions: LarkMention[] | undefined): string {
  let out = text;
  for (const m of mentions ?? []) if (m.key) out = out.split(m.key).join(`@${m.name ?? ""}`);
  return out;
}

/**
 * Chữ để tách lệnh: bỏ @bot, còn @người khác thay bằng TÊN — "giao việc
 * này cho @Linh" phải giữ được "Linh" (gỡ hết @ là mất người được giao).
 */
export function commandText(
  text: string,
  mentions: LarkMention[] | undefined,
  botOpenId?: string,
  botName?: string,
): string {
  let out = text;
  for (const m of mentions ?? []) {
    if (!m.key) continue;
    const isBot = mentionsBot([m], botOpenId, botName);
    out = out.split(m.key).join(isBot ? " " : (m.name ?? " "));
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Tin trong group có gọi bot không. Chỉ có quyền "tin @bot" thì mọi tin tới
 * đều có @bot; khi app có quyền đọc toàn bộ group thì phải lọc ở đây.
 */
export function mentionsBot(mentions: LarkMention[] | undefined, botOpenId?: string, botName?: string): boolean {
  if (!mentions?.length) return false;
  return mentions.some((m) => {
    const id = mentionOpenId(m);
    if (botOpenId && id) return id === botOpenId;
    const n = (m.name ?? "").toLowerCase();
    return n.includes("lowtechie") || (botName ? n === botName.toLowerCase() : false);
  });
}

// ── API bot (tenant access token) ────────────────────────────────────────

let tenantCache: { token: string; exp: number } | null = null;

export function isBotConfigured(): boolean {
  return Boolean(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
}

/** Token danh nghĩa bot (~2 giờ), nhớ trong tiến trình tới 5 phút trước hạn. */
export async function larkTenantToken(): Promise<string> {
  if (tenantCache && Date.now() < tenantCache.exp) return tenantCache.token;
  const res = await fetch(`${OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
    cache: "no-store",
  });
  const d = (await res.json().catch(() => ({}))) as { code?: number; tenant_access_token?: string; expire?: number };
  if (!res.ok || d.code !== 0 || !d.tenant_access_token) throw new Error(`lark-${d.code ?? res.status}`);
  tenantCache = { token: d.tenant_access_token, exp: Date.now() + Math.max(60, (d.expire ?? 7200) - 300) * 1000 };
  return d.tenant_access_token;
}

async function botCall<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await larkTenantToken();
  const res = await fetch(`${OPEN_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const d = (await res.json().catch(() => ({}))) as { code?: number } & T;
  if (!res.ok || (typeof d.code === "number" && d.code !== 0)) throw new Error(`lark-${d.code ?? res.status}`);
  return d;
}

export interface BotInfo {
  openId?: string;
  name?: string;
  /** 2 = đang bật; 0/3/4 = chờ cài/kích hoạt; 1/5/6 = bị tắt. */
  activateStatus?: number;
}

let botInfoCache: { info: BotInfo; exp: number } | null = null;

export async function larkBotInfo(fresh = false): Promise<BotInfo> {
  if (!fresh && botInfoCache && Date.now() < botInfoCache.exp) return botInfoCache.info;
  const d = await botCall<{ bot?: { open_id?: string; app_name?: string; activate_status?: number } }>(
    "/open-apis/bot/v3/info",
  );
  const info = { openId: d.bot?.open_id, name: d.bot?.app_name, activateStatus: d.bot?.activate_status };
  botInfoCache = { info, exp: Date.now() + 30 * 60_000 };
  return info;
}

function textBody(text: string): string {
  return JSON.stringify({ msg_type: "text", content: JSON.stringify({ text }) });
}

/** Trả lời ngay dưới tin được gọi. */
export async function larkReply(messageId: string, text: string): Promise<void> {
  await botCall(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`, {
    method: "POST",
    body: textBody(text),
  });
}

/** Gửi tin mới vào group (chat_id) hoặc nhắn riêng một người (open_id). */
export async function larkSendText(receiveId: string, text: string, idType: "chat_id" | "open_id"): Promise<void> {
  await botCall(`/open-apis/im/v1/messages?receive_id_type=${idType}`, {
    method: "POST",
    body: JSON.stringify({ receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text }) }),
  });
}

export interface BotChat {
  id: string;
  name: string;
  external: boolean;
}

/** Các group bot đang ở trong (cần quyền đọc thông tin group). */
export async function larkBotChats(): Promise<BotChat[]> {
  const out: BotChat[] = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const p = new URLSearchParams({ page_size: "100" });
    if (pageToken) p.set("page_token", pageToken);
    const d = await botCall<{
      data?: { items?: { chat_id?: string; name?: string; external?: boolean }[]; has_more?: boolean; page_token?: string };
    }>(`/open-apis/im/v1/chats?${p}`);
    for (const c of d.data?.items ?? []) {
      if (c.chat_id) out.push({ id: c.chat_id, name: c.name || "(group không tên)", external: Boolean(c.external) });
    }
    if (!d.data?.has_more || !d.data.page_token) break;
    pageToken = d.data.page_token;
  }
  return out;
}

export async function larkChatName(chatId: string): Promise<string | undefined> {
  try {
    const d = await botCall<{ data?: { name?: string } }>(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`);
    return d.data?.name || undefined;
  } catch {
    return undefined;
  }
}

const memberCache = new Map<string, { names: Map<string, string>; exp: number }>();

/** Tên thành viên group theo open_id (best-effort, nhớ 10 phút). */
export async function larkChatMembers(chatId: string): Promise<Map<string, string>> {
  const hit = memberCache.get(chatId);
  if (hit && Date.now() < hit.exp) return hit.names;
  const names = new Map<string, string>();
  try {
    let pageToken = "";
    for (let page = 0; page < 5; page++) {
      const p = new URLSearchParams({ member_id_type: "open_id", page_size: "100" });
      if (pageToken) p.set("page_token", pageToken);
      const d = await botCall<{
        data?: { items?: { member_id?: string; name?: string }[]; has_more?: boolean; page_token?: string };
      }>(`/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?${p}`);
      for (const m of d.data?.items ?? []) if (m.member_id && m.name) names.set(m.member_id, m.name);
      if (!d.data?.has_more || !d.data.page_token) break;
      pageToken = d.data.page_token;
    }
  } catch {
    /* thiếu quyền thành viên → không có tên, vẫn chạy tiếp */
  }
  memberCache.set(chatId, { names, exp: Date.now() + 10 * 60_000 });
  return names;
}

interface RawMessage {
  message_id?: string;
  msg_type?: string;
  create_time?: string;
  deleted?: boolean;
  sender?: { id?: string; id_type?: string; sender_type?: string };
  body?: { content?: string };
  mentions?: LarkMention[];
}

export interface ChatLine {
  at: number;
  senderId?: string;
  fromBot: boolean;
  text: string;
}

function toLine(m: RawMessage): ChatLine | null {
  if (m.deleted) return null;
  const text = resolveMentionKeys(larkMessageText(m.msg_type, m.body?.content), m.mentions).trim();
  if (!text) return null;
  return {
    at: Number(m.create_time) || 0,
    senderId: m.sender?.id,
    fromBot: m.sender?.sender_type === "app",
    text,
  };
}

/** Một tin theo id (ví dụ tin được trả lời khi gọi "ghi việc này"). */
export async function larkGetMessage(messageId: string): Promise<ChatLine | null> {
  try {
    const d = await botCall<{ data?: { items?: RawMessage[] } }>(
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
    );
    const m = d.data?.items?.[0];
    return m ? toLine(m) : null;
  } catch {
    return null;
  }
}

/**
 * Lịch sử group trong khoảng thời gian (giây) — cần quyền ĐỌC TOÀN BỘ tin
 * group (nhạy cảm, admin duyệt). Tối đa `max` tin, cũ → mới.
 */
export async function larkChatHistory(chatId: string, fromSec: number, toSec: number, max = 300): Promise<ChatLine[]> {
  const out: ChatLine[] = [];
  let pageToken = "";
  for (let page = 0; page < 10 && out.length < max; page++) {
    const p = new URLSearchParams({
      container_id_type: "chat",
      container_id: chatId,
      start_time: String(Math.floor(fromSec)),
      end_time: String(Math.floor(toSec)),
      sort_type: "ByCreateTimeAsc",
      page_size: "50",
    });
    if (pageToken) p.set("page_token", pageToken);
    const d = await botCall<{ data?: { items?: RawMessage[]; has_more?: boolean; page_token?: string } }>(
      `/open-apis/im/v1/messages?${p}`,
    );
    for (const m of d.data?.items ?? []) {
      const line = toLine(m);
      if (line) out.push(line);
    }
    if (!d.data?.has_more || !d.data.page_token) break;
    pageToken = d.data.page_token;
  }
  return out.slice(0, max);
}

/**
 * Mã lỗi bot → việc cần làm, theo đúng thứ tự kiểm tra của PRD §5.5.1.
 * Luôn kèm "(mã …)" — Mai hay gửi ảnh chụp màn hình, có mã là đoán đúng
 * bệnh (lỗi thật 25/9: "Lark báo lỗi (11205)" không nói phải làm gì).
 */
export function botErrorAction(detail: string): string {
  const code = detail.match(/lark-(\w+)/)?.[1] ?? "";
  const tag = code ? ` (mã ${code})` : "";
  // 11205 = bot/v3/info "app do not have bot"; 230006 = IM "bot ability is not activated".
  if (code === "11205" || code === "230006")
    return `App chưa bật tính năng Bot — trên console Lark: Features → Bot → bật, rồi tạo phiên bản mới và phát hành${tag}.`;
  if (code === "10003" || code === "10014" || code === "99991663" || code === "99991664")
    return `LARK_APP_ID / LARK_APP_SECRET trên Vercel không khớp app — chép lại từ Credentials của app${tag}.`;
  if (code === "230002") return `Bot chưa nằm trong group này — thêm bot ở cài đặt group → Bot${tag}.`;
  if (code === "230027" || code.startsWith("99991"))
    return `App thiếu quyền cho việc này — thêm ở Permissions & Scopes, tab Tenant token scopes (quyền của bot, KHÁC tab User token của lịch), rồi phát hành lại và chờ admin duyệt${tag}.`;
  if (code === "403" || code === "404")
    return `Không gọi được API bot — kiểm tra app dùng đúng miền larksuite.com (bản quốc tế) và đã phát hành${tag}.`;
  return `Lark báo lỗi mã ${code || detail} — bấm Kiểm tra bot lại sau vài phút.`;
}
