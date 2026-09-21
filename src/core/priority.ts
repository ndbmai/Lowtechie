import type { Project, Task } from "./types";

/**
 * Điểm ưu tiên (PRD §5.2): deadline (cứng > mềm), trọng số dự án,
 * đang chặn người khác, năng lượng cần. Điểm cao = làm trước.
 */
export function priorityScore(task: Task, project: Project, now: Date): number {
  let score = 0;

  if (task.dueAt) {
    const daysLeft = (new Date(task.dueAt).getTime() - now.getTime()) / 86_400_000;
    // Càng sát hạn điểm càng cao; quá hạn cao nhất.
    const urgency = daysLeft <= 0 ? 10 : Math.max(0, 7 - daysLeft);
    score += urgency * (task.dueType === "hard" ? 1.5 : 1);
  }

  score += project.weight * 5;
  if (task.blocksOthers) score += 3;
  // Việc deep cần được xếp trước để còn giữ block trong lịch.
  if (task.energy === "deep") score += 0.5;

  return score;
}

/** Sắp việc chưa xong theo ưu tiên giảm dần. */
export function rankTasks(tasks: Task[], projects: Project[], now: Date): Task[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return tasks
    .filter((t) => t.status === "todo" || t.status === "doing")
    .slice()
    .sort((a, b) => {
      const pa = priorityScore(a, byId.get(a.projectId) ?? projects[0], now);
      const pb = priorityScore(b, byId.get(b.projectId) ?? projects[0], now);
      return pb - pa;
    });
}
