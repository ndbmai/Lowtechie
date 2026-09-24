import { describe, expect, it } from "vitest";
import { parseBotCommand } from "../botCommand";
import { groupLarkItems, larkChatLink, larkItemToDraft, type LarkInboxItem } from "../larkInbox";
import { DEFAULT_CATEGORIES, DEFAULT_PROJECTS } from "../projects";
import type { Client } from "../types";

const DOTHI: Client = {
  id: "dothi",
  name: "Đô Thị",
  type: "khachhang",
  aliases: [],
  projectIds: ["circle"],
  status: "danglam",
};

const ctx = {
  projects: DEFAULT_PROJECTS,
  categories: DEFAULT_CATEGORIES,
  clients: [DOTHI],
  feedback: [],
};

// Thứ Tư 23/9/2026 10:00 giờ thiết bị.
const WED = new Date(2026, 8, 23, 10, 0).toISOString();

function item(p: Partial<LarkInboxItem>): LarkInboxItem {
  return {
    id: "om_1",
    kind: "task",
    text: "",
    chatId: "oc_circle",
    chatName: "Circle × Đô Thị",
    chatType: "group",
    sender: "Linh",
    at: WED,
    url: larkChatLink("oc_circle"),
    ...p,
  };
}

describe("bot Lark → Hộp duyệt (§5.5.1 bước 7)", () => {
  it("“ghi việc: gửi proposal cho Đô Thị thứ Sáu” → hạn thứ Sáu theo LÚC GỬI tin, kèm nguồn + link", () => {
    const d = larkItemToDraft(item({ text: "gửi proposal cho Đô Thị thứ Sáu" }), ctx);
    expect(d.title).toBe("Gửi proposal cho Đô Thị");
    const due = new Date(d.dueAt!);
    expect([due.getFullYear(), due.getMonth(), due.getDate(), due.getHours()]).toEqual([2026, 8, 25, 9]);
    expect(d.dueSource).toBe("nguon");
    expect(d.clientId).toBe("dothi");
    expect(d.assignee).toBe("mai");
    expect(d.source.channel).toBe("lark");
    expect(d.source.ref).toContain("openChatId=oc_circle");
    expect(d.source.quote).toContain("gửi proposal cho Đô Thị thứ Sáu");
    expect(d.source.quote).toContain("Linh · Circle × Đô Thị");
  });

  it("group đã gắn dự án + khách → tự điền đúng (Circle · Đô Thị)", () => {
    const d = larkItemToDraft(item({ text: "chuẩn bị slide đào tạo" }), {
      ...ctx,
      group: { name: "Circle × Đô Thị", projectId: "circle", clientId: "dothi", mode: "mention" },
    });
    expect(d.projectId).toBe("circle");
    expect(d.clientId).toBe("dothi");
    expect(d.dueAt).toBeUndefined();
  });

  it("dự án của group đã tạm ngưng → không dùng, rơi về tự phân loại", () => {
    const projects = DEFAULT_PROJECTS.map((p) => (p.id === "circle" ? { ...p, status: "archived" as const } : p));
    const d = larkItemToDraft(item({ text: "gọi điện cho nhà cung cấp" }), {
      ...ctx,
      projects,
      group: { name: "x", projectId: "circle", mode: "mention" },
    });
    expect(d.projectId).not.toBe("circle");
  });

  it("“giao việc gửi proposal cho Linh, hạn thứ Tư” → người làm Linh, đang chờ Linh, hạn thứ Tư TUẦN SAU", () => {
    const d = larkItemToDraft(item({ kind: "assign", text: "gửi proposal cho Linh, hạn thứ Tư", assignee: "Linh" }), ctx);
    expect(d.title).toBe("Gửi proposal");
    expect(d.assignee).toBe("Linh");
    expect(d.waitingOn?.person).toBe("Linh");
    const due = new Date(d.dueAt!);
    expect([due.getMonth(), due.getDate()]).toEqual([8, 30]);
    expect(d.waitingOn?.followUpAt).toBe(d.dueAt);
  });

  it("quyết định → “Quyết định: …”, không có hạn", () => {
    const d = larkItemToDraft(item({ kind: "decision", text: "chốt pilot 6 tuần" }), ctx);
    expect(d.title).toBe("Quyết định: Chốt pilot 6 tuần");
    expect(d.dueAt).toBeUndefined();
  });

  it("“nhắc Linh thứ Năm” trả lời một tin → nội dung lấy từ tin đó", () => {
    const d = larkItemToDraft(
      item({ kind: "remind", text: "Linh thứ Năm", assignee: "Linh", quote: "gửi báo giá gói AIO" }),
      ctx,
    );
    expect(d.title).toBe("Nhắc Linh: gửi báo giá gói AIO");
    expect(new Date(d.dueAt!).getDate()).toBe(24);
    expect(d.source.quote).toContain("trả lời");
  });

  it("việc trong gói tóm tắt: hạn YYYY-MM-DD → 9:00 sáng giờ máy; độ chắc thấp hơn lệnh trực tiếp", () => {
    const d = larkItemToDraft(item({ text: "Gửi hợp đồng bản cuối", dueDate: "2026-10-02", confidence: 0.75 }), ctx);
    const due = new Date(d.dueAt!);
    expect([due.getMonth(), due.getDate(), due.getHours()]).toEqual([9, 2, 9]);
    expect(d.confidence).toBe(0.75);
    expect(larkItemToDraft(item({ text: "x" }), ctx).confidence).toBe(0.9);
  });

  it("gom theo gói: mục cùng bundleId đi chung một nhóm Hộp duyệt", () => {
    const later = new Date(2026, 8, 23, 11, 0).toISOString();
    const groups = groupLarkItems([
      item({ id: "b#t1", bundleId: "b", at: later }),
      item({ id: "a", at: WED }),
      item({ id: "b#t0", bundleId: "b", at: later }),
    ]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([["a"], ["b#t0", "b#t1"]]);
  });
});

describe("lệnh bot bổ sung", () => {
  it("hỏi trạng thái việc → status (chưa trả lời trong group, không đoán)", () => {
    expect(parseBotCommand("@_user_1 việc nào đang treo?").kind).toBe("status");
    expect(parseBotCommand("@_user_1 ai đang làm phần đào tạo?").kind).toBe("status");
  });

  it("“chốt việc hôm nay” = tóm tắt 24 giờ + gói việc cho Mai duyệt", () => {
    expect(parseBotCommand("@Lowtechie chốt việc hôm nay")).toEqual({ kind: "summary", hours: 24 });
  });
});

describe("giao việc NÀY (trả lời một tin)", () => {
  it("“giao việc này cho Linh, hạn thứ Tư” → tên việc lấy từ tin được trả lời", () => {
    const d = larkItemToDraft(
      item({ kind: "assign", text: "này cho Linh, hạn thứ Tư", assignee: "Linh", quote: "gửi proposal cho Đô Thị nha" }),
      ctx,
    );
    expect(d.title).toBe("Gửi proposal cho Đô Thị");
    expect(d.assignee).toBe("Linh");
    expect(new Date(d.dueAt!).getDay()).toBe(3);
  });
});
