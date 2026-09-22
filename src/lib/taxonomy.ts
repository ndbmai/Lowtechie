import { DEFAULT_CATEGORIES, DEFAULT_PROJECTS } from "@/core/projects";

/**
 * Taxonomy thật của Mai (dự án/category tự quản trong app) gửi kèm các
 * request tách lệnh/đọc ảnh, để Claude phân loại đúng danh sách hiện tại.
 */
export interface TaxonomyPayload {
  projects: { id: string; name: string }[];
  categories: { id: string; projectId: string; name: string }[];
}

export function taxonomyText(t: TaxonomyPayload): string {
  return t.projects
    .map((p) => {
      const cats = t.categories.filter((c) => c.projectId === p.id);
      return `- ${p.id} (${p.name}): ${cats.map((c) => `${c.id} "${c.name}"`).join(" | ") || "không có category"}`;
    })
    .join("\n");
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
  if (projects.length === 0) {
    return {
      projects: DEFAULT_PROJECTS.map((p) => ({ id: p.id, name: p.name })),
      categories: DEFAULT_CATEGORIES,
    };
  }
  return { projects, categories };
}
