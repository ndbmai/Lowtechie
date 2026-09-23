import type { Project, Task } from "./types";

/**
 * Điểm ưu tiên (PRD §5.2 v2.8): deadline (cứng > mềm), THỨ TỰ dự án do
 * Mai sắp xếp (không còn trọng số giờ — Mai không bấm giờ), đang chặn
 * người khác, năng lượng cần. Điểm cao = làm trước.
 */
export function priorityScore(task: Task, now: Date, projectBoost = 0): number {
  let score = 0;

  if (task.dueAt) {
    const daysLeft = (new Date(task.dueAt).getTime() - now.getTime()) / 86_400_000;
    // Càng sát hạn điểm càng cao; quá hạn cao nhất.
    const urgency = daysLeft <= 0 ? 10 : Math.max(0, 7 - daysLeft);
    score += urgency * (task.dueType === "hard" ? 1.5 : 1);
  }

  score += projectBoost;
  if (task.blocksOthers) score += 3;
  // Việc deep cần được xếp trước để còn giữ block trong lịch.
  if (task.energy === "deep") score += 0.5;

  return score;
}

/**
 * Điểm cộng theo vị trí dự án trong danh sách Mai đặt (§5.3.1): dự án
 * đứng đầu +2, giảm dần về 0 — deadline sát vẫn luôn thắng thứ tự.
 */
export function projectOrderBoost(projects: Project[]): (projectId: string) => number {
  const order = new Map(projects.map((p, i) => [p.id, i]));
  const n = Math.max(1, projects.length);
  return (projectId) => {
    const idx = order.get(projectId);
    return idx === undefined ? 0 : ((n - idx) / n) * 2;
  };
}

/** Sắp việc chưa xong theo ưu tiên giảm dần. */
export function rankTasks(tasks: Task[], projects: Project[], now: Date): Task[] {
  const boost = projectOrderBoost(projects);
  return tasks
    .filter((t) => t.status === "todo" || t.status === "doing")
    .slice()
    .sort(
      (a, b) =>
        priorityScore(b, now, boost(b.projectId)) - priorityScore(a, now, boost(a.projectId)),
    );
}
