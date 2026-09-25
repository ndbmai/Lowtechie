import { NextResponse, type NextRequest } from "next/server";
import { classifyAndGroup, type FlightSegment } from "@/core/flights";
import { accessToken, type GoogleLink } from "@/lib/googleServer";
import { larkRecentMail, larkTokenFor } from "@/lib/larkServer";
import {
  accountsWith,
  readAccounts,
  writeAccount,
  type Account,
  type LarkLink,
} from "@/lib/accounts";

/**
 * Quét Gmail tìm email xác nhận vé máy bay (PRD §5.9, bản 6b — sửa lỗi
 * vé OADC5J): AI chỉ TRÍCH THÔ tất cả các chặng từ email + PDF đính kèm;
 * việc so với "bây giờ", khử trùng và gộp thành chuyến là của CODE
 * (`src/core/flights.ts` — có test hồi quy). Chỉ ĐỌC email; chuyến chỉ
 * được tạo khi Mai bấm duyệt ở màn Chuyến đi.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEARCH_Q =
  '{"e-ticket" eticket itinerary "boarding pass" "booking confirmation" "vé điện tử" "vé máy bay" "chuyến bay" flight} newer_than:90d';
const MAX_EMAILS = 12;
const MAX_BODY_CHARS = 3500;
/** Hành trình đầy đủ hay nằm trong PDF (lỗi OADC5J) — đọc tối đa 3 tệp nhỏ. */
const MAX_PDFS = 3;
/** Trần ĐỌC bằng Claude — không phải trần lưu file. */
const MAX_PDF_BYTES = 1_500_000;
/** Trần file vé client tải về LƯU vào chuyến (khớp /api/gmail/attachment). */
const MAX_REF_BYTES = 3_000_000;

/** "Thứ Ba 22/9/2026, 14:30" theo giờ địa phương của Mai. */
function localLabel(epochMs: number, tzOffsetMin: number): string {
  const d = new Date(epochMs - tzOffsetMin * 60_000);
  const days = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}, ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function localIso(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs - tzOffsetMin * 60_000);
  const sign = tzOffsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  return shifted
    .toISOString()
    .replace(/\.\d{3}Z$/, `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`);
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

function b64urlDecode(s: string): string {
  try {
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Gmail trả base64url; Claude cần base64 chuẩn có padding. */
function b64urlToB64(s: string): string {
  let out = s.replace(/-/g, "+").replace(/_/g, "/");
  while (out.length % 4) out += "=";
  return out;
}

function extractText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return b64urlDecode(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return b64urlDecode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return "";
}

/** Gom các PDF đính kèm (id + tên + cỡ) trong cây MIME của một email. */
function listPdfParts(part: GmailPart | undefined): { attachmentId: string; filename: string; size: number }[] {
  if (!part) return [];
  const out: { attachmentId: string; filename: string; size: number }[] = [];
  const isPdf =
    part.mimeType === "application/pdf" || /\.pdf$/i.test(part.filename ?? "");
  if (isPdf && part.body?.attachmentId) {
    out.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename || "dinh-kem.pdf",
      size: part.body.size ?? 0,
    });
  }
  for (const p of part.parts ?? []) out.push(...listPdfParts(p));
  return out;
}

const TOOL_SCHEMA = {
  name: "emit_segments",
  description:
    "TẤT CẢ các chặng bay tìm thấy trong email và PDF đính kèm — trích thô, không tự lọc theo thời gian.",
  input_schema: {
    type: "object" as const,
    properties: {
      segments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pnr: { type: "string", description: "Mã đặt chỗ (PNR / booking reference) nếu thấy" },
            flightNo: { type: "string", description: 'Số hiệu chuyến, ví dụ "VU-131", "VJ903"' },
            airline: { type: "string", description: "Tên hãng bay" },
            fromIata: { type: "string", description: "Mã IATA sân bay ĐI, ví dụ SGN" },
            toIata: { type: "string", description: "Mã IATA sân bay ĐẾN, ví dụ BKK" },
            fromTerminal: { type: "string", description: 'Nhà ga đi nếu vé ghi, ví dụ "2"' },
            toTerminal: { type: "string", description: "Nhà ga đến nếu vé ghi" },
            departLocal: {
              type: "string",
              description:
                "Giờ cất cánh ISO 8601 KÈM offset múi giờ sân bay đi, ví dụ 2026-10-02T11:50:00+07:00",
            },
            arriveLocal: {
              type: "string",
              description: "Giờ hạ cánh ISO 8601 theo múi giờ sân bay đến",
            },
            seat: { type: "string", description: 'Số ghế, ví dụ "12F"' },
            baggage: { type: "string", description: 'Hành lý ký gửi, ví dụ "15kg"' },
            checkinMinutes: {
              type: "number",
              description: 'Vé ghi "có mặt trước X phút/tiếng" → đổi ra phút',
            },
            cancelled: { type: "boolean", description: "Email báo chặng này đã HỦY" },
            superseded: {
              type: "boolean",
              description: "Lịch trình cũ đã bị email đổi vé mới hơn (cùng PNR) thay thế",
            },
            subject: { type: "string", description: "Subject email nguồn" },
            confidence: { type: "number" },
          },
          required: ["flightNo", "departLocal", "confidence"],
        },
      },
    },
    required: ["segments"],
  },
};

