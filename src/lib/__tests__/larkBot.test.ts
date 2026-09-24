import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptLarkPayload,
  larkMessageText,
  larkSignature,
  mentionsBot,
  resolveMentionKeys,
  safeEqual,
} from "../larkBot";

/** Mã hóa y như Lark: AES-256-CBC, khóa = SHA-256(encrypt key), IV 16 byte đứng đầu. */
function larkEncrypt(plain: string, key: string): string {
  const iv = randomBytes(16);
  const k = createHash("sha256").update(key).digest();
  const c = createCipheriv("aes-256-cbc", k, iv);
  return Buffer.concat([iv, c.update(plain, "utf8"), c.final()]).toString("base64");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("webhook bot Lark — xác thực (§5.5.1 bước 3)", () => {
  it("giải mã body encrypt đúng chuẩn Lark", async () => {
    const plain = JSON.stringify({ challenge: "abc", token: "tok", type: "url_verification" });
    expect(await decryptLarkPayload(larkEncrypt(plain, "k3y"), "k3y")).toBe(plain);
  });

  it("sai encrypt key → ném, không trả rác", async () => {
    await expect(decryptLarkPayload(larkEncrypt("{}", "dung"), "sai")).rejects.toThrow();
  });

  it("chữ ký = sha256(timestamp + nonce + key + body) dạng hex", async () => {
    const want = createHash("sha256").update("1700000000" + "n0nce" + "k3y" + '{"encrypt":"x"}').digest("hex");
    expect(await larkSignature("1700000000", "n0nce", "k3y", '{"encrypt":"x"}')).toBe(want);
  });

  it("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
});

describe("route /api/lark/events — bước xác minh URL", () => {
  async function post(body: unknown, headers: Record<string, string> = {}) {
    const { POST } = await import("../../app/api/lark/events/route");
    const raw = JSON.stringify(body);
    const req = new NextRequest("https://lowtechie.test/api/lark/events", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", ...headers },
    });
    const res = await POST(req);
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, raw };
  }

  it("không mã hóa: đúng token → trả lại challenge", async () => {
    vi.stubEnv("LARK_VERIFICATION_TOKEN", "tok");
    vi.stubEnv("LARK_ENCRYPT_KEY", "");
    const r = await post({ challenge: "ch-1", token: "tok", type: "url_verification" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ challenge: "ch-1" });
  });

  it("có Encrypt Key: giải mã rồi trả challenge", async () => {
    vi.stubEnv("LARK_VERIFICATION_TOKEN", "tok");
    vi.stubEnv("LARK_ENCRYPT_KEY", "k3y");
    const enc = larkEncrypt(JSON.stringify({ challenge: "ch-2", token: "tok", type: "url_verification" }), "k3y");
    const r = await post({ encrypt: enc });
    expect(r.body).toEqual({ challenge: "ch-2" });
  });

  it("có chữ ký sai → 401", async () => {
    vi.stubEnv("LARK_VERIFICATION_TOKEN", "tok");
    vi.stubEnv("LARK_ENCRYPT_KEY", "k3y");
    const enc = larkEncrypt(JSON.stringify({ challenge: "x", token: "tok", type: "url_verification" }), "k3y");
    const r = await post(
      { encrypt: enc },
      { "x-lark-request-timestamp": "1", "x-lark-request-nonce": "n", "x-lark-signature": "sai" },
    );
    expect(r.status).toBe(401);
  });

  it("sai verification token hoặc máy chủ chưa đặt token → 401 (không nhận sự kiện lạ)", async () => {
    vi.stubEnv("LARK_VERIFICATION_TOKEN", "tok");
    expect((await post({ challenge: "x", token: "khac", type: "url_verification" })).status).toBe(401);
    vi.stubEnv("LARK_VERIFICATION_TOKEN", "");
    expect((await post({ challenge: "x", token: "tok", type: "url_verification" })).status).toBe(401);
  });
});

describe("nội dung tin Lark", () => {
  it("tin text", () => {
    expect(larkMessageText("text", JSON.stringify({ text: "@_user_1 ghi việc: gửi proposal" }))).toBe(
      "@_user_1 ghi việc: gửi proposal",
    );
  });

  it("tin post (rich text), kể cả bọc theo ngôn ngữ", () => {
    const post = {
      title: "",
      content: [[{ tag: "at", user_name: "Lowtechie" }, { tag: "text", text: " ghi việc: gửi báo giá" }]],
    };
    expect(larkMessageText("post", JSON.stringify(post))).toBe("@Lowtechie ghi việc: gửi báo giá");
    expect(larkMessageText("post", JSON.stringify({ vi_vn: post }))).toBe("@Lowtechie ghi việc: gửi báo giá");
  });

  it("nội dung hỏng → chuỗi rỗng", () => {
    expect(larkMessageText("text", "{hỏng")).toBe("");
    expect(larkMessageText("image", JSON.stringify({ image_key: "img_1" }))).toBe("");
  });

  it("thay khóa @_user_N bằng tên (đọc lịch sử cho dễ hiểu)", () => {
    expect(resolveMentionKeys("@_user_1 gửi cho @_user_2", [
      { key: "@_user_1", name: "Lowtechie" },
      { key: "@_user_2", name: "Linh" },
    ])).toBe("@Lowtechie gửi cho @Linh");
  });

  it("chỉ xử lý tin GỌI bot (theo open_id bot; không có id thì theo tên)", () => {
    const m = [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "Mai Lowtechie" }];
    expect(mentionsBot(m, "ou_bot")).toBe(true);
    expect(mentionsBot(m, "ou_khac")).toBe(false);
    expect(mentionsBot([{ key: "@_user_1", name: "Mai Lowtechie" }])).toBe(true);
    expect(mentionsBot([{ key: "@_user_1", id: { open_id: "ou_linh" }, name: "Linh" }], "ou_bot")).toBe(false);
    expect(mentionsBot(undefined, "ou_bot")).toBe(false);
  });
});

describe("chữ để tách lệnh", () => {
  it("bỏ @bot, giữ TÊN người được @ (giao việc cho @Linh không mất Linh)", async () => {
    const { commandText } = await import("../larkBot");
    const { parseBotCommand } = await import("../../core/botCommand");
    const text = commandText("@_user_1 giao việc này cho @_user_2, hạn thứ Tư", [
      { key: "@_user_1", id: { open_id: "ou_bot" }, name: "Mai Lowtechie" },
      { key: "@_user_2", id: { open_id: "ou_linh" }, name: "Linh" },
    ], "ou_bot");
    expect(text).toBe("giao việc này cho Linh, hạn thứ Tư");
    expect(parseBotCommand(text)).toEqual({ kind: "assign", text: "này cho Linh, hạn thứ Tư", assignee: "Linh" });
  });
});
