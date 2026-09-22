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
  flights: string;
  subject: string;
  confidence: number;
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
    },
    required: ["trips"],
  },
};

interface ClaudeContent {
  type: string;
  name?: string;
  input?: { trips?: FlightTripCandidate[] };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
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
  if (ids.length === 0) return NextResponse.json({ trips: [], scanned: 0 });

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
        max_tokens: 4096,
        system: `Bạn đọc email hộ Mai Lowtechie. Hôm nay là ${new Date().toISOString()}.
Chỉ trích CHUYẾN BAY THẬT từ email xác nhận vé (bỏ quảng cáo, khuyến mãi, check-in nhắc lại chuyến đã trích). Bỏ chuyến đã bay xong. Ghép chặng đi + chặng về cùng một chuyến khi thấy khớp. Giờ bay theo múi giờ địa phương của sân bay đi (Bangkok +07:00, Việt Nam +07:00, Nhật +09:00). Không bịa chuyến không có trong email.`,
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
      error?: { type?: string; message?: string };
    } | null;
    if (res.ok && data) {
      const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "emit_trips");
      if (Array.isArray(toolUse?.input?.trips)) {
        return NextResponse.json({ trips: toolUse.input.trips, scanned: usable.length });
      }
    }
    const detail = data?.error?.message?.slice(0, 200) ?? `Claude HTTP ${res.status}`;
    console.error("gmail/flights failed:", detail);
    return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server";
    console.error("gmail/flights failed:", detail);
    return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
  }
}
