import type { Project, Task } from "./types";

/**
 * Thống kê cho màn Dự án + Weekly review (PRD §5.10 v2.8): ĐẾM việc
 * xong / trễ / đang mở — không so số giờ vì Mai không bấm giờ làm việc
 * (lỗi thấy 22–23/9: mọi dự án hiện "0h / mục tiêu 12h" gây nhiễu).
 */

export interface ProjectWeekStat {
  project: Project;
  /** Việc xong trong tuần này (từ thứ Hai). */
  doneCount: number;
  /** Việc đang mở đã quá hạn. */
  lateCount: number;
  /** Việc đang mở (todo/doing). */
  openCount: number;
  /** Tuần này có xong việc nào không — false + còn việc mở = không tiến triển. */
  progressed: boolean;
}

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

const isOpen = (t: Task) => t.status === "todo" || t.status === "doing";

export function weekStats(tasks: Task[], projects: Project[], now: Date): ProjectWeekStat[] {
  const weekStart = mondayOf(now).getTime();
  const nowMs = now.getTime();
  const done = new Map<string, number>();
  const late = new Map<string, number>();
  const open = new Map<string, number>();

  for (const t of tasks) {
    if (t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() >= weekStart) {
      done.set(t.projectId, (done.get(t.projectId) ?? 0) + 1);
    } else if (isOpen(t)) {
      open.set(t.projectId, (open.get(t.projectId) ?? 0) + 1);
      if (t.dueAt && new Date(t.dueAt).getTime() < nowMs) {
        late.set(t.projectId, (late.get(t.projectId) ?? 0) + 1);
      }
    }
  }

  // Giữ đúng thứ tự dự án Mai đặt — mostStarved dựa vào thứ tự này.
  return projects.map((p) => {
    const doneCount = done.get(p.id) ?? 0;
    return {
      project: p,
      doneCount,
      lateCount: late.get(p.id) ?? 0,
      openCount: open.get(p.id) ?? 0,
      progressed: doneCount > 0,
    };
  });
}

/**
 * Dự án bị bỏ quên nhất tuần này (để Lowtechie lên tiếng): dự án đứng
 * trên cùng trong thứ tự Mai đặt mà còn việc mở nhưng cả tuần chưa xong
 * việc nào.
 */
export function mostStarved(stats: ProjectWeekStat[]): ProjectWeekStat | undefined {
  return stats.find((s) => s.openCount > 0 && !s.progressed);
}

/**
 * Khoảng "7 ngày tới" theo NGÀY ĐỊA PHƯƠNG (§5.3.3): từ đầu hôm nay đến
 * hết ngày thứ 7 tính từ hôm nay.
 */
export function next7DaysRange(now: Date): { start: number; end: number } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999).getTime(),
  };
}

/** Số đếm cho một ô dự án trên màn Dự án (§5.3.0): mở / quá hạn / 7 ngày. */
export interface ProjectCounts {
  open: number;
  overdue: number;
  due7d: number;
}

export function projectCounts(tasks: Task[], projectId: string, now: Date): ProjectCounts {
  const { start, end } = next7DaysRange(now);
  const nowMs = now.getTime();
  let open = 0;
  let overdue = 0;
  let due7d = 0;
  for (const t of tasks) {
    if (t.projectId !== projectId || !isOpen(t)) continue;
    open++;
    if (t.dueAt) {
      const due = new Date(t.dueAt).getTime();
      if (due < nowMs) overdue++;
      if (due >= start && due <= end) due7d++;
    }
  }
  return { open, overdue, due7d };
}

/** Việc đã dời ≥ 3 lần — weekly review đề xuất Bỏ / Giao / Hoãn. */
export function chronicallyDeferred(tasks: Task[]): Task[] {
  return tasks.filter((t) => isOpen(t) && t.deferCount >= 3);
}

export function weekSummary(tasks: Task[], now: Date): { done: number; deferred: number } {
  const weekStart = mondayOf(now).getTime();
  const done = tasks.filter(
    (t) => t.status === "done" && t.completedAt && new Date(t.completedAt).getTime() >= weekStart,
  ).length;
  const deferred = tasks.filter((t) => t.deferCount > 0 && t.status !== "done").length;
  return { done, deferred };
}
