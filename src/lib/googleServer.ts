/**
 * Nối Google Calendar (PRD §5.4) — chỉ chạy phía server (route handlers).
 *
 * Kiến trúc local-first, không có database: refresh token được MÃ HÓA
 * (AES-GCM, khóa dẫn xuất từ GOOGLE_CLIENT_SECRET) và nằm trong cookie
 * httpOnly của trình duyệt Mai. Mỗi thiết bị tự nối, server không giữ gì.
 */

export const GCAL_COOKIE = "lowtechie_g";
export const STATE_COOKIE = "lowtechie_gs";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * calendar.events: đọc + ghi sự kiện (§5.4). gmail.readonly: đọc email
 * vé máy bay để tạo chuyến đi (§5.9) — scope restricted, chạy được ở
 * chế độ Testing với test user. openid+email: hiển thị tài khoản.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
].join(" ");

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ── Mã hóa cookie ────────────────────────────────────────────────────────

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function aesKeyFor(material: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Khóa cho cookie Google — GIỮ NGUYÊN cách dẫn xuất cũ để cookie đã nối vẫn đọc được. */
function googleKeyMaterial(): string {
  return `lowtechie-cookie::${process.env.GOOGLE_CLIENT_SECRET ?? ""}`;
}

/** Mã hóa/giải mã JSON bất kỳ theo khóa dẫn xuất từ chuỗi bí mật (đa tài khoản v3.0). */
export async function sealFor(material: string, obj: unknown): Promise<string> {
  const key = await aesKeyFor(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out);
}

export async function unsealFor<T>(material: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  try {
    const bytes = fromB64url(value);
    const key = await aesKeyFor(material);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch {
    // Cookie cũ/hỏng hoặc secret đã đổi → coi như chưa nối.
    return null;
  }
}

export interface GoogleLink {
  /** Refresh token của Google. */
  rt: string;
  email?: string;
  /** Đã cấp quyền đọc Gmail chưa (cookie cũ nối trước khi thêm scope thì chưa). */
  gm?: boolean;
  /** Bật/tắt từng phần của tài khoản (§5.3.4) — thiếu = bật hết. */
  parts?: { cal: boolean; mail: boolean; drive: boolean };
}

export async function seal(link: GoogleLink): Promise<string> {
  return sealFor(googleKeyMaterial(), link);
}

export async function unseal(value: string | undefined): Promise<GoogleLink | null> {
  const parsed = await unsealFor<GoogleLink>(googleKeyMaterial(), value);
  return parsed && typeof parsed.rt === "string" && parsed.rt ? parsed : null;
}

// ── OAuth ────────────────────────────────────────────────────────────────

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function authUrl(origin: string, state: string, pickAccount = false): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // "consent" bắt buộc để Google cấp refresh_token cả khi đã đồng ý trước;
    // thêm select_account khi Mai nối TÀI KHOẢN NỮA (§5.3.4) để chọn đúng hộp.
    prompt: pickAccount ? "consent select_account" : "consent",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  /** Danh sách scope Google THẬT SỰ cấp (Mai có thể bỏ tick từng quyền). */
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Đổi code lấy refresh token + email (từ id_token, do Google trả trực tiếp). */
export async function exchangeCode(
  code: string,
  origin: string,
): Promise<{ link: GoogleLink } | { error: string }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.refresh_token) {
    return { error: data.error_description ?? data.error ?? `HTTP ${res.status}` };
  }
  let email: string | undefined;
  if (data.id_token) {
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(fromB64url(data.id_token.split(".")[1])),
      ) as { email?: string };
      email = payload.email;
    } catch {
      /* không có email cũng không sao */
    }
  }
  const gm = (data.scope ?? "").includes(GMAIL_SCOPE);
  return { link: { rt: data.refresh_token, email, gm } };
}

/** Refresh token → access token dùng ngay (không cache, mỗi request một lần). */
export async function accessToken(link: GoogleLink): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: link.rt,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  return res.ok && data.access_token ? data.access_token : null;
}

export async function revoke(link: GoogleLink): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(link.rt)}`, { method: "POST" });
  } catch {
    /* revoke lỗi thì cookie vẫn bị xóa phía ta */
  }
}
