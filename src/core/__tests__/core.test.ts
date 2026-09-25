import { describe, expect, it } from "vitest";
import type { CalEvent, Task } from "../types";
import { DEFAULT_PROJECTS } from "../projects";
import { rankTasks } from "../priority";
import { groupsFor } from "../checklist";
import { freeSlotsOnDay, proposeSlots } from "../slots";
import { chronicallyDeferred, mostStarved, projectCounts, weekStats } from "../stats";
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

  it("v2.8: dự án đứng trên trong thứ tự Mai đặt được ưu tiên; hạn sát vẫn thắng", () => {
    const sorene = task({ title: "Sorene không hạn", projectId: "sorene" });
    const admin = task({ title: "Admin không hạn", projectId: "admin" });
    expect(rankTasks([admin, sorene], DEFAULT_PROJECTS, NOW)[0].title).toBe("Sorene không hạn");

    const adminDueSoon = task({
      title: "Admin mai hạn",
      projectId: "admin",
      dueAt: new Date(2026, 8, 19, 9).toISOString(),
    });
    expect(rankTasks([sorene, adminDueSoon], DEFAULT_PROJECTS, NOW)[0].title).toBe("Admin mai hạn");
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

describe("weekStats + review (PRD §5.10 v2.8 — đếm việc, không đếm giờ)", () => {
  it("đếm xong trong tuần / trễ / đang mở theo dự án; bỏ quên = còn việc mà không tiến triển", () => {
    const tasks = [
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString() }),
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString() }),
      task({ projectId: "circle", title: "Circle đang mở" }),
      // xong từ tuần trước → không tính là tiến triển tuần này
      task({ projectId: "sorene", status: "done", completedAt: new Date(2026, 8, 10).toISOString() }),
      task({ projectId: "sorene", title: "Sorene trễ", dueAt: new Date(2026, 8, 15).toISOString() }),
    ];
    const stats = weekStats(tasks, DEFAULT_PROJECTS, NOW);
    const circle = stats.find((s) => s.project.id === "circle")!;
    expect(circle.doneCount).toBe(2);
    expect(circle.openCount).toBe(1);
    expect(circle.lateCount).toBe(0);
    expect(circle.progressed).toBe(true);
    const sorene = stats.find((s) => s.project.id === "sorene")!;
    expect(sorene.doneCount).toBe(0);
    expect(sorene.lateCount).toBe(1);
    expect(sorene.progressed).toBe(false);
    // Sorene đứng đầu thứ tự, còn việc mở mà cả tuần chưa xong gì → bị gọi tên.
    expect(mostStarved(stats)!.project.id).toBe("sorene");
  });

  it("v2.8 §5.3.0: số đếm ô dự án — mở / quá hạn / đến hạn 7 ngày", () => {
    const tasks = [
      task({ projectId: "circle", title: "Quá hạn", dueAt: new Date(2026, 8, 15).toISOString() }),
      task({ projectId: "circle", title: "Ngày mai", dueAt: new Date(2026, 8, 19, 9).toISOString() }),
      task({ projectId: "circle", title: "Không hạn" }),
      task({ projectId: "circle", title: "Xa", dueAt: new Date(2026, 10, 1).toISOString() }),
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString() }),
      task({ projectId: "sorene", title: "Dự án khác" }),
    ];
    const c = projectCounts(tasks, "circle", NOW);
    expect(c.open).toBe(4);
    expect(c.overdue).toBe(1);
    expect(c.due7d).toBe(1);
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

  it("Mai 25/9: KHÔNG tự gợi ý giữ chỗ deep work nữa, kể cả khi có dự án bị bỏ quên + lịch trống", () => {
    const tasks = [
      task({ projectId: "circle", status: "done", completedAt: NOW.toISOString() }),
      task({ projectId: "sorene", title: "Chuẩn bị pitch" }),
    ];
    const brief = composeBrief(tasks, DEFAULT_PROJECTS, [], NOW);
    expect("suggestion" in brief).toBe(false);
  });

  it("v2.8 §5.3.3: Deadline 7 ngày tới ĐẦY ĐỦ theo ngày địa phương — 20+ việc hạn ngày mai không bị cắt", () => {
    const tomorrow = new Date(2026, 8, 19, 9).toISOString();
    const many = Array.from({ length: 22 }, (_, i) =>
      task({ title: `V${i}`, projectId: "circle", dueAt: tomorrow }),
    );
    const extra = [
      task({ title: "Quá hạn hôm qua", dueAt: new Date(2026, 8, 17, 9).toISOString() }),
      task({ title: "Cuối ngày thứ 7", dueAt: new Date(2026, 8, 25, 21).toISOString() }),
      task({ title: "Ngày thứ 8", dueAt: new Date(2026, 8, 26, 9).toISOString() }),
      task({ title: "Không hạn" }),
    ];
    const brief = composeBrief([...many, ...extra], DEFAULT_PROJECTS, [], NOW);
    const titles = brief.deadlines7d.map((t) => t.title);
    expect(brief.deadlines7d).toHaveLength(23); // 22 việc ngày mai + cuối ngày thứ 7
    expect(titles).toContain("Cuối ngày thứ 7");
    expect(titles).not.toContain("Ngày thứ 8");
    expect(titles).not.toContain("Quá hạn hôm qua");
    expect(titles).not.toContain("Không hạn");
  });
});
