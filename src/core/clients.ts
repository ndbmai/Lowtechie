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

/** Khách đang dùng được cho một dự án (đã kết thúc vẫn chọn được để tra cứu). */
export function clientsFor(clients: Client[], projectId: ProjectId): Client[] {
  return clients.filter((c) => c.projectIds.includes(projectId));
}

export function clientById(clients: Client[], id: string | undefined): Client | undefined {
  return id ? clients.find((c) => c.id === id) : undefined;
}

/**
 * Tìm khách hàng được nhắc trong câu/tiêu đề: so tên + tên gọi tắt,
 * chặn biên bằng khoảng trắng (không dùng \b — hỏng cạnh dấu tiếng Việt).
 * Ưu tiên tên khớp DÀI nhất để "Đô thị Xanh" thắng "Đô thị".
 */
export function matchClient(text: string, clients: Client[]): Client | undefined {
  const t = ` ${norm(text)} `;
  let best: { client: Client; len: number } | undefined;
  for (const c of clients) {
    for (const name of [c.name, ...c.aliases]) {
      const n = norm(name);
      if (n.length < 2) continue;
      if (t.includes(` ${n} `) || t.includes(` ${n},`) || t.includes(` ${n}.`)) {
        if (!best || n.length > best.len) best = { client: c, len: n.length };
      }
    }
  }
  return best?.client;
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
