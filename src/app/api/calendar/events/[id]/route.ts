import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, accessToken, type GoogleLink } from "@/lib/googleServer";
import { larkAddMeeting, larkDeleteEvent, larkListAttendees, larkPatchEvent } from "@/lib/larkServer";
import { writeAccount } from "@/lib/accounts";
import { larkTarget, targetAccount } from "@/lib/calendarTarget";

export const runtime = "nodejs";

/**
 * Ai đã nhận / từ chối / chưa trả lời lời mời (§5.4 v3.9) + link họp —
 * màn chi tiết sự kiện gọi khi mở. ?account= ?calendar= (lịch con Lark).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const target = await targetAccount(req, sp.get("account"));
  if (!target) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const { id } = await params;

  if (target.provider === "google") {
    const at = await accessToken(target.link as GoogleLink);
    if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
    const res = await fetch(`${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${at}` },
    });
    if (!res.ok) return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    const e = (await res.json()) as {
      hangoutLink?: string;
      attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
    };
    return NextResponse.json({
      meetUrl: e.hangoutLink,
      attendees: (e.attendees ?? [])
        .filter((a) => !a.self && !a.resource)
        .map((a) => ({ email: a.email, name: a.displayName, response: a.responseStatus ?? "needsAction" })),
    });
  }

  const t = await larkTarget(target, sp.get("calendar"));
  if (!t) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  let res: NextResponse;
  try {
    res = NextResponse.json({ attendees: await larkListAttendees(t.at, t.calendarId, id) });
  } catch (e) {
    res = NextResponse.json({ error: e instanceof Error ? e.message : "lark" }, { status: 502 });
  }
  if (t.changed) await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
  return res;
}

/**
 * Xóa một sự kiện (gỡ chuỗi, hoàn tác book, hoặc Mai xóa ở màn chi tiết
 * sự kiện §5.4.0 v3.7). ?calendar= lịch con Lark; ?notify=1 = báo hủy cho
 * người được mời (Mai đã xác nhận riêng).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const target = await targetAccount(req, sp.get("account"));
  if (!target) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const { id } = await params;
  const notify = sp.get("notify") === "1";

  if (target.provider === "google") {
    const at = await accessToken(target.link as GoogleLink);
    if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
    const res = await fetch(
      `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${notify ? "all" : "none"}`,
      { method: "DELETE", headers: { authorization: `Bearer ${at}` } },
    );
    // 404/410: đã bị xóa tay trên Google — với ta coi như xong.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  const t = await larkTarget(target, sp.get("calendar"));
  if (!t) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const ok = await larkDeleteEvent(t.at, t.calendarId, id, notify);
  const res = ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "lark-delete" }, { status: 502 });
  if (t.changed) await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
  return res;
}

/**
 * Sửa/dời một sự kiện trên lịch ngoài (§5.4.0 v3.7) — CHỈ gọi sau khi Mai
 * xem thẻ trước → sau và bấm Lưu. Body: { account, calendarId?, title?,
 * startAt?, endAt?, location?, description?, notify? }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* 400 bên dưới */
  }
  const str = (k: string, max: number) =>
    typeof body[k] === "string" ? (body[k] as string).slice(0, max) : undefined;
  const patch = {
    title: str("title", 200),
    startAt: str("startAt", 40),
    endAt: str("endAt", 40),
    location: str("location", 200),
    description: str("description", 1000),
  };
  if (
    (patch.startAt && Number.isNaN(Date.parse(patch.startAt))) ||
    (patch.endAt && Number.isNaN(Date.parse(patch.endAt)))
  ) {
    return NextResponse.json({ error: "Giờ không hợp lệ" }, { status: 400 });
  }
  const notify = body.notify === true;
  // "＋ Tạo link họp" cho sự kiện đã có (§5.4 v3.9) — Mai bấm nút là duyệt.
  const meet = body.meet === true;
  const target = await targetAccount(req, str("account", 64) ?? null);
  if (!target) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const { id } = await params;

  if (target.provider === "google") {
    const at = await accessToken(target.link as GoogleLink);
    if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
    const g: Record<string, unknown> = {};
    if (patch.title !== undefined) g.summary = patch.title;
    if (patch.location !== undefined) g.location = patch.location;
    if (patch.description !== undefined) g.description = patch.description;
    if (patch.startAt) g.start = { dateTime: new Date(patch.startAt).toISOString() };
    if (patch.endAt) g.end = { dateTime: new Date(patch.endAt).toISOString() };
    if (meet) {
      g.conferenceData = {
        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      };
    }
    const res = await fetch(
      `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${notify ? "all" : "none"}${meet ? "&conferenceDataVersion=1" : ""}`,
      {
        method: "PATCH",
        headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
        body: JSON.stringify(g),
      },
    );
    if (!res.ok) return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    const d = (await res.json().catch(() => ({}))) as {
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
    };
    const meetUrl = d.hangoutLink ?? d.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
    return NextResponse.json({ ok: true, meetUrl: meet ? meetUrl : undefined });
  }

  const t = await larkTarget(target, str("calendarId", 200) ?? null);
  if (!t) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  if (meet) {
    const meetUrl = await larkAddMeeting(t.at, t.calendarId, id);
    const r = meetUrl
      ? NextResponse.json({ ok: true, meetUrl })
      : NextResponse.json({ error: "lark-meeting" }, { status: 502 });
    if (t.changed) await writeAccount(r, req.nextUrl.origin, target.id, "lark", t.link);
    return r;
  }
  const ok = await larkPatchEvent(t.at, t.calendarId, id, patch, notify);
  const res = ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "lark-patch" }, { status: 502 });
  if (t.changed) await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
  return res;
}
