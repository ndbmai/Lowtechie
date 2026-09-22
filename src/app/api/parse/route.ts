import { NextResponse } from "next/server";
import type { ParseResult, ParsedAction } from "@/core/types";

/**
 * Proxy tách lệnh qua Claude API (tool use, hiểu VI/TH/EN trộn).
 *
 * Không có ANTHROPIC_API_KEY (hoặc gọi lỗi) → trả 501/502 để client tự
 * chạy bộ phân tích luật NGAY TRÊN TRÌNH DUYỆT — đúng múi giờ của Mai,
 * còn server (thường chạy UTC) thì không.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const TOOL_SCHEMA = {
  name: "emit_actions",
  description: "Trả về danh sách hành động tách được từ câu lệnh của Mai.",
  input_schema: {
    type: "object" as const,
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["task", "event", "reschedule"] },
            title: { type: "string", description: "Tiêu đề việc/sự kiện (kind=task|event)" },
            what: { type: "string", description: "Thứ cần dời (kind=reschedule)" },
            projectId: {
              type: "string",
              enum: ["sorene", "circle", "favstay", "edge", "canhan", "hoctap", "admin"],
            },
            categoryId: {
              type: "string",
              description: "Category cấp 2 dạng '<project>:<slug>' theo danh sách trong system prompt",
            },
            dueAt: { type: "string", description: "ISO 8601, có offset múi giờ" },
            dueType: { type: "string", enum: ["hard", "soft"] },
            startAt: { type: "string", description: "ISO 8601 cho event" },
            toWhen: { type: "string", description: "ISO 8601 cho reschedule" },
            keepTime: { type: "boolean" },
            durationMinutes: { type: "number" },
            location: { type: "string" },
            mode: { type: "string", enum: ["transit", "car"] },
            confidence: { type: "number" },
          },
          required: ["kind", "confidence"],
        },
      },
      question: {
        type: "string",
        description: "TỐI ĐA MỘT câu hỏi lại khi thiếu thông tin quan trọng, tiếng Việt.",
      },
    },
    required: ["actions"],
  },
};

function systemPrompt(localNow: string, tzName: string): string {
  return `Bạn là bộ tách lệnh của Mai Lowtechie — trợ lý của Mai (founder ở Bangkok, nói tiếng Việt/Thái/Anh trộn).
Bây giờ ở chỗ Mai là ${localNow} (múi giờ ${tzName}). Dùng mốc này cho "ngày mai", "thứ Ba tuần sau"…; mọi ISO trả về phải kèm đúng offset múi giờ này.
Tách câu của Mai thành các hành động: task (việc, có projectId + categoryId + dueAt nếu nói), event (hẹn/họp/bay/block deep work; kèm startAt hoặc durationMinutes, location, mode nếu Mai nói "đi tàu"/"ô tô"), reschedule (dời lịch; keepTime=true khi chỉ nói ngày mới).
Tiêu đề việc bắt đầu bằng động từ rõ ràng ("Gửi báo giá cho OKR", không phải "báo giá OKR").
Dự án và category (PRD §5.2.1): sorene (sorene:sanpham | sorene:goivon | sorene:tangtruong | sorene:phaply) · circle (circle:banhang | circle:delivery | circle:daotao | circle:marketing | circle:hopdong) · favstay (favstay:vanhanh | favstay:ota | favstay:marketing | favstay:doitac) · edge (edge:vietbai | edge:phanphoi | edge:congdong) · canhan (canhan:suckhoe | canhan:chuyendi | canhan:nhacua | canhan:giayto) · hoctap (hoctap:tiengthai — dự án riêng cho việc học) · admin (admin:thue | admin:hoadon | admin:congcu).
Không chắc category thì bỏ trống, đừng đoán bừa; confidence phản ánh độ chắc của phân loại.
Giờ không nói rõ: nhắc việc = 9:00. "tối"=19:00, "chiều"=15:00, "sáng"=9:00.
Hỏi lại TỐI ĐA MỘT câu, chỉ khi thiếu thông tin thật sự quan trọng. Không bịa hành động Mai không nói.`;
}

/** "2026-09-21T15:30:00+07:00" từ epoch + offset của trình duyệt Mai. */
function localIso(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs - tzOffsetMin * 60_000);
  const sign = tzOffsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return shifted.toISOString().replace(/\.\d{3}Z$/, `${sign}${hh}:${mm}`);
}

interface ClaudeContent {
  type: string;
  name?: string;
  input?: { actions?: ParsedAction[]; question?: string };
}

export async function POST(req: Request): Promise<NextResponse> {
  let text = "";
  let epochMs = Date.now();
  let tzOffsetMin = 0;
  let tzName = "UTC";
  try {
    const body = (await req.json()) as {
      text?: unknown;
      epochMs?: unknown;
      tzOffsetMin?: unknown;
      tz?: unknown;
    };
    text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
    if (typeof body.epochMs === "number" && Number.isFinite(body.epochMs)) epochMs = body.epochMs;
    if (typeof body.tzOffsetMin === "number" && Number.isFinite(body.tzOffsetMin))
      tzOffsetMin = body.tzOffsetMin;
    if (typeof body.tz === "string") tzName = body.tz.slice(0, 64);
  } catch {
    /* body hỏng → 400 bên dưới */
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "Thiếu text" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Client sẽ tự parse bằng bộ luật trên trình duyệt.
    return NextResponse.json({ error: "no-key" }, { status: 501 });
  }

  // Key cấp org chưa gắn workspace → Anthropic đòi header này.
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
        max_tokens: 1024,
        system: systemPrompt(localIso(epochMs, tzOffsetMin), tzName),
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "emit_actions" },
        messages: [{ role: "user", content: text }],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { content?: ClaudeContent[] };
      const toolUse = data.content?.find(
        (c) => c.type === "tool_use" && c.name === "emit_actions",
      );
      const actions = toolUse?.input?.actions;
      if (Array.isArray(actions) && actions.length > 0) {
        const out: ParseResult = {
          actions,
          question: toolUse?.input?.question,
          source: "claude",
        };
        return NextResponse.json(out);
      }
    }
  } catch {
    /* rơi xuống 502 */
  }
  return NextResponse.json({ error: "claude-failed" }, { status: 502 });
}
