import { describe, expect, it } from "vitest";
import { bookingDueAt, bookingKeyword, detectBooking, unbookedSoon } from "../booking";
import { composeBrief } from "../brief";
import { DEFAULT_PROJECTS } from "../projects";
import {
  diffEvent,
  findOverlaps,
  matchEventByName,
  rescheduleTarget,
  suggestMoveSlot,
} from "../eventOps";
import {
  cityFromCoords,
  cityFromTrips,
  currentCity,
  defaultModeForCity,
  nearestPlace,
  originPlace,
  pruneLocation,
} from "../location";
import { parseCommand } from "../parse";
import { deadlineEnd, proposeTaskSlots } from "../slots";
import type { CalEvent, LocationState, Place, Trip } from "../types";

// Thứ Tư 23/9/2026 10:00 (giờ máy chạy test — mọi mốc dựng bằng giờ địa phương).
const NOW = new Date(2026, 8, 23, 10, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).toISOString();

function ev(id: string, title: string, s: string, e: string, extra: Partial<CalEvent> = {}): CalEvent {
  return { id, title, startAt: s, endAt: e, kind: "event", ...extra };
}

function place(p: Partial<Place> & { id: string; name: string }): Place {
  return { needsBooking: false, bookingLeadDays: 0, ...p };
}

describe("trùng giờ (§5.4.0 v3.7 — lỗi thấy 25/9)", () => {
  const trietLong = ev("a", "Triệt lông… tại Ngọc Dung", at(25, 15), at(25, 16));
  const catToc = ev("b", "Cắt tóc", at(25, 15), at(25, 16));

  it('"Triệt lông" và "Cắt tóc" cùng 15:00–16:00 → cả hai mang dấu trùng', () => {
    const m = findOverlaps([trietLong, catToc]);
    expect(m.get("a")).toEqual(["b"]);
    expect(m.get("b")).toEqual(["a"]);
  });

  it("liền kề (hết 15:00, bắt đầu 15:00) không phải trùng; block chuỗi không tính", () => {
    const before = ev("c", "Họp", at(25, 14), at(25, 15));
    const prep = ev("p", "Chuẩn bị", at(25, 14, 30), at(25, 15), { kind: "prep", chainOf: "a" });
    const m = findOverlaps([trietLong, before, prep]);
    expect(m.size).toBe(0);
  });

  it("đề xuất dời một cái sang khung trống gần nhất — hòa thì chọn SAU giờ cũ (16:00)", () => {
    const s = suggestMoveSlot(catToc, [trietLong, catToc], NOW);
    expect(s).toEqual({ startAt: at(25, 16), endAt: at(25, 17) });
  });
});

describe("tìm sự kiện theo tên Mai nói (chat/voice sửa/xóa)", () => {
  const list = [
    ev("1", "Cắt tóc", at(25, 15), at(25, 16)),
    ev("2", "Cắt tóc", at(30, 15), at(30, 16)),
    ev("3", "Xem Tarot với chị Hà", at(24, 19), at(24, 20)),
  ];
  it('"cắt tóc thứ Sáu" chọn đúng ngày; không dấu vẫn khớp', () => {
    expect(matchEventByName(list, "cat toc", at(25, 9), NOW)?.id).toBe("1");
    expect(matchEventByName(list, "Cắt tóc", at(30, 9), NOW)?.id).toBe("2");
  });
  it("không nói ngày → sự kiện sắp tới gần nhất; không khớp → undefined", () => {
    expect(matchEventByName(list, "tarot", undefined, NOW)?.id).toBe("3");
    expect(matchEventByName(list, "cắt tóc", undefined, NOW)?.id).toBe("1");
    expect(matchEventByName(list, "yoga", undefined, NOW)).toBeUndefined();
  });
});

describe("giờ mới khi dời bằng chat", () => {
  it('"sang 17:00" giữ NGÀY cũ (thứ Sáu), không nhảy về hôm nay', () => {
    expect(rescheduleTarget(at(25, 15), at(23, 17), { keepDate: true })).toBe(at(25, 17));
  });
  it('"sang thứ Năm" giữ GIỜ cũ', () => {
    expect(rescheduleTarget(at(25, 15, 30), at(24, 9), { keepTime: true })).toBe(at(24, 15, 30));
  });
  it("nói cả ngày lẫn giờ → lấy nguyên", () => {
    expect(rescheduleTarget(at(25, 15), at(26, 10), {})).toBe(at(26, 10));
  });
});

