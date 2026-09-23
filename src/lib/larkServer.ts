/**
 * Nối Lark (PRD §5.5.1 + §5.3.4) — bản quốc tế larksuite.com, chỉ chạy
 * phía server. Cùng kiến trúc local-first như Google: refresh token mã
 * hóa nằm trong cookie thiết bị của Mai, server không lưu gì.
 *
 * KHÁC Google hai điểm phải nhớ:
 * 1. Lark XOAY VÒNG refresh token — mỗi lần refresh trả cái MỚI, route
 *    nào lấy access token đều phải ghi lại cookie (rotated trong kết quả).
 * 2. Quyền (lịch, mail) cấp ở CẤP APP và cần admin tổ chức duyệt; Mail
 *    API có thể không bật cho gói Lark của tổ chức (PRD §9) — mọi lời
 *    gọi mail đều best-effort, lỗi trả về ghi chú chứ không vỡ cả quét.
 */

const ACCOUNTS_BASE = "https://accounts.larksuite.com";
const OPEN_BASE = "https://open.larksuite.com";

export function isLarkConfigured(): boolean {
  return Boolean(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
}

/** Khóa mã hóa cookie Lark — dẫn xuất từ LARK_APP_SECRET (đổi secret = nối lại). */
export function larkKeyMaterial(): string {
  return `lowtechie-cookie-lark::${process.env.LARK_APP_SECRET ?? ""}`;
}

export const LARK_STATE_COOKIE = "lowtechie_ls";

export function larkRedirectUri(origin: string): string {
  return `${origin}/api/lark/callback`;
}

export function larkAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.LARK_APP_ID ?? "",
    redirect_uri: larkRedirectUri(origin),
    response_type: "code",
    state,
    // offline_access để có refresh token; các quyền lịch/mail nằm ở cấp app.
    scope: "offline_access",
  });
  return `${ACCOUNTS_BASE}/open-apis/authen/v1/authorize?${p}`;
}

interface LarkTokenResponse {
  code?: number;
  error?: string;
  error_description?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  data?: { access_token?: string; refresh_token?: string };
}

function pickTokens(d: LarkTokenResponse): { at: string; rt?: string } | null {
  const at = d.access_token ?? d.data?.access_token;
  const rt = d.refresh_token ?? d.data?.refresh_token;
  return at ? { at, rt } : null;
}

/** Đổi code lấy access + refresh token. */
export async function larkExchangeCode(
  code: string,
  origin: string,
): Promise<{ at: string; rt: string } | { error: string }> {
  const res = await fetch(`${OPEN_BASE}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: process.env.LARK_APP_ID ?? "",
      client_secret: process.env.LARK_APP_SECRET ?? "",
      code,
      redirect_uri: larkRedirectUri(origin),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as LarkTokenResponse;
  const tokens = pickTokens(data);
  if (!res.ok || !tokens?.rt) {
    return { error: data.error_description ?? data.error ?? `lark-${data.code ?? res.status}` };
  }
  return { at: tokens.at, rt: tokens.rt };
}

/**
 * Refresh token → access token. LƯU Ý: `rt` trả về là refresh token MỚI
 * (Lark xoay vòng) — caller phải ghi lại cookie bằng nó.
 */
export async function larkAccessToken(
  refreshToken: string,
): Promise<{ at: string; rt: string } | null> {
  const res = await fetch(`${OPEN_BASE}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: process.env.LARK_APP_ID ?? "",
      client_secret: process.env.LARK_APP_SECRET ?? "",
      refresh_token: refreshToken,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as LarkTokenResponse;
  const tokens = pickTokens(data);
  if (!res.ok || !tokens) return null;
  return { at: tokens.at, rt: tokens.rt ?? refreshToken };
}

/** Email hiển thị của người dùng (ưu tiên email doanh nghiệp The Circle). */
export async function larkUserEmail(at: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${OPEN_BASE}/open-apis/authen/v1/user_info`, {
      headers: { authorization: `Bearer ${at}` },
    });
    const d = (await res.json().catch(() => ({}))) as {
      data?: { enterprise_email?: string; email?: string; name?: string };
    };
    return d.data?.enterprise_email || d.data?.email || d.data?.name;
  } catch {
    return undefined;
  }
}

// ── Lark Calendar v4 (đọc/ghi như Google — §5.5.1) ───────────────────────

interface LarkCalendar {
  calendar_id?: string;
  type?: string;
  role?: string;
}

/** Lịch chính của người dùng; null nếu không tra được. */
export async function larkPrimaryCalendarId(at: string): Promise<string | null> {
  try {
    const res = await fetch(`${OPEN_BASE}/open-apis/calendar/v4/calendars?page_size=50`, {
      headers: { authorization: `Bearer ${at}` },
    });
    const d = (await res.json().catch(() => ({}))) as {
      data?: { calendar_list?: LarkCalendar[] };
    };
    const list = d.data?.calendar_list ?? [];
    const primary = list.find((c) => c.type === "primary") ?? list[0];
    return primary?.calendar_id ?? null;
  } catch {
    return null;
  }
}

interface LarkEvent {
  event_id?: string;
  summary?: string;
  status?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  location?: { name?: string };
}

export interface RemoteEventDto {
  gcalId: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  allDay?: boolean;
}

function larkTime(t: LarkEvent["start_time"]): { iso: string; allDay: boolean } | null {
  if (t?.timestamp) {
    const ms = Number(t.timestamp) * 1000;
    if (!Number.isFinite(ms)) return null;
    return { iso: new Date(ms).toISOString(), allDay: false };
  }
  if (t?.date) return { iso: `${t.date}T00:00:00`, allDay: true };
  return null;
}

export async function larkListEvents(
  at: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
): Promise<RemoteEventDto[]> {
  const p = new URLSearchParams({
    start_time: String(Math.floor(fromMs / 1000)),
    end_time: String(Math.ceil(toMs / 1000)),
    page_size: "100",
  });
  const res = await fetch(
    `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${p}`,
    { headers: { authorization: `Bearer ${at}` } },
  );
  if (!res.ok) throw new Error(`lark-cal-${res.status}`);
  const d = (await res.json().catch(() => ({}))) as { data?: { items?: LarkEvent[] } };
  const out: RemoteEventDto[] = [];
  for (const e of d.data?.items ?? []) {
    if (!e.event_id || e.status === "cancelled") continue;
    const s = larkTime(e.start_time);
    const en = larkTime(e.end_time);
    if (!s || !en) continue;
    out.push({
      gcalId: e.event_id,
      title: e.summary || "(không tên)",
      startAt: s.iso,
      endAt: en.iso,
      location: e.location?.name,
      allDay: s.allDay,
    });
  }
  return out;
}

/** Tìm sự kiện theo từ khóa (§5.4.0) — lỗi thì trả [] để tìm kiếm không vỡ. */
export async function larkSearchEvents(
  at: string,
  calendarId: string,
  query: string,
): Promise<RemoteEventDto[]> {
  try {
    const res = await fetch(
      `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/search?page_size=50`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
        body: JSON.stringify({ query }),
      },
    );
    if (!res.ok) return [];
    const d = (await res.json().catch(() => ({}))) as { data?: { items?: LarkEvent[] } };
    return (d.data?.items ?? []).flatMap((e) => {
      const s = larkTime(e.start_time);
      const en = larkTime(e.end_time);
      if (!e.event_id || !s || !en) return [];
      return [
        {
          gcalId: e.event_id,
          title: e.summary || "(không tên)",
          startAt: s.iso,
          endAt: en.iso,
          location: e.location?.name,
          allDay: s.allDay,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Ghi sự kiện — CHỈ gọi sau khi Mai bấm duyệt (nguyên tắc số 1). */
export async function larkCreateEvent(
  at: string,
  calendarId: string,
  ev: { title: string; startAt: string; endAt: string; description?: string },
): Promise<string | null> {
  const res = await fetch(
    `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: ev.title,
        description: ev.description || "Tạo bởi Mai Lowtechie 🌼",
        start_time: { timestamp: String(Math.floor(Date.parse(ev.startAt) / 1000)) },
        end_time: { timestamp: String(Math.floor(Date.parse(ev.endAt) / 1000)) },
      }),
    },
  );
  const d = (await res.json().catch(() => ({}))) as { data?: { event?: { event_id?: string } } };
  return res.ok ? (d.data?.event?.event_id ?? null) : null;
}

