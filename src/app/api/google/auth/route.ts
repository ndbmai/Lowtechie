import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, authUrl, isConfigured } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Bước 1 OAuth: đưa Mai sang màn đồng ý của Google. */
export function GET(req: NextRequest): NextResponse {
  const origin = req.nextUrl.origin;
  if (!isConfigured()) {
    return NextResponse.redirect(`${origin}/lich?gerr=config`);
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
