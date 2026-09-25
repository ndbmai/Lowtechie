import { describe, expect, it } from "vitest";
import { isOnlineMeeting, meetingLink, needsTravel } from "../online";
import { onlineChain } from "../timeback";

describe("họp online không tính di chuyển (Mai 25/9)", () => {
  it("địa điểm là link họp / chữ Zoom · Meet · Online → online, không cần di chuyển", () => {
    for (const location of [
      "https://meet.google.com/gks-opqs-qie",
      "Link Zoom trong email",
      "Zoom",
      "Google Meet",
      "Lark VC",
      "Online",
      "Họp trực tuyến",
      "https://example.com/phong-hop-rieng",
    ]) {
      expect(isOnlineMeeting({ location }), location).toBe(true);
      expect(needsTravel({ location }), location).toBe(false);
    }
  });

  it("địa chỉ thật → cần di chuyển, kể cả khi lịch có kèm link Meet (Google tự gắn)", () => {
    expect(needsTravel({ location: "Salon Tóc Xinh" })).toBe(true);
    expect(needsTravel({ location: "The Hive Thonglor", meetUrl: "https://meet.google.com/abc-defg-hij" })).toBe(true);
    expect(needsTravel({ location: "https://maps.app.goo.gl/AbCd123" })).toBe(true);
    expect(isOnlineMeeting({ location: "Zoom Café, Sukhumvit 24" })).toBe(true); // chữ "Zoom" — chấp nhận, Mai sửa tay được
  });

  it("không địa điểm: link họp trong ghi chú / meetUrl / tiêu đề 'họp online' → online (không có gì để đi)", () => {
    expect(isOnlineMeeting({ notes: "Join: https://zoom.us/j/123456" })).toBe(true);
    expect(isOnlineMeeting({ meetUrl: "https://meet.google.com/x" })).toBe(true);
    expect(isOnlineMeeting({ title: "Họp online với OKR" })).toBe(true);
    expect(isOnlineMeeting({ title: "Ăn trưa với Linh" })).toBe(false);
    expect(needsTravel({ title: "Ăn trưa với Linh" })).toBe(false); // không địa điểm thì cũng không tính đường
  });

  it("nút Mở link họp lấy đúng link", () => {
    expect(meetingLink({ location: "https://meet.google.com/gks-opqs-qie" })).toBe("https://meet.google.com/gks-opqs-qie");
    expect(meetingLink({ notes: "Link: https://zoom.us/j/99?pwd=x rồi vào" })).toBe("https://zoom.us/j/99?pwd=x");
    expect(meetingLink({ location: "https://maps.app.goo.gl/x" })).toBeUndefined();
  });

  it("chuỗi của họp online chỉ có Chuẩn bị, không có block di chuyển", () => {
    const c = onlineChain({ appointmentAt: "2026-09-25T11:00:00.000Z", prepMinutes: 20 });
    expect(c.blocks.map((b) => b.kind)).toEqual(["prep"]);
    expect(c.blocks[0].startAt).toBe("2026-09-25T10:40:00.000Z");
    expect(c.leaveAt).toBe("2026-09-25T11:00:00.000Z");
    expect(onlineChain({ appointmentAt: "2026-09-25T11:00:00.000Z", prepMinutes: 0 }).blocks).toEqual([]);
  });
});

describe("lịch online không sinh việc đặt chỗ", () => {
  it("“Tư vấn spa” qua Zoom → không cần đặt chỗ; spa có địa chỉ thật → vẫn cần", async () => {
    const { detectBooking } = await import("../booking");
    expect(detectBooking("Tư vấn spa", "https://zoom.us/j/1", []).kind).toBe("none");
    expect(detectBooking("Spa", "Let's Relax Thonglor", []).kind).toBe("keyword");
  });
});

describe("ngày giờ tiếng Anh cho lệnh bot (team trao đổi tiếng Anh — Mai 25/9)", async () => {
  const { parseWhenEn } = await import("../whenEn");
  const WED = new Date(2026, 8, 23, 10, 0); // thứ Tư 23/9/2026 10:00
  const ymdh = (d?: Date) => (d ? [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()] : undefined);

  it("thứ trong tuần: Friday → 25/9 9:00; next Monday → 28/9; next Friday → 2/10 (tuần sau); Wednesday (hôm nay) → tuần sau", () => {
    expect(ymdh(parseWhenEn("send proposal to Do Thi Friday", WED).at)).toEqual([9, 25, 9, 0]);
    expect(ymdh(parseWhenEn("review deck next Monday", WED).at)).toEqual([9, 28, 9, 0]);
    expect(ymdh(parseWhenEn("ship it next Friday", WED).at)).toEqual([10, 2, 9, 0]);
    expect(ymdh(parseWhenEn("due Wednesday", WED).at)).toEqual([9, 30, 9, 0]);
    expect(ymdh(parseWhenEn("by Fri", WED).at)).toEqual([9, 25, 9, 0]);
    expect(parseWhenEn("we sat with the client", WED).at).toBeUndefined();
  });

  it("tương đối + giờ: tomorrow 3pm, today, EOD, day after tomorrow, noon", () => {
    expect(ymdh(parseWhenEn("call Linh tomorrow 3pm", WED).at)).toEqual([9, 24, 15, 0]);
    expect(ymdh(parseWhenEn("send it today", WED).at)).toEqual([9, 23, 9, 0]);
    expect(ymdh(parseWhenEn("by EOD", WED).at)).toEqual([9, 23, 9, 0]);
    expect(ymdh(parseWhenEn("the day after tomorrow at 10:30", WED).at)).toEqual([9, 25, 10, 30]);
    expect(ymdh(parseWhenEn("lunch at noon", WED).at)).toEqual([9, 23, 12, 0]);
    expect(ymdh(parseWhenEn("sync at 9am", WED).at)).toEqual([9, 24, 9, 0]); // 9h đã qua → mai
  });

  it("ngày cụ thể: Sep 30, 2 October, 30/9, 5/1 (đã qua → năm sau); '1-2 days' không phải ngày", () => {
    expect(ymdh(parseWhenEn("contract by Sep 30", WED).at)).toEqual([9, 30, 9, 0]);
    expect(ymdh(parseWhenEn("launch on 2 October", WED).at)).toEqual([10, 2, 9, 0]);
    expect(ymdh(parseWhenEn("invoice 30/9", WED).at)).toEqual([9, 30, 9, 0]);
    const jan = parseWhenEn("renew 5/1", WED).at!;
    expect([jan.getFullYear(), jan.getMonth(), jan.getDate()]).toEqual([2027, 0, 5]);
    expect(parseWhenEn("reply within 1-2 days", WED).at).toBeUndefined();
  });

  it("spans kèm chữ dẫn để gỡ khỏi tiêu đề", () => {
    expect(parseWhenEn("send proposal by Friday", WED).spans).toContain("by Friday");
  });
});
