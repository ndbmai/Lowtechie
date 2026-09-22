import { beforeAll, describe, expect, it } from "vitest";
import { authUrl, isConfigured, seal, unseal } from "../googleServer";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret-abc";
});

describe("googleServer — cookie mã hóa & URL OAuth", () => {
  it("seal → unseal tròn vòng, giữ nguyên refresh token + email", async () => {
    const sealed = await seal({ rt: "1//refresh-token-xyz", email: "mai@example.com" });
    expect(sealed).not.toContain("refresh-token");
    const link = await unseal(sealed);
    expect(link).toEqual({ rt: "1//refresh-token-xyz", email: "mai@example.com" });
  });

  it("cookie rác / thiếu → null, không nổ", async () => {
    expect(await unseal(undefined)).toBeNull();
    expect(await unseal("khong-phai-cookie")).toBeNull();
    expect(await unseal("AAAA")).toBeNull();
  });

  it("đổi GOOGLE_CLIENT_SECRET thì cookie cũ vô hiệu (coi như chưa nối)", async () => {
    const sealed = await seal({ rt: "rt-1" });
    const old = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_SECRET = "secret-moi";
    expect(await unseal(sealed)).toBeNull();
    process.env.GOOGLE_CLIENT_SECRET = old;
  });

  it("authUrl đủ client_id, redirect_uri, scope calendar.events, offline+consent", () => {
    const u = new URL(authUrl("https://lowtechie.vercel.app", "state-123"));
    expect(u.origin).toBe("https://accounts.google.com");
    expect(u.searchParams.get("client_id")).toBe("test-client-id.apps.googleusercontent.com");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://lowtechie.vercel.app/api/google/callback",
    );
    expect(u.searchParams.get("scope")).toContain("calendar.events");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("state-123");
  });

  it("isConfigured phản ánh env", () => {
    expect(isConfigured()).toBe(true);
  });
});
