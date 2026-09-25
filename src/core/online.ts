import { foldName } from "./clients";

/**
 * Họp online (Mai 25/9: "lịch họp có gắn link tự hiểu là họp online thì
 * không check thời gian di chuyển"). Địa điểm là LINK hoặc chữ kiểu "Zoom",
 * "Google Meet", "Online" → online. Địa điểm là địa chỉ thật thì vẫn tính
 * di chuyển kể cả khi lịch có kèm link họp (Google hay tự gắn Meet vào mọi
 * lịch, kể cả gặp trực tiếp).
 */

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

/** Link bản đồ là địa điểm THẬT, không phải link họp. */
const MAP_LINK_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com)/i;

const MEETING_HOST_RE =
  /https?:\/\/(?:[\w-]+\.)*(?:meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|larksuite\.com|feishu\.cn|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si|skype\.com|chime\.aws|bluejeans\.com)\b/i;

/** Chữ (đã bỏ dấu, chữ thường) cho biết họp online. */
const ONLINE_WORDS_RE =
  /(?:^|[^a-z0-9])(?:zoom|google meet|gg meet|gmeet|meet link|ms teams|microsoft teams|teams meeting|webex|lark vc|lark meeting|lark video|video call|online|truc tuyen|hop online)(?![a-z0-9])/;

export interface OnlineCheck {
  title?: string;
  location?: string;
  notes?: string;
  meetUrl?: string;
}

function meetingLinkIn(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(new RegExp(MEETING_HOST_RE.source + "[^\\s<>\"')]*", "i"));
  return m?.[0];
}

/** Có phải họp online không (quy tắc ở đầu file). */
export function isOnlineMeeting(ev: OnlineCheck): boolean {
  const loc = (ev.location ?? "").trim();
  if (loc) {
    if (MAP_LINK_RE.test(loc)) return false;
    if (URL_RE.test(loc)) return true;
    return ONLINE_WORDS_RE.test(foldName(loc));
  }
  if (ev.meetUrl) return true;
  if (meetingLinkIn(ev.notes)) return true;
  return ONLINE_WORDS_RE.test(foldName(ev.title ?? ""));
}

/** Có cần tính thời gian di chuyển không: có địa điểm THẬT và không phải họp online. */
export function needsTravel(ev: OnlineCheck): boolean {
  return Boolean(ev.location?.trim()) && !isOnlineMeeting(ev);
}

/** Link vào phòng họp (để nút "Mở link họp"), nếu có. */
export function meetingLink(ev: OnlineCheck): string | undefined {
  if (ev.meetUrl) return ev.meetUrl;
  const loc = ev.location?.trim() ?? "";
  if (loc && !MAP_LINK_RE.test(loc)) {
    const u = loc.match(URL_RE)?.[0];
    if (u) return u;
  }
  return meetingLinkIn(ev.notes);
}