describe("thẻ xem trước khi sửa chỉ hiện phần đổi (trước → sau)", () => {
  it("chỉ đổi giờ → đúng một dòng 'time'", () => {
    const a = ev("x", "Cắt tóc", at(25, 15), at(25, 16));
    const d = diffEvent(a, { ...a, startAt: at(25, 17), endAt: at(25, 18) });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ field: "time", before: at(25, 15), after: at(25, 17) });
  });
  it("không đổi gì → rỗng; đổi tên + địa điểm → hai dòng", () => {
    const a = ev("x", "Cắt tóc", at(25, 15), at(25, 16), { location: "Salon A" });
    expect(diffEvent(a, { ...a })).toEqual([]);
    const d = diffEvent(a, { ...a, title: "Cắt + gội", location: "Salon B" });
    expect(d.map((c) => c.field)).toEqual(["title", "location"]);
  });
});

describe("việc đặt chỗ nằm trong danh sách việc (§5.4.2 v3.7)", () => {
  it("từ khóa: spa, triệt lông, cắt tóc, khám, nha khoa, tiêm, clinic, massage, nail", () => {
    for (const t of ["Spa thứ Năm", "Triệt lông", "Cắt tóc", "Đi khám mắt", "Nha khoa Smile", "Tiêm phòng", "Clinic da", "Massage chân", "Làm nail"]) {
      expect(bookingKeyword(t), t).toBeDefined();
    }
    expect(bookingKeyword("Khám phá Bangkok")).toBeUndefined();
    expect(bookingKeyword("Space planning")).toBeUndefined();
  });

  it('"Triệt lông… tại Ngọc Dung" → nơi "Ngọc Dung" (lần đầu → hỏi đặt trước bao lâu)', () => {
    const r = detectBooking("Triệt lông tại Ngọc Dung", undefined, []);
    expect(r).toEqual({ kind: "keyword", keyword: "triệt lông", placeName: "Ngọc Dung" });
  });

  it("nơi đã lưu cần đặt → dùng số ngày đã nhớ; nơi Mai trả lời 'không cần' → thôi", () => {
    const spa = place({ id: "s", name: "Ngọc Dung", needsBooking: true, bookingLeadDays: 2 });
    expect(detectBooking("Triệt lông tại Ngọc Dung", undefined, [spa])).toEqual({ kind: "place", place: spa });
    const no = place({ id: "n", name: "Ngọc Dung", needsBooking: false, bookingDecided: true });
    expect(detectBooking("Triệt lông tại Ngọc Dung", undefined, [no])).toEqual({ kind: "none" });
  });

  it('nơi chưa từng quyết định (vd "Nhà") KHÔNG che từ khóa', () => {
    const home = place({ id: "h", name: "Nhà", isHome: true });
    expect(detectBooking("Spa gần nhà", undefined, [home]).kind).toBe("keyword");
  });

  it("hạn = ngày hẹn − số ngày đặt trước, 9:00; lỡ mốc → hôm nay; không muộn hơn giờ hẹn", () => {
    expect(bookingDueAt(at(30, 15), 3, NOW)).toBe(at(27, 9));
    // hẹn 24/9 15:00, đặt trước 3 ngày → mốc 21/9 đã qua → gấp hôm nay (giờ kế tiếp 10:00)
    expect(bookingDueAt(at(24, 15), 3, NOW)).toBe(at(23, 10));
    // hẹn ngay 23/9 9:30 (đã qua 9:00 hôm nay) → không muộn hơn giờ hẹn
    expect(bookingDueAt(at(23, 10, 30), 0, NOW)).toBe(at(23, 10));
  });

  it("brief sáng: đếm lịch 7 ngày tới còn 'Chưa đặt'", () => {
    const list = [
      ev("p1", "Spa", at(25, 15), at(25, 16), { bookingStatus: "pending" }),
      ev("p2", "Nail", at(28, 11), at(28, 12), { bookingStatus: "pending" }),
      ev("b1", "Tóc", at(26, 10), at(26, 11), { bookingStatus: "booked" }),
      ev("far", "Khám", at(30 + 10, 9), at(30 + 10, 10), { bookingStatus: "pending" }),
    ];
    expect(unbookedSoon(list, NOW)).toEqual(["p1", "p2"]);
    const brief = composeBrief([], DEFAULT_PROJECTS, list, NOW);
    expect(brief.unbooked.map((e) => e.id)).toEqual(["p1", "p2"]);
  });
});

