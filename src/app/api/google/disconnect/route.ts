import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, revoke, unseal } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Ngắt kết nối: thu hồi token phía Google + xóa cookie thiết bị này. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  if (link) await revoke(link);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(GCAL_COOKIE);
  return res;
}
