import { NextResponse, type NextRequest } from "next/server";
import { newSlotId, readAccounts, writeAccount, type LarkLink } from "@/lib/accounts";
import {
  LARK_STATE_COOKIE,
  larkExchangeCode,
  larkScopeHasCalendar,
  larkUserInfo,
} from "@/lib/larkServer";

export const runtime = "nodejs";

/** Bước 2 OAuth Lark: đổi code lấy token, cất vào cookie tài khoản. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const savedState = req.cookies.get(LARK_STATE_COOKIE)?.value;

  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/ket-noi?${q}`);
    res.cookies.delete(LARK_STATE_COOKIE);
    return res;
  };

  if (!code || !state || state !== savedState) return back("lerr=state");

  const result = await larkExchangeCode(code, origin);
  if ("error" in result) return back(`lerr=${encodeURIComponent(result.error)}`);

  const who = await larkUserInfo(result.at);
  const email = who?.email;
  // Nối lại cùng email → ghi đè đúng tài khoản cũ, giữ bật/tắt Mai đã đặt.
  const existing = (await readAccounts(req)).find(
    (a) => a.provider === "lark" && (email ? a.email === email : true),
  );
  const link: LarkLink = {
    rt: result.rt,
    at: result.at,
    atExp: result.atExp,
    email,
    openId: who?.openId,
    parts: existing?.parts,
  };
  // Lark có thể nhớ lần cho phép CŨ và cấp phiên KHÔNG kèm quyền lịch —
  // vẫn cất cookie (mail/phần khác còn dùng được) nhưng báo rõ ở Kết nối.
  const res = back(larkScopeHasCalendar(result.scope) ? "lok=1" : "lerr=noscope");
  await writeAccount(res, origin, existing?.id ?? newSlotId(), "lark", link);
  return res;
}
