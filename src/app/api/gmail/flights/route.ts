import { NextResponse, type NextRequest } from "next/server";
import { GCAL_COOKIE, accessToken, unseal } from "@/lib/googleServer";

/**
 * Quét Gmail tìm email xác nhận vé máy bay → Claude trích thành các
 * chuyến đi ứng viên (PRD §5.9). Chỉ ĐỌC email; chuyến chỉ được tạo
 * khi Mai bấm duyệt ở màn Chuyến đi.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEARCH_Q =
  '{"e-ticket" eticket itinerary "boarding pass" "booking confirmation" "vé điện tử" "vé máy bay" "chuyến bay" flight} newer_than:90d';
const MAX_EMAILS = 12;
const MAX_BODY_CHARS = 3500;

export interface FlightTripCandidate {
  destination: "tokyo" | "hcmc" | "bkk" | "other";
  destinationName?: string;
  departAt: string;
  returnAt?: string;
  /** Mã đặt chỗ để chống tạo trùng (§5.9). */
  pnr?: string;
  flights: string;
  subject: string;
  confidence: number;
}

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
  body?: { data?: string };
  parts?: GmailPart[];
}

function b64urlDecode(s: string): string {
  try {
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
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

const TOOL_SCHEMA = {
  name: "emit_trips",
  description: "Các chuyến bay SẮP TỚI trích được từ email xác nhận vé.",
  input_schema: {
    type: "object" as const,
    properties: {
      trips: {
        type: "array",
        items: {
          type: "object",
          properties: {
            destination: {
              type: "string",
              enum: ["tokyo", "hcmc", "bkk", "other"],
              description: "Theo sân bay ĐẾN của chặng đi: NRT/HND=tokyo, SGN=hcmc, BKK/DMK=bkk",
            },
            destinationName: { type: "string", description: "Tên điểm đến nếu là other" },
            departAt: {
              type: "string",
              description: "Giờ cất cánh chặng đi, ISO 8601 theo múi giờ sân bay đi",
            },
            returnAt: { type: "string", description: "Giờ cất cánh chặng về nếu có" },
            pnr: { type: "string", description: "Mã đặt chỗ (PNR) nếu có" },
            flights: {
              type: "string",
              description: 'Tóm tắt chuyến, ví dụ "VJ903 BKK→SGN 08:30 · VJ904 về 20:15"',
            },
            subject: { type: "string", description: "Subject email nguồn" },
            confidence: { type: "number" },
          },
          required: ["destination", "departAt", "flights", "subject", "confidence"],
        },
      },
      skipped: {
        type: "array",
        items: { type: "string" },
        description:
          'Các chặng BỎ QUA kèm lý do, ví dụ "VJ901 15/9 — đã bay", "TG123 — chuyến đã hủy", "lịch trình cũ trước khi đổi vé"',
      },
    },
    required: ["trips"],
  },
};

interface ClaudeContent {
  type: string;
  name?: string;
  input?: { trips?: FlightTripCandidate[]; skipped?: string[] };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Mốc thời gian THẬT của Mai (PRD §5.9: không bao giờ để AI tự đoán ngày).
  const epochMs = Number(req.nextUrl.searchParams.get("epochMs")) || Date.now();
  const tzOffsetMin = Number(req.nextUrl.searchParams.get("tzOffsetMin")) || 0;
  const tzName = req.nextUrl.searchParams.get("tz")?.slice(0, 64) || "UTC";
  const todayLocal = localLabel(epochMs, tzOffsetMin);

  const link = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  if (!link) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  if (!link.gm) return NextResponse.json({ error: "no-gmail-scope" }, { status: 403 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no-key" }, { status: 501 });

  const at = await accessToken(link);
  if (!at) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const gauth = { authorization: `Bearer ${at}` };

  // 1. Tìm email nghi là vé máy bay.
  const listRes = await fetch(
    `${GMAIL}/messages?q=${encodeURIComponent(SEARCH_Q)}&maxResults=${MAX_EMAILS}`,
    { headers: gauth },
  );
  if (listRes.status === 403) {
    return NextResponse.json({ error: "no-gmail-scope" }, { status: 403 });
  }
  if (!listRes.ok) {
    return NextResponse.json({ error: `gmail-${listRes.status}` }, { status: 502 });
  }
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id);
  if (ids.length === 0) {
    return NextResponse.json({ trips: [], skipped: [], scanned: 0, todayLocal });
  }

  // 2. Lấy nội dung từng email (song song).
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
      return { subject: h("subject"), from: h("from"), date: h("date"), body };
    }),
  );
  const usable = emails.filter((e): e is NonNullable<typeof e> => Boolean(e?.body));

  // 3. Claude trích các chuyến sắp tới.
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) {
    headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;
  }
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
        system: `Bạn trích vé máy bay cho Mai Lowtechie theo PRD §5.9 — BẮT BUỘC đúng ngày, đúng chuyến.
MỐC THỜI GIAN THẬT (không được tự đoán): bây giờ là ${localIso(epochMs, tzOffsetMin)} — ${todayLocal}, múi giờ ${tzName} nơi Mai đang ở.
Quy tắc chọn chặng:
- CHỈ đưa vào trips những chặng có giờ khởi hành SAU thời điểm trên, so theo giờ địa phương của SÂN BAY ĐI (Bangkok/VN +07:00, Nhật +09:00).
- Chặng đã bay, chặng bị hủy, lịch trình cũ trước khi đổi vé, email check-in/nhắc lại → đưa vào "skipped" kèm lý do ngắn, KHÔNG đưa vào trips.
- Vé khứ hồi mà chặng đi đã qua → trips chỉ chứa chặng về.
- Nhiều phiên bản lịch trình trong hộp thư → lấy phiên bản MỚI NHẤT theo ngày xuất/đổi vé.
- Vé chỉ ghi ngày không ghi năm (kiểu "22SEP") → năm là lần xuất hiện gần nhất TỪ HÔM NAY TRỞ ĐI, đối chiếu với ngày gửi email.
Chỉ trích chuyến THẬT từ email xác nhận vé (bỏ quảng cáo/khuyến mãi). Ghép chặng đi + về cùng PNR thành một chuyến. Ghi PNR nếu thấy. departAt/returnAt là ISO 8601 kèm đúng offset múi giờ sân bay đi. Không bịa chuyến không có trong email.`,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "emit_trips" },
        messages: [
          {
            role: "user",
            content: usable
              .map(
                (e, i) =>
                  `--- EMAIL ${i + 1} ---\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.body}`,
              )
              .join("\n\n"),
          },
        ],
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      content?: ClaudeContent[];
      stop_reason?: string;
      error?: { type?: string; message?: string };
    } | null;
    if (res.ok && data) {
      const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "emit_trips");
      if (Array.isArray(toolUse?.input?.trips)) {
        // Hàng rào thứ hai (§5.9): dù model có lỡ trả chặng quá khứ,
        // server vẫn gạt sang "skipped" — không bao giờ thành chuyến.
        const skipped = [...(toolUse.input.skipped ?? [])];
        const trips = toolUse.input.trips.filter((t) => {
          const departMs = Date.parse(t.departAt);
          if (!Number.isFinite(departMs)) {
            skipped.push(`${t.flights} — không đọc được ngày giờ`);
            return false;
          }
          if (departMs <= epochMs) {
            skipped.push(`${t.flights} — đã bay (server chặn)`);
            return false;
          }
          return true;
        });
        return NextResponse.json({ trips, skipped, scanned: usable.length, todayLocal });
      }
    }
    const detail =
      data?.error?.message?.slice(0, 200) ??
      (res.ok
        ? `Claude 200 nhưng thiếu danh sách (stop_reason: ${data?.stop_reason ?? "?"}, blocks: ${(data?.content ?? []).map((c) => c.type).join(",") || "rỗng"})`
        : `Claude HTTP ${res.status}`);
    console.error("gmail/flights failed:", detail);
    return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server";
    console.error("gmail/flights failed:", detail);
    return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
  }
}
