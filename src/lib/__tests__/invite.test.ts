import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seal } from "../googleServer";
import { POST } from "../../app/api/calendar/events/[id]/invite/route";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret-abc";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** Google giả: một địa chỉ "wrong@okr.vn" làm hỏng cả lần PATCH (400) như Google thật. */
function fakeGoogle(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "at-1" });
    if (method === "GET") {
      return Response.json({ summary: "Họp OKR", description: "Tạo bởi Mai Lowtechie 🌼", attendees: [] });
    }
    const emails = ((body?.attendees as { email: string }[]) ?? []).map((a) => a.email);
    if (emails.includes("wrong@okr.vn")) {
      return Response.json({ error: { code: 400, message: "Invalid attendee email." } }, { status: 400 });
    }
    return Response.json({ id: "evt1" });
  });
}

async function req(body: unknown): Promise<NextRequest> {
  const cookie = await seal({ rt: "rt-1", email: "mai@sorene.ai" });
  return new NextRequest("https://lowtechie.test/api/calendar/events/evt1/invite", {
    method: "POST",
    headers: { cookie: `lowtechie_g=${cookie}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("gửi mời (§5.4 v3.9) — email sai / gửi lỗi báo lại KÈM TÊN, không im lặng", () => {
  it("một địa chỉ Google từ chối → thử từng người: ai được, ai lỗi; sai định dạng thì không gửi đi", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", fakeGoogle(calls));
    const res = await POST(
      await req({
        account: "g0",
        title: "Họp OKR tuần này",
        message: "Hi Tuan,\n\nI'd like to invite you…",
        attendees: [
          { email: "tuan@okr.vn", name: "Tuấn" },
          { email: "wrong@okr.vn", name: "Người sai" },
          { email: "linh@", name: "Linh" },
        ],
      }),
      { params: Promise.resolve({ id: "evt1" }) },
    );
    const d = (await res.json()) as { results: { email?: string; ok: boolean; error?: string }[]; detailsOk: boolean };
    const by = Object.fromEntries(d.results.map((r) => [r.email, r]));
    expect(by["tuan@okr.vn"].ok).toBe(true);
    expect(by["wrong@okr.vn"].ok).toBe(false);
    expect(by["wrong@okr.vn"].error).toContain("email không hợp lệ");
    expect(by["linh@"]).toEqual({ email: "linh@", ok: false, error: "email không đúng định dạng" });
    expect(d.detailsOk).toBe(true);

    const patches = calls.filter((c) => c.method === "PATCH");
    // Lần 1 gửi cả hai (lỗi), rồi thử từng người.
    expect(patches).toHaveLength(3);
    expect(patches.every((p) => p.url.includes("sendUpdates=all"))).toBe(true);
    // Lời nhắn đứng đầu mô tả, bỏ dấu "Tạo bởi…"; tiêu đề mới đi kèm lần gửi thành công đầu tiên.
    const firstOk = patches[1];
    expect(firstOk.body?.description).toBe("Hi Tuan,\n\nI'd like to invite you…");
    expect(firstOk.body?.summary).toBe("Họp OKR tuần này");
    // Không ai trong danh sách thiếu email bị gửi đi.
    expect(JSON.stringify(patches)).not.toContain("linh@\"");
  });

  it("không có ai hợp lệ để mời → 400, không gọi Google", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", fakeGoogle(calls));
    const res = await POST(await req({ attendees: [] }), { params: Promise.resolve({ id: "evt1" }) });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
