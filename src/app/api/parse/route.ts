import { NextResponse } from "next/server";
import { readTaxonomy, taxonomyText, type TaxonomyPayload } from "@/lib/taxonomy";
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
            kind: { type: "string", enum: ["task", "event", "reschedule", "note", "complete"] },
            title: { type: "string", description: "Tiêu đề việc/sự kiện (kind=task|event)" },
            what: {
              type: "string",
              description: "Tên việc/lịch nhắm tới (kind=reschedule|note|complete)",
            },
            text: { type: "string", description: "Nội dung ghi chú (kind=note)" },
            projectId: {
              type: "string",
              description: "Id dự án — CHỈ dùng id có trong danh sách ở system prompt",
            },
            categoryId: {
              type: "string",
              description: "Id category — CHỈ dùng id có trong danh sách ở system prompt",
            },
            clientId: {
              type: "string",
              description:
                "Id khách hàng/đối tác — CHỈ khi tên trong câu khớp danh bạ (kể cả tên gọi tắt); tên lạ thì BỎ TRỐNG, không đoán",
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

function systemPrompt(localNow: string, tzName: string, taxonomy: TaxonomyPayload): string {
  return `Bạn là bộ tách lệnh của Mai Lowtechie — trợ lý của Mai (founder ở Bangkok, nói tiếng Việt/Thái/Anh trộn).
Bây giờ ở chỗ Mai là ${localNow} (múi giờ ${tzName}). Dùng mốc này cho "ngày mai", "thứ Ba tuần sau"…; mọi ISO trả về phải kèm đúng offset múi giờ này.
Tách câu của Mai thành các hành động: task (việc, có projectId + categoryId + dueAt nếu nói), event (hẹn/họp/bay/block deep work; kèm startAt hoặc durationMinutes, location, mode nếu Mai nói "đi tàu"/"ô tô"), reschedule (dời lịch; keepTime=true khi chỉ nói ngày mới), note ("ghi chú cho việc X: …" → what=tên việc ĐÃ CÓ, text=nội dung — không tạo việc mới), complete ("xong việc X rồi" → what=tên việc; app sẽ hiện thẻ xác nhận trước khi đóng).
Tiêu đề việc bắt đầu bằng động từ rõ ràng ("Gửi báo giá cho OKR", không phải "báo giá OKR").
Dự án, category và danh bạ khách CỦA MAI (chỉ dùng đúng các id này, Mai tự quản danh sách):
${taxonomyText(taxonomy)}
Không chắc category thì bỏ trống, đừng đoán bừa; confidence phản ánh độ chắc của phân loại.
Khách hàng/đối tác: tên trong câu khớp danh bạ (kể cả tên gọi tắt) → điền clientId; tên chưa có trong danh bạ → BỎ TRỐNG, không tự tạo, không đoán.
Deadline: câu có hạn (kể cả ngày tương đối "thứ Sáu", "cuối tháng") → quy ra dueAt theo mốc thời gian trên; câu KHÔNG có hạn → BỎ TRỐNG dueAt, tuyệt đối không tự đề xuất hạn.
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
  let taxonomy = readTaxonomy(undefined);
  try {
    const body = (await req.json()) as {
      text?: unknown;
      epochMs?: unknown;
      tzOffsetMin?: unknown;
      tz?: unknown;
      taxonomy?: unknown;
    };
    text = typeof body.text === "string" ? body.text.slice(0, 2000) : "";
    taxonomy = readTaxonomy(body.taxonomy);
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
        max_tokens: 4096,
        output_config: { effort: "low" },
        system: systemPrompt(localIso(epochMs, tzOffsetMin), tzName, taxonomy),
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
