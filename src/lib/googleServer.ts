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

/** Đọc + ghi sự kiện (sensitive, không phải restricted) + email hiển thị. */
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"].join(" ");

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

async function aesKey(): Promise<CryptoKey> {
  const material = new TextEncoder().encode(
    `lowtechie-cookie::${process.env.GOOGLE_CLIENT_SECRET ?? ""}`,
  );
  const hash = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface GoogleLink {
  /** Refresh token của Google. */
  rt: string;
  email?: string;
}

export async function seal(link: GoogleLink): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(link)),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64url(out);
}

export async function unseal(value: string | undefined): Promise<GoogleLink | null> {
  if (!value) return null;
  try {
    const bytes = fromB64url(value);
    const key = await aesKey();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    const parsed = JSON.parse(new TextDecoder().decode(pt)) as GoogleLink;
    return typeof parsed.rt === "string" && parsed.rt ? parsed : null;
  } catch {
    // Cookie cũ/hỏng hoặc GOOGLE_CLIENT_SECRET đã đổi → coi như chưa nối.
    return null;
  }
}

// ── OAuth ────────────────────────────────────────────────────────────────

export function redirectUri(origin: string): string {
  return `${origin}/api/google/callback`;
}

export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Bắt buộc để Google cấp refresh_token cả khi Mai đã đồng ý trước đó.
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${p}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
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
  return { link: { rt: data.refresh_token, email } };
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
