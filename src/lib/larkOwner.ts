import type { NextRequest } from "next/server";
import { readAccounts, type Account, type LarkLink } from "@/lib/accounts";
import { KV_KEYS, kv, kvConfigured } from "@/lib/kv";
import { larkTokenFor, larkUserInfo } from "@/lib/larkServer";

/**
 * Ai là "Mai" với bot (§5.5.2 — chỉ Mai hỏi được chuyện riêng, chỉ Mai kéo
 * được hàng đợi Hộp duyệt): env LARK_OWNER_OPEN_ID nếu đặt, không thì
 * open_id của người ĐẦU TIÊN mở app có tài khoản Lark khi đã bật hàng đợi.
 */
export async function ownerOpenId(): Promise<string | undefined> {
  if (process.env.LARK_OWNER_OPEN_ID) return process.env.LARK_OWNER_OPEN_ID;
  if (!kvConfigured()) return undefined;
  try {
    return (await kv<string>(["GET", KV_KEYS.owner])) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface LarkIdentity {
  account: Account;
  openId?: string;
  name?: string;
  /** Link đã xoay vòng refresh token — route PHẢI ghi lại cookie. */
  rotated?: LarkLink;
}

/**
 * open_id của tài khoản Lark trên thiết bị này. Cookie nối trước v3.7
 * chưa có open_id → refresh một lần để hỏi user_info (nhớ ghi cookie).
 */
export async function larkIdentity(req: NextRequest): Promise<LarkIdentity | null> {
  const larks = (await readAccounts(req)).filter((a) => a.provider === "lark");
  const withId = larks.find((a) => (a.link as LarkLink).openId);
  if (withId) return { account: withId, openId: (withId.link as LarkLink).openId };
  const first = larks[0];
  if (!first) return null;
  const tokens = await larkTokenFor(first.link as LarkLink);
  if (!tokens) return { account: first };
  const who = await larkUserInfo(tokens.at);
  const openId = who?.openId ?? (first.link as LarkLink).openId;
  return {
    account: first,
    openId: who?.openId,
    name: who?.name,
    // Ghi lại cookie khi có refresh (xoay vòng) hoặc vừa biết thêm open_id.
    rotated: tokens.changed || openId ? { ...tokens.link, openId } : undefined,
  };
}

/**
 * Chủ bot hiện tại; chưa có chủ + có hàng đợi → nhận người đang mở app
 * (SET NX — người đầu tiên, không ghi đè).
 */
export async function resolveOwner(openId: string | undefined): Promise<{ owner?: string; isYou: boolean }> {
  let owner = await ownerOpenId();
  if (!owner && openId && kvConfigured()) {
    try {
      await kv(["SET", KV_KEYS.owner, openId, "NX"]);
      owner = (await kv<string>(["GET", KV_KEYS.owner])) ?? undefined;
    } catch {
      /* hàng đợi lỗi → coi như chưa có chủ */
    }
  }
  return { owner, isYou: Boolean(owner && openId && owner === openId) };
}
