import { foldName } from "./clients";
import type { CalEvent, Client, Contact, EventInvitee, InviteResponse } from "./types";

/**
 * Danh bạ liên hệ + mời họp (§5.4 v3.9). Mai gõ hoặc nói tên ("mời anh
 * Tuấn bên OKR và chị Linh") → khớp với danh bạ, điền sẵn email; chưa có
 * → hỏi ĐÚNG MỘT LẦN "Email của anh Tuấn là gì?" rồi nhớ; trùng tên → 2
 * lựa chọn gần nhất kèm công ty. Gửi mời luôn cần Mai xác nhận riêng —
 * phần đó nằm ở UI; ở đây chỉ là logic thuần (không mạng, không React).
 */

const EMAIL_RE = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[a-z]{2,}$/i;
const EMAIL_IN_TEXT = /[^\s@<>(),;:"'·]+@[^\s@<>(),;:"'·]+\.[a-z]{2,}/i;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function emailIn(s: string | undefined): string | undefined {
  return s?.match(EMAIL_IN_TEXT)?.[0]?.toLowerCase();
}

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** Chữ đặc trưng tiếng Việt (ă â đ ê ô ơ ư + dấu hỏi/ngã/nặng) — "é" kiểu Pháp không tính. */
const VI_CHARS = /[ăâđêôơưảãạẻẽẹỉĩịỏõọủũụỷỹỵằắẳẵặầấẩẫậềếểễệồốổỗộờớởỡợừứửữự]/i;

/** Danh xưng Mai dùng khi gọi tên. Danh xưng tiếng Việt → thư mời tiếng Việt. */
const VI_HONORIFIC = "anh|chị|chi|em|bạn|cô|chú|bác|ông|bà|thầy|sếp|cậu|dì";
const OTHER_HONORIFIC = String.raw`mr\.?|mrs\.?|ms\.?|miss|dr\.?|khun|p'|nong`;

export interface SaidName {
  /** Tên lõi để tìm: "Tuấn". */
  core: string;
  honorific?: string;
  /** "bên OKR" → "OKR". */
  company?: string;
  /** Cách gọi không kèm công ty: "anh Tuấn" — dùng cho câu hỏi + lời chào. */
  call: string;
  /** Mai gọi bằng danh xưng tiếng Việt → nhiều khả năng dùng tiếng Việt. */
  viHint: boolean;
}

/** "anh Tuấn bên OKR" → { core "Tuấn", honorific "anh", company "OKR", call "anh Tuấn" }. */
export function parseSaidName(raw: string): SaidName {
  let s = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:]+|[,.;:!?]+$/g, "")
    .trim();
  let company: string | undefined;
  const cm = s.match(/^(.+?)\s+(?:bên|của|thuộc|ở công ty|công ty|cty|from|at|@)\s+(.+)$/iu);
  if (cm) {
    s = cm[1].trim();
    company = cm[2].trim();
  } else {
    const paren = s.match(/^(.+?)\s*\(([^)]+)\)$/u);
    if (paren) {
      s = paren[1].trim();
      company = paren[2].trim();
    }
  }
  let honorific: string | undefined;
  const hm = s.match(new RegExp(`^(${VI_HONORIFIC}|${OTHER_HONORIFIC})\\s+(.+)$`, "iu"));
  if (hm) {
    honorific = hm[1];
    s = hm[2].trim();
  } else {
    // "a Tuấn", "c Linh" (nhắn tắt) — chỉ khi tên sau viết HOA.
    const one = s.match(/^([ace])\s+(\p{Lu}.*)$/u);
    const th = one ? null : s.match(/^(คุณ|พี่|น้อง)\s*(.+)$/u);
    const m = one ?? th;
    if (m) {
      honorific = m[1];
      s = m[2].trim();
    }
  }
  const viHint = Boolean(honorific && new RegExp(`^(?:${VI_HONORIFIC}|a|c|e)$`, "iu").test(honorific));
  return { core: s, honorific, company, call: honorific ? `${honorific} ${s}` : s, viHint };
}

