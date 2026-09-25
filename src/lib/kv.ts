/**
 * Hàng đợi nhỏ trên Upstash Redis (REST, fetch thuần — không SDK) cho bot
 * Lark (§5.5.1 v3.7). App vẫn local-first: server chỉ giữ TẠM các mục bot
 * nhận được trong group cho tới khi app của Mai kéo về Hộp duyệt, rồi xóa.
 *
 * Env: KV_REST_API_URL + KV_REST_API_TOKEN (Upstash qua Vercel Marketplace)
 * hoặc UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash trực tiếp).
 * Khi nối Storage, Vercel cho đặt TIỀN TỐ tùy ý (ví dụ LOWTECHIE_KV_REST_API_URL)
 * → nhận cả cặp `<tiền tố>_REST_API_URL/_TOKEN`. Chỉ Redis có REST API (Upstash);
 * "Redis" của Redis Cloud chỉ cho REDIS_URL dạng redis:// — không dùng được.
 */

type Env = Record<string, string | undefined>;

export function kvEnvFrom(env: Env): { url: string; token: string } | null {
  const pick = (url?: string, token?: string) =>
    url && token && /^https:\/\//.test(url) ? { url: url.replace(/\/+$/, ""), token } : null;
  const direct =
    pick(env.KV_REST_API_URL, env.KV_REST_API_TOKEN) ??
    pick(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (direct) return direct;
  // Tiền tố tùy ý: chỉ nhận host Upstash, kẻo nhầm biến *_REST_API_URL của dịch vụ khác.
  for (const key of Object.keys(env).sort()) {
    const m = key.match(/^(.+)_(REST_API|REDIS_REST)_URL$/);
    const url = env[key];
    if (!m || !url || !/^https:\/\/[^/]+\.upstash\.io(?:\/|$)/.test(url)) continue;
    const found = pick(url, env[`${m[1]}_${m[2]}_TOKEN`]);
    if (found) return found;
  }
  return null;
}

function kvEnv(): { url: string; token: string } | null {
  return kvEnvFrom(process.env);
}

export function kvConfigured(): boolean {
  return kvEnv() !== null;
}

type Arg = string | number;

/** Một lệnh Redis, ví dụ kv(["HSET", key, field, value]). Lỗi → ném. */
export async function kv<T = unknown>(cmd: Arg[]): Promise<T | null> {
  const env = kvEnv();
  if (!env) throw new Error("kv-off");
  const res = await fetch(env.url, {
    method: "POST",
    headers: { authorization: `Bearer ${env.token}`, "content-type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
    cache: "no-store",
  });
  const d = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok || d.error) throw new Error(`kv-${d.error ?? res.status}`);
  return d.result ?? null;
}

/** HGETALL trả mảng phẳng [k1, v1, k2, v2…] → object. */
export function pairsToRecord(flat: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) out[String(flat[i])] = String(flat[i + 1]);
  return out;
}

export const KV_KEYS = {
  /** Hash message_id → LarkInboxItem (JSON) chờ app kéo về. */
  inbox: "lowtechie:lark:inbox",
  /** open_id của Mai (chủ bot) — nhận lần đầu Mai mở Kiểm tra bot. */
  owner: "lowtechie:lark:owner",
  /** Cấu hình group (chế độ, tên dự án/khách) app đồng bộ lên. */
  groups: "lowtechie:lark:groups",
  /** Sự kiện gần nhất bot nhận được (cho màn Kiểm tra bot). */
  last: "lowtechie:lark:last",
  /** Nhật ký truy vấn: ai hỏi gì, bot trả lời gì (§5.5.2), giữ 200 dòng. */
  log: "lowtechie:lark:log",
  event: (id: string) => `lowtechie:lark:ev:${id}`,
} as const;
