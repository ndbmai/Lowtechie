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
  const res = NextResponse.redirect(larkAuthUrl(origin, state));
  res.cookies.set(LARK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