/** "anh Tuấn bên OKR và chị Linh, Hà" → 3 người. "mọi người"/"team" không phải tên. */
export function splitInviteeList(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\s(?:và|va|and|với|with)\s|&|\+)\s*/iu)
    .map((s) => s.replace(/^(?:mời|invite)\s+/iu, "").trim())
    .filter((s) => s.length > 0 && !/^(?:mọi người|cả nhà|cả team|team|everyone|all|nhé|nha)$/iu.test(s));
}

function tokens(s: string): string[] {
  return foldName(s)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/** Mức khớp tên: 3 = đúng cả tên/tên gọi khác, 2 = đủ các chữ (nhiều chữ), 1 = một chữ (tên gọi). */
export function scoreContact(c: Contact, query: string): number {
  const fq = foldName(query);
  if (!fq) return 0;
  const names = [c.name, ...c.aliases];
  if (names.some((n) => foldName(n) === fq)) return 3;
  const qt = tokens(query);
  if (!qt.length) return 0;
  let best = 0;
  for (const n of names) {
    const nt = tokens(n);
    if (qt.every((t) => nt.includes(t))) best = Math.max(best, qt.length > 1 ? 2 : 1);
  }
  if (!best && c.email) {
    const local = tokens(c.email.split("@")[0].replace(/[._-]+/g, " "));
    if (qt.every((t) => local.includes(t))) best = 1;
  }
  return best;
}

function companyMatches(c: Contact, hint: string, clients: Client[]): boolean {
  const h = foldName(hint);
  if (!h) return true;
  if (c.company && foldName(c.company).includes(h)) return true;
  const domain = c.email?.split("@")[1];
  if (domain && foldName(domain).includes(h.replace(/\s+/g, ""))) return true;
  const client = c.clientId ? clients.find((x) => x.id === c.clientId) : undefined;
  return Boolean(client && [client.name, ...client.aliases].some((n) => foldName(n).includes(h)));
}

function byRecency(a: Contact, b: Contact): number {
  return (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || (b.useCount ?? 0) - (a.useCount ?? 0);
}

export type InviteeMatch =
  | { kind: "email"; email: string; contact?: Contact }
  | { kind: "one"; contact: Contact }
  | { kind: "many"; options: Contact[] }
  | { kind: "none" };

/**
 * Khớp MỘT người Mai gọi với danh bạ. Có email trong câu → dùng thẳng.
 * Nhiều người khớp ngang nhau → 2 lựa chọn gần nhất (dùng gần đây nhất).
 * "bên OKR" lọc theo công ty/tên miền/khách hàng.
 */
export function matchInvitee(said: string, pool: Contact[], clients: Client[] = []): InviteeMatch {
  const email = emailIn(said);
  if (email) return { kind: "email", email, contact: pool.find((c) => lower(c.email) === email) };
  const p = parseSaidName(said);
  // "Anh Thư" có thể là TÊN (không phải "anh" + "Thư") → cả cụm chỉ tính khi khớp ĐÚNG
  // tên/tên gọi khác; khớp từng chữ thì chỉ dùng tên lõi — kẻo "anh Tuấn" ưu tiên nhầm
  // người có tên đệm "Anh".
  const whole = foldName(p.honorific ? `${p.honorific} ${p.core}` : p.core);
  let scored = pool
    .map((c) => ({
      c,
      s: [c.name, ...c.aliases].some((n) => foldName(n) === whole) ? 3 : scoreContact(c, p.core),
    }))
    .filter((x) => x.s > 0);
  if (p.company) {
    const hit = scored.filter((x) => companyMatches(x.c, p.company!, clients));
    if (hit.length) scored = hit;
  }
  if (!scored.length) return { kind: "none" };
  scored.sort((a, b) => b.s - a.s || byRecency(a.c, b.c));
  const top = scored.filter((x) => x.s === scored[0].s);
  if (top.length === 1) return { kind: "one", contact: top[0].c };
  return { kind: "many", options: top.slice(0, 2).map((x) => x.c) };
}

/** Một người trên thẻ xem trước — đang đủ email, chờ Mai trả lời email, hay chờ chọn 1 trong 2. */
export interface InviteeDraft {
  /** Cách Mai gọi: "anh Tuấn bên OKR". */
  said: string;
  name: string;
  /** "anh Tuấn" — câu hỏi email + lời chào tiếng Việt. */
  call: string;
  email?: string;
  contactId?: string;
  larkOpenId?: string;
  company?: string;
  status: "ready" | "ask_email" | "pick";
  options?: Contact[];
  viHint?: boolean;
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)(\p{Ll})/gu, (_, sp: string, ch: string) => sp + ch.toUpperCase());
}

