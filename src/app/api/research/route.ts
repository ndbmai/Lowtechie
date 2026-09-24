import { NextResponse } from "next/server";

/**
 * Trợ lý nghiên cứu mức NHANH (PRD §5.9.1 v3.7): Claude tìm web (3–5
 * nguồn) rồi trả kết quả có cấu trúc qua công cụ emit_research — tóm tắt
 * trước, chi tiết sau, LUÔN kèm nguồn; chỗ chưa chắc nói rõ, không đoán.
 * Server không lưu gì: kết quả về máy Mai, Mai chọn nơi lưu.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const EMIT_TOOL = {
  name: "emit_research",
  description:
    "Trả kết quả nghiên cứu cho Mai. Gọi ĐÚNG MỘT LẦN, SAU KHI đã tìm kiếm web xong.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description: "Tóm tắt 2–4 câu tiếng Việt, trả lời thẳng câu hỏi của Mai.",
      },
      details: {
        type: "string",
        description:
          "Phần chi tiết: mỗi dòng một ý bắt đầu bằng '- ', kèm số nguồn dạng [1], [2] theo thứ tự trong sources.",
      },
      sources: {
        type: "array",
        description: "Các nguồn ĐÃ DÙNG (URL thật từ kết quả tìm kiếm, không bịa).",
        items: {
          type: "object",
          properties: { title: { type: "string" }, url: { type: "string" } },
          required: ["title", "url"],
        },
      },
      uncertain: {
        type: "string",
        description: "Chỗ chưa chắc chắn, thiếu dữ liệu, hoặc nên kiểm tra lại tại nguồn gốc.",
      },
      followUps: {
        type: "array",
        description: "1–3 việc tiếp theo Mai có thể làm, mỗi việc bắt đầu bằng động từ rõ ràng.",
        items: { type: "string" },
      },
    },
    required: ["summary", "sources"],
  },
};

function systemPrompt(today: string, context: string): string {
  return `Bạn là trợ lý nghiên cứu của Mai (founder ở Bangkok, làm việc với Sorene và The Circle; đọc tiếng Việt).
Hôm nay là ${today}. Dùng công cụ web_search để tìm thông tin CÔNG KHAI, mới nhất có thể (tối đa 5 lần tìm).
Quy tắc:
- Chỉ nêu điều có nguồn; mọi ý trong phần chi tiết gắn số nguồn [n].
- Không đoán thành sự thật: số liệu, tên, giá không chắc thì ghi vào "uncertain".
- Không đọc được nội dung sau đăng nhập hoặc tường phí — nếu nguồn chính nằm sau tường phí, nói rõ.
- Viết tiếng Việt ngắn gọn, thẳng vào việc.
Khi tìm xong, gọi emit_research ĐÚNG MỘT LẦN với kết quả.${context ? `\n\nDữ liệu nội bộ liên quan của Mai (chỉ để tham chiếu, không gửi ra ngoài):\n${context}` : ""}`;
}

interface ContentBlock {
  type: string;
  name?: string;
  text?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  citations?: { url?: string; title?: string }[];
}

interface ClaudeResponse {
  stop_reason?: string;
  content?: ContentBlock[];
  error?: { message?: string };
}

const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** Nguồn tìm được (kết quả web_search + trích dẫn trong chữ) — lưới an toàn khi Claude không gọi emit_research. */
function collectSources(blocks: ContentBlock[]): { title: string; url: string }[] {
  const out = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { url?: unknown; title?: unknown }[]) {
        if (isHttp(r.url) && !out.has(r.url)) out.set(r.url, typeof r.title === "string" ? r.title : r.url);
      }
    }
    for (const c of b.citations ?? []) {
      if (isHttp(c.url) && !out.has(c.url)) out.set(c.url, c.title ?? c.url);
    }
  }
  return [...out.entries()].map(([url, title]) => ({ url, title }));
}