interface ClaudeContent {
  type: string;
  name?: string;
  input?: { segments?: FlightSegment[] };
}

/** Một lời gọi Claude trích chặng thô từ một hộp thư. */
async function claudeExtract(
  apiKey: string,
  emailsText: string,
  pdfDocs: { label: string; data: string }[],
  clock: { epochMs: number; tzOffsetMin: number; tzName: string; todayLocal: string },
): Promise<{ segments: FlightSegment[] } | { error: string }> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  }
  const content: unknown[] = [
    ...pdfDocs.map((p) => ({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.data },
    })),
    {
      type: "text",
      text:
        (pdfDocs.length
          ? `Các PDF phía trên theo thứ tự: ${pdfDocs.map((p, i) => `(${i + 1}) ${p.label}`).join("; ")}.\n\n`
          : "") + emailsText,
    },
  ];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.LOWTECHIE_MODEL || "claude-sonnet-5",
        // Trần rộng + effort thấp: phần "suy nghĩ" cũng ăn vào max_tokens,
        // để hẹp là danh sách bị cắt và mất luôn tool_use (lỗi "HTTP 200").
        max_tokens: 16000,
        output_config: { effort: "low" },
        system: `Bạn trích vé máy bay cho Mai Lowtechie theo PRD §5.9 bản 6b — trích THEO CHẶNG, trả thô.
MỐC THỜI GIAN THẬT: bây giờ là ${localIso(clock.epochMs, clock.tzOffsetMin)} — ${clock.todayLocal}, múi giờ ${clock.tzName} nơi Mai đang ở. Mốc này CHỈ để suy ra năm khi vé ghi kiểu "02OCT" không có năm (đối chiếu ngày gửi email) — KHÔNG dùng để lọc chặng.
Quy tắc:
- Trả về TẤT CẢ các chặng bay tìm thấy, kể cả chặng đã bay trong quá khứ. Việc so với "bây giờ" là của server, không phải của bạn — đừng tự bỏ chặng nào.
- Mỗi chiều bay là MỘT chặng riêng (vé khứ hồi = 2 chặng; nối chuyến = mỗi đoạn 1 chặng). Đừng bao giờ trả chặng đi mà bỏ quên chặng về — hành trình đầy đủ thường nằm trong PDF đính kèm, đọc kỹ cả PDF.
- departLocal/arriveLocal là ISO 8601 KÈM đúng offset múi giờ sân bay (Bangkok/VN +07:00, Nhật +09:00).
- cancelled=true chỉ khi có email báo hủy chặng đó; superseded=true chỉ cho lịch trình CŨ khi có email đổi vé mới hơn cùng PNR.
- Email check-in/nhắc chuyến lặp lại một chặng đã có → cứ trả bình thường, server tự khử trùng theo PNR + số hiệu + ngày bay.
- Ghi đủ nếu vé có: PNR, nhà ga (terminal), ghế, hành lý ký gửi, quy định "có mặt trước X phút" (đổi ra checkinMinutes).
- Chỉ trích chuyến THẬT từ email xác nhận/đổi/hủy vé; bỏ quảng cáo, khuyến mãi, gợi ý giá. Không bịa chặng không có trong nguồn.`,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "emit_segments" },
        messages: [{ role: "user", content }],
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      content?: ClaudeContent[];
      stop_reason?: string;
      error?: { type?: string; message?: string };
    } | null;
    if (res.ok && data) {
      const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "emit_segments");
      if (Array.isArray(toolUse?.input?.segments)) return { segments: toolUse.input.segments };
    }
    return {
      error:
        data?.error?.message?.slice(0, 200) ??
        (res.ok
          ? `Claude 200 nhưng thiếu danh sách (stop_reason: ${data?.stop_reason ?? "?"})`
          : `Claude HTTP ${res.status}`),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server" };
  }
}

