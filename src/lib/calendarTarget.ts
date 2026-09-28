import type { NextRequest } from "next/server";
import { LEGACY_GOOGLE_ID, findAccount, readAccounts, type Account, type LarkLink } from "@/lib/accounts";
import { larkPrimaryCalendarId, larkTokenFor } from "@/lib/larkServer";

/*
 * Chọn đúng tài khoản + lịch con cho các route sửa/xóa/mời một sự kiện
 * (§5.3.4, §5.4.0 v3.7, §5.4 v3.9). Route handler của Next không được
 * export hàm phụ nên phần dùng chung nằm ở đây.
 */

/** Tài khoản đích: ?account= (§5.3.4); block cũ không có → cookie Google đời đầu. */
export async function targetAccount(req: NextRequest, wanted: string | null): Promise<Account | undefined> {
  const accounts = await readAccounts(req);
  return (
    findAccount(accounts, wanted) ??
    findAccount(accounts, LEGACY_GOOGLE_ID) ??
    accounts.find((a) => a.provider === "google")
  );
}

/**
 * Lark: access token + lịch con đích. Lark XOAY VÒNG refresh token → trả
 * kèm link mới để route ghi lại cookie.
 */
export async function larkTarget(
  account: Account,
  calendarId: string | null,
): Promise<{ at: string; calendarId: string; link: LarkLink; changed: boolean } | null> {
  const tokens = await larkTokenFor(account.link as LarkLink);
  if (!tokens) return null;
  const cal = calendarId || (await larkPrimaryCalendarId(tokens.at));
  if (!cal) return null;
  return { at: tokens.at, calendarId: cal, link: tokens.link, changed: tokens.changed };
}
