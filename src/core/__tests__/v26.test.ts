import { describe, expect, it } from "vitest";
import { composeBrief } from "../brief";
import { parseCommand } from "../parse";
import { DEFAULT_PROJECTS } from "../projects";
import type { Task } from "../types";

const NOW = new Date(2026, 8, 22, 8, 0); // thứ Ba 22/9/2026

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

describe("lệnh ghi chú & đóng việc qua chat (PRD 3d + 5.2.2 v2.6)", () => {
  it('"ghi chú cho việc hợp đồng Đô Thị: …" → kind note, giữ nguyên nội dung', () => {
    const r = parseCommand("ghi chú cho việc hợp đồng Đô Thị: khách muốn thêm điều khoản bảo trì", NOW);
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    expect(a.kind).toBe("note");
    if (a.kind === "note") {
      expect(a.what.toLowerCase()).toContain("hợp đồng đô thị");
      expect(a.text).toBe("khách muốn thêm điều khoản bảo trì");
    }
  });

  it('"xong việc chatbot rồi" → kind complete (UI sẽ hiện thẻ xác nhận)', () => {
    const r = parseCommand("xong việc chatbot rồi", NOW);
    expect(r.actions[0].kind).toBe("complete");
    if (r.actions[0].kind === "complete") {
      expect(r.actions[0].what.toLowerCase()).toContain("chatbot");
    }
    expect(parseCommand("đã hoàn thành báo giá OKR", NOW).actions[0].kind).toBe("complete");
  });

  it("câu thường không bị nhận nhầm thành complete/note", () => {
    const r = parseCommand("Gửi báo giá cho OKR thứ Sáu", NOW);
    expect(r.actions[0].kind).toBe("task");
  });
});

describe("Ưu tiên hôm nay không nhận việc còn hạn xa (5.2.2 v2.6)", () => {
  it("việc hạn 5 tuần nữa KHÔNG lên top; đánh dấu ưu tiên cao thì lên", () => {
    const far = task({ title: "Event 30/10", dueAt: new Date(2026, 9, 30).toISOString(), dueType: "hard" });
    const near = task({ title: "Báo giá tuần này", dueAt: new Date(2026, 8, 25).toISOString() });
    const b1 = composeBrief([far, near], DEFAULT_PROJECTS, [], NOW);
    expect(b1.top.map((t) => t.title)).toContain("Báo giá tuần này");
    expect(b1.top.map((t) => t.title)).not.toContain("Event 30/10");

    const pinned = { ...far, priority: "high" as const };
    const b2 = composeBrief([pinned, near], DEFAULT_PROJECTS, [], NOW);
    expect(b2.top.map((t) => t.title)).toContain("Event 30/10");
  });

  it("việc không hạn và việc chặn người khác vẫn được xét", () => {
    const noDue = task({ title: "Không hạn" });
    const blocking = task({ title: "Đang chặn", dueAt: new Date(2026, 10, 20).toISOString(), blocksOthers: true });
    const b = composeBrief([noDue, blocking], DEFAULT_PROJECTS, [], NOW);
    expect(b.top.map((t) => t.title)).toEqual(expect.arrayContaining(["Không hạn", "Đang chặn"]));
  });
});
