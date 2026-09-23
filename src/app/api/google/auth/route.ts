import { NextResponse, type NextRequest } from "next/server";
import { STATE_COOKIE, authUrl, isConfigured } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Cookie nhớ màn cần quay về sau OAuth (Lịch mặc định; Kết nối khi thêm tài khoản). */
const RETURN_COOKIE = "lowtechie_gret";

/** Bước 1 OAuth: đưa Mai sang màn đồng ý của Google. ?add=1 = nối THÊM tài khoản (§5.3.4). */
export function GET(req: NextRequest): NextResponse {
  const origin = req.nextUrl.origin;
  const adding = req.nextUrl.searchParams.get("add") === "1";
  if (!isConfigured()) {
    return NextResponse.redirect(`${origin}/${adding ? "ket-noi" : "lich"}?gerr=config`);
  }
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(origin, state, adding));
  const opts = {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  res.cookies.set(STATE_COOKIE, state, opts);
  res.cookies.set(RETURN_COOKIE, adding ? "ket-noi" : "lich", opts);
  return res;
}
