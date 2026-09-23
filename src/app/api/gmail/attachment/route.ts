import { NextResponse, type NextRequest } from "next/server";
import { accessToken, type GoogleLink } from "@/lib/googleServer";
import { LEGACY_GOOGLE_ID, findAccount, readAccounts } from "@/lib/accounts";

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

  // ?account= chọn đúng hộp thư chứa email vé (§5.3.4); ref cũ không có
  // → cookie Google đời đầu.
  const accounts = await readAccounts(req);
  const wanted = req.nextUrl.searchParams.get("account");
  const target =
    findAccount(accounts, wanted) ??
    findAccount(accounts, LEGACY_GOOGLE_ID) ??
    accounts.find((a) => a.provider === "google");
  if (!target || target.provider !== "google") {
    return NextResponse.json({ error: "not-connected" }, { status: 401 });
  }
  if (!target.gm) return NextResponse.json({ error: "no-gmail-scope" }, { status: 403 });
  const at = await accessToken(target.link as GoogleLink);
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
