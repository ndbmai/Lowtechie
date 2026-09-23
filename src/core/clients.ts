import type { Client, Project, ProjectId } from "./types";

/**
 * Danh bạ khách hàng / đối tác theo dự án (PRD §5.3.2).
 *
 * Khách hàng là TRƯỜNG RIÊNG của việc, không phải category. Khi trích
 * việc, tên trong nội dung (kể cả tên gọi tắt) được so với danh bạ để
 * điền khách hàng; tên chưa có trong danh bạ thì KHÔNG đoán — Mai tạo
 * mới ngay trong thẻ duyệt nếu muốn.
 */

function norm(s: string): string {
  return s.normalize("NFC").toLowerCase().trim();
}

/**
 * Chuẩn hóa tên để TÌM và CHỐNG TRÙNG (v2.3): bỏ dấu, thường hóa, gộp
 * khoảng trắng — "do thi", "đô thị", "Đô  Thị " đều thành "do thi".
 */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tìm khách theo tên gõ tay (không phân biệt hoa/thường/dấu, so cả tên
 * gọi tắt) — dùng để KHÔNG tạo trùng khi Mai nhập lại "Đô Thị" (v2.3).
 */
export function findClientByName(clients: Client[], raw: string): Client | undefined {
  const q = foldName(raw);
  if (!q) return undefined;
  return clients.find((c) => foldName(c.name) === q || c.aliases.some((a) => foldName(a) === q));
}

/**
 * Thứ tự gợi ý ô Khách hàng (v2.3): vừa dùng gần đây → hay dùng nhất →
 * còn lại theo thứ tự Mai đặt.
 */
export function orderClientsForPick(clients: Client[]): Client[] {
  const recent = clients
    .filter((c) => c.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
  const frequent = clients
    .filter((c) => !c.lastUsedAt && (c.useCount ?? 0) > 0)
    .sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0));
  const rest = clients.filter((c) => !c.lastUsedAt && !(c.useCount ?? 0));
  return [...recent, ...frequent, ...rest];
}

/** Khách đang dùng được cho một dự án (đã kết thúc vẫn chọn được để tra cứu). */
export function clientsFor(clients: Client[], projectId: ProjectId): Client[] {
  return clients.filter((c) => c.projectIds.includes(projectId));
}

export function clientById(clients: Client[], id: string | undefined): Client | undefined {
  return id ? clients.find((c) => c.id === id) : undefined;
}

/**
 * Tìm khách hàng được nhắc trong câu/tiêu đề, TRẢ KÈM cụm chữ đã khớp —
 * cho dòng «nhận từ "đô thị"» trên thẻ duyệt (§5.3.2 v2.8). So tên +
 * tên gọi tắt, chặn biên bằng khoảng trắng (không dùng \b — hỏng cạnh
 * dấu tiếng Việt). Ưu tiên tên khớp DÀI nhất để "Đô thị Xanh" thắng
 * "Đô thị".
 */
export function matchClientDetail(
  text: string,
  clients: Client[],
): { client: Client; term: string } | undefined {
  const t = ` ${norm(text)} `;
  let best: { client: Client; term: string; len: number } | undefined;
  for (const c of clients) {
    for (const name of [c.name, ...c.aliases]) {
      const n = norm(name);
      if (n.length < 2) continue;
      if (t.includes(` ${n} `) || t.includes(` ${n},`) || t.includes(` ${n}.`)) {
        if (!best || n.length > best.len) best = { client: c, term: n, len: n.length };
      }
    }
  }
  return best ? { client: best.client, term: best.term } : undefined;
}

export function matchClient(text: string, clients: Client[]): Client | undefined {
  return matchClientDetail(text, clients)?.client;
}

/**
 * Học cách gọi mới từ lần Mai gõ/sửa ô khách hàng (§5.3.2 v2.8): trả
 * danh sách tên gọi mới nếu `raw` chưa trùng tên/tên gọi nào đã có
 * (so không phân biệt hoa/thường + khoảng trắng, NHƯNG phân biệt dấu —
 * "do thi" không dấu đáng học để lần sau nhận từ voice/ảnh); trả null
 * khi không có gì mới.
 */
export function withLearnedAlias(c: Client, raw: string): string[] | null {
  const r = raw.replace(/\s+/g, " ").trim();
  if (r.length < 2 || r.length > 40) return null;
  const key = (s: string) => norm(s).replace(/\s+/g, " ");
  const q = key(r);
  if (key(c.name) === q || c.aliases.some((a) => key(a) === q)) return null;
  // Giữ tối đa 12 tên gọi, bỏ bớt cái cũ nhất.
  return [...c.aliases, r].slice(-12);
}

/**
 * Kiểm tra clientId do phân loại/Claude trả về: phải có trong danh bạ;
 * nếu khách không thuộc dự án cuối cùng của việc thì vẫn giữ (một việc
 * có thể tạm nằm dự án khác trước khi Mai sửa), chỉ id lạ mới bị bỏ.
 */
export function sanitizeClientId(
  clients: Client[],
  clientId: string | undefined,
): string | undefined {
  return clients.some((c) => c.id === clientId) ? clientId : undefined;
}

/**
 * Tín hiệu phân loại từ khách hàng (PRD §5.2.1): tên khách trong tiêu đề
 * khớp danh bạ → gợi ý dự án của khách đó khi phân loại đang phân vân.
 */
export function clientProjectHint(
  client: Client | undefined,
  projects: Project[],
): ProjectId | undefined {
  if (!client) return undefined;
  const live = client.projectIds.filter((pid) =>
    projects.some((p) => p.id === pid && p.status !== "archived"),
  );
  return live[0];
}

/** Slug id khách mới, không trùng. */
export function makeClientId(name: string, existing: Client[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "khach";
  let id = `kh:${base}`;
  let n = 2;
  while (existing.some((c) => c.id === id)) id = `kh:${base}${n++}`;
  return id;
}
