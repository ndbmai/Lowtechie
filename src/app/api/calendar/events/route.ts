import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, accessToken, type GoogleLink } from "@/lib/googleServer";
import {
  larkAccessToken,
  larkCalendarSession,
  larkCreateEvent,
  larkEventsAllCalendars,
  larkSearchEvents,
} from "@/lib/larkServer";
import {
  accountErrorAction,
  accountsWith,
  findAccount,
  readAccounts,
  writeAccount,
  type Account,
  type LarkLink,
} from "@/lib/accounts";
import { dedupeRemoteEvents } from "@/core/events";

export const runtime = "nodejs";
export const maxDuration = 30;

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  iCalUID?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface OutEvent {
  gcalId: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  allDay?: boolean;
  iCalUID?: string;
  /** Tài khoản chứa sự kiện (§5.3.4) — client dùng khi xóa/hiển thị nguồn. */
  account: string;
  accountEmail?: string;
  provider: "google" | "lark";
}

async function googleEvents(at: string, p: URLSearchParams): Promise<GEvent[]> {
  const res = await fetch(`${CAL_BASE}/calendars/primary/events?${p}`, {
    headers: { authorization: `Bearer ${at}` },
  });
  if (!res.ok) throw new Error(`google-${res.status}`);
  const data = (await res.json()) as { items?: GEvent[] };
  return data.items ?? [];
}

/**
 * Sự kiện của MỌI tài khoản đang bật Lịch (§5.3.4) trong khoảng
 * fromMs–toMs, hoặc TÌM TOÀN BỘ LỊCH với ?q= — gộp và khử trùng sự kiện
 * được mời chéo (iCalUID). Tài khoản lỗi được bỏ qua kèm ghi chú, không
 * làm vỡ cả danh sách.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const calAccounts = accountsWith(await readAccounts(req), "cal");
  if (calAccounts.length === 0) {
    return NextResponse.json({ error: "not-connected" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? "";
  const fromMs = Number(req.nextUrl.searchParams.get("fromMs")) || Date.now();
  const toMs = Number(req.nextUrl.searchParams.get("toMs")) || fromMs + 7 * 86_400_000;

  const events: OutEvent[] = [];
  // v3.2: lỗi tài khoản phải NÓI RÕ có việc để làm, không trả lịch trống im lặng.
  const errors: { email?: string; provider: "google" | "lark"; detail: string; action: string }[] =
    [];
  const rotated: { account: Account; link: LarkLink }[] = [];

  for (const a of calAccounts) {
    try {
      if (a.provider === "google") {
        const at = await accessToken(a.link as GoogleLink);
        if (!at) throw new Error("token");
        const p = q
          ? new URLSearchParams({ q, singleEvents: "true", orderBy: "startTime", maxResults: "50" })
          : new URLSearchParams({
              timeMin: new Date(fromMs).toISOString(),
              timeMax: new Date(toMs).toISOString(),
              singleEvents: "true",
              orderBy: "startTime",
              maxResults: "100",
            });
        for (const e of await googleEvents(at, p)) {
          if (e.status === "cancelled" || (!e.start?.dateTime && !e.start?.date)) continue;
          events.push({
            gcalId: e.id,
            title: e.summary || "(không tên)",
            // Sự kiện cả ngày: chuỗi không offset → client hiểu theo giờ máy Mai.
            startAt: e.start?.dateTime ?? `${e.start?.date}T00:00:00`,
            endAt: e.end?.dateTime ?? `${e.end?.date}T00:00:00`,
            location: e.location,
            allDay: !e.start?.dateTime,
            iCalUID: e.iCalUID,
            account: a.id,
            accountEmail: a.email,
            provider: "google",
          });
        }
      } else {
        const tokens = await larkAccessToken((a.link as LarkLink).rt);
        if (!tokens) throw new Error("token");
        rotated.push({ account: a, link: { ...(a.link as LarkLink), rt: tokens.rt } });
        // v3.2: đọc MỌI lịch con (trước chỉ lịch chính → sự kiện "biến mất").
        const list = q
          ? await larkSearchEvents(tokens.at, q)
          : (await larkEventsAllCalendars(tokens.at, fromMs, toMs)).events;
        for (const e of list) {
          events.push({ ...e, account: a.id, accountEmail: a.email, provider: "lark" });
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "lỗi";
      errors.push({
        email: a.email,
        provider: a.provider,
        detail,
        action: accountErrorAction(a.provider, detail),
      });
    }
  }

  const merged = dedupeRemoteEvents(events).sort((x, y) => x.startAt.localeCompare(y.startAt));
  const res = NextResponse.json({ events: merged, errors: errors.length ? errors : undefined });
  // Lark xoay vòng refresh token → ghi lại cookie tài khoản.
  for (const r of rotated) {
    await writeAccount(res, req.nextUrl.origin, r.account.id, "lark", r.link);
  }
  return res;
}

/**
 * Ghi một block/sự kiện — chỉ gọi sau khi Mai bấm duyệt. `accountId`
 * chọn LỊCH ĐÍCH (§5.3.4, mặc định theo dự án do client quyết); thiếu
 * thì vào tài khoản bật Lịch đầu tiên.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const accounts = accountsWith(await readAccounts(req), "cal");
  if (accounts.length === 0) {
    return NextResponse.json({ error: "not-connected" }, { status: 401 });
  }

  let title = "";
  let startAt = "";
  let endAt = "";
  let description = "";
  let accountId = "";
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.title === "string") title = body.title.slice(0, 200);
    if (typeof body.startAt === "string") startAt = body.startAt;
    if (typeof body.endAt === "string") endAt = body.endAt;
    if (typeof body.description === "string") description = body.description.slice(0, 500);
    if (typeof body.accountId === "string") accountId = body.accountId;
  } catch {
    /* 400 bên dưới */
  }
  if (!title || Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) {
    return NextResponse.json({ error: "Thiếu title/startAt/endAt" }, { status: 400 });
  }

  const target = findAccount(accounts, accountId) ?? accounts[0];

  if (target.provider === "google") {
    const at = await accessToken(target.link as GoogleLink);
    if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
    const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: title,
        description: description || "Tạo bởi Mai Lowtechie 🌼",
        start: { dateTime: new Date(startAt).toISOString() },
        end: { dateTime: new Date(endAt).toISOString() },
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    if (!res.ok || !data.id) {
      return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ gcalId: data.id, accountId: target.id });
  }

  const s = await larkCalendarSession((target.link as LarkLink).rt);
  if (!s) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const eventId = await larkCreateEvent(s.at, s.calendarId, { title, startAt, endAt, description });
  const res = eventId
    ? NextResponse.json({ gcalId: eventId, accountId: target.id })
    : NextResponse.json({ error: "lark-create" }, { status: 502 });
  await writeAccount(res, req.nextUrl.origin, target.id, "lark", {
    ...(target.link as LarkLink),
    rt: s.rt,
  });
  return res;
}
