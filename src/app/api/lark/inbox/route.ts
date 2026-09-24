import { NextResponse, type NextRequest } from "next/server";
import type { LarkInboxItem } from "@/core/larkInbox";
import { writeAccount } from "@/lib/accounts";
import { KV_KEYS, kv, kvConfigured, pairsToRecord } from "@/lib/kv";
import { larkIdentity, resolveOwner } from "@/lib/larkOwner";

/**
 * Hàng đợi bot → Hộp duyệt (§5.5.1 bước 7). CHỈ chủ bot (Mai) kéo/xóa
 * được. GET trả các mục đang chờ; app dựng thẻ duyệt xong thì DELETE.
 */

export const runtime = "nodejs";

type Auth =
  | { ok: false; res: NextResponse }
  | { ok: true; done: (res: NextResponse) => Promise<NextResponse> };

async function authorize(req: NextRequest): Promise<Auth> {
  const id = await larkIdentity(req);
  if (!id) return { ok: false, res: NextResponse.json({ error: "not-connected" }, { status: 401 }) };
  const { isYou, owner } = await resolveOwner(id.openId);
  const done = async (res: NextResponse) => {
    if (id.rotated) await writeAccount(res, req.nextUrl.origin, id.account.id, "lark", id.rotated);
    return res;
  };
  if (!isYou) {
    return { ok: false, res: await done(NextResponse.json({ error: owner ? "not-owner" : "no-owner" }, { status: 403 })) };
  }
  return { ok: true, done };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!kvConfigured()) return NextResponse.json({ items: [], queue: false });
  const auth = await authorize(req);
  if (!auth.ok) return auth.res;
  try {
    const rec = pairsToRecord(await kv(["HGETALL", KV_KEYS.inbox]));
    const items: LarkInboxItem[] = [];
    for (const v of Object.values(rec)) {
      try {
        items.push(JSON.parse(v) as LarkInboxItem);
      } catch {
        /* mục hỏng — bỏ */
      }
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    return auth.done(NextResponse.json({ items, queue: true }));
  } catch (err) {
    return auth.done(NextResponse.json({ error: "kv", detail: String(err) }, { status: 502 }));
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (!kvConfigured()) return NextResponse.json({ ok: true });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return NextResponse.json({ ok: true });
  const auth = await authorize(req);
  if (!auth.ok) return auth.res;
  try {
    await kv(["HDEL", KV_KEYS.inbox, ...ids.slice(0, 200)]);
    return auth.done(NextResponse.json({ ok: true }));
  } catch (err) {
    return auth.done(NextResponse.json({ error: "kv", detail: String(err) }, { status: 502 }));
  }
}
