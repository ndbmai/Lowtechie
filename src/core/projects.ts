import type { Category, Project, ProjectId } from "./types";

/** Quỹ giờ có chủ đích mỗi tuần để quy trọng số → giờ mục tiêu. */
export const WEEKLY_CAPACITY_HOURS = 40;

/**
 * Dự án mặc định (PRD §5.3 + Admin chung từ bảng category §5.2.1)
 * với màu cố định từ mockup; màu Admin chung và Học tập là màu chọn thêm.
 * Trọng số ví dụ trong PRD: Sorene 40%, Circle 30%…, Mai chỉnh trong app.
 */
export const DEFAULT_PROJECTS: Project[] = [
  { id: "sorene", name: "Sorene", color: "#8B7BFF", weight: 0.4, targetHoursPerWeek: 16, goal: "Pitch deck + gọi vốn" },
  { id: "circle", name: "Circle", color: "#1FA9B8", weight: 0.3, targetHoursPerWeek: 12, goal: "Tư vấn AI — Bangkok, HCMC, Tokyo" },
  { id: "favstay", name: "Favstay", color: "#FF8A5B", weight: 0.2, targetHoursPerWeek: 8, goal: "Revenue management 150+ khách sạn" },
  { id: "edge", name: "Edge", color: "#3D62E0", weight: 0.1, targetHoursPerWeek: 4, goal: "Newsletter ~10k subscriber" },
  { id: "canhan", name: "Cá nhân", color: "#FF7FA8", weight: 0, targetHoursPerWeek: 0, goal: "Spa, sức khỏe, giấy tờ" },
  { id: "hoctap", name: "Học tập", color: "#7C9A3E", weight: 0, targetHoursPerWeek: 0, goal: "Tiếng Thái mỗi ngày" },
  { id: "admin", name: "Admin chung", color: "#7D8AA5", weight: 0, targetHoursPerWeek: 0, goal: "Thuế, hóa đơn, công cụ" },
];

/**
 * Category mặc định theo bảng PRD §5.2.1. Quyết định của Mai (21/9/2026):
 * Học tập là DỰ ÁN RIÊNG với category Tiếng Thái — không phải category
 * dưới Cá nhân.
 */
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
  { id: "favstay:vanhanh", projectId: "favstay", name: "Khách sạn & vận hành" },
  { id: "favstay:ota", projectId: "favstay", name: "OTA" },
  { id: "favstay:marketing", projectId: "favstay", name: "Marketing" },
  { id: "favstay:doitac", projectId: "favstay", name: "Đối tác" },
  { id: "edge:vietbai", projectId: "edge", name: "Viết bài" },
  { id: "edge:phanphoi", projectId: "edge", name: "Phân phối" },
  { id: "edge:congdong", projectId: "edge", name: "Cộng đồng" },
  { id: "canhan:suckhoe", projectId: "canhan", name: "Sức khỏe & làm đẹp" },
  { id: "canhan:chuyendi", projectId: "canhan", name: "Chuyến đi" },
  { id: "canhan:nhacua", projectId: "canhan", name: "Nhà cửa" },
  { id: "canhan:giayto", projectId: "canhan", name: "Giấy tờ & tài chính cá nhân" },
  { id: "hoctap:tiengthai", projectId: "hoctap", name: "Tiếng Thái" },
  { id: "admin:thue", projectId: "admin", name: "Thuế & hạn pháp lý" },
  { id: "admin:hoadon", projectId: "admin", name: "Hóa đơn" },
  { id: "admin:congcu", projectId: "admin", name: "Công cụ & tài khoản" },
];

export function projectById(projects: Project[], id: ProjectId): Project {
  return projects.find((p) => p.id === id) ?? projects[0];
}

export function categoriesFor(projectId: ProjectId): Category[] {
  return DEFAULT_CATEGORIES.filter((c) => c.projectId === projectId);
}

export function categoryName(categoryId: string | undefined): string | undefined {
  return DEFAULT_CATEGORIES.find((c) => c.id === categoryId)?.name;
}
