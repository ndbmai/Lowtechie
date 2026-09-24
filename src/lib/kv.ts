/**
 * Hàng đợi nhỏ trên Upstash Redis (REST, fetch thuần — không SDK) cho bot
 * Lark (§5.5.1 v3.7). App vẫn local-first: server chỉ giữ TẠM các mục bot
 * nhận được trong group cho tới khi app của Mai kéo về Hộp duyệt, rồi xóa.
 *
 * Env: KV_REST_API_URL + KV_REST_API_TOKEN (Upstash qua Vercel Marketplace)
 * hoặc UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash trực tiếp).
 */

function kvEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
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
