import { describe, expect, it } from "vitest";
import {
  classify,
  findDuplicate,
  isSimilarTitle,
  learnableTerms,
} from "../classify";
import { DEFAULT_CATEGORIES, DEFAULT_PROJECTS, categoriesFor } from "../projects";
import type { Task } from "../types";

describe("phân loại 2 tầng (PRD §5.2.1)", () => {
  it("luật từ khóa gắn đúng dự án + category", () => {
    expect(classify("Gửi báo giá cho OKR")).toMatchObject({
      projectId: "circle",
      categoryId: "circle:banhang",
    });
    expect(classify("Soạn hợp đồng pilot")).toMatchObject({
      projectId: "circle",
      categoryId: "circle:hopdong",
    });
    expect(classify("Sửa slide pitch deck")).toMatchObject({
      projectId: "sorene",
      categoryId: "sorene:goivon",
    });
    expect(classify("Gửi báo cáo OTA tháng 9")).toMatchObject({
      projectId: "favstay",
      categoryId: "favstay:ota",
    });
    expect(classify("Viết newsletter tuần này")).toMatchObject({
      projectId: "edge",
      categoryId: "edge:vietbai",
    });
    expect(classify("Đặt lịch spa")).toMatchObject({
      projectId: "canhan",
      categoryId: "canhan:suckhoe",
    });
    expect(classify("Nộp khai thuế quý 3")).toMatchObject({
      projectId: "admin",
      categoryId: "admin:thue",
    });
    expect(classify("Gia hạn visa Thái")).toMatchObject({
      projectId: "canhan",
      categoryId: "canhan:giayto",
    });
  });

  it("không tín hiệu → Cá nhân, chắc chắn thấp, có 2 lựa chọn thay thế", () => {
    const c = classify("Mua quà sinh nhật");
    expect(c.projectId).toBe("canhan");
    expect(c.confidence).toBeLessThan(0.7);
    expect(c.alternatives).toHaveLength(2);
  });

  it("nhiều dự án cùng khớp → chắc chắn giảm + hiện lựa chọn kia", () => {
    const c = classify("Viết bài về khách sạn cho newsletter");
    expect(c.confidence).toBeLessThan(0.7);
    expect(c.alternatives.length).toBeGreaterThan(0);
  });

  it("học từ sửa đổi thắng luật: 'Rạng Đông' luôn là Favstay (ví dụ PRD)", () => {
    const feedback = [
      { term: "rạng đông", projectId: "favstay" as const, categoryId: "favstay:vanhanh" },
    ];
    // "hợp đồng" theo luật là Circle, nhưng Mai đã dạy Rạng Đông → Favstay.
    const c = classify("Gửi hợp đồng cho khách sạn Rạng Đông", feedback);
    expect(c.projectId).toBe("favstay");
    expect(c.categoryId).toBe("favstay:vanhanh");
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("learnableTerms rút tên riêng giữa câu, bỏ từ đầu câu", () => {
    const terms = learnableTerms("Gửi hợp đồng cho Rạng Đông trước thứ Sáu");
    expect(terms).toContain("rạng đông");
    expect(terms).not.toContain("gửi");
    expect(learnableTerms("gọi anh Tuấn bên OKR")).toEqual(
      expect.arrayContaining(["tuấn", "okr"]),
    );
  });
});

describe("kiểm tra trùng trước khi lưu", () => {
  let seq = 0;
  const task = (title: string, status: Task["status"] = "todo"): Task => ({
    id: `t${seq++}`,
    title,
    projectId: "circle",
    assignee: "mai",
    status,
    source: { channel: "manual" },
    confidence: 1,
    createdAt: new Date().toISOString(),
    deferCount: 0,
  });

  it("bắt được tiêu đề gần giống", () => {
    expect(isSimilarTitle("Gửi báo giá cho OKR", "Gửi báo giá cho OKR trước thứ Sáu")).toBe(true);
    expect(isSimilarTitle("Gửi báo giá OKR", "Gửi báo giá cho bên OKR")).toBe(true);
    expect(isSimilarTitle("Gửi báo giá cho OKR", "Đặt lịch spa thứ Năm")).toBe(false);
  });

  it("findDuplicate chỉ soi việc đang mở", () => {
    const done = task("Gửi báo giá cho OKR", "done");
    const open = task("Gửi báo giá cho OKR");
    expect(findDuplicate("Gửi báo giá cho OKR trước thứ Sáu", [done])).toBeUndefined();
    expect(findDuplicate("Gửi báo giá cho OKR trước thứ Sáu", [done, open])?.id).toBe(open.id);
  });
});

describe("dự án + category mặc định", () => {
  it("có Admin chung (PRD §5.2.1) và đủ 7 dự án", () => {
    expect(DEFAULT_PROJECTS.map((p) => p.id)).toContain("admin");
    expect(DEFAULT_PROJECTS).toHaveLength(7);
  });

  it("mỗi category thuộc đúng dự án, id không trùng", () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.id.startsWith(`${c.projectId}:`)).toBe(true);
    }
    expect(categoriesFor("circle").map((c) => c.name)).toContain("Hợp đồng");
  });
});
