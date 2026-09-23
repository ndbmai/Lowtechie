import { NextResponse } from "next/server";

/**
 * Speech-to-text server (PRD §5.0 v2.0 — sửa lỗi voice 22/9): client ghi
 * âm trên máy rồi gửi lên đây, KHÔNG dựa vào nhận dạng của trình duyệt.
 * Dùng OpenAI Whisper (hỗ trợ tiếng Việt/Thái/Anh) qua fetch thuần.
 * Không có OPENAI_API_KEY → 501, client rơi về Web Speech nếu có.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

/** ~8MB audio (vài phút ghi âm nén) — voice note lệnh luôn ngắn hơn nhiều. */
const MAX_AUDIO_BYTES = 8_000_000;

export async function POST(req: Request): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "no-key" }, { status: 501 });

  let audio = "";
  let vocab: string[] = [];
  try {
    const body = (await req.json()) as { audio?: unknown; vocab?: unknown };
    if (typeof body.audio === "string") audio = body.audio;
    // Tên khách hàng/đối tác làm từ vựng ưu tiên (§5.3.2 v2.8) — để tên
    // riêng ("Đô Thị", "OKR"…) được nghe đúng thay vì phiên âm bừa.
    if (Array.isArray(body.vocab)) {
      vocab = body.vocab
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length >= 2 && v.length <= 40)
        .slice(0, 40);
    }
  } catch {
    /* 400 bên dưới */
  }
  const m = audio.match(/^data:(audio\/[a-z0-9.+-]+)((?:;[^;,]+)*);base64,(.+)$/i);
  if (!m) return NextResponse.json({ error: "Thiếu audio (data URL)" }, { status: 400 });
  const mime = m[1];
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `voice.${ext}`);
  form.append("model", process.env.LOWTECHIE_STT_MODEL || "whisper-1");
  form.append(
    "prompt",
    "Ghi chú công việc tiếng Việt, có thể trộn tiếng Anh và tiếng Thái." +
      (vocab.length ? ` Tên riêng cần nghe đúng: ${vocab.join(", ")}.` : ""),
  );

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = (await res.json().catch(() => null)) as
      | { text?: string; error?: { message?: string } }
      | null;
    if (res.ok && typeof data?.text === "string") {
      return NextResponse.json({ text: data.text });
    }
    const detail = data?.error?.message?.slice(0, 200) ?? `STT HTTP ${res.status}`;
    console.error("stt failed:", detail);
    return NextResponse.json({ error: "stt-failed", detail }, { status: 502 });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "lỗi mạng phía server";
    console.error("stt failed:", detail);
    return NextResponse.json({ error: "stt-failed", detail }, { status: 502 });
  }
}
