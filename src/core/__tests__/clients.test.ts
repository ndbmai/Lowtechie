import { describe, expect, it } from "vitest";
import {
  clientProjectHint,
  clientsFor,
  makeClientId,
  matchClient,
  sanitizeClientId,
} from "../clients";
import { dueWarnings, duePresets } from "../due";
import type { Client, Project } from "../types";

const dothi: Client = {
  id: "kh:dothi",
  name: "Đô thị",
  type: "khachhang",
  aliases: ["do thi laundry", "Đô Thị Laundry"],
  projectIds: ["circle"],
  status: "danglam",
};
const okr: Client = {
  id: "kh:okr",
  name: "OKR",
  type: "doitac",
  aliases: [],
  projectIds: ["circle", "sorene"],
  status: "danglam",
};
const CLIENTS = [dothi, okr];

describe("danh bạ khách hàng (PRD §5.3.2)", () => {
  it("khớp tên khách trong tiêu đề, kể cả tên gọi tắt và khác hoa thường", () => {
    expect(matchClient("Ký lại hợp đồng website đô thị", CLIENTS)?.id).toBe("kh:dothi");
    expect(matchClient("gửi báo giá cho Do thi laundry nhé", CLIENTS)?.id).toBe("kh:dothi");
    expect(matchClient("họp với OKR chiều nay", CLIENTS)?.id).toBe("kh:okr");
  });

  it("tên lạ không đoán — không khớp thì trả undefined", () => {
    expect(matchClient("mua quà sinh nhật cho mẹ", CLIENTS)).toBeUndefined();
  });

  it("không khớp giữa từ (tránh dương tính giả)", () => {
    // "OKRs" là chuỗi khác, không phải nhắc đối tác OKR.
    expect(matchClient("đọc sách về OKRs framework", CLIENTS)).toBeUndefined();
  });

  it("tên dài hơn thắng khi lồng nhau", () => {
    const xanh: Client = { ...dothi, id: "kh:dothixanh", name: "Đô thị Xanh", aliases: [] };
    expect(matchClient("hợp đồng Đô thị Xanh tháng 10", [dothi, xanh])?.id).toBe("kh:dothixanh");
  });

  it("lọc khách theo dự án; id lạ bị bỏ khi sanitize", () => {
    expect(clientsFor(CLIENTS, "circle").map((c) => c.id)).toEqual(["kh:dothi", "kh:okr"]);
    expect(clientsFor(CLIENTS, "sorene").map((c) => c.id)).toEqual(["kh:okr"]);
    expect(sanitizeClientId(CLIENTS, "kh:dothi")).toBe("kh:dothi");
    expect(sanitizeClientId(CLIENTS, "kh:ma")).toBeUndefined();
  });

  it("gợi ý dự án từ khách (bỏ dự án đã lưu trữ)", () => {
    const projects = [
      { id: "circle", status: "archived" },
      { id: "sorene" },
    ] as Project[];
    expect(clientProjectHint(okr, projects)).toBe("sorene");
    expect(clientProjectHint(undefined, projects)).toBeUndefined();
  });

  it("id khách mới là slug không dấu, không trùng", () => {
    expect(makeClientId("Đô thị", CLIENTS)).toBe("kh:dothi2");
    expect(makeClientId("Anh Tuấn — OKR", [])).toBe("kh:anhtuanokr");
  });
});

describe("deadline 3c: nút điền nhanh + cảnh báo", () => {
  // Thứ Ba 22/9/2026.
  const NOW = new Date(2026, 8, 22, 17, 47);

  it("Hôm nay/Ngày mai/Thứ Sáu này/Tuần sau/Cuối tháng ra đúng ngày, 9:00 sáng", () => {
    const p = Object.fromEntries(duePresets(NOW).map((x) => [x.key, x.at]));
    expect(p.today.getDate()).toBe(22);
    expect(p.today.getHours()).toBe(9);
    expect(p.tomorrow.getDate()).toBe(23);
    expect(p.friday.getDay()).toBe(5);
    expect(p.friday.getDate()).toBe(25);
    expect(p.nextweek.getDay()).toBe(1);
    expect(p.nextweek.getDate()).toBe(28);
    expect(p.endmonth.getDate()).toBe(30);
    expect(p.endmonth.getMonth()).toBe(8);
  });

  it("đúng thứ Sáu thì 'Thứ Sáu này' là hôm nay; thứ Hai thì 'Tuần sau' nhảy 7 ngày", () => {
    const friday = new Date(2026, 8, 25, 8, 0);
    expect(duePresets(friday).find((x) => x.key === "friday")?.at.getDate()).toBe(25);
    const monday = new Date(2026, 8, 21, 8, 0);
    expect(duePresets(monday).find((x) => x.key === "nextweek")?.at.getDate()).toBe(28);
  });

  it("cảnh báo: hạn đã qua · ngày bay · ngày lịch dày — nhưng chỉ là cảnh báo", () => {
    const ctx = {
      nowMs: NOW.getTime(),
      trips: [{ departAt: "2026-10-02T04:50:00.000Z", returnAt: undefined }],
      events: [
        { startAt: "2026-09-24T02:00:00.000Z", endAt: "2026-09-24T09:00:00.000Z" },
      ],
    };
    expect(dueWarnings(new Date(2026, 8, 20).toISOString(), ctx)).toContain("hạn đã qua");
    expect(dueWarnings(new Date(2026, 9, 2, 12, 0).toISOString(), ctx)).toContain(
      "rơi vào ngày Mai bay",
    );
    expect(dueWarnings(new Date(2026, 8, 24, 15, 0).toISOString(), ctx)).toContain(
      "ngày đó lịch đã dày",
    );
    expect(dueWarnings(new Date(2026, 8, 29).toISOString(), ctx)).toEqual([]);
  });
});
