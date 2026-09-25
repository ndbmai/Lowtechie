import type { NextRequest, NextResponse } from "next/server";
import {
  GCAL_COOKIE,
  seal,
  sealFor,
  unseal,
  unsealFor,
  type GoogleLink,
} from "@/lib/googleServer";
import { larkErrorAction, larkKeyMaterial } from "@/lib/larkServer";

/**
 * Sổ đăng ký NHIỀU tài khoản (PRD §5.3.4): mỗi tài khoản một cookie
 * httpOnly mã hóa AES-GCM, server không lưu gì (đúng local-first).
 *
 * - Cookie Google CŨ (`lowtechie_g`) được giữ nguyên tên + khóa và đọc
 *   thành tài khoản id "g0" — Mai KHÔNG phải nối lại sau bản này.
 * - Tài khoản thêm sau: `lta_g_<slot>` (Google, khóa cũ) và
 *   `lta_l_<slot>` (Lark, khóa dẫn xuất từ LARK_APP_SECRET).
 */

export interface AccountParts {
  cal: boolean;
  mail: boolean;
  drive: boolean;
}

export const DEFAULT_PARTS: AccountParts = { cal: true, mail: true, drive: true };

export interface LarkLink {
  /** Refresh token của Lark — MỖI LẦN refresh Lark cấp cái mới (xoay vòng). */
  rt: string;
  email?: string;
  /** open_id của người dùng trong app — bot nhận ra Mai (chủ bot) nhờ id này. */
  openId?: string;
  /**
   * Access token còn hạn (~2 giờ) + hạn của nó — dùng lại thay vì refresh
   * mỗi request (refresh song song làm "phiên hết hạn", lỗi thật 25/9).
   */
  at?: string;
  atExp?: number;
  parts?: AccountParts;
}

export interface Account {
  /** "g0" = cookie Google cũ; còn lại là slot trong tên cookie. */
  id: string;
  provider: "google" | "lark";
  email?: string;
  /** Google: đã có quyền đọc Gmail chưa. Lark luôn true (quyền theo app). */
  gm: boolean;
  parts: AccountParts;
  /** Link gốc đã giải mã — dùng nội bộ server, không trả về client. */
  link: GoogleLink | LarkLink;
}

export const LEGACY_GOOGLE_ID = "g0";
const GOOGLE_PREFIX = "lta_g_";
const LARK_PREFIX = "lta_l_";

export function cookieNameFor(id: string, provider: "google" | "lark"): string {
  if (id === LEGACY_GOOGLE_ID) return GCAL_COOKIE;
  return (provider === "google" ? GOOGLE_PREFIX : LARK_PREFIX) + id;
}

export function newSlotId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function normalizeParts(p: AccountParts | undefined): AccountParts {
  return p ? { cal: !!p.cal, mail: !!p.mail, drive: !!p.drive } : { ...DEFAULT_PARTS };
}

/** Đọc TẤT CẢ tài khoản từ cookies của request (cookie hỏng thì bỏ qua). */
export async function readAccounts(req: NextRequest): Promise<Account[]> {
  const out: Account[] = [];

  const legacy = await unseal(req.cookies.get(GCAL_COOKIE)?.value);
  if (legacy) {
    out.push({
      id: LEGACY_GOOGLE_ID,
      provider: "google",
      email: legacy.email,
      gm: Boolean(legacy.gm),
      parts: normalizeParts(legacy.parts),
      link: legacy,
    });
  }

  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith(GOOGLE_PREFIX)) {
      const link = await unseal(c.value);
      if (link) {
        out.push({
          id: c.name.slice(GOOGLE_PREFIX.length),
          provider: "google",
          email: link.email,
          gm: Boolean(link.gm),
          parts: normalizeParts(link.parts),
          link,
        });
      }
    } else if (c.name.startsWith(LARK_PREFIX)) {
      const link = await unsealFor<LarkLink>(larkKeyMaterial(), c.value);
      if (link && typeof link.rt === "string" && link.rt) {
        out.push({
          id: c.name.slice(LARK_PREFIX.length),
          provider: "lark",
          email: link.email,
          gm: true,
          parts: normalizeParts(link.parts),
          link,
        });
      }
    }
  }
  return out;
}

export function findAccount(accounts: Account[], id: string | undefined | null): Account | undefined {
  return id ? accounts.find((a) => a.id === id) : undefined;
}

/** Các tài khoản đang bật một phần cụ thể (Lịch/Mail/Drive). */
export function accountsWith(accounts: Account[], part: keyof AccountParts): Account[] {
  return accounts.filter((a) => a.parts[part]);
}

function cookieOptions(origin: string) {
  return {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
  };
}

/** Trình duyệt bỏ lặng cookie quá ~4 KB — chừa chỗ cho tên + thuộc tính. */
const MAX_COOKIE_VALUE = 3700;

/**
 * Giá trị cookie Lark đã mã hóa. Access token cất kèm cho đỡ refresh (25/9)
 * nhưng token Lark v2 có thể dài: vượt ngưỡng thì BỎ access token (rơi về
 * refresh mỗi request) — mất cookie là mất đăng nhập, tệ hơn nhiều.
 */
export async function sealLarkLink(link: LarkLink): Promise<string> {
  const full = await sealFor(larkKeyMaterial(), link);
  if (full.length <= MAX_COOKIE_VALUE || !link.at) return full;
  const { at: _at, atExp: _atExp, ...slim } = link;
  return sealFor(larkKeyMaterial(), slim);
}

/** Ghi (tạo/cập nhật) cookie của một tài khoản lên response. */
export async function writeAccount(
  res: NextResponse,
  origin: string,
  id: string,
  provider: "google" | "lark",
  link: GoogleLink | LarkLink,
): Promise<void> {
  const value = provider === "google" ? await seal(link as GoogleLink) : await sealLarkLink(link as LarkLink);
  res.cookies.set(cookieNameFor(id, provider), value, cookieOptions(origin));
}

export function deleteAccountCookie(res: NextResponse, id: string, provider: "google" | "lark"): void {
  res.cookies.delete(cookieNameFor(id, provider));
}

/**
 * Lỗi đồng bộ → thông điệp CÓ VIỆC ĐỂ LÀM (PRD v3.2 — "không hiện sự kiện"
 * phải nói rõ vì sao và bấm gì, không im lặng trả lịch trống).
 */
export function accountErrorAction(provider: "google" | "lark", detail: string): string {
  if (provider === "lark") return larkErrorAction(detail);
  if (detail === "token" || detail.includes("401"))
    return "Phiên đăng nhập Google hết hạn — bấm Kết nối lại.";
  if (detail.includes("403"))
    return "Google từ chối quyền lịch — bấm Kết nối lại và cấp lại quyền Calendar.";
  return "Google báo lỗi — bấm Đồng bộ ngay thử lại, còn lỗi thì Kết nối lại.";
}

/** Dạng an toàn trả về client — KHÔNG kèm token. */
export function publicAccount(a: Account): {
  id: string;
  provider: "google" | "lark";
  email?: string;
  gmail: boolean;
  parts: AccountParts;
} {
  return { id: a.id, provider: a.provider, email: a.email, gmail: a.gm, parts: a.parts };
}
