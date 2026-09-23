import { beforeAll, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { seal, sealFor, unsealFor } from "../googleServer";
import { larkAuthUrl, larkKeyMaterial } from "../larkServer";
import {
  DEFAULT_PARTS,
  LEGACY_GOOGLE_ID,
  accountsWith,
  cookieNameFor,
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
