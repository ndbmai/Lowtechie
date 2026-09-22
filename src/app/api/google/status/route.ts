import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, isConfigured, unseal } from "@/lib/googleServer";

export const runtime = "nodejs";

/** Trạng thái nối Google + các dịch vụ server của thiết bị này. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  return NextResponse.json({
    configured: isConfigured(),
    connected: Boolean(link),
    email: link?.email,
    /** Quyền đọc Gmail (nối trước khi có scope này thì phải nối lại). */
    gmail: Boolean(link?.gm),
    /** Server có GOOGLE_MAPS_API_KEY chưa (Routes API, §5.4.1). */
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    /** Server có ANTHROPIC_API_KEY chưa (đọc ảnh, trích vé bay). */
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    /** Server có OPENAI_API_KEY chưa (voice → chữ, §5.0 v2.0). */
    stt: Boolean(process.env.OPENAI_API_KEY),
  });
}
