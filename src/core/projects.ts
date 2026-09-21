import type { Project, ProjectId } from "./types";

/** Quỹ giờ có chủ đích mỗi tuần để quy trọng số → giờ mục tiêu. */
export const WEEKLY_CAPACITY_HOURS = 40;

/**
 * Dự án mặc định (PRD §5.3) với màu cố định từ mockup.
 * Trọng số ví dụ trong PRD: Sorene 40%, Circle 30%…, Mai chỉnh trong app.
 */
export const DEFAULT_PROJECTS: Project[] = [
  { id: "sorene", name: "Sorene", color: "#8B7BFF", weight: 0.4, targetHoursPerWeek: 16, goal: "Pitch deck + gọi vốn" },
  { id: "circle", name: "Circle", color: "#1FA9B8", weight: 0.3, targetHoursPerWeek: 12, goal: "Tư vấn AI — Bangkok, HCMC, Tokyo" },
  { id: "favstay", name: "Favstay", color: "#FF8A5B", weight: 0.2, targetHoursPerWeek: 8, goal: "Revenue management 150+ khách sạn" },
  { id: "edge", name: "Edge", color: "#3D62E0", weight: 0.1, targetHoursPerWeek: 4, goal: "Newsletter ~10k subscriber" },
  { id: "canhan", name: "Cá nhân", color: "#FF7FA8", weight: 0, targetHoursPerWeek: 0, goal: "Spa, sức khỏe, giấy tờ" },
  { id: "hoctap", name: "Học tập", color: "#7C9A3E", weight: 0, targetHoursPerWeek: 0, goal: "Tiếng Thái mỗi ngày" },
];

export function projectById(projects: Project[], id: ProjectId): Project {
  return projects.find((p) => p.id === id) ?? projects[0];
}
