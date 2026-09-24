import type { CalEvent, Project, Task } from "./types";
import { unbookedSoon } from "./booking";
import { rankTasks } from "./priority";
import { freeSlotsOnDay } from "./slots";
import { weekStats, mostStarved, next7DaysRange } from "./stats";

/**
 * Brief sáng (PRD §5.10): lịch hôm nay, top 3 việc, đang chờ người khác,
 * deadline 7 ngày — cộng một đề xuất cụ thể bấm được (mockup Hôm nay).
 */

export interface Suggestion {
  text: string;
  /** Block deep work đề xuất, tạo khi Mai bấm "Giữ chỗ". */
  block: { title: string; projectId: Project["id"]; startAt: string; endAt: string };
}

export interface MorningBrief {
  greeting: string;
  top: Task[];
  waiting: Task[];
  deadlines7d: Task[];
  todayEvents: CalEvent[];
  /** Lịch 7 ngày tới CHƯA đặt chỗ (§5.4.2 v3.7) — "2 lịch tuần này chưa đặt chỗ". */
  unbooked: CalEvent[];
  suggestion?: Suggestion;
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

  // Đề xuất: dự án đói nhất + khoảng trống ≥ 2 tiếng hôm nay.
  let suggestion: Suggestion | undefined;
  const starved = mostStarved(weekStats(tasks, projects, now));
  if (starved) {
    const mainEvents = events.filter((e) => e.kind === "event" || e.kind === "block");
    const gaps = freeSlotsOnDay(mainEvents, now, 120).filter(
      (g) => g.endAt.getTime() > now.getTime() + 30 * 60_000,
    );
    if (gaps.length) {
      const start = new Date(Math.max(gaps[0].startAt.getTime(), now.getTime()));
      start.setMinutes(start.getMinutes() + ((30 - (start.getMinutes() % 30)) % 30), 0, 0);
      const end = new Date(start.getTime() + 120 * 60_000);
      const hh = `${start.getHours()}:${String(start.getMinutes()).padStart(2, "0")}`;
      suggestion = {
        text: `Hôm nay có khoảng trống 2 tiếng lúc ${hh}. Mình giữ chỗ deep work cho ${starved.project.name} nhé?`,
        block: {
          title: `Deep work: ${starved.project.name}`,
          projectId: starved.project.id,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      };
    }
  }

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
    suggestion,
  };
}