export async function POST(req: Request): Promise<NextResponse> {
  let query = "";
  let context = "";
  let today = new Date().toISOString().slice(0, 10);
  try {
    const body = (await req.json()) as { query?: unknown; context?: unknown; today?: unknown };
    if (typeof body.query === "string") query = body.query.trim().slice(0, 500);
    if (typeof body.context === "string") context = body.context.slice(0, 4000);
    if (typeof body.today === "string") today = body.today.slice(0, 40);
  } catch {
    /* 400 bên dưới */
  }
  if (!query) return NextResponse.json({ error: "Thiếu câu hỏi" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no-key" }, { status: 501 });
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
  if (process.env.ANTHROPIC_WORKSPACE_ID) headers["anthropic-workspace-id"] = process.env.ANTHROPIC_WORKSPACE_ID;

  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: query }];
  const seen: ContentBlock[] = [];
  // web_search_20260209 (lọc động) cần Sonnet 5 / Opus 4.6+; model cũ hơn → bản cơ bản.
  let searchType = "web_search_20260209";

  try {
    for (let turn = 0; turn < 4; turn++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: process.env.LOWTECHIE_MODEL || "claude-sonnet-5",
          max_tokens: 8000,
          output_config: { effort: "medium" },
          system: systemPrompt(today, context),
          tools: [{ type: searchType, name: "web_search", max_uses: 5 }, EMIT_TOOL],
          tool_choice: { type: "auto" },
          messages,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ClaudeResponse;
      if (!res.ok) {
        if (res.status === 400 && searchType === "web_search_20260209" && /web_search/i.test(data.error?.message ?? "")) {
          searchType = "web_search_20250305";
          continue;
        }
        return NextResponse.json(
          { error: "claude-failed", detail: data.error?.message?.slice(0, 200) ?? `HTTP ${res.status}` },
          { status: 502 },
        );
      }
      const blocks = data.content ?? [];
      seen.push(...blocks);
      if (data.stop_reason === "refusal") {
        return NextResponse.json({ error: "refused", detail: "Claude từ chối câu hỏi này." }, { status: 502 });
      }
      const emit = blocks.find((b) => b.type === "tool_use" && b.name === "emit_research");
      if (emit?.input) {
        const i = emit.input;
        const toolSources = Array.isArray(i.sources)
          ? (i.sources as { title?: unknown; url?: unknown }[])
              .filter((s) => isHttp(s.url))
              .map((s) => ({ url: s.url as string, title: typeof s.title === "string" ? s.title : (s.url as string) }))
          : [];
        return NextResponse.json({
          summary: typeof i.summary === "string" ? i.summary : "",
          details: typeof i.details === "string" ? i.details : undefined,
          sources: (toolSources.length ? toolSources : collectSources(seen)).slice(0, 10),
          uncertain: typeof i.uncertain === "string" && i.uncertain.trim() ? i.uncertain : undefined,
          followUps: Array.isArray(i.followUps)
            ? (i.followUps as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3)
            : [],
        });
      }
      // Vòng tìm kiếm phía server chạm giới hạn → gửi lại để server chạy tiếp.
      if (data.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: blocks });
        continue;
      }
      // Claude trả lời bằng chữ mà không gọi công cụ → vẫn dùng được, kèm nguồn.
      const text = blocks
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("")
        .trim();
      if (text) {
        return NextResponse.json({
          summary: text.slice(0, 600),
          details: text.length > 600 ? text : undefined,
          sources: collectSources(seen).slice(0, 10),
          uncertain: "Kết quả chưa được sắp theo khung chuẩn — Mai đọc kỹ nguồn giúp mình.",
          followUps: [],
        });
      }
      break;
    }
  } catch (e) {
    return NextResponse.json(
      { error: "claude-failed", detail: e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng" },
      { status: 502 },
    );
  }
  return NextResponse.json({ error: "empty", detail: "Chưa ra kết quả — Mai thử hỏi cụ thể hơn nhé." }, { status: 502 });
}
