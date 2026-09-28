import { NextResponse, type NextRequest } from "next/server";
import { LARK_STATE_COOKIE, isLarkConfigured, larkAuthUrl } from "@/lib/larkServer";

export const runtime = "nodejs";

/** Bước 1 OAuth Lark: đưa Mai sang màn đồng ý của Lark (§5.5.1). */
export function GET(req: NextRequest): NextResponse {
  const origin = req.nextUrl.origin;
  if (!isLarkConfigured()) {
    return NextResponse.redirect(`${origin}/ket-noi?lerr=config`);
  }
  const state = crypto.randomUUID();
  // ?invite=1 — "Bật quyền mời người" ở Kết nối: xin thêm quyền sửa sự kiện (§5.4 v3.9).
  const invite = req.nextUrl.searchParams.get("invite") === "1";
  const res = NextResponse.redirect(larkAuthUrl(origin, state, { invite }));
  // Cookie nhớ cả ý định xin quyền mời người để màn Kết nối báo đúng kết quả.
  res.cookies.set(LARK_STATE_COOKIE, invite ? `${state}:inv` : state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