/** Ref file PDF để client tự lưu vé — kèm tài khoản chứa email (§5.3.4). */
interface AttachmentRef {
  messageId: string;
  attachmentId: string;
  filename: string;
  size: number;
  subject: string;
  account: string;
}

/** Quét MỘT hộp Gmail: gom email + PDF, Claude trích chặng thô. */
async function scanGmailbox(
  apiKey: string,
  account: Account,
  clock: { epochMs: number; tzOffsetMin: number; tzName: string; todayLocal: string },
): Promise<
  | { segments: FlightSegment[]; refs: AttachmentRef[]; scanned: number }
  | { error: string }
> {
  const at = await accessToken(account.link as GoogleLink);
  if (!at) return { error: "không lấy được token — cần Kết nối lại" };
  const gauth = { authorization: `Bearer ${at}` };

  // 1. Tìm email nghi là vé máy bay.
  const listRes = await fetch(
    `${GMAIL}/messages?q=${encodeURIComponent(SEARCH_Q)}&maxResults=${MAX_EMAILS}`,
    { headers: gauth },
  );
  if (listRes.status === 403) return { error: "chưa cấp quyền đọc Gmail — cần Kết nối lại" };
  if (!listRes.ok) return { error: `gmail-${listRes.status}` };
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) return { segments: [], refs: [], scanned: 0 };

  // 2. Lấy nội dung từng email (song song), kèm danh sách PDF đính kèm.
  const emails = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: gauth });
      if (!r.ok) return null;
      const m = (await r.json()) as {
        payload?: GmailPart & { headers?: { name: string; value: string }[] };
      };
      const h = (name: string) =>
        m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      const body = extractText(m.payload).replace(/\s+/g, " ").slice(0, MAX_BODY_CHARS);
      // Lọc theo trần LƯU (3MB) — trần đọc Claude siết riêng lúc tải docs,
      // đừng để vé nặng biến mất khỏi danh sách lưu (lỗi Mai gặp).
      const pdfs = listPdfParts(m.payload).filter((p) => p.size > 0 && p.size <= MAX_REF_BYTES);
      return { id, subject: h("subject"), from: h("from"), date: h("date"), body, pdfs };
    }),
  );
  const usable = emails.filter((e): e is NonNullable<typeof e> => Boolean(e?.body || e?.pdfs.length));
  if (usable.length === 0) return { segments: [], refs: [], scanned: 0 };

  // 2b. Tải tối đa MAX_PDFS tệp PDF — hành trình đầy đủ (chặng về!) hay chỉ
  // nằm trong đây chứ không nằm trong thân email (đúng lỗi OADC5J).
  const seenPdf = new Set<string>();
  const pdfDocs: { label: string; data: string }[] = [];
  for (const e of usable) {
    for (const p of e.pdfs) {
      if (pdfDocs.length >= MAX_PDFS) break;
      // Trần đọc Claude siết ở ĐÂY — file to hơn vẫn nằm trong refs để lưu.
      if (p.size > MAX_PDF_BYTES) continue;
      const dupKey = `${p.filename}|${p.size}`;
      if (seenPdf.has(dupKey)) continue;
      seenPdf.add(dupKey);
      const r = await fetch(
        `${GMAIL}/messages/${e.id}/attachments/${encodeURIComponent(p.attachmentId)}`,
        { headers: gauth },
      );
      if (!r.ok) continue;
      const a = (await r.json()) as { data?: string };
      if (!a.data) continue;
      pdfDocs.push({
        label: `PDF "${p.filename}" đính kèm email "${e.subject.slice(0, 80)}"`,
        data: b64urlToB64(a.data),
      });
    }
    if (pdfDocs.length >= MAX_PDFS) break;
  }

  // 3. Claude trích THÔ mọi chặng của hộp thư này.
  const emailsText = usable
    .map(
      (e, i) =>
        `--- EMAIL ${i + 1} ---\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.body}`,
    )
    .join("\n\n");
  const out = await claudeExtract(apiKey, emailsText, pdfDocs, clock);
  if ("error" in out) return out;
  const refs = usable
    .flatMap((e) =>
      e.pdfs.slice(0, 3).map((p) => ({
        messageId: e.id,
        attachmentId: p.attachmentId,
        filename: p.filename,
        size: p.size,
        subject: e.subject,
        account: account.id,
      })),
    )
    .slice(0, 8);
  return { segments: out.segments, refs, scanned: usable.length };
}

