import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, accessToken, type GoogleLink } from "@/lib/googleServer";
import {
  larkAccessToken,
  larkDeleteEvent,
  larkPatchEvent,
  larkPrimaryCalendarId,
} from "@/lib/larkServer";
import {
  LEGACY_GOOGLE_ID,
  findAccount,
  readAccounts,
  writeAccount,
  type Account,
  type LarkLink,
} from "@/lib/accounts";

export const runtime = "nodejs";

/** Tài khoản đích: ?account= (§5.3.4); block cũ không có → cookie Google đời đầu. */
async function targetAccount(req: NextRequest, wanted: string | null): Promise<Account | undefined> {
  const accounts = await readAccounts(req);
  return (
    findAccount(accounts, wanted) ??
    findAccount(accounts, LEGACY_GOOGLE_ID) ??
    accounts.find((a) => a.provider === "google")
  );
}

/**
 * Lark: access token + lịch con đích. Lark XOAY VÒNG refresh token → trả
 * kèm link mới để route ghi lại cookie.
 */
async function larkTarget(
  account: Account,
  calendarId: string | null,
): Promise<{ at: string; calendarId: string; link: LarkLink } | null> {
  const tokens = await larkAccessToken((account.link as LarkLink).rt);
  if (!tokens) return null;
  const cal = calendarId || (await larkPrimaryCalendarId(tokens.at));
  if (!cal) return null;
  return { at: tokens.at, calendarId: cal, link: { ...(account.link as LarkLink), rt: tokens.rt } };
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
  await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
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
    const res = await fetch(
      `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${notify ? "all" : "none"}`,
      {
        method: "PATCH",
        headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
        body: JSON.stringify(g),
      },
    );
    if (!res.ok) return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  const t = await larkTarget(target, str("calendarId", 200) ?? null);
  if (!t) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const ok = await larkPatchEvent(t.at, t.calendarId, id, patch, notify);
  const res = ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "lark-patch" }, { status: 502 });
  await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
  return res;
}
