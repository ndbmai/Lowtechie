import { NextResponse, type NextRequest } from "next/server";
import { newSlotId, readAccounts, writeAccount, type LarkLink } from "@/lib/accounts";
import {
  LARK_STATE_COOKIE,
  larkExchangeCode,
  larkScopeHasCalendar,
  larkScopeHasInvite,
  larkUserInfo,
} from "@/lib/larkServer";

export const runtime = "nodejs";

/** Bước 2 OAuth Lark: đổi code lấy token, cất vào cookie tài khoản. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const [savedState, intent] = (req.cookies.get(LARK_STATE_COOKIE)?.value ?? "").split(":");
  const wantInvite = intent === "inv";
  const larkError = req.nextUrl.searchParams.get("error");

  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/ket-noi?${q}`);
    res.cookies.delete(LARK_STATE_COOKIE);
    return res;
  };

  // Mai bấm Từ chối / Lark báo lỗi ngay ở màn đồng ý → nói đúng lỗi, không phải "state".
  if (larkError && !code) return back(`lerr=${encodeURIComponent(larkError)}`);
  if (!code || !state || state !== savedState) return back("lerr=state");

  const result = await larkExchangeCode(code, origin);
  if ("error" in result) return back(`lerr=${encodeURIComponent(result.error)}`);

  const who = await larkUserInfo(result.at);
  const email = who?.email;
  // Nối lại cùng email → ghi đè đúng tài khoản cũ, giữ bật/tắt Mai đã đặt.
  const existing = (await readAccounts(req)).find(
    (a) => a.provider === "lark" && (email ? a.email === email : true),
  );
  // Quyền mời người (§5.4 v3.9): đọc từ danh sách scope Lark THẬT SỰ cấp.
  const inv = larkScopeHasInvite(result.scope);
  const link: LarkLink = {
    rt: result.rt,
    at: result.at,
    atExp: result.atExp,
    email,
    openId: who?.openId,
    parts: existing?.parts,
    inv,
  };
  // Lark có thể nhớ lần cho phép CŨ và cấp phiên KHÔNG kèm quyền lịch —
  // vẫn cất cookie (mail/phần khác còn dùng được) nhưng báo rõ ở Kết nối.
  const res = back(
    !larkScopeHasCalendar(result.scope)
      ? "lerr=noscope"
      : wantInvite
        ? `lok=1&linv=${inv === false ? "0" : "1"}`
        : "lok=1",
  );
  await writeAccount(res, origin, existing?.id ?? newSlotId(), "lark", link);
  return res;
}
