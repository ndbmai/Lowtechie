import { after, NextResponse, type NextRequest } from "next/server";
import { decryptLarkPayload, larkSignature, safeEqual } from "@/lib/larkBot";
import { firstSeen, handleLarkEvent, type LarkEnvelope } from "@/lib/larkBotHandle";

/**
 * Địa chỉ nhận sự kiện của bot Lark (PRD §5.5.1 bước 3) — khai ở
 * Events & Callbacks của app: `${origin}/api/lark/events`.
 *
 * - Xác minh URL: trả lại `challenge` (sau khi giải mã nếu có Encrypt Key).
 * - Mọi sự kiện phải khớp LARK_VERIFICATION_TOKEN; có Encrypt Key thì
 *   kiểm cả chữ ký X-Lark-Signature.
 * - Trả 200 NGAY (Lark đòi trong 3 giây, chậm là gửi lại), xử lý sau
 *   bằng `after()`; mỗi event_id chỉ xử lý một lần.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const encryptKey = process.env.LARK_ENCRYPT_KEY;
  if (typeof body.encrypt === "string") {
    if (!encryptKey) return NextResponse.json({ error: "no-encrypt-key" }, { status: 400 });
    const ts = req.headers.get("x-lark-request-timestamp");
    const nonce = req.headers.get("x-lark-request-nonce");
    const sig = req.headers.get("x-lark-signature");
    if (ts && nonce && sig && !safeEqual(await larkSignature(ts, nonce, encryptKey, raw), sig)) {
      return NextResponse.json({ error: "bad-signature" }, { status: 401 });
    }
    try {
      body = JSON.parse(await decryptLarkPayload(body.encrypt, encryptKey)) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "bad-encrypt" }, { status: 400 });
    }
  }

  const env = body as LarkEnvelope;
  const token = env.header?.token ?? env.token;
  const expected = process.env.LARK_VERIFICATION_TOKEN;
  if (!expected || typeof token !== "string" || !safeEqual(token, expected)) {
    return NextResponse.json({ error: "bad-token" }, { status: 401 });
  }

  if (env.type === "url_verification") return NextResponse.json({ challenge: env.challenge });

  const eventId = env.header?.event_id ?? env.uuid;
  if (eventId && !(await firstSeen(eventId))) return NextResponse.json({ ok: true });

  const origin = req.nextUrl.origin;
  after(() => handleLarkEvent(env, origin));
  return NextResponse.json({ ok: true });
}
