import type { Category, Project, ProjectId } from "./types";

/**
 * Dự án khởi tạo — Mai tự thêm/sửa/xóa trong app (Dự án → Quản lý),
 * đây chỉ là seed cho thiết bị mới. Quyết định của Mai (22/9/2026):
 * bỏ Favstay và Edge khỏi danh sách. Không còn mục tiêu giờ/tuần (v2.8):
 * ưu tiên giữa dự án tính theo THỨ TỰ Mai sắp xếp danh sách này.
 */
export const DEFAULT_PROJECTS: Project[] = [
  { id: "sorene", name: "Sorene", color: "#8B7BFF", goal: "Pitch deck + gọi vốn" },
  { id: "circle", name: "Circle", color: "#1FA9B8", goal: "Tư vấn AI — Bangkok, HCMC, Tokyo" },
  { id: "canhan", name: "Cá nhân", color: "#FF7FA8", goal: "Spa, sức khỏe, giấy tờ" },
  { id: "hoctap", name: "Học tập", color: "#9BC53D", goal: "Tiếng Thái + khóa học" },
  { id: "admin", name: "Admin chung", color: "#8A8FB0", goal: "Thuế, hóa đơn, công cụ" },
];

/** Bảng màu cho dự án mới (PRD §6.1: dự án tự thêm chọn từ bảng có sẵn). */
export const PROJECT_COLORS = [
  "#8B7BFF",
  "#1FA9B8",
  "#9BC53D",
  "#FF7FA8",
  "#8A8FB0",
  "#FF8A5B",
  "#3D62E0",
  "#E0A13D",
  "#C25FA3",
  "#4C9F8B",
];

/** Category khởi tạo theo bảng PRD §5.2.1 (đã bỏ Favstay/Edge). */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "sorene:sanpham", projectId: "sorene", name: "Sản phẩm" },
  { id: "sorene:goivon", projectId: "sorene", name: "Gọi vốn" },
  { id: "sorene:tangtruong", projectId: "sorene", name: "Tăng trưởng & cohort" },
  { id: "sorene:phaply", projectId: "sorene", name: "Pháp lý & công ty" },
  { id: "circle:banhang", projectId: "circle", name: "Khách hàng & bán hàng" },
  { id: "circle:delivery", projectId: "circle", name: "Delivery dự án" },
  { id: "circle:daotao", projectId: "circle", name: "Đào tạo" },
  { id: "circle:marketing", projectId: "circle", name: "Marketing & nội dung" },
  { id: "circle:hopdong", projectId: "circle", name: "Hợp đồng" },
  { id: "canhan:suckhoe", projectId: "canhan", name: "Sức khỏe & làm đẹp" },
  { id: "canhan:chuyendi", projectId: "canhan", name: "Chuyến đi" },
  { id: "canhan:nhacua", projectId: "canhan", name: "Nhà cửa" },
  { id: "canhan:giayto", projectId: "canhan", name: "Giấy tờ & tài chính cá nhân" },
  { id: "hoctap:tiengthai", projectId: "hoctap", name: "Tiếng Thái" },
  { id: "hoctap:khoahoc", projectId: "hoctap", name: "Khóa học & chứng chỉ" },
  { id: "hoctap:nghiencuu", projectId: "hoctap", name: "Đọc & nghiên cứu" },
  { id: "admin:thue", projectId: "admin", name: "Thuế & hạn pháp lý" },
  { id: "admin:hoadon", projectId: "admin", name: "Hóa đơn" },
  { id: "admin:congcu", projectId: "admin", name: "Công cụ & tài khoản" },
];

export function projectById(projects: Project[], id: ProjectId): Project {
  return projects.find((p) => p.id === id) ?? projects[0];
}

/** Dự án đang hoạt động — dự án lưu trữ ẩn khỏi mọi màn chính (§5.3.1). */
export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status !== "archived");
}

export function categoriesFor(categories: Category[], projectId: ProjectId): Category[] {
  return categories.filter((c) => c.projectId === projectId);
}

export function categoryName(
  categories: Category[],
  categoryId: string | undefined,
): string | undefined {
  return categories.find((c) => c.id === categoryId)?.name;
}

/** Dự án rơi về khi id không còn tồn tại: Cá nhân, hoặc dự án đầu tiên. */
export function fallbackProjectId(projects: Project[]): ProjectId {
  const live = activeProjects(projects);
  return live.find((p) => p.id === "canhan")?.id ?? live[0]?.id ?? projects[0]?.id ?? "canhan";
}

/**
 * Kiểm tra id do phân loại/Claude trả về so với taxonomy thật của Mai —
 * dự án đã xóa/lưu trữ thì rơi về Cá nhân, category lạ thì bỏ.
 */
export function sanitizeTaxonomy(
  projects: Project[],
  categories: Category[],
  projectId: ProjectId | undefined,
  categoryId: string | undefined,
): { projectId: ProjectId; categoryId?: string } {
  const live = activeProjects(projects);
  const pid =
    projectId && live.some((p) => p.id === projectId)
      ? projectId
      : fallbackProjectId(projects);
  const cat = categories.find((c) => c.id === categoryId && c.projectId === pid);
  return { projectId: pid, categoryId: cat?.id };
}

/** Slug không dấu, chữ thường cho id mới. */
function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) || "duan"
  );
}

export function makeProjectId(name: string, existing: Project[]): ProjectId {
  const base = slug(name);
  let id = base;
  let n = 2;
  while (existing.some((p) => p.id === id)) id = `${base}${n++}`;
  return id;
}

export function makeCategoryId(
  projectId: ProjectId,
  name: string,
  existing: Category[],
): string {
  const base = `${projectId}:${slug(name)}`;
  let id = base;
  let n = 2;
  while (existing.some((c) => c.id === id)) id = `${base}${n++}`;
  return id;
}