/** "tuan.nguyen@okr.vn" → "Tuan Nguyen". */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/\d+/g, " ").replace(/[._+-]+/g, " ").trim();
  return titleCase(local.toLowerCase()) || email;
}

export function draftFromContact(c: Contact, said = c.name, viHint = false): InviteeDraft {
  const p = parseSaidName(said);
  return {
    said,
    name: c.name,
    call: p.honorific ? p.call : c.name,
    email: c.email,
    contactId: c.id,
    larkOpenId: c.larkOpenId,
    company: c.company,
    status: c.email || c.larkOpenId ? "ready" : "ask_email",
    viHint: viHint || p.viHint,
  };
}

/** Tên Mai nói → dòng người mời trên thẻ (§5.4 v3.9). */
export function resolveInvitee(said: string, pool: Contact[], clients: Client[] = []): InviteeDraft {
  const p = parseSaidName(said);
  const m = matchInvitee(said, pool, clients);
  if (m.kind === "email") {
    if (m.contact) return { ...draftFromContact(m.contact, m.contact.name), said, email: m.email, status: "ready" };
    const bare = said.replace(EMAIL_IN_TEXT, "").replace(/[<>()"]/g, "").trim();
    const name = bare ? parseSaidName(bare).core : nameFromEmail(m.email);
    return { said, name, call: name, email: m.email, status: "ready" };
  }
  if (m.kind === "one") return draftFromContact(m.contact, said, p.viHint);
  const name = titleCase(p.core);
  if (m.kind === "many") {
    return { said, name, call: p.call, company: p.company, status: "pick", options: m.options, viHint: p.viHint };
  }
  return { said, name, call: p.honorific ? `${p.honorific} ${name}` : name, company: p.company, status: "ask_email", viHint: p.viHint };
}

/** Dòng trên thẻ → người được mời lưu kèm sự kiện (CHƯA gửi — chờ xác nhận riêng). */
export function inviteeFromDraft(d: InviteeDraft): EventInvitee {
  return {
    name: d.name,
    call: d.call,
    lang: d.viHint ? "vi" : contactLang({ name: d.name, email: d.email }),
    email: d.email,
    contactId: d.contactId,
    larkOpenId: d.larkOpenId,
    response: "no_reply",
  };
}

/** Lịch Lark mời được người trong tổ chức bằng open_id — không cần hỏi email. */
export function needsEmail(d: InviteeDraft, provider?: "google" | "lark"): boolean {
  return !d.email && !(provider === "lark" && d.larkOpenId);
}

/** Câu hỏi DUY NHẤT khi chưa có email (PRD: "Email của anh Tuấn là gì?"). */
export function emailQuestion(d: InviteeDraft): string {
  return `Email của ${d.call} là gì?`;
}

/** Nhãn lựa chọn khi trùng tên: tên · công ty · email. */
export function contactLabel(c: Contact): string {
  return [c.name, c.company, c.email].filter(Boolean).join(" · ");
}

/** Gợi ý khi Mai đang gõ ở ô "Mời thêm" — khớp đầu chữ, tên gọi khác, email. */
export function suggestContacts(q: string, pool: Contact[], limit = 5): Contact[] {
  const fq = foldName(q);
  if (fq.length < 1) return [];
  return pool
    .filter(
      (c) =>
        [c.name, ...c.aliases].some((n) => foldName(n).startsWith(fq) || tokens(n).some((t) => t.startsWith(fq))) ||
        lower(c.email).startsWith(fq),
    )
    .sort(byRecency)
    .slice(0, limit);
}

// ── Ghi nhớ / gộp ────────────────────────────────────────────────────────

export function makeContactId(name: string, existing: Contact[]): string {
  const base =
    foldName(name)
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "lienhe";
  let id = `ct:${base}`;
  let n = 2;
  while (existing.some((c) => c.id === id)) id = `ct:${base}${n++}`;
  return id;
}

function looksLikeEmail(s: string): boolean {
  return s.includes("@");
}

export type ContactInput = Partial<Omit<Contact, "id">> & { name: string; source: Contact["source"] };

/**
 * Thêm hoặc cập nhật liên hệ — KHÔNG tạo trùng: khớp theo `id` (Mai chọn
 * đúng người), email, rồi open_id Lark. Tên mới khác tên cũ → học thành
 * tên gọi khác. `use` = vừa mời người này (gợi ý theo gần đây/hay dùng).
 */
export function upsertContact(
  contacts: Contact[],
  input: ContactInput,
  opts: { id?: string; use?: boolean; now?: string } = {},
): { contacts: Contact[]; contact: Contact; created: boolean } {
  const email = input.email ? input.email.trim().toLowerCase() : undefined;
  const found =
    (opts.id ? contacts.find((c) => c.id === opts.id) : undefined) ??
    (email ? contacts.find((c) => lower(c.email) === email) : undefined) ??
    (input.larkOpenId ? contacts.find((c) => c.larkOpenId === input.larkOpenId) : undefined);
  const now = opts.now ?? new Date().toISOString();
  const usage = opts.use ? { lastUsedAt: now } : {};
  const name = input.name.replace(/\s+/g, " ").trim();

  if (found) {
    let nextName = found.name;
    let aliases = found.aliases;
    if (name && !looksLikeEmail(name)) {
      if (!found.name || looksLikeEmail(found.name)) nextName = name;
      else if (
        foldName(name) !== foldName(found.name) &&
        !aliases.some((a) => foldName(a) === foldName(name))
      ) {
        aliases = [...aliases, name].slice(-8);
      }
    }
    const projectIds = [...new Set([...(found.projectIds ?? []), ...(input.projectIds ?? [])])];
    const merged: Contact = {
      ...found,
      name: nextName,
      aliases,
      email: found.email ?? email,
      company: found.company ?? input.company,
      clientId: found.clientId ?? input.clientId,
      larkOpenId: found.larkOpenId ?? input.larkOpenId,
      lang: found.lang ?? input.lang,
      projectIds: projectIds.length ? projectIds : undefined,
      ...usage,
      useCount: (found.useCount ?? 0) + (opts.use ? 1 : 0),
    };
    return { contacts: contacts.map((c) => (c.id === found.id ? merged : c)), contact: merged, created: false };
  }

  const contact: Contact = {
    id: makeContactId(name || email || "lienhe", contacts),
    name: name || (email ? nameFromEmail(email) : "Liên hệ"),
    aliases: input.aliases ?? [],
    email,
    company: input.company,
    clientId: input.clientId,
    projectIds: input.projectIds,
    source: input.source,
    larkOpenId: input.larkOpenId,
    lang: input.lang,
    ...usage,
    useCount: opts.use ? 1 : 0,
  };
  return { contacts: [...contacts, contact], contact, created: true };
}

/** Gộp hai liên hệ trùng (Quản lý): giữ `keepId`, tên người kia thành tên gọi khác. */
export function mergeContacts(contacts: Contact[], keepId: string, dropId: string): Contact[] {
  const keep = contacts.find((c) => c.id === keepId);
  const drop = contacts.find((c) => c.id === dropId);
  if (!keep || !drop || keepId === dropId) return contacts;
  const aliases = [...keep.aliases];
  for (const n of [drop.name, ...drop.aliases]) {
    if (n && foldName(n) !== foldName(keep.name) && !aliases.some((a) => foldName(a) === foldName(n))) aliases.push(n);
  }
  const merged: Contact = {
    ...keep,
    aliases: aliases.slice(-12),
    email: keep.email ?? drop.email,
    company: keep.company ?? drop.company,
    clientId: keep.clientId ?? drop.clientId,
    larkOpenId: keep.larkOpenId ?? drop.larkOpenId,
    lang: keep.lang ?? drop.lang,
    projectIds: [...new Set([...(keep.projectIds ?? []), ...(drop.projectIds ?? [])])],
    lastUsedAt: [keep.lastUsedAt, drop.lastUsedAt].filter(Boolean).sort().pop(),
    useCount: (keep.useCount ?? 0) + (drop.useCount ?? 0),
  };
  return contacts.filter((c) => c.id !== dropId).map((c) => (c.id === keepId ? merged : c));
}

/**
 * Người liên hệ của khách hàng/đối tác (§5.3.2) — khách có email trong ô
 * liên hệ thì mời được ngay, không phải nhập lại vào danh bạ liên hệ.
 */
export function contactsFromClients(clients: Client[]): Contact[] {
  const out: Contact[] = [];
  for (const c of clients) {
    const email = emailIn(c.contact);
    if (!email) continue;
    const note = c.notes?.trim();
    out.push({
      id: `client:${c.id}`,
      name: c.name,
      aliases: c.aliases,
      email,
      company: note && note.length <= 60 && !note.includes("\n") ? note : undefined,
      clientId: c.id,
      projectIds: c.projectIds,
      source: "client",
      lastUsedAt: c.lastUsedAt,
    });
  }
  return out;
}

/** Danh bạ để khớp tên: liên hệ đã lưu + người liên hệ của khách (không trùng email). */
export function invitePool(contacts: Contact[], clients: Client[]): Contact[] {
  const emails = new Set(contacts.map((c) => lower(c.email)).filter(Boolean));
  return [...contacts, ...contactsFromClients(clients).filter((c) => !emails.has(lower(c.email)))];
}

// ── Nhập từ hộp thư ──────────────────────────────────────────────────────

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.com.vn",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "msn.com",
]);
const TWO_LEVEL_SUFFIX = /\.(?:co|com|net|org|ac|go|or|in|edu|gov)\.[a-z]{2}$/i;
const ROBOT_LOCAL = /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|notify|alerts?|newsletters?|news|bounces?|info|support|hello|contact|sales|admin|billing|marketing|team|calendar|calendar-notification|invoice|receipts?|updates?)$/i;

