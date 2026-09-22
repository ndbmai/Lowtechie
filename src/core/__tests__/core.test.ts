import { describe, expect, it } from "vitest";
import type { CalEvent, Task } from "../types";
import { DEFAULT_PROJECTS } from "../projects";
import { rankTasks } from "../priority";
import { groupsFor } from "../checklist";
import { freeSlotsOnDay, proposeSlots } from "../slots";
import { chronicallyDeferred, mostStarved, weekStats } from "../stats";
import { composeBrief } from "../brief";

const NOW = new Date(2026, 8, 18, 8, 2); // thứ Sáu 18/9/2026

let seq = 0;
function task(over: Partial<Task>): Task {
  return {
    id: `t${seq++}`,
    title: "Việc",
    projectId: "canhan",
    assignee: "mai",
    status: "todo",
    source: { channel: "manual" },
    confidence: 1,
    createdAt: NOW.toISOString(),
    deferCount: 0,
    ...over,
  };
}

describe("priority (PRD §5.2)", () => {
  it("quá hạn cứng > sắp hạn mềm > không hạn; chặn người khác được cộng", () => {
    const overdue = task({ title: "Quá hạn", dueAt: new Date(2026, 8, 17).toISOString(), dueType: "hard" });
    const soon = task({ title: "Sắp hạn", dueAt: new Date(2026, 8, 20).toISOString(), dueType: "soft" });
    const blocking = task({ title: "Đang chặn", blocksOthers: true });
    const plain = task({ title: "Bình thường" });
    const ranked = rankTasks([plain, soon, blocking, overdue], DEFAULT_PROJECTS, NOW);
    expect(ranked.map((t) => t.title)).toEqual(["Quá hạn", "Sắp hạn", "Đang chặn", "Bình thường"]);
  });

  it("việc done không được xếp hạng", () => {
    const done = task({ status: "done" });
    expect(rankTasks([done], DEFAULT_PROJECTS, NOW)).toHaveLength(0);
  });
});

describe("checklist theo điểm đến (PRD §5.9)", () => {
  it("Tokyo có Visit Japan Web + Suica, không có TDAC", () => {
    const titles = groupsFor("pack", "tokyo").flatMap((g) => g.items.map((i) => i.title));
    expect(titles.join()).toMatch(/Visit Japan Web/);
    expect(titles.join()).toMatch(/Suica/);
    expect(titles.join()).not.toMatch(/TDAC/);
  });

  it("về Bangkok có TDAC + baht; HCMC có tiền đồng", () => {
    const bkk = groupsFor("pack", "bkk").flatMap((g) => g.items.map((i) => i.title));
    expect(bkk.join()).toMatch(/TDAC/);
    expect(bkk.join()).toMatch(/baht/);
    const hcmc = groupsFor("pack", "hcmc").flatMap((g) => g.items.map((i) => i.title));
    expect(hcmc.join()).toMatch(/Tiền mặt đồng/);
  });

  it("id món ổn định để lưu tick", () => {
    const a = groupsFor("pack", "tokyo")[0].items[0].id;
    const b = groupsFor("pack", "bkk")[0].items[0].id;
    expect(a).toBe(b);
  });
});

describe("slots", () => {
  const ev = (h1: number, h2: number): CalEvent => ({
    id: `e${h1}`,
    title: "Họp",
    startAt: new Date(2026, 8, 18, h1).toISOString(),
    endAt: new Date(2026, 8, 18, h2).toISOString(),
    kind: "event",
  });

  it("tìm khoảng trống quanh sự kiện", () => {
    const gaps = freeSlotsOnDay([ev(10, 12)], NOW, 120);
    expect(gaps).toHaveLength(2);
    expect(gaps[0].startAt.getHours()).toBe(8);
    expect(gaps[1].startAt.getHours()).toBe(12);
  });

  it("đề xuất tối đa 3 khung kèm lý do", () => {
    const slots = proposeSlots([ev(9, 17)], NOW, 120, 5);
    expect(slots.length).toBeLessThanOrEqual(3);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.reason).toBeTruthy();
  });
});

describe("weekStats + review (PRD §5.10)", () => {
  it("cộng giờ việc xong trong tuần theo dự án, tìm dự án bị bỏ đói", () => {
    const tasks = [
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString(), estMinutes: 120 }),
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString(), estMinutes: 60 }),
      // xong từ tuần trước → không tính
      task({ projectId: "sorene", status: "done", completedAt: new Date(2026, 8, 10).toISOString(), estMinutes: 600 }),
    ];
    const stats = weekStats(tasks, DEFAULT_PROJECTS, NOW);
    expect(stats.find((s) => s.project.id === "circle")!.doneHours).toBe(3);
    expect(stats.find((s) => s.project.id === "sorene")!.doneHours).toBe(0);
    expect(mostStarved(stats)!.project.id).toBe("sorene");
  });

  it("việc dời ≥ 3 lần bị điểm mặt", () => {
    const t3 = task({ deferCount: 3 });
    const t1 = task({ deferCount: 1 });
    expect(chronicallyDeferred([t3, t1]).map((t) => t.id)).toEqual([t3.id]);
  });
});

describe("brief sáng (PRD §5.10)", () => {
  it("top 3 không lẫn việc đang chờ người khác; deadline 7 ngày có mặt", () => {
    const tasks = [
      task({ title: "A", dueAt: new Date(2026, 8, 18, 17).toISOString(), dueType: "hard", projectId: "sorene" }),
      task({ title: "B", projectId: "circle" }),
      task({ title: "C", projectId: "hoctap" }),
      task({ title: "D chờ Linh", waitingOn: { person: "Linh" }, projectId: "circle" }),
    ];
    const brief = composeBrief(tasks, DEFAULT_PROJECTS, [], NOW);
    expect(brief.top.map((t) => t.title)).not.toContain("D chờ Linh");
    expect(brief.top[0].title).toBe("A");
    expect(brief.waiting.map((t) => t.title)).toEqual(["D chờ Linh"]);
    expect(brief.deadlines7d.map((t) => t.title)).toContain("A");
  });

  it("có khoảng trống → đề xuất giữ chỗ cho dự án đói nhất", () => {
    const tasks = [
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString(), estMinutes: 300 }),
    ];
    const brief = composeBrief(tasks, DEFAULT_PROJECTS, [], NOW);
    expect(brief.suggestion).toBeTruthy();
    expect(brief.suggestion!.block.projectId).toBe("sorene");
    expect(brief.suggestion!.text).toMatch(/Sorene/);
  });
});
