import type { Project, Task } from "./types";

/**
 * Thống kê tuần cho màn Dự án + Weekly review (PRD §5.10): thời gian
 * ước tính đã hoàn thành so với mục tiêu, và việc bị dời nhiều lần.
 * v1 xấp xỉ "thời gian đã dùng" = tổng estMinutes của việc xong trong tuần.
 */

export interface ProjectWeekStat {
  project: Project;
  doneHours: number;
  targetHours: number;
  /** < 0.5 sau nửa tuần → dự án đang bị bỏ đói. */
  ratio: number;
}

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function weekStats(tasks: Task[], projects: Project[], now: Date): ProjectWeekStat[] {
  const weekStart = mondayOf(now).getTime();
  const spent = new Map<string, number>();

  for (const t of tasks) {
    if (t.status !== "done" || !t.completedAt) continue;
    if (new Date(t.completedAt).getTime() < weekStart) continue;
    spent.set(t.projectId, (spent.get(t.projectId) ?? 0) + (t.estMinutes ?? 30));
  }

  return projects.map((p) => {
    const doneHours = (spent.get(p.id) ?? 0) / 60;
    return {
      project: p,
      doneHours,
      targetHours: p.targetHoursPerWeek,
      ratio: p.targetHoursPerWeek > 0 ? doneHours / p.targetHoursPerWeek : 0,
    };
  });
}

/** Dự án bị bỏ đói nhất tuần này (để Lowtechie lên tiếng). */
export function mostStarved(stats: ProjectWeekStat[]): ProjectWeekStat | undefined {
  return stats
    .filter((s) => s.targetHours > 0)
    .sort((a, b) => a.ratio - b.ratio)[0];
}

/** Việc đã dời ≥ 3 lần — weekly review đề xuất Bỏ / Giao / Hoãn. */
export function chronicallyDeferred(tasks: Task[]): Task[] {
  return tasks.filter(
    (t) => (t.status === "todo" || t.status === "doing") && t.deferCount >= 3,
  );
}

export function weekSummary(tasks: Task[], now: Date): { done: number; deferred: number } {
  const weekStart = mondayOf(now).getTime();
  const done = tasks.filter(
    (t) => t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() >= weekStart,
  ).length;
  const deferred = tasks.filter((t) => t.deferCount > 0 && t.status !== "done").length;
  return { done, deferred };
}