/** "okr.vn" → "OKR", "mail.thecircle.co" → "Thecircle"; hộp thư miễn phí → không có công ty. */
export function companyFromDomain(domain: string): string | undefined {
  const d = domain.toLowerCase();
  if (FREE_MAIL.has(d)) return undefined;
  const labels = d.split(".");
  const idx = TWO_LEVEL_SUFFIX.test(d) ? labels.length - 3 : labels.length - 2;
  const label = labels[idx];
  if (!label) return undefined;
  return label.length <= 4 ? label.toUpperCase() : label.charAt(0).toUpperCase() + label.slice(1);
}

export interface MailPerson {
  name: string;
  email: string;
  company?: string;
  /** Số lần xuất hiện — hay trao đổi đứng trước. */
  count: number;
}

/**
 * Người gửi/nhận từ header From/To/Cc (Gmail, Lark Mail) → ứng viên danh
 * bạ. Bỏ địa chỉ của chính Mai và hộp thư máy (no-reply, info, support…).
 */
export function peopleFromHeaders(values: string[], selfEmails: string[] = []): MailPerson[] {
  const self = new Set(selfEmails.map((e) => e.toLowerCase()));
  const found = new Map<string, MailPerson>();
  const re = /(?:"?([^"<>,;]*?)"?\s*)<([^<>\s]+@[^<>\s]+)>|([^\s<>,;"]+@[^\s<>,;"]+)/g;
  for (const v of values) {
    for (const m of v.matchAll(re)) {
      const email = (m[2] ?? m[3] ?? "").toLowerCase().replace(/[.,;]+$/, "");
      if (!isEmail(email) || self.has(email)) continue;
      const [local, domain] = email.split("@");
      if (ROBOT_LOCAL.test(local) || /(?:no-?reply|bounce|notification)/i.test(local)) continue;
      const rawName = (m[1] ?? "").replace(/^['"\s]+|['"\s]+$/g, "").trim();
      const name = rawName && !rawName.includes("@") ? rawName : nameFromEmail(email);
      const prev = found.get(email);
      if (prev) {
        prev.count++;
        if (prev.name === nameFromEmail(email) && rawName && !rawName.includes("@")) prev.name = rawName;
      } else {
        found.set(email, { name, email, company: companyFromDomain(domain), count: 1 });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

// ── Ngôn ngữ + lời nhắn thư mời ─────────────────────────────────────────

export type InviteLang = "vi" | "en";

/** Liên hệ này dùng tiếng Việt? (Mai đặt rõ > tên có dấu Việt > tên miền .vn). */
export function contactLang(c: { name: string; email?: string; lang?: InviteLang }): InviteLang | undefined {
  if (c.lang) return c.lang;
  if (VI_CHARS.test(c.name)) return "vi";
  if (c.email && /\.vn$/i.test(c.email)) return "vi";
  return undefined;
}

/**
 * Thư mời mặc định TIẾNG ANH với người ngoài; TIẾNG VIỆT chỉ khi mọi
 * người được mời đều dùng tiếng Việt (§5.4 v3.9).
 */
export function inviteLanguage(people: { name: string; email?: string; lang?: InviteLang; viHint?: boolean }[]): InviteLang {
  if (!people.length) return "en";
  return people.every((p) => p.viHint || contactLang(p) === "vi") ? "vi" : "en";
}

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VI_DAYS = ["Chủ nhật", "thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy"];

const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** "GMT+7" theo giờ máy của Mai tại thời điểm đó. */
export function gmtLabel(d: Date): string {
  const off = -d.getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return `GMT${off < 0 ? "-" : "+"}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

export function inviteWhen(lang: InviteLang, startAt: string, endAt: string): string {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const range = `${hm(s)}–${hm(e)} (${gmtLabel(s)})`;
  return lang === "vi"
    ? `${VI_DAYS[s.getDay()]} ${s.getDate()}/${s.getMonth() + 1}, ${range}`
    : `${EN_DAYS[s.getDay()]}, ${EN_MONTHS[s.getMonth()]} ${s.getDate()} · ${range}`;
}

/** Lời nhắn mặc định trong thư mời — Mai sửa được trước khi gửi. */
export function defaultInviteMessage(
  lang: InviteLang,
  ev: { title: string; startAt: string; endAt: string; meetUrl?: string; location?: string },
  people: { call: string; name: string }[],
): string {
  const when = inviteWhen(lang, ev.startAt, ev.endAt);
  const place = ev.meetUrl
    ? `${lang === "vi" ? "Link họp" : "Join"}: ${ev.meetUrl}`
    : ev.location
      ? `${lang === "vi" ? "Địa điểm" : "Location"}: ${ev.location}`
      : "";
  if (lang === "vi") {
    const calls = people.map((p) => p.call);
    const greet = calls.length && calls.length <= 3 ? `Chào ${calls.join(", ")},` : "Chào mọi người,";
    const whom = people.length === 1 ? (parseSaidName(people[0].call).honorific ?? "bạn") : "mọi người";
    return [greet, "", `Mai mời ${whom} tham gia “${ev.title}” vào ${when}.`, place, "", "Cảm ơn,", "Mai"]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n")
      .replace(/\n\n\n+/g, "\n\n");
  }
  const first = people.map((p) => {
    const core = parseSaidName(p.call).core || p.name;
    return core;
  });
  const greet = first.length && first.length <= 3 ? `Hi ${first.join(", ")},` : "Hi all,";
  return [greet, "", `I'd like to invite you to “${ev.title}” on ${when}.`, place, "", "Best regards,", "Mai"]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

// ── Trả lời + nhắc follow-up ─────────────────────────────────────────────

/** Trạng thái trả lời từ Google (needsAction/accepted…) hoặc Lark (needs_action/accept…). */
export function normalizeResponse(raw: string | undefined): InviteResponse {
  const r = (raw ?? "").toLowerCase();
  if (r === "accepted" || r === "accept") return "accepted";
  if (r === "declined" || r === "decline" || r === "removed") return "declined";
  if (r === "tentative") return "tentative";
  return "no_reply";
}

export interface RemoteAttendee {
  email?: string;
  openId?: string;
  name?: string;
  response: string;
}

/** Ghép trạng thái trả lời đọc từ lịch ngoài vào danh sách người mời (theo email/open_id). */
export function applyResponses(invitees: EventInvitee[], remote: RemoteAttendee[]): EventInvitee[] {
  return invitees.map((i) => {
    const hit = remote.find(
      (r) => (i.email && lower(r.email) === lower(i.email)) || (i.larkOpenId && r.openId === i.larkOpenId),
    );
    return hit ? { ...i, response: normalizeResponse(hit.response) } : i;
  });
}

/** Ghép kết quả gửi mời vào danh sách người mời của sự kiện (theo email / open_id / tên). */
export function mergeInvitees(existing: EventInvitee[], updated: EventInvitee[]): EventInvitee[] {
  const same = (a: EventInvitee, b: EventInvitee) =>
    (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) ||
    (a.larkOpenId && a.larkOpenId === b.larkOpenId) ||
    (!a.email && !b.email && a.name === b.name);
  const out = existing.map((x) => updated.find((u) => same(u, x)) ?? x);
  for (const u of updated) if (!out.some((x) => same(x, u))) out.push(u);
  return out;
}

export interface InviteStats {
  accepted: number;
  declined: number;
  tentative: number;
  noReply: number;
  failed: number;
  /** Đã soạn nhưng CHƯA gửi. */
  unsent: number;
}

export function inviteStats(invitees: EventInvitee[] = []): InviteStats {
  const s: InviteStats = { accepted: 0, declined: 0, tentative: 0, noReply: 0, failed: 0, unsent: 0 };
  for (const i of invitees) {
    if (i.error) s.failed++;
    else if (!i.sentAt) s.unsent++;
    else if (i.response === "accepted") s.accepted++;
    else if (i.response === "declined") s.declined++;
    else if (i.response === "tentative") s.tentative++;
    else s.noReply++;
  }
  return s;
}

/** "2 nhận · 1 từ chối · 1 chưa trả lời". */
export function inviteStatsLine(s: InviteStats): string {
  return [
    s.accepted && `${s.accepted} nhận`,
    s.tentative && `${s.tentative} có thể`,
    s.declined && `${s.declined} từ chối`,
    s.noReply && `${s.noReply} chưa trả lời`,
    s.failed && `${s.failed} gửi lỗi`,
    s.unsent && `${s.unsent} chưa gửi`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Chờ bao lâu mới nhắc follow-up: 2 ngày; sự kiện trong 24 giờ tới thì sau 6 giờ. */
export const FOLLOW_UP_AFTER_MS = 48 * 3_600_000;
const FOLLOW_UP_SOON_MS = 6 * 3_600_000;

export interface FollowUp {
  event: CalEvent;
  /** Người chưa trả lời (tên). */
  names: string[];
}

/**
 * Người được mời chưa trả lời sau một khoảng → nhắc Mai follow-up (§5.4
 * v3.9). Sự kiện đã qua, người gửi lỗi, hoặc Mai đã bấm "Đã nhắc" sau lần
 * gửi cuối thì không nhắc.
 */
export function followUpsDue(events: CalEvent[], now: Date): FollowUp[] {
  const t = now.getTime();
  const out: FollowUp[] = [];
  for (const ev of events) {
    const start = Date.parse(ev.startAt);
    if (!ev.invitees?.length || !(start > t)) continue;
    const lastSent = Math.max(0, ...ev.invitees.map((i) => (i.sentAt ? Date.parse(i.sentAt) : 0)));
    if (ev.inviteFollowUpAt && Date.parse(ev.inviteFollowUpAt) >= lastSent) continue;
    const soon = start - t < 24 * 3_600_000;
    const names = ev.invitees
      .filter((i) => i.sentAt && !i.error && i.response === "no_reply")
      .filter((i) => t - Date.parse(i.sentAt!) >= (soon ? FOLLOW_UP_SOON_MS : FOLLOW_UP_AFTER_MS))
      .map((i) => i.name);
    if (names.length) out.push({ event: ev, names });
  }
  return out.sort((a, b) => a.event.startAt.localeCompare(b.event.startAt));
}

// ── Câu lệnh: mời ai, có cần link họp ───────────────────────────────────

/**
 * "tạo link Meet" / "họp online" / "link Zoom" → loại link cần có.
 * Zoom: app không tạo được — thẻ mời Mai dán link có sẵn.
 */
export function meetLinkRequest(text: string): "meet" | "lark" | "zoom" | "any" | undefined {
  const t = text.toLowerCase();
  const asked =
    /tạo\s+(?:link|phòng)\s*(?:họp|meet|zoom|lark|teams)?|link\s+(?:meet|họp|zoom|lark|teams|google meet)|\bgoogle\s+meet\b|\bgg\s*meet\b|\blark\s+(?:meeting|vc)\b|\bzoom\b|\bmeet\s+link\b|họp\s+online|họp\s+trực\s+tuyến|\bonline\s+meeting\b|\bvideo\s+call\b|\bcreate\s+(?:a\s+)?(?:meet|meeting|zoom|video)\s+link\b/iu.test(
      t,
    );
  if (!asked) return undefined;
  if (/\bzoom\b/.test(t)) return "zoom";
  if (/\blark\b/.test(t)) return "lark";
  if (/\bmeet\b/.test(t)) return "meet";
  return "any";
}

/** Cụm chữ xin link họp — gỡ khỏi tiêu đề sự kiện. */
export const MEET_PHRASE_RE =
  /,?\s*(?:và\s+)?(?:tạo|gắn|kèm|thêm)\s+(?:link|phòng)(?:\s+(?:họp|meet|zoom|lark|teams|google meet|online))*(?:\s+(?:nhé|nha|luôn))?/giu;

/**
 * Người Mai muốn mời trong câu (luật, khi không có Claude): "mời X, Y",
 * "họp với X và Y", "meeting with X and Y", "invite X". Trả kèm đoạn chữ
 * "mời …" để gỡ khỏi tiêu đề ("họp với …" giữ lại — tiêu đề tự nhiên).
 */
export function extractInvitees(clause: string): { names: string[]; span?: string } {
  const stop = String.raw`(?=,\s*(?:tạo|gắn|kèm|thêm)\s|\s+(?:tạo|gắn|kèm|thêm)\s+(?:link|phòng)|\s+(?:lúc|vào|ở|tại|để|về|thứ|ngày|hôm|tuần|sáng|trưa|chiều|tối|on|at|tomorrow|today|next)\s|\s+\d|[.;!?]|,\s*\d|$)`;
  const invite = clause.match(new RegExp(String.raw`(?:^|[\s,])(?:mời|invite)\s+(.+?)${stop}`, "iu"));
  if (invite) return { names: splitInviteeList(invite[1]), span: invite[0] };
  const withM = clause.match(
    new RegExp(String.raw`(?:họp|meeting|call|sync)\s+(?:online\s+)?(?:với|with)\s+(.+?)${stop}`, "iu"),
  );
  if (withM) return { names: splitInviteeList(withM[1]) };
  return { names: [] };
}
