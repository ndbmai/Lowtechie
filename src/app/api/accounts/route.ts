import { NextResponse, type NextRequest } from "next/server";
import {
  accountErrorAction,
  accountsWith,
  deleteAccountCookie,
  findAccount,
  publicAccount,
  readAccounts,
  writeAccount,
  type Account,
  type AccountParts,
  type LarkLink,
} from "@/lib/accounts";
import { CAL_BASE, accessToken, isConfigured, revoke, type GoogleLink } from "@/lib/googleServer";
import { isLarkConfigured, larkAccessToken, larkEventsAllCalendars } from "@/lib/larkServer";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ProbeResult {
  id: string;
  provider: "google" | "lark";
  email?: string;
  calendars: number;
  events: number;
  error?: { detail: string; action: string };
}

/**
 * Danh sách tài khoản đã nối trên THIẾT BỊ này (§5.3.4) — không kèm token.
 * Thêm `?probe=1&fromMs&toMs` (v3.2 — "Đồng bộ ngay"): thử đọc thật từng
 * tài khoản bật Lịch, đếm lịch con + sự kiện trong khoảng; lỗi trả kèm
 * hành động rõ ràng thay vì im lặng 0 sự kiện.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const accounts = await readAccounts(req);
  const base = {
    configured: { google: isConfigured(), lark: isLarkConfigured() },
    accounts: accounts.map(publicAccount),
  };
  if (req.nextUrl.searchParams.get("probe") !== "1") return NextResponse.json(base);

  const fromMs = Number(req.nextUrl.searchParams.get("fromMs")) || Date.now();
  const toMs = Number(req.nextUrl.searchParams.get("toMs")) || fromMs + 30 * 86_400_000;
  const probe: ProbeResult[] = [];
  const rotated: { account: Account; link: LarkLink }[] = [];

  for (const a of accountsWith(accounts, "cal")) {
    try {
      if (a.provider === "google") {
        const at = await accessToken(a.link as GoogleLink);
        if (!at) throw new Error("token");
        const p = new URLSearchParams({
          timeMin: new Date(fromMs).toISOString(),
          timeMax: new Date(toMs).toISOString(),
          singleEvents: "true",
          maxResults: "100",
        });
        const res = await fetch(`${CAL_BASE}/calendars/primary/events?${p}`, {
          headers: { authorization: `Bearer ${at}` },
        });
        if (!res.ok) throw new Error(`google-${res.status}`);
        const d = (await res.json().catch(() => ({}))) as { items?: { status?: string }[] };
        const events = (d.items ?? []).filter((e) => e.status !== "cancelled").length;
        probe.push({ id: a.id, provider: "google", email: a.email, calendars: 1, events });
      } else {
        const tokens = await larkAccessToken((a.link as LarkLink).rt);
        if (!tokens) throw new Error("token");
        // Lark xoay vòng refresh token → PHẢI ghi lại cookie.
        rotated.push({ account: a, link: { ...(a.link as LarkLink), rt: tokens.rt } });
        const got = await larkEventsAllCalendars(tokens.at, fromMs, toMs);
        probe.push({
          id: a.id,
          provider: "lark",
          email: a.email,
          calendars: got.calendars,
          events: got.events.length,
        });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : "lỗi";
      probe.push({
        id: a.id,
        provider: a.provider,
        email: a.email,
        calendars: 0,
        events: 0,
        error: { detail, action: accountErrorAction(a.provider, detail) },
      });
    }
  }

  const res = NextResponse.json({ ...base, probe });
  for (const r of rotated) {
    await writeAccount(res, req.nextUrl.origin, r.account.id, "lark", r.link);
  }
  return res;
}

/** Bật/tắt Lịch · Mail · Drive của một tài khoản. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let id = "";
  let parts: Partial<AccountParts> = {};
  try {
    const body = (await req.json()) as { id?: unknown; parts?: Partial<AccountParts> };
    if (typeof body.id === "string") id = body.id;
    if (body.parts && typeof body.parts === "object") parts = body.parts;
  } catch {
    /* 400 bên dưới */
  }
  const account = findAccount(await readAccounts(req), id);
  if (!account) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const next: AccountParts = {
    cal: parts.cal ?? account.parts.cal,
    mail: parts.mail ?? account.parts.mail,
    drive: parts.drive ?? account.parts.drive,
  };
  const res = NextResponse.json({ ok: true, parts: next });
  await writeAccount(res, req.nextUrl.origin, account.id, account.provider, {
    ...account.link,
    parts: next,
  });
  return res;
}

/** Ngắt MỘT tài khoản: thu hồi phía nhà cung cấp (Google) + xóa cookie. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const account = findAccount(await readAccounts(req), id);
  if (!account) return NextResponse.json({ error: "not-found" }, { status: 404 });

  if (account.provider === "google") await revoke(account.link as GoogleLink);
  const res = NextResponse.json({ ok: true });
  deleteAccountCookie(res, account.id, account.provider);
  return res;
}
