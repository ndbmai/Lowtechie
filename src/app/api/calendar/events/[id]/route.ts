import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, accessToken, type GoogleLink } from "@/lib/googleServer";
import { larkCalendarSession, larkDeleteEvent } from "@/lib/larkServer";
import {
  LEGACY_GOOGLE_ID,
  findAccount,
  readAccounts,
  writeAccount,
  type LarkLink,
} from "@/lib/accounts";

export const runtime = "nodejs";

/**
 * Xóa một sự kiện do Lowtechie tạo (khi Mai gỡ chuỗi/hoàn tác book).
 * ?account= chọn đúng tài khoản (§5.3.4); block cũ không có → cookie
 * Google đời đầu.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const accounts = await readAccounts(req);
  const wanted = req.nextUrl.searchParams.get("account");
  const target =
    findAccount(accounts, wanted) ??
    findAccount(accounts, LEGACY_GOOGLE_ID) ??
    accounts.find((a) => a.provider === "google");
  if (!target) return NextResponse.json({ error: "not-connected" }, { status: 401 });

  const { id } = await params;

  if (target.provider === "google") {
    const at = await accessToken(target.link as GoogleLink);
    if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
    const res = await fetch(`${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${at}` },
    });
    // 404/410: đã bị xóa tay trên Google — với ta coi như xong.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  }

  const s = await larkCalendarSession((target.link as LarkLink).rt);
  if (!s) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const ok = await larkDeleteEvent(s.at, s.calendarId, id);
  const res = ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "lark-delete" }, { status: 502 });
  await writeAccount(res, req.nextUrl.origin, target.id, "lark", {
    ...(target.link as LarkLink),
    rt: s.rt,
  });
  return res;
}
