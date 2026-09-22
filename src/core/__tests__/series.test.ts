import { describe, expect, it } from "vitest";
import { findClientByName, foldName, orderClientsForPick } from "../clients";
import {
  activeReminder,
  addInterval,
  completeOccurrence,
  daysUntil,
  intervalLabel,
  isSeriesDay,
  type RecurringSeries,
} from "../series";
import type { Client } from "../types";

function series(over: Partial<RecurringSeries>): RecurringSeries {
  return {
    id: "s1",
    title: "Gia hạn visa",
    intervalUnit: "month",
    intervalCount: 3,
    nextDate: "2026-12-22",
    reminderOffsets: [30, 14, 7, 1],
    prepTemplate: "Chuẩn bị giấy tờ\nĐặt lịch hẹn",
    projectId: "canhan",
    categoryId: "canhan:giayto",
    isHard: true,
    history: [],
    ...over,
  };
}

describe("hẹn định kỳ dài hạn (PRD §5.4.0 v2.3)", () => {
  it("cộng chu kỳ: 3 tháng, 1 năm, 90 ngày; kẹp cuối tháng 31/1 → 28/2", () => {
    expect(addInterval("2026-01-15", "month", 3)).toBe("2026-04-15");
    expect(addInterval("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(addInterval("2028-02-29", "year", 1)).toBe("2029-02-28");
    expect(addInterval("2026-09-22", "day", 90)).toBe("2026-12-21");
    expect(addInterval("2026-11-25", "month", 2)).toBe("2027-01-25");
    expect(intervalLabel("month", 3)).toBe("mỗi 3 tháng");
    expect(intervalLabel("year", 1)).toBe("mỗi năm");
  });

  it("gia hạn sớm/muộn hơn kế hoạch → lần sau tính từ NGÀY THẬT", () => {
    const s = series({ nextDate: "2026-10-15" });
    const done = completeOccurrence(s, "2026-10-20", "làm ở Chaengwattana");
    expect(done.nextDate).toBe("2027-01-20");
    expect(done.history[0]).toEqual({
      plannedDate: "2026-10-15",
      actualDate: "2026-10-20",
      notes: "làm ở Chaengwattana",
    });
    expect(done.prepCreatedFor).toBeUndefined();
  });

  it("nhắc trước nhiều mốc: còn 25 ngày → band 30; còn 10 → 14; còn 0 → 1; quá hạn/còn xa → null", () => {
    const now = new Date(2026, 8, 22); // 22/9/2026
    expect(activeReminder(series({ nextDate: "2026-10-17" }), now)).toBe(30); // còn 25
    expect(activeReminder(series({ nextDate: "2026-10-02" }), now)).toBe(14); // còn 10
    expect(activeReminder(series({ nextDate: "2026-09-22" }), now)).toBe(1); // hôm nay
    expect(activeReminder(series({ nextDate: "2026-12-22" }), now)).toBeNull(); // còn 91
    expect(daysUntil("2026-09-20", now)).toBe(-2);
    expect(activeReminder(series({ nextDate: "2026-09-20" }), now)).toBeNull();
  });

  it("đánh dấu ngày hẹn trên lịch tháng: ngày kế tiếp + các lần đã làm", () => {
    const s = series({
      nextDate: "2026-12-22",
      history: [{ plannedDate: "2026-09-22", actualDate: "2026-09-20" }],
    });
    expect(isSeriesDay(s, new Date(2026, 11, 22))).toBe(true);
    expect(isSeriesDay(s, new Date(2026, 8, 20))).toBe(true);
    expect(isSeriesDay(s, new Date(2026, 8, 21))).toBe(false);
  });
});

describe("khách hàng nhập một lần (v2.3 — lỗi 22/9 phải nhập lại)", () => {
  const dothi: Client = {
    id: "kh:dothi",
    name: "Đô Thị",
    type: "khachhang",
    aliases: ["do thi laundry"],
    projectIds: ["circle"],
    status: "danglam",
  };

  it("fold bỏ dấu/hoa thường/khoảng trắng: 'do thi' ≡ 'Đô  Thị '", () => {
    expect(foldName("Đô  Thị ")).toBe("do thi");
    expect(foldName("do thi")).toBe("do thi");
  });

  it("tìm theo tên gõ tay không tạo trùng: 'đô thị', 'DO THI' đều ra cùng khách", () => {
    expect(findClientByName([dothi], "đô thị")?.id).toBe("kh:dothi");
    expect(findClientByName([dothi], "DO THI")?.id).toBe("kh:dothi");
    expect(findClientByName([dothi], "Do Thi Laundry")?.id).toBe("kh:dothi");
    expect(findClientByName([dothi], "Rạng Đông")).toBeUndefined();
  });

  it("gợi ý: vừa dùng gần đây → hay dùng → còn lại theo thứ tự Mai đặt", () => {
    const a: Client = { ...dothi, id: "a", name: "A" };
    const b: Client = { ...dothi, id: "b", name: "B", useCount: 5 };
    const c: Client = { ...dothi, id: "c", name: "C", lastUsedAt: "2026-09-21T00:00:00Z" };
    const d: Client = { ...dothi, id: "d", name: "D", lastUsedAt: "2026-09-22T00:00:00Z" };
    expect(orderClientsForPick([a, b, c, d]).map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
  });
});
