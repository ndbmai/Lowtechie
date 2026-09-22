import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, GCAL_COOKIE, accessToken, unseal } from "@/lib/googleServer";

export const runtime = "nodejs";

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

async function token(req: NextRequest): Promise<string | null> {
  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  if (!link) return null;
  return accessToken(link);
}

/**
 * Sự kiện Google Calendar (lịch chính) trong khoảng fromMs–toMs, hoặc
 * TÌM TOÀN BỘ LỊCH với ?q= (quá khứ lẫn tương lai — §5.4.0 v2.3).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const at = await token(req);
  if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? "";
  const fromMs = Number(req.nextUrl.searchParams.get("fromMs")) || Date.now();
  const toMs =
    Number(req.nextUrl.searchParams.get("toMs")) || fromMs + 7 * 86_400_000;

  const p = q
    ? new URLSearchParams({ q, singleEvents: "true", orderBy: "startTime", maxResults: "50" })
    : new URLSearchParams({
        timeMin: new Date(fromMs).toISOString(),
        timeMax: new Date(toMs).toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "100",
      });
  const res = await fetch(`${CAL_BASE}/calendars/primary/events?${p}`, {
    headers: { authorization: `Bearer ${at}` },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
  }
  const data = (await res.json()) as { items?: GEvent[] };
  const events = (data.items ?? [])
    .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e) => {
      const allDay = !e.start?.dateTime;
      return {
        gcalId: e.id,
        title: e.summary || "(không tên)",
        // Sự kiện cả ngày: chuỗi không offset → client hiểu theo giờ máy Mai.
        startAt: e.start?.dateTime ?? `${e.start?.date}T00:00:00`,
        endAt: e.end?.dateTime ?? `${e.end?.date}T00:00:00`,
        location: e.location,
        allDay,
      };
    });
  return NextResponse.json({ events });
}

/** Ghi một block/sự kiện vào Google Calendar — chỉ gọi sau khi Mai bấm duyệt. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const at = await token(req);
  if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });

  let title = "";
  let startAt = "";
  let endAt = "";
  let description = "";
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.title === "string") title = body.title.slice(0, 200);
    if (typeof body.startAt === "string") startAt = body.startAt;
    if (typeof body.endAt === "string") endAt = body.endAt;
    if (typeof body.description === "string") description = body.description.slice(0, 500);
  } catch {
    /* 400 bên dưới */
  }
  if (!title || Number.isNaN(Date.parse(startAt)) || Number.isNaN(Date.parse(endAt))) {
    return NextResponse.json({ error: "Thiếu title/startAt/endAt" }, { status: 400 });
  }

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
  return NextResponse.json({ gcalId: data.id });
}