/**
 * Quét vé trên TẤT CẢ hộp thư đã bật Mail (§5.3.4): Gmail đầy đủ (email
 * + PDF); Lark Mail best-effort (PRD §9 — tổ chức chưa bật Mail API thì
 * ghi chú, không vỡ cả lần quét). Chặng của mọi hộp gộp chung một lần
 * khử trùng để vé forward qua hai hộp không thành hai chuyến.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Mốc thời gian THẬT của Mai (PRD §5.9: không bao giờ để AI tự đoán ngày).
  const epochMs = Number(req.nextUrl.searchParams.get("epochMs")) || Date.now();
  const tzOffsetMin = Number(req.nextUrl.searchParams.get("tzOffsetMin")) || 0;
  const tzName = req.nextUrl.searchParams.get("tz")?.slice(0, 64) || "UTC";
  const todayLocal = localLabel(epochMs, tzOffsetMin);
  const clock = { epochMs, tzOffsetMin, tzName, todayLocal };

  const accounts = await readAccounts(req);
  if (accounts.length === 0) {
    return NextResponse.json({ error: "not-connected" }, { status: 401 });
  }
  const mailboxes = accountsWith(accounts, "mail").filter(
    (a) => a.provider === "lark" || a.gm,
  );
  if (mailboxes.length === 0) {
    return NextResponse.json({ error: "no-gmail-scope" }, { status: 403 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no-key" }, { status: 501 });

  const segments: FlightSegment[] = [];
  const refs: AttachmentRef[] = [];
  const notes: string[] = [];
  const rotated: { account: Account; link: LarkLink }[] = [];
  let scanned = 0;
  let okBoxes = 0;

  for (const a of mailboxes.slice(0, 4)) {
    const label = a.email ?? (a.provider === "lark" ? "Lark Mail" : "Gmail");
    if (a.provider === "google") {
      const r = await scanGmailbox(apiKey, a, clock);
      if ("error" in r) {
        notes.push(`${label}: ${r.error}`);
        continue;
      }
      okBoxes++;
      scanned += r.scanned;
      refs.push(...r.refs);
      segments.push(...r.segments.map((s) => ({ ...s, mailbox: a.email })));
    } else {
      const tokens = await larkTokenFor(a.link as LarkLink);
      if (!tokens) {
        notes.push(`${label}: không lấy được token — cần Kết nối lại`);
        continue;
      }
      if (tokens.changed) rotated.push({ account: a, link: tokens.link });
      const mail = await larkRecentMail(tokens.at, MAX_EMAILS);
      if ("error" in mail) {
        // PRD §9: phạm vi Mail API tùy gói Lark của tổ chức — báo rõ.
        notes.push(`${label}: Lark Mail chưa đọc được (${mail.error}) — kiểm tra quyền Mail API`);
        continue;
      }
      okBoxes++;
      scanned += mail.messages.length;
      if (mail.messages.length > 0) {
        const text = mail.messages
          .map((m, i) => `--- EMAIL ${i + 1} ---\nSubject: ${m.subject}\n${m.bodyText}`)
          .join("\n\n");
        const out = await claudeExtract(apiKey, text, [], clock);
        if ("error" in out) notes.push(`${label}: ${out.error}`);
        else segments.push(...out.segments.map((s) => ({ ...s, mailbox: a.email ?? "Lark" })));
      }
    }
  }

  if (okBoxes === 0) {
    const detail = notes.join(" · ").slice(0, 300) || "không quét được hộp thư nào";
    console.error("gmail/flights failed:", detail);
    return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
  }

  // 4. CODE phân loại + khử trùng + gộp trên TẤT CẢ chặng (hàng rào thật
  // của §5.9 — giữ nguyên tên trường trả về để client cũ vẫn chạy).
  const { candidates, history } = classifyAndGroup(segments, epochMs);
  const res = NextResponse.json({
    trips: candidates,
    skipped: history,
    attachments: refs.slice(0, 8),
    scanned,
    todayLocal,
    mailboxNotes: notes.length ? notes : undefined,
  });
  // Lark xoay vòng refresh token → ghi lại cookie tài khoản.
  for (const r of rotated) {
    await writeAccount(res, req.nextUrl.origin, r.account.id, "lark", r.link);
  }
  return res;
}
