import { DEFAULT_CATEGORIES, DEFAULT_PROJECTS } from "@/core/projects";

/**
 * Taxonomy thật của Mai (dự án/category/danh bạ khách tự quản trong app)
 * gửi kèm các request tách lệnh/đọc ảnh, để Claude phân loại đúng danh
 * sách hiện tại và điền khách hàng theo danh bạ (§5.3.2).
 */
export interface TaxonomyPayload {
  projects: { id: string; name: string }[];
  categories: { id: string; projectId: string; name: string }[];
  clients: { id: string; name: string; aliases: string[]; projectIds: string[] }[];
}

export function taxonomyText(t: TaxonomyPayload): string {
  const lines = t.projects.map((p) => {
    const cats = t.categories.filter((c) => c.projectId === p.id);
    return `- ${p.id} (${p.name}): ${cats.map((c) => `${c.id} "${c.name}"`).join(" | ") || "không có category"}`;
  });
  if (t.clients.length) {
    lines.push("Danh bạ khách hàng/đối tác (id — tên, tên gọi tắt, thuộc dự án):");
    for (const c of t.clients) {
      lines.push(
        `- ${c.id} — "${c.name}"${c.aliases.length ? ` (gọi tắt: ${c.aliases.join(", ")})` : ""} · dự án: ${c.projectIds.join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

/** Đọc taxonomy từ body request; thiếu/hỏng thì rơi về seed mặc định. */
export function readTaxonomy(raw: unknown): TaxonomyPayload {
  const t = raw as Partial<TaxonomyPayload> | undefined;
  const projects = Array.isArray(t?.projects)
    ? t.projects.filter((p) => typeof p?.id === "string" && typeof p?.name === "string").slice(0, 40)
    : [];
  const categories = Array.isArray(t?.categories)
    ? t.categories
        .filter(
          (c) =>
            typeof c?.id === "string" &&
            typeof c?.projectId === "string" &&
            typeof c?.name === "string",
        )
        .slice(0, 200)
    : [];
  const clients = Array.isArray(t?.clients)
    ? t.clients
        .filter((c) => typeof c?.id === "string" && typeof c?.name === "string")
        .map((c) => ({
          id: c.id,
          name: c.name,
          aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === "string").slice(0, 12) : [],
          projectIds: Array.isArray(c.projectIds)
            ? c.projectIds.filter((p) => typeof p === "string").slice(0, 20)
            : [],
        }))
        .slice(0, 120)
    : [];
  if (projects.length === 0) {
    return {
      projects: DEFAULT_PROJECTS.map((p) => ({ id: p.id, name: p.name })),
      categories: DEFAULT_CATEGORIES,
      clients,
    };
  }
  return { projects, categories, clients };
}