export async function larkDeleteEvent(
  at: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  const res = await fetch(
    `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${at}` } },
  );
  // 404: đã bị xóa tay trên Lark — với ta coi như xong.
  return res.ok || res.status === 404;
}

/**
 * Refresh + tra lịch chính trong một bước cho các route lịch. `rt` trả
 * về là refresh token MỚI — caller PHẢI ghi lại cookie tài khoản.
 */
export async function larkCalendarSession(
  refreshToken: string,
): Promise<{ at: string; rt: string; calendarId: string } | null> {
  const tokens = await larkAccessToken(refreshToken);
  if (!tokens) return null;
  const calendarId = await larkPrimaryCalendarId(tokens.at);
  return calendarId ? { ...tokens, calendarId } : null;
}

// ── Lark Mail (best-effort — PRD §9 dặn phải kiểm tra phạm vi Mail API) ──

export interface LarkMailMessage {
  subject: string;
  bodyText: string;
}

/**
 * Đọc thư gần đây trong hộp Lark Mail để quét vé (§5.5.1). Trả về lỗi
 * dạng chuỗi thay vì ném — tổ chức chưa bật Mail API là chuyện PRD đã
 * lường trước, không được làm vỡ cả lần quét đa hộp thư.
 */
export async function larkRecentMail(
  at: string,
  max = 12,
): Promise<{ messages: LarkMailMessage[] } | { error: string }> {
  try {
    const listRes = await fetch(
      `${OPEN_BASE}/open-apis/mail/v1/user_mailboxes/me/messages?page_size=${max}`,
      { headers: { authorization: `Bearer ${at}` } },
    );
    if (!listRes.ok) return { error: `mail-${listRes.status}` };
    const list = (await listRes.json().catch(() => ({}))) as {
      data?: { items?: string[] | { message_id?: string }[] };
    };
    const ids = (list.data?.items ?? [])
      .map((x) => (typeof x === "string" ? x : x.message_id))
      .filter((x): x is string => Boolean(x))
      .slice(0, max);
    const messages: LarkMailMessage[] = [];
    for (const id of ids) {
      const res = await fetch(
        `${OPEN_BASE}/open-apis/mail/v1/user_mailboxes/me/messages/${encodeURIComponent(id)}`,
        { headers: { authorization: `Bearer ${at}` } },
      );
      if (!res.ok) continue;
      const d = (await res.json().catch(() => ({}))) as {
        data?: { message?: { subject?: string; body_plain_text?: string; body_html?: string } };
      };
      const m = d.data?.message;
      if (!m) continue;
      const html = m.body_html ?? "";
      messages.push({
        subject: m.subject ?? "",
        bodyText: (m.body_plain_text ?? html.replace(/<[^>]+>/g, " ")).slice(0, 3500),
      });
    }
    return { messages };
  } catch {
    return { error: "mail-network" };
  }
}
