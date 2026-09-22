import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, accessToken, unseal } from "@/lib/googleServer";

/**
 * Tải MỘT file đính kèm Gmail (vé PDF) để client lưu vào chuyến
 * (PRD §5.9 v2.0 "tự lưu vé"). Chỉ chạy sau khi Mai bấm xác nhận chuyến.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

/** ~3MB sau khi giải base64 — vé máy bay luôn nhỏ hơn nhiều. */
const MAX_B64_CHARS = 4_200_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const messageId = req.nextUrl.searchParams.get("messageId") ?? "";
  const attachmentId = req.nextUrl.searchParams.get("attachmentId") ?? "";
  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: "Thiếu messageId/attachmentId" }, { status: 400 });
  }

  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  if (!link) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  if (!link.gm) return NextResponse.json({ error: "no-gmail-scope" }, { status: 403 });
  const at = await accessToken(link);
  if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });

  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { authorization: `Bearer ${at}` } },
  );
  if (!r.ok) return NextResponse.json({ error: `gmail-${r.status}` }, { status: 502 });
  const a = (await r.json()) as { data?: string; size?: number };
  if (!a.data) return NextResponse.json({ error: "empty" }, { status: 502 });

  // Gmail trả base64url → base64 chuẩn có padding.
  let data = a.data.replace(/-/g, "+").replace(/_/g, "/");
  while (data.length % 4) data += "=";
  if (data.length > MAX_B64_CHARS) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }
  return NextResponse.json({ data, size: a.size ?? 0 });
}
