import { describe, expect, it } from "vitest";
import { kvEnvFrom } from "../kv";

describe("hàng đợi Upstash — nhận biến môi trường (Mai nối Storage trên Vercel 25/9)", () => {
  it("tên mặc định của Vercel Marketplace (KV_) và của Upstash trực tiếp", () => {
    expect(kvEnvFrom({ KV_REST_API_URL: "https://a.upstash.io/", KV_REST_API_TOKEN: "t" })).toEqual({
      url: "https://a.upstash.io",
      token: "t",
    });
    expect(kvEnvFrom({ UPSTASH_REDIS_REST_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u" })?.url).toBe(
      "https://b.upstash.io",
    );
  });

  it("tiền tố tùy ý khi nối Storage (LOWTECHIE_KV_REST_API_URL…)", () => {
    expect(
      kvEnvFrom({ LOWTECHIE_KV_REST_API_URL: "https://c.upstash.io", LOWTECHIE_KV_REST_API_TOKEN: "v" }),
    ).toEqual({ url: "https://c.upstash.io", token: "v" });
    expect(kvEnvFrom({ STORE_REDIS_REST_URL: "https://d.upstash.io", STORE_REDIS_REST_TOKEN: "w" })?.token).toBe("w");
  });

  it("chỉ có REDIS_URL dạng redis:// (Redis Cloud) hoặc thiếu token → coi như chưa có hàng đợi", () => {
    expect(kvEnvFrom({ REDIS_URL: "redis://default:x@host:6379" })).toBeNull();
    expect(kvEnvFrom({ KV_REST_API_URL: "https://a.upstash.io" })).toBeNull();
    expect(kvEnvFrom({ KV_URL: "rediss://x", KV_REST_API_URL: "redis://x", KV_REST_API_TOKEN: "t" })).toBeNull();
  });
});

describe("không nhầm dịch vụ khác", () => {
  it("biến *_REST_API_URL không phải Upstash → bỏ qua", () => {
    expect(kvEnvFrom({ OTHER_REST_API_URL: "https://api.example.com", OTHER_REST_API_TOKEN: "x" })).toBeNull();
  });
});