describe("biết Mai đang ở đâu (§5.4.3 v3.7)", () => {
  const trips: Trip[] = [
    {
      id: "t1",
      destination: "hcmc",
      label: "BKK → SGN",
      departAt: at(20, 8),
      returnAt: at(27, 18),
      done: {},
      customItems: [],
      removed: {},
    },
  ];

  it("tọa độ → thành phố; ngoài ba thành phố → không đoán", () => {
    expect(cityFromCoords(13.72, 100.58)).toBe("bkk");
    expect(cityFromCoords(10.79, 106.68)).toBe("hcmc");
    expect(cityFromCoords(35.68, 139.76)).toBe("tokyo");
    expect(cityFromCoords(21.03, 105.85)).toBeUndefined(); // Hà Nội
  });

  it("nơi đã lưu trong bán kính 250 m (chỉ nơi có tọa độ)", () => {
    const home = place({ id: "h", name: "Nhà Bang Na", lat: 13.668, lng: 100.605 });
    const noCoords = place({ id: "x", name: "Spa" });
    expect(nearestPlace({ lat: 13.6685, lng: 100.6052 }, [noCoords, home])?.id).toBe("h");
    expect(nearestPlace({ lat: 13.7, lng: 100.6 }, [home])).toBeUndefined();
  });

  it("không dùng vị trí: suy từ chuyến bay — đang trong chuyến → điểm đến; bay về rồi → nhà", () => {
    expect(cityFromTrips(trips, NOW)).toBe("hcmc");
    expect(cityFromTrips(trips, new Date(2026, 8, 28, 9))).toBe("bkk");
    expect(cityFromTrips([], NOW)).toBe("bkk");
  });

  it("GPS tươi thắng; GPS cũ hơn 6 giờ → quay về suy từ chuyến bay", () => {
    const gps: LocationState = {
      city: "bkk",
      placeId: "h",
      source: "gps",
      updatedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 29 * 86_400_000).toISOString(),
    };
    expect(currentCity(gps, [], NOW)).toEqual({ city: "bkk", placeId: "h", source: "gps" });
    const stale = { ...gps, updatedAt: new Date(NOW.getTime() - 7 * 3_600_000).toISOString() };
    expect(currentCity(stale, trips, NOW)).toEqual({ city: "hcmc", source: "calendar" });
  });

  it('Mai tự nói "đang ở HCMC" giữ đến khi có chuyến bay mới cất cánh sau đó', () => {
    const manual: LocationState = {
      city: "hcmc",
      source: "manual",
      updatedAt: at(19, 9),
      expiresAt: new Date(NOW.getTime() + 20 * 86_400_000).toISOString(),
    };
    expect(currentCity(manual, [], NOW).city).toBe("hcmc");
    // chuyến t1 cất cánh 20/9 SAU lúc Mai nói → tin chuyến bay
    expect(currentCity(manual, trips, NOW)).toEqual({ city: "hcmc", source: "calendar" });
  });

  it("dữ liệu vị trí quá 30 ngày thì xóa", () => {
    const old: LocationState = {
      city: "bkk",
      source: "manual",
      updatedAt: at(1, 9),
      expiresAt: at(22, 9),
    };
    expect(pruneLocation(old, NOW)).toBeUndefined();
  });

  it("phương tiện mặc định theo thành phố: Bangkok tàu điện, HCMC Grab; xuất phát từ nhà ở thành phố đó", () => {
    expect(defaultModeForCity("bkk")).toBe("transit");
    expect(defaultModeForCity("hcmc")).toBe("car");
    const hcmHome = place({ id: "hh", name: "Nhà ở HCM", city: "hcmc", isHome: true });
    const bkkHome = place({ id: "bh", name: "Nhà Bang Na", city: "bkk", isHome: true });
    expect(originPlace([bkkHome, hcmHome], { city: "hcmc", source: "calendar" })?.id).toBe("hh");
  });
});

