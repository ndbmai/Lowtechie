import { NextResponse, type NextRequest } from "next/server";
import { isConfigured } from "@/lib/googleServer";
import { isLarkConfigured } from "@/lib/larkServer";
import { readAccounts } from "@/lib/accounts";

export const runtime = "nodejs";

/**
 * Trạng thái nối + các dịch vụ server của thiết bị này. Từ §5.3.4 có thể
 * nhiều tài khoản: connected/gmail nói về BẤT KỲ tài khoản Google nào —
 * các màn cũ (Hôm nay, Chuyến đi) vẫn đọc như trước.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accounts = await readAccounts(req);
  const googles = accounts.filter((a) => a.provider === "google");
  const first = googles[0];
  return NextResponse.json({
    configured: isConfigured(),
    connected: googles.length > 0,
    email: first?.email,
    /** Có tài khoản Google nào bật Mail và đã cấp quyền Gmail chưa. */
    gmail: googles.some((a) => a.gm && a.parts.mail),
    /** Số tài khoản đã nối (mọi nhà cung cấp) — màn Kết nối dùng chi tiết hơn. */
    accounts: accounts.length,
    larkConfigured: isLarkConfigured(),
    /** Server có GOOGLE_MAPS_API_KEY chưa (Routes API, §5.4.1). */
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    /** Server có ANTHROPIC_API_KEY chưa (đọc ảnh, trích vé bay). */
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    /** Server có OPENAI_API_KEY chưa (voice → chữ, §5.0 v2.0). */
    stt: Boolean(process.env.OPENAI_API_KEY),
  });
}
