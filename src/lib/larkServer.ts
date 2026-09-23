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

/**
 * Scope user token XIN khi đăng nhập — PHẢI là tập con của các scope đã
 * khai ở tab "User token scopes" trên console và đã publish. Hai lỗi thật
 * 23/9: xin THIẾU → token không quyền, gọi lịch dính 99991xxx dù admin đã
 * duyệt app; xin scope CHƯA KHAI → Lark chặn ngay bước đăng nhập (20027).
 * App của Mai khai 4 scope lịch DẠNG CON (không khai scope cha
 * `calendar:calendar`) — nên xin đúng 4 scope con. KHÔNG xin mail
 * (best-effort, PRD §9). Đổi danh sách không cần deploy: env
 * LARK_OAUTH_SCOPES; đổi scope thì Mai phải Kết nối lại — refresh token
 * cũ không tự thêm quyền.
 */
const LARK_USER_SCOPES =
  "offline_access calendar:calendar:readonly calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:delete";

export function larkAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.LARK_APP_ID ?? "",
    redirect_uri: larkRedirectUri(origin),
    response_type: "code",
    state,
    scope: process.env.LARK_OAUTH_SCOPES || LARK_USER_SCOPES,
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
  /** Scope Lark THẬT SỰ cấp — có thể hẹp hơn scope đã xin (nhớ lần cho phép cũ). */
  scope?: string;
  data?: { access_token?: string; refresh_token?: string; scope?: string };
}

function pickTokens(d: LarkTokenResponse): { at: string; rt?: string } | null {
  const at = d.access_token ?? d.data?.access_token;
  const rt = d.refresh_token ?? d.data?.refresh_token;
  return at ? { at, rt } : null;
}

/** Đổi code lấy access + refresh token (+ scope Lark thật sự cấp). */
export async function larkExchangeCode(
  code: string,
  origin: string,
): Promise<{ at: string; rt: string; scope?: string } | { error: string }> {
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
  return { at: tokens.at, rt: tokens.rt, scope: data.scope ?? data.data?.scope };
}

/**
 * Token Lark cấp có kèm quyền lịch không — bắt ca "Lark nhớ lần cho phép
 * CŨ nên không hỏi lại, cấp phiên chỉ có offline_access" (lỗi thật 23/9:
 * đã khai + publish 4 scope lịch mà token mới vẫn không đọc được lịch).
 * Lark không trả scope thì không kết luận được — coi như ổn, đừng chặn oan.
 */
