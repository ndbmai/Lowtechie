import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, STATE_COOKIE, exchangeCode, seal } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Bước 2 OAuth: Google gọi về đây; đổi code lấy token, cất vào cookie. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errParam = req.nextUrl.searchParams.get("error");
  const savedState = req.cookies.get(STATE_COOKIE)?.value;

  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/lich?${q}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (errParam) return back(`gerr=${encodeURIComponent(errParam)}`);
  if (!code || !state || state !== savedState) return back("gerr=state");

  const result = await exchangeCode(code, origin);
  if ("error" in result) return back(`gerr=${encodeURIComponent(result.error)}`);

  const res = back("gok=1");
  res.cookies.set(GCAL_COOKIE, await seal(result.link), {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
  });
  return res;
}
