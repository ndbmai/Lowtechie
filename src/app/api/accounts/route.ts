import { NextResponse, type NextRequest } from "next/server";
import {
  deleteAccountCookie,
  findAccount,
  publicAccount,
  readAccounts,
  writeAccount,
  type AccountParts,
} from "@/lib/accounts";
import { isConfigured, revoke, type GoogleLink } from "@/lib/googleServer";
import { isLarkConfigured } from "@/lib/larkServer";

export const runtime = "nodejs";

/** Danh sách tài khoản đã nối trên THIẾT BỊ này (§5.3.4) — không kèm token. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accounts = await readAccounts(req);
  return NextResponse.json({
    configured: { google: isConfigured(), lark: isLarkConfigured() },
    accounts: accounts.map(publicAccount),
  });
}

/** Bật/tắt Lịch · Mail · Drive của một tài khoản. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let id = "";
  let parts: Partial<AccountParts> = {};
  try {
    const body = (await req.json()) as { id?: unknown; parts?: Partial<AccountParts> };
    if (typeof body.id === "string") id = body.id;
    if (body.parts && typeof body.parts === "object") parts = body.parts;
  } catch {
    /* 400 bên dưới */
  }
  const account = findAccount(await readAccounts(req), id);
  if (!account) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const next: AccountParts = {
    cal: parts.cal ?? account.parts.cal,
    mail: parts.mail ?? account.parts.mail,
    drive: parts.drive ?? account.parts.drive,
  };
  const res = NextResponse.json({ ok: true, parts: next });
  await writeAccount(res, req.nextUrl.origin, account.id, account.provider, {
    ...account.link,
    parts: next,
  });
  return res;
}

/** Ngắt MỘT tài khoản: thu hồi phía nhà cung cấp (Google) + xóa cookie. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const account = findAccount(await readAccounts(req), id);
  if (!account) return NextResponse.json({ error: "not-found" }, { status: 404 });

  if (account.provider === "google") await revoke(account.link as GoogleLink);
  const res = NextResponse.json({ ok: true });
  deleteAccountCookie(res, account.id, account.provider);
  return res;
}
