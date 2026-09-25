import { NextResponse, type NextRequest } from "next/server";
import { writeAccount } from "@/lib/accounts";
import { KV_KEYS, kv, kvConfigured } from "@/lib/kv";
import { botErrorAction, isBotConfigured, larkBotChats, larkBotInfo, larkTenantToken, type BotChat } from "@/lib/larkBot";
import type { GroupConfig } from "@/lib/larkBotHandle";
import { larkIdentity, resolveOwner } from "@/lib/larkOwner";

/**
 * "Kiểm tra bot" ở màn Kết nối (§5.5.1 — "Bot không nhận được tin nhắn,
 * kiểm tra theo thứ tự này"): mỗi bước một dòng ✓/✗ kèm việc cần làm.
 * POST: đồng bộ chế độ từng group (Mai chọn trong app) lên hàng đợi để
 * bot biết group nào được đọc toàn bộ.
 */

export const runtime = "nodejs";

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readJson<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await kv<string>(["GET", key]);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = await larkIdentity(req);
  const queue = kvConfigured();
  const { owner, isYou } = await resolveOwner(id?.openId);
  const canSee = Boolean(id) && (isYou || !owner);

  const out: Record<string, unknown> = {
    connected: Boolean(id),
    configured: isBotConfigured(),
    webhookUrl: `${req.nextUrl.origin}/api/lark/events`,
    verificationToken: Boolean(process.env.LARK_VERIFICATION_TOKEN),
    encryptKey: Boolean(process.env.LARK_ENCRYPT_KEY),
    queue,
    owner: { known: Boolean(owner), isYou, you: id?.openId },
  };

  if (isBotConfigured()) {
    try {
      await larkTenantToken();
      out.tenant = { ok: true };
      try {
        const info = await larkBotInfo(true);
        out.bot = { ok: info.activateStatus === 2, name: info.name, activateStatus: info.activateStatus };
      } catch (err) {
        out.bot = { ok: false, action: botErrorAction(errText(err)) };
      }
      if (canSee) {
        try {
          const items: BotChat[] = await larkBotChats();
          out.chats = { ok: items.length > 0, items };
        } catch (err) {
          out.chats = {
            ok: false,
            items: [],
            action: /lark-(?:99991|230027)/.test(errText(err))
              ? `App thiếu quyền đọc thông tin group — thêm im:chat:readonly ở tab Tenant token scopes, phát hành lại (mã ${errText(err).replace("lark-", "")}).`
              : botErrorAction(errText(err)),
          };
        }
      }
    } catch (err) {
      out.tenant = { ok: false, action: botErrorAction(errText(err)) };
    }
  }

  if (queue) {
    out.lastEvent = await readJson(KV_KEYS.last);
    out.lastError = await readJson(`${KV_KEYS.last}:err`);
    if (isYou) {
      try {
        const rows = (await kv<string[]>(["LRANGE", KV_KEYS.log, 0, 29])) ?? [];
        out.log = rows.flatMap((r) => {
          try {
            return [JSON.parse(r)];
          } catch {
            return [];
          }
        });
      } catch {
        out.log = [];
      }
    }
  }

  const res = NextResponse.json(out);
  if (id?.rotated) await writeAccount(res, req.nextUrl.origin, id.account.id, "lark", id.rotated);
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!kvConfigured()) return NextResponse.json({ error: "no-queue" }, { status: 501 });
  const id = await larkIdentity(req);
  if (!id) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const { isYou } = await resolveOwner(id.openId);
  const done = async (res: NextResponse) => {
    if (id.rotated) await writeAccount(res, req.nextUrl.origin, id.account.id, "lark", id.rotated);
    return res;
  };
  if (!isYou) return done(NextResponse.json({ error: "not-owner" }, { status: 403 }));

  let groups: Record<string, GroupConfig> = {};
  try {
    const body = (await req.json()) as { groups?: Record<string, Partial<GroupConfig>> };
    for (const [chatId, g] of Object.entries(body.groups ?? {}).slice(0, 100)) {
      if (!/^oc_[\w-]+$/.test(chatId)) continue;
      groups[chatId] = {
        name: typeof g.name === "string" ? g.name.slice(0, 120) : undefined,
        mode: g.mode === "all" ? "all" : "mention",
        projectName: typeof g.projectName === "string" ? g.projectName.slice(0, 80) : undefined,
        clientName: typeof g.clientName === "string" ? g.clientName.slice(0, 80) : undefined,
      };
    }
  } catch {
    groups = {};
  }
  try {
    await kv(["SET", KV_KEYS.groups, JSON.stringify(groups)]);
    return done(NextResponse.json({ ok: true }));
  } catch (err) {
    return done(NextResponse.json({ error: "kv", detail: errText(err) }, { status: 502 }));
  }
}
