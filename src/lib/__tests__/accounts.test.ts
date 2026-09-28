import { beforeAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { seal, sealFor, unsealFor } from "../googleServer";
import {
  LARK_INVITE_SCOPE,
  larkAuthUrl,
  larkKeyMaterial,
  larkRequestedScopes,
  larkScopeHasInvite,
} from "../larkServer";
import {
  DEFAULT_PARTS,
  LEGACY_GOOGLE_ID,
  accountsWith,
  cookieNameFor,
  publicAccount,
  readAccounts,
  type LarkLink,
} from "../accounts";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret-abc";
  process.env.LARK_APP_ID = "cli_test123";
  process.env.LARK_APP_SECRET = "lark-secret-xyz";
});

/** NextRequest giả chỉ với phần cookies mà readAccounts dùng. */
function fakeReq(cookies: Record<string, string>): NextRequest {
  return {
    cookies: {
      get: (name: string) => (name in cookies ? { name, value: cookies[name] } : undefined),
      getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })),
    },
  } as unknown as NextRequest;
}

describe("sổ đăng ký nhiều tài khoản (§5.3.4)", () => {
  it("cookie Google CŨ đọc thành tài khoản g0 — Mai không phải nối lại", async () => {
    const legacy = await seal({ rt: "rt-legacy", email: "mai@sorene.ai", gm: true });
    const accounts = await readAccounts(fakeReq({ lowtechie_g: legacy }));
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(LEGACY_GOOGLE_ID);
    expect(accounts[0].provider).toBe("google");
    expect(accounts[0].email).toBe("mai@sorene.ai");
    expect(accounts[0].gm).toBe(true);
    // Thiếu parts → bật hết như hành vi cũ.
    expect(accounts[0].parts).toEqual(DEFAULT_PARTS);
  });

  it("đọc song song Google cũ + Google slot + Lark; cookie rác bị bỏ qua", async () => {
    const legacy = await seal({ rt: "rt-1", email: "mai@sorene.ai" });
    const g2 = await seal({
      rt: "rt-2",
      email: "personal@gmail.com",
      gm: true,
      parts: { cal: true, mail: false, drive: false },
    });
    const lark = await sealFor(larkKeyMaterial(), {
      rt: "lark-rt",
      email: "mai@thecircle.tech",
    } satisfies LarkLink);
    const accounts = await readAccounts(
      fakeReq({
        lowtechie_g: legacy,
        [cookieNameFor("ab12cd", "google")]: g2,
        [cookieNameFor("xy99zz", "lark")]: lark,
        lta_g_hong: "cookie-rac",
      }),
    );
    expect(accounts.map((a) => a.id).sort()).toEqual(["ab12cd", "g0", "xy99zz"]);
    const g = accounts.find((a) => a.id === "ab12cd")!;
    expect(g.parts.mail).toBe(false);
    const l = accounts.find((a) => a.id === "xy99zz")!;
    expect(l.provider).toBe("lark");
    expect(l.email).toBe("mai@thecircle.tech");
    // accountsWith lọc theo phần đang bật.
    expect(accountsWith(accounts, "mail").map((a) => a.id).sort()).toEqual(["g0", "xy99zz"]);
  });

  it("cookie Lark dùng khóa riêng — khóa Google không đọc được và ngược lại", async () => {
    const lark = await sealFor(larkKeyMaterial(), { rt: "lark-rt" });
    expect(await unsealFor(`lowtechie-cookie::${process.env.GOOGLE_CLIENT_SECRET}`, lark)).toBeNull();
    const round = await unsealFor<LarkLink>(larkKeyMaterial(), lark);
    expect(round?.rt).toBe("lark-rt");
  });

  it("larkAuthUrl đủ client_id, redirect /api/lark/callback, offline_access", () => {
    const u = new URL(larkAuthUrl("https://lowtechie.vercel.app", "st-1"));
    expect(u.searchParams.get("client_id")).toBe("cli_test123");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://lowtechie.vercel.app/api/lark/callback",
    );
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("state")).toBe("st-1");
  });
});

describe("quyền mời người qua lịch Lark (§5.4 v3.9) — Mai bật ở Kết nối, không phải sửa Vercel", () => {
  it("mặc định KHÔNG xin quyền sửa sự kiện (app chưa khai là Lark chặn đăng nhập 20027); ?invite=1 mới xin", () => {
    const plain = new URL(larkAuthUrl("https://lowtechie.vercel.app", "s")).searchParams.get("scope")!;
    expect(plain.split(" ")).not.toContain(LARK_INVITE_SCOPE);
    const inv = new URL(larkAuthUrl("https://lowtechie.vercel.app", "s", { invite: true })).searchParams.get("scope")!;
    expect(inv.split(" ")).toContain(LARK_INVITE_SCOPE);
    expect(inv.split(" ")).toContain("calendar:calendar.event:create");
  });

  it("LARK_OAUTH_SCOPES đã có quyền đó → không xin trùng", () => {
    process.env.LARK_OAUTH_SCOPES = `offline_access calendar:calendar.event:read ${LARK_INVITE_SCOPE}`;
    try {
      expect(larkRequestedScopes(true).split(" ").filter((x) => x === LARK_INVITE_SCOPE)).toHaveLength(1);
      expect(larkRequestedScopes(false)).toContain(LARK_INVITE_SCOPE);
    } finally {
      delete process.env.LARK_OAUTH_SCOPES;
    }
  });

  it("đọc quyền từ danh sách scope Lark THẬT SỰ cấp; không có danh sách → chưa rõ", () => {
    expect(larkScopeHasInvite(`offline_access calendar:calendar.event:read ${LARK_INVITE_SCOPE}`)).toBe(true);
    expect(larkScopeHasInvite("offline_access calendar:calendar.event:read")).toBe(false);
    expect(larkScopeHasInvite(undefined)).toBeUndefined();
  });

  it("cờ inv đi theo cookie Lark ra màn Kết nối (invite), Google không có cờ này", async () => {
    const lark = await sealFor(larkKeyMaterial(), { rt: "rt", email: "mai@thecircle.tech", inv: true } satisfies LarkLink);
    const g = await seal({ rt: "rt-g", email: "mai@sorene.ai" });
    const accounts = await readAccounts(fakeReq({ lowtechie_g: g, [cookieNameFor("ab12", "lark")]: lark }));
    const pub = accounts.map(publicAccount);
    expect(pub.find((a) => a.provider === "lark")?.invite).toBe(true);
    expect(pub.find((a) => a.provider === "google")).not.toHaveProperty("invite");
  });
});

describe("cookie Lark cất access token nhưng không bao giờ quá cỡ (25/9)", () => {
  it("token ngắn → giữ access token; token quá dài → bỏ access token, vẫn giữ refresh token", async () => {
    const { sealLarkLink } = await import("../accounts");
    const small: LarkLink = { rt: "rt-1", at: "at-1", atExp: 123, email: "mai@thecircle.tech" };
    const back1 = await unsealFor<LarkLink>(larkKeyMaterial(), await sealLarkLink(small));
    expect(back1?.at).toBe("at-1");
    const big: LarkLink = { rt: "rt-2", at: "x".repeat(4000), atExp: 456, email: "mai@thecircle.tech" };
    const sealed = await sealLarkLink(big);
    expect(sealed.length).toBeLessThanOrEqual(3700);
    const back2 = await unsealFor<LarkLink>(larkKeyMaterial(), sealed);
    expect(back2?.rt).toBe("rt-2");
    expect(back2?.at).toBeUndefined();
    expect(back2?.email).toBe("mai@thecircle.tech");
  });
});
