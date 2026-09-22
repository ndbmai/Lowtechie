import { NextResponse } from "next/server";
import type { ImageItem, ImageParseResult } from "@/core/types";

/**
 * Đọc ảnh thành danh sách việc (PRD §5.1.1) bằng Claude vision.
 * Không có ANTHROPIC_API_KEY → 501: đọc chữ trong ảnh không có bản
 * chạy máy, client sẽ báo Mai bật key.
 */

export const runtime = "nodejs";
/** Đọc ảnh + trả danh sách dài có thể quá 15s mặc định của Vercel. */
export const maxDuration = 60;

const MAX_IMAGES = 4;

const TOOL_SCHEMA = {
  name: "emit_checklist",
  description: "Trả về các dòng việc đọc được từ ảnh checklist/ghi chú.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Một dòng = một việc, bắt đầu bằng động từ rõ ràng",
            },
            group: { type: "string", description: "Tên nhóm/mục con trong ảnh nếu có" },
            done: {
              type: "boolean",
              description: "true nếu ô đã tick / dòng bị gạch ngang",
            },
            assignee: { type: "string" },
            dueAt: { type: "string", description: "ISO 8601 kèm offset, nếu ảnh ghi ngày" },
            projectId: {
              type: "string",
              enum: ["sorene", "circle", "favstay", "edge", "canhan", "hoctap", "admin"],
            },
            categoryId: { type: "string" },
            confidence: {
              type: "number",
              description: "0–1; thấp khi chữ tay khó đọc, ảnh mờ/lóa",
            },
          },
          required: ["title", "confidence"],
        },
      },
      question: { type: "string", description: "TỐI ĐA MỘT câu hỏi lại, tiếng Việt" },
    },
    required: ["items"],
  },
};

function systemPrompt(localNow: string): string {
  return `Bạn đọc ảnh cho Mai Lowtechie: checklist viết tay, bảng trắng, sticky note, ảnh chụp màn hình — tiếng Việt/Thái/Anh, kể cả viết trộn.
Bây giờ ở chỗ Mai là ${localNow}. Mỗi dòng trong ảnh thành một việc bắt đầu bằng động từ; giữ tên nhóm/mục con nếu ảnh có cấu trúc; dòng đã tick hoặc gạch ngang → done=true; đọc ngày, tên người, dấu ưu tiên (*, !, khoanh tròn) nếu có.
Lời nhắn kèm ảnh (nếu có) cho biết dự án và hạn áp cho CẢ danh sách. Dự án: sorene (pitch deck, gọi vốn), circle (tư vấn, báo giá, hợp đồng, đào tạo), favstay (khách sạn, OTA), edge (newsletter), canhan (spa, sức khỏe, chuyến đi, giấy tờ), hoctap (tiếng Thái), admin (thuế, hóa đơn, công cụ).
Chữ khó đọc → vẫn trả dòng đó với confidence thấp, đừng bỏ. Không bịa dòng không có trong ảnh.`;
}

function localIso(epochMs: number, tzOffsetMin: number): string {
  const shifted = new Date(epochMs - tzOffsetMin * 60_000);
  const sign = tzOffsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  return shifted
    .toISOString()
    .replace(/\.\d{3}Z$/, `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`);
}

interface ClaudeContent {
  type: string;
  name?: string;
  input?: { items?: ImageItem[]; question?: string };
}

export async function POST(req: Request): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "no-key" }, { status: 501 });
  }

  let images: string[] = [];
  let caption = "";
  let epochMs = Date.now();
  let tzOffsetMin = 0;
  try {
    const body = (await req.json()) as {
      images?: unknown;
      caption?: unknown;
      epochMs?: unknown;
      tzOffsetMin?: unknown;
    };
    if (Array.isArray(body.images)) {
      images = body.images.filter((x): x is string => typeof x === "string").slice(0, MAX_IMAGES);
    }
    if (typeof body.caption === "string") caption = body.caption.slice(0, 500);
    if (typeof body.epochMs === "number" && Number.isFinite(body.epochMs)) epochMs = body.epochMs;
    if (typeof body.tzOffsetMin === "number" && Number.isFinite(body.tzOffsetMin))
      tzOffsetMin = body.tzOffsetMin;
  } catch {
    /* 400 bên dưới */
  }
  if (images.length === 0) {
    return NextResponse.json({ error: "Thiếu ảnh" }, { status: 400 });
  }

  const imageBlocks = [];
  for (const dataUrl of images) {
    const m = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!m) return NextResponse.json({ error: "Ảnh phải là data URL base64" }, { status: 400 });
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: m[1], data: m[2] },
    });
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

  let detail = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: process.env.LOWTECHIE_MODEL || "claude-sonnet-5",
        // Danh sách viết tay dài → JSON trả về dài; để thấp là bị cắt
        // giữa chừng và hỏng tool input (phần suy nghĩ cũng ăn vào trần).
        max_tokens: 12000,
        output_config: { effort: "low" },
        system: systemPrompt(localIso(epochMs, tzOffsetMin)),
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "emit_checklist" },
        messages: [
          {
            role: "user",
            content: [
              ...imageBlocks,
              {
                type: "text",
                text: caption
                  ? `Lời nhắn kèm ảnh của Mai: "${caption}". Trích danh sách việc từ ảnh.`
                  : "Trích danh sách việc từ ảnh.",
              },
            ],
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
      const toolUse = data.content?.find(
        (c) => c.type === "tool_use" && c.name === "emit_checklist",
      );
      const items = toolUse?.input?.items;
      if (Array.isArray(items)) {
        const out: ImageParseResult = {
          items,
          question: toolUse?.input?.question,
          source: "claude",
        };
        return NextResponse.json(out);
      }
      detail = `Claude trả về không có danh sách (stop_reason: ${data.stop_reason ?? "?"})`;
    } else {
      // Không lộ key — chỉ lấy loại lỗi + message từ Claude API.
      detail = data?.error?.message
        ? `${data.error.type ?? "api_error"}: ${data.error.message.slice(0, 200)}`
        : `Claude API HTTP ${res.status}`;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server";
  }
  console.error("parse-image failed:", detail);
  return NextResponse.json({ error: "claude-failed", detail }, { status: 502 });
}