describe("book lịch cho một việc — 3 khung trước deadline (§5.2.2 v3.7)", () => {
  it("hạn 'chỉ ngày' (9:00) nghĩa là hết ngày đó; hạn có giờ thật giữ nguyên", () => {
    expect(deadlineEnd(at(25, 9))).toBe(new Date(2026, 8, 25, 23, 59, 59).getTime());
    expect(deadlineEnd(at(25, 14, 30))).toBe(Date.parse(at(25, 14, 30)));
  });

  it("mọi khung đề xuất kết thúc trước hạn", () => {
    const { slots, afterDeadline } = proposeTaskSlots([], NOW, 120, { deadline: at(24, 9) });
    expect(afterDeadline).toBe(false);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(Date.parse(s.endAt)).toBeLessThanOrEqual(deadlineEnd(at(24, 9)));
  });

  it("việc quá hạn → vẫn đề xuất (sau hạn) và báo rõ", () => {
    const r = proposeTaskSlots([], NOW, 60, { deadline: at(21, 9) });
    expect(r.afterDeadline).toBe(true);
    expect(r.slots.length).toBeGreaterThan(0);
  });

  it('"thứ Năm" → chỉ khung trong thứ Năm', () => {
    const { slots } = proposeTaskSlots([], NOW, 120, { onDay: at(24, 9) });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(new Date(s.startAt).getDate()).toBe(24);
  });
});

describe("lệnh chat/voice mới (v3.7)", () => {
  const first = (t: string) => parseCommand(t, NOW).actions[0];

  it('"dời cắt tóc thứ Sáu sang 17:00" → đúng lịch thứ Sáu, sang 17:00 CÙNG NGÀY', () => {
    const a = first("dời cắt tóc thứ Sáu sang 17:00");
    expect(a).toMatchObject({ kind: "reschedule", what: "Cắt tóc", toWhen: at(25, 17), day: at(25, 9) });
  });

  it('"dời spa sang 17:00" (không nói ngày) → giữ ngày của lịch đó', () => {
    expect(first("dời spa sang 17:00")).toMatchObject({ kind: "reschedule", what: "Spa", keepDate: true });
  });

  it('"xóa lịch tarot" → delete_event (UI luôn hỏi xác nhận)', () => {
    expect(first("xóa lịch tarot")).toMatchObject({ kind: "delete_event", what: "Tarot" });
  });

  it('"book 2 tiếng cho việc pitch deck thứ Năm" → book_task 120 phút, ngày thứ Năm', () => {
    expect(first("book 2 tiếng cho việc pitch deck thứ Năm")).toMatchObject({
      kind: "book_task",
      what: "Pitch deck",
      durationMinutes: 120,
      day: at(24, 9),
    });
  });

  it('"chị đang ở HCMC" → location', () => {
    expect(first("chị đang ở HCMC")).toMatchObject({ kind: "location", city: "hcmc" });
    expect(first("em vừa tới Tokyo rồi")).toMatchObject({ kind: "location", city: "tokyo" });
  });

  it('"Spa thứ Năm đặt rồi" → booked', () => {
    expect(first("Spa thứ Năm đặt rồi")).toMatchObject({ kind: "booked", what: "Spa", day: at(24, 9) });
  });

  it('"Tìm giúp chị 5 công ty AI automation ở Bangkok, lưu vào Circle" → research gắn Circle', () => {
    expect(first("Tìm giúp chị 5 công ty AI automation ở Bangkok, lưu vào Circle")).toMatchObject({
      kind: "research",
      query: "5 công ty AI automation ở Bangkok",
      projectId: "circle",
    });
  });

  it('"tìm giờ họp với OKR" KHÔNG phải nghiên cứu', () => {
    expect(first("tìm giờ họp với OKR").kind).not.toBe("research");
  });
});

import { BOT_HELP, isPrivateAsk, parseBotCommand, stripMentions } from "../botCommand";

