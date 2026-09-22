import { NextResponse, type NextRequest } from "next/server";
import { CAL_BASE, GCAL_COOKIE, accessToken, unseal } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Xóa một sự kiện do Lowtechie tạo (khi Mai gỡ chuỗi chuẩn bị/di chuyển). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  const at = link ? await accessToken(link) : null;
  if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });

  const { id } = await params;
  const res = await fetch(
    `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${at}` } },
  );
  // 404/410: đã bị xóa tay trên Google — với ta coi như xong.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    return NextResponse.json({ error: `google-${res.status}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
