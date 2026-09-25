import type { CalEvent, Project, Task } from "./types";
import { unbookedSoon } from "./booking";
import { rankTasks } from "./priority";
import { next7DaysRange } from "./stats";

/**
 * Brief sáng (PRD §5.10): lịch hôm nay, top 3 việc, đang chờ người khác,
 * deadline 7 ngày. KHÔNG tự gợi ý giữ chỗ deep work nữa (Mai 25/9).
 */

export interface MorningBrief {
  greeting: string;
  top: Task[];
  waiting: Task[];
  deadlines7d: Task[];
  todayEvents: CalEvent[];
  /** Lịch 7 ngày tới CHƯA đặt chỗ (§5.4.2 v3.7) — "2 lịch tuần này chưa đặt chỗ". */
  unbooked: CalEvent[];
}

const GREETINGS = ["Chào Mai", "Mai ơi", "Chào buổi sáng, Mai"];

export function composeBrief(
  tasks: Task[],
  projects: Project[],
  events: CalEvent[],
  now: Date,
): MorningBrief {
  const ranked = rankTasks(tasks, projects, now);
  const waiting = tasks.filter((t) => t.waitingOn && t.status !== "done" && t.status !== "dropped");
  // Ưu tiên hôm nay (5.2.2 v2.6): việc còn hạn XA (>14 ngày) không leo lên
  // đây, trừ khi Mai đánh dấu ưu tiên cao hoặc việc đang chặn người khác.
  const nearMs = now.getTime() + 14 * 86_400_000;
  const todayWorthy = (t: Task) =>
    !t.dueAt || new Date(t.dueAt).getTime() <= nearMs || t.priority === "high" || Boolean(t.blocksOthers);
  // Deadline 7 ngày tới (§5.3.3): theo NGÀY địa phương, từ hôm nay đến hết
  // ngày thứ 7 — ĐẦY ĐỦ, không cắt bớt; quá hạn đã nằm ở Ưu tiên hôm nay.
  const { start, end } = next7DaysRange(now);
  const deadlines7d = ranked.filter((t) => {
    if (!t.dueAt || t.waitingOn) return false;
    const due = new Date(t.dueAt).getTime();
    return due >= start && due <= end;
  });

  const todayEvents = events
    .filter((e) => new Date(e.startAt).toDateString() === now.toDateString())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return {
    greeting: GREETINGS[now.getDate() % GREETINGS.length],
    top: ranked.filter((t) => !t.waitingOn && todayWorthy(t)).slice(0, 3),
    waiting,
    deadlines7d,
    todayEvents,
    unbooked: (() => {
      const ids = new Set(unbookedSoon(events, now));
      return events.filter((e) => ids.has(e.id)).sort((a, b) => a.startAt.localeCompare(b.startAt));
    })(),
  };
}
