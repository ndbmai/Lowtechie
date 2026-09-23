import { NextResponse, type NextRequest } from "next/server";
import { revoke, type GoogleLink } from "@/lib/googleServer";
import { deleteAccountCookie, readAccounts } from "@/lib/accounts";

export const runtime = "nodejs";

/**
 * Ngắt TẤT CẢ tài khoản Google của thiết bị này (nút cũ ở màn Lịch).
 * Ngắt từng tài khoản một → DELETE /api/accounts?id=… (màn Kết nối).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const googles = (await readAccounts(req)).filter((a) => a.provider === "google");
  for (const a of googles) await revoke(a.link as GoogleLink);
  const res = NextResponse.json({ ok: true });
  for (const a of googles) deleteAccountCookie(res, a.id, a.provider);
  return res;
}
