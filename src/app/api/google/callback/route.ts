import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, exchangeCode } from "@/lib/googleServer";
import { LEGACY_GOOGLE_ID, newSlotId, readAccounts, writeAccount } from "@/lib/accounts";

export const runtime = "nodejs";

const RETURN_COOKIE = "lowtechie_gret";

/**
 * Bước 2 OAuth: Google gọi về đây; đổi code lấy token, cất vào cookie.
 * Đa tài khoản (§5.3.4): cùng email → ghi đè đúng tài khoản cũ (giữ
 * bật/tắt Mai đã đặt); email mới → thêm tài khoản mới; thiết bị chưa
 * nối gì → dùng cookie cũ `lowtechie_g` như trước (không đổi hành vi).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errParam = req.nextUrl.searchParams.get("error");
  const savedState = req.cookies.get(STATE_COOKIE)?.value;
  const returnTo = req.cookies.get(RETURN_COOKIE)?.value === "ket-noi" ? "ket-noi" : "lich";

  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/${returnTo}?${q}`);
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(RETURN_COOKIE);
    return res;
  };

  if (errParam) return back(`gerr=${encodeURIComponent(errParam)}`);
  if (!code || !state || state !== savedState) return back("gerr=state");

  const result = await exchangeCode(code, origin);
  if ("error" in result) return back(`gerr=${encodeURIComponent(result.error)}`);

  const accounts = await readAccounts(req);
  const googles = accounts.filter((a) => a.provider === "google");
  const sameEmail = result.link.email
    ? googles.find((a) => a.email === result.link.email)
    : undefined;
  // Nối lại → giữ slot + bật/tắt cũ; lần đầu của thiết bị → slot g0 (cookie cũ).
  const target = sameEmail ?? (googles.length === 0 ? { id: LEGACY_GOOGLE_ID, parts: undefined } : undefined);

  const res = back("gok=1");
  await writeAccount(res, origin, target?.id ?? newSlotId(), "google", {
    ...result.link,
    parts: sameEmail?.parts,
  });
  return res;
}