export function larkScopeHasCalendar(scope: string | undefined): boolean {
  if (!scope) return true;
  return scope.includes("calendar:");
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

/**
 * Lark hay trả HTTP 200 KÈM `code != 0` khi lỗi (thiếu quyền, token
 * hỏng) — PHẢI check code, đừng chỉ nhìn res.ok. Đây chính là lỗi thật
 * 23/9: lịch Lark "trống" im lặng vì lỗi quyền bị nuốt (PRD v3.2).
 */
async function larkJson<T>(res: Response): Promise<T> {
  const d = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
  if (!res.ok || (typeof d.code === "number" && d.code !== 0)) {
    throw new Error(`lark-${d.code ?? res.status}`);
  }
  return (d.data ?? {}) as T;
}

/** Mã lỗi Lark → thông điệp CÓ VIỆC ĐỂ LÀM (v3.2 — không im lặng). */
export function larkErrorAction(detail: string): string {
  const code = detail.match(/lark-(\w+)/)?.[1] ?? "";
  if (detail.includes("token") || detail.includes("expired"))
    return "Phiên đăng nhập Lark hết hạn — bấm Kết nối lại.";
  if (code.startsWith("99991"))
    return "Thiếu quyền hoặc phiên hết hạn — kiểm tra admin đã duyệt quyền Calendar chưa, rồi bấm Kết nối lại.";
  if (code.startsWith("1901") || code.startsWith("1951"))
    return "Lịch Lark từ chối yêu cầu — kiểm tra quyền đọc lịch đã được admin duyệt và tài khoản có lịch con.";
  if (code === "nocal") return "Chưa thấy lịch con nào trong tài khoản Lark này.";
  if (code === "403" || code === "404")
    return "Không truy cập được API lịch — kiểm tra quyền Calendar đã duyệt và app dùng đúng miền larksuite.com.";
  return `Lark báo lỗi (${code || detail}) — bấm Đồng bộ ngay để thử lại, còn lỗi thì Kết nối lại.`;
}

export interface LarkCalendarInfo {
  id: string;
  name: string;
  type?: string;
  role?: string;
}

/**
 * DANH SÁCH LỊCH TRƯỚC rồi mới lấy sự kiện (v3.2): lịch chính, lịch
 * nhóm, lịch đã đăng ký — theo phân trang page_token đến hết.
 */
export async function larkListCalendars(at: string): Promise<LarkCalendarInfo[]> {
  const out: LarkCalendarInfo[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const p = new URLSearchParams({ page_size: "50" });
    if (pageToken) p.set("page_token", pageToken);
    const res = await fetch(`${OPEN_BASE}/open-apis/calendar/v4/calendars?${p}`, {
      headers: { authorization: `Bearer ${at}` },
    });
    const d = await larkJson<{
      calendar_list?: { calendar_id?: string; summary?: string; type?: string; role?: string }[];
      page_token?: string;
      has_more?: boolean;
    }>(res);
    for (const c of d.calendar_list ?? []) {
      if (c.calendar_id)
        out.push({ id: c.calendar_id, name: c.summary ?? "", type: c.type, role: c.role });
    }
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return out;
}

/** Lịch chính của người dùng (để GHI sự kiện); null nếu không tra được. */
export async function larkPrimaryCalendarId(at: string): Promise<string | null> {
  try {
    const list = await larkListCalendars(at);
    return (list.find((c) => c.type === "primary") ?? list[0])?.id ?? null;
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

function larkEventToDto(e: LarkEvent): RemoteEventDto | null {
  if (!e.event_id || e.status === "cancelled") return null;
  const s = larkTime(e.start_time);
  const en = larkTime(e.end_time);
  if (!s || !en) return null;
  return {
    gcalId: e.event_id,
    title: e.summary || "(không tên)",
    startAt: s.iso,
    endAt: en.iso,
    location: e.location?.name,
    allDay: s.allDay,
  };
}

/** Sự kiện MỘT lịch con — phân trang page_token đến hết (v3.2). */
export async function larkListEvents(
  at: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
): Promise<RemoteEventDto[]> {
  const out: RemoteEventDto[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const p = new URLSearchParams({
      start_time: String(Math.floor(fromMs / 1000)),
      end_time: String(Math.ceil(toMs / 1000)),
      page_size: "100",
    });
    if (pageToken) p.set("page_token", pageToken);
    const res = await fetch(
      `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?${p}`,
      { headers: { authorization: `Bearer ${at}` } },
    );
    const d = await larkJson<{ items?: LarkEvent[]; page_token?: string; has_more?: boolean }>(res);
    for (const e of d.items ?? []) {
      const dto = larkEventToDto(e);
      if (dto) out.push(dto);
    }
    if (!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return out;
}

/** Cửa sổ con ≤30 ngày — instance_view giới hạn độ dài khoảng truy vấn. */
function chunkRange(fromMs: number, toMs: number): [number, number][] {
  const MAX = 30 * 86_400_000;
  const out: [number, number][] = [];
  for (let a = fromMs; a < toMs; a += MAX) out.push([a, Math.min(a + MAX, toMs)]);
  return out.length ? out : [[fromMs, toMs]];
}

/**
 * Đọc sự kiện MỘT lịch con qua `events/instance_view`: BUNG sự kiện lặp
 * lại (họp weekly The Circle…) thành từng buổi trong khoảng. `/events`
 * thường KHÔNG bung — tháng toàn họp định kỳ sẽ ra 0 (lỗi thật 23/9
 * "6 lịch con · 0 sự kiện" trong khi app Lark đầy sự kiện).
 */
async function larkInstanceView(
  at: string,
  calendarId: string,
  fromMs: number,
  toMs: number,
): Promise<RemoteEventDto[]> {
  const out: RemoteEventDto[] = [];
  for (const [a, b] of chunkRange(fromMs, toMs)) {
    const p = new URLSearchParams({
      start_time: String(Math.floor(a / 1000)),
      end_time: String(Math.ceil(b / 1000)),
    });
    const res = await fetch(
      `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/instance_view?${p}`,
      { headers: { authorization: `Bearer ${at}` } },
    );
    const d = await larkJson<{ items?: LarkEvent[] }>(res);
    for (const e of d.items ?? []) {
      const dto = larkEventToDto(e);
      if (dto) out.push(dto);
    }
  }
  return out;
}

/** Kết quả đọc từng lịch con — v3.2: soi được lịch nào hỏng/rỗng. */
export interface LarkCalendarRead {
  name: string;
  events: number;
  error?: string;
}

/**
 * Sự kiện của MỌI lịch con (v3.2 — trước chỉ đọc lịch chính nên sự kiện
 * lịch nhóm/lịch đăng ký "biến mất"). Ưu tiên instance_view (bung sự kiện
 * lặp), lịch không hỗ trợ thì rơi về `/events`. Một lịch lỗi không làm
 * rỗng cả tài khoản — ghi vào `perCalendar` để màn Kết nối soi từng lịch;
 * MỌI lịch cùng lỗi mới ném lỗi đầu, không im lặng.
 */
export async function larkEventsAllCalendars(
  at: string,
  fromMs: number,
  toMs: number,
): Promise<{ events: RemoteEventDto[]; calendars: number; perCalendar: LarkCalendarRead[] }> {
  const calendars = (await larkListCalendars(at)).filter((c) => c.type !== "resource").slice(0, 10);
  if (calendars.length === 0) throw new Error("lark-nocal");
  const events: RemoteEventDto[] = [];
  const perCalendar: LarkCalendarRead[] = [];
  const seen = new Set<string>();
  let firstError: unknown = null;
  let ok = 0;
  for (const c of calendars) {
    try {
      const got = await larkInstanceView(at, c.id, fromMs, toMs).catch(() =>
        larkListEvents(at, c.id, fromMs, toMs),
      );
      let added = 0;
      for (const ev of got) {
        // Sự kiện LẶP: cùng event_id nhưng khác giờ từng buổi — khóa phải
        // kèm startAt, dedupe theo mỗi id trần là mất các buổi sau.
        const key = `${ev.gcalId}|${ev.startAt}`;
        if (seen.has(key)) continue; // cùng buổi xuất hiện ở 2 lịch con
        seen.add(key);
        events.push(ev);
        added++;
      }
      perCalendar.push({ name: c.name, events: added });
      ok++;
    } catch (e) {
      firstError = firstError ?? e;
      perCalendar.push({
        name: c.name,
        events: 0,
        error: e instanceof Error ? e.message : "lỗi",
      });
    }
  }
  if (ok === 0 && firstError) throw firstError;
  return { events, calendars: calendars.length, perCalendar };
}

async function larkSearchOne(
  at: string,
  calendarId: string,
  query: string,
): Promise<RemoteEventDto[]> {
  const res = await fetch(
    `${OPEN_BASE}/open-apis/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/search?page_size=50`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
    },
  );
  const d = await larkJson<{ items?: LarkEvent[] }>(res);
  return (d.items ?? []).flatMap((e) => {
    const dto = larkEventToDto(e);
    return dto ? [dto] : [];
  });
}

/** Tìm theo từ khóa (§5.4.0) trên mọi lịch con — lỗi trả [] để tìm kiếm không vỡ. */
export async function larkSearchEvents(at: string, query: string): Promise<RemoteEventDto[]> {
  try {
    const calendars = (await larkListCalendars(at)).filter((c) => c.type !== "resource").slice(0, 5);
    const seen = new Set<string>();
    const out: RemoteEventDto[] = [];
    for (const c of calendars) {
      for (const ev of await larkSearchOne(at, c.id, query).catch(() => [] as RemoteEventDto[])) {
        if (seen.has(ev.gcalId)) continue;
        seen.add(ev.gcalId);
        out.push(ev);
      }
    }
    return out;
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