describe("bot group Lark — lệnh @Lowtechie + ranh giới riêng tư (§5.5.1–5.5.2)", () => {
  it("gỡ khóa mention @_user_1 của Lark", () => {
    expect(stripMentions("@_user_1 ghi việc: gửi proposal")).toBe("ghi việc: gửi proposal");
  });

  it('"ghi việc: gửi proposal cho Đô Thị thứ Sáu" → task (bước Kiểm tra trong PRD)', () => {
    expect(parseBotCommand("@_user_1 ghi việc: gửi proposal cho Đô Thị thứ Sáu")).toEqual({
      kind: "task",
      text: "gửi proposal cho Đô Thị thứ Sáu",
    });
  });

  it("giao việc cho người trong group, nhắc follow-up, ghi quyết định", () => {
    expect(parseBotCommand("@_user_1 giao việc chatbot cho Linh, hạn thứ Tư")).toMatchObject({
      kind: "assign",
      assignee: "Linh",
    });
    expect(parseBotCommand("@_user_1 nhắc Linh thứ Năm")).toMatchObject({ kind: "remind", assignee: "Linh" });
    expect(parseBotCommand("@_user_1 ghi quyết định: chốt pilot 6 tuần")).toEqual({
      kind: "decision",
      text: "chốt pilot 6 tuần",
    });
  });

  it("tóm tắt: N ngày qua / từ hôm qua / mặc định 24 giờ", () => {
    expect(parseBotCommand("@_user_1 tóm tắt 2 ngày qua")).toEqual({ kind: "summary", hours: 48 });
    expect(parseBotCommand("@_user_1 tóm tắt từ hôm qua tới giờ")).toEqual({ kind: "summary", hours: 48 });
    expect(parseBotCommand("@_user_1 tóm tắt")).toEqual({ kind: "summary", hours: 24 });
  });

  it("câu hỏi thuộc mức Riêng tư → private (không trả lời trong group)", () => {
    for (const q of ["Mai đang ở đâu?", "lịch cá nhân của chị Mai tuần này", "chị Mai bay về ngày nào, vé máy bay?", "email của khách khác"]) {
      expect(isPrivateAsk(q), q).toBe(true);
      expect(parseBotCommand(`@_user_1 ${q}`).kind).toBe("private");
    }
    expect(isPrivateAsk("việc nào đang treo?")).toBe(false);
  });

  it("lệnh ghi việc có chữ 'spa' vẫn là ghi việc (lệnh thắng bộ lọc riêng tư)", () => {
    expect(parseBotCommand("@_user_1 ghi việc: đặt spa cho đoàn khách").kind).toBe("task");
  });

  it("không hiểu → hướng dẫn, không đoán", () => {
    expect(parseBotCommand("@_user_1 hello")).toEqual({ kind: "help" });
    expect(BOT_HELP).toContain("Hộp duyệt");
  });
});

describe("parser — lỗi thật v3.7: “thứ Tư” không bao giờ khớp (\\b chỉ hiểu ASCII)", () => {
  it("“gửi báo cáo thứ Tư” có hạn thứ Tư, tiêu đề sạch", () => {
    const now = new Date(2026, 8, 21, 10); // thứ Hai 21/9
    const r = parseCommand("gửi báo cáo thứ Tư", now);
    const a = r.actions[0];
    expect(a.kind).toBe("task");
    if (a.kind !== "task") return;
    expect(a.title).toBe("Gửi báo cáo");
    const due = new Date(a.dueAt!);
    expect([due.getDate(), due.getDay()]).toEqual([23, 3]);
  });

  it("“thứ tư tuần sau”, “thứ 4” vẫn đúng; “thứ bảy” không bị nhầm thành thứ Ba", () => {
    const now = new Date(2026, 8, 21, 10);
    const a = parseCommand("gửi hợp đồng thứ tư tuần sau", now).actions[0];
    expect(a.kind === "task" && new Date(a.dueAt!).getDate()).toBe(30);
    const b = parseCommand("dọn nhà thứ bảy", now).actions[0];
    expect(b.kind === "task" && new Date(b.dueAt!).getDay()).toBe(6);
  });
});

describe("parser — nơi cần đặt chỗ + giờ cụ thể là LỊCH HẸN (§5.4.2 v3.7)", () => {
  const now = new Date(2026, 8, 21, 10); // thứ Hai
  it("“spa thứ Bảy 10h”, “cắt tóc thứ Sáu 15h” → sự kiện có giờ", () => {
    const a = parseCommand("spa thứ Bảy 10h", now).actions[0];
    expect(a.kind).toBe("event");
    if (a.kind === "event") {
      expect(a.title).toBe("Spa");
      expect(new Date(a.startAt!).getHours()).toBe(10);
      expect(new Date(a.startAt!).getDay()).toBe(6);
    }
    expect(parseCommand("cắt tóc thứ Sáu 15h", now).actions[0].kind).toBe("event");
  });

  it("không có giờ, hoặc từ khóa không đứng đầu, hoặc “khám phá” → vẫn là việc", () => {
    expect(parseCommand("spa thứ Bảy", now).actions[0].kind).toBe("task");
    expect(parseCommand("gửi báo cáo khám sức khỏe thứ Hai 9h", now).actions[0].kind).toBe("task");
    expect(parseCommand("khám phá quán mới thứ Bảy 10h", now).actions[0].kind).toBe("task");
  });
});
