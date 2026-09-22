import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, isConfigured, unseal } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Trạng thái nối Google của thiết bị này (đọc từ cookie). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  return NextResponse.json({
    configured: isConfigured(),
    connected: Boolean(link),
    email: link?.email,
  });
}
