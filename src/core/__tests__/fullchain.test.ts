import { describe, expect, it } from "vitest";
import { fullFlightChain, validateChainBlocks } from "../timeback";

const T = (s: string) => Date.parse(s);

// Ví dụ chuỗi đúng cho VU-131 ngày 2/10 trong PRD v2.0 §5.9.
describe("chuỗi ngày bay hai đầu (PRD v2.0) — hồi quy VU-131", () => {
  const chain = fullFlightChain({
    departureAt: "2026-10-02T11:50:00+07:00",
    arrivalAt: "2026-10-02T13:25:00+07:00",
    international: true,
    prepMinutes: 90,
    travelToAirportMin: 40,
    ticketCheckinMin: 120, // vé ghi "có mặt tại quầy trước 2 tiếng"
    arrivalProcessMin: 60,
    travelAfterMin: 40,
  });

  it("ra đúng bảng ví dụ: 07:10 chuẩn bị → 15:05 về đến nhà", () => {
    expect(T(chain.prepStartAt)).toBe(T("2026-10-02T07:10:00+07:00"));
    expect(T(chain.leaveAt)).toBe(T("2026-10-02T08:40:00+07:00"));
    expect(T(chain.airportArriveAt)).toBe(T("2026-10-02T09:20:00+07:00"));
    expect(chain.arriveAt && T(chain.arriveAt)).toBe(T("2026-10-02T15:05:00+07:00"));
    expect(chain.blocks.map((b) => b.key)).toEqual([
      "prep",
      "toAirport",
      "checkin",
      "flight",
      "arrival",
      "fromAirport",
    ]);
  });

  it("đệm check-in = MAX(quy định vé, mặc định 150 quốc tế)", () => {
    expect(chain.checkinMin).toBe(150);
    const strictTicket = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 40,
      ticketCheckinMin: 180,
    });
    expect(strictTicket.checkinMin).toBe(180);
  });

  it("Mai tự chỉnh check-in ('chỉ cần 1 tiếng 30') → dùng đúng số đó", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 40,
      ticketCheckinMin: 120,
      checkinOverrideMin: 90,
    });
    expect(c.checkinMin).toBe(90);
  });

  it("chuỗi liên tục, tăng dần — qua được kiểm tra bắt buộc", () => {
    expect(validateChainBlocks(chain.blocks)).toBeNull();
    expect(chain.warnings).toEqual([]);
  });
});

describe("kiểm tra bắt buộc + cảnh báo (lỗi thật 22/9)", () => {
  it("di chuyển 1020 phút → cảnh báo 'hơn 3 tiếng', không lặng lẽ vẽ chuỗi lạ", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 1020,
    });
    expect(c.warnings.join()).toContain("hơn 3 tiếng");
    // Chuỗi vẫn đúng toán học (lùi sang hôm trước) — UI phải kèm ngày.
    expect(validateChainBlocks(c.blocks)).toBeNull();
  });

  it("chuẩn bị rơi vào 0:00–5:00 giờ địa phương sân bay đi → hỏi lại", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T06:00:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 60,
    });
    // 6:00 − 150' = 3:30 đến sân bay; rời nhà 2:30; chuẩn bị 1:00 → đêm.
    expect(c.warnings.join()).toContain("nửa đêm");
  });

  // Test bắt buộc của v2.3: giờ kiểm tra là GIỜ ĐỊA PHƯƠNG, không phải UTC.
  it("chuẩn bị 7:13 giờ HCMC → KHÔNG cảnh báo nửa đêm (dù bằng 0:13 UTC)", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 47,
      checkinOverrideMin: 150,
    });
    // 11:50 − 150' = 9:20; − 47' = 8:33 rời nhà; − 90' = 7:03… đúng khung sáng.
    expect(c.warnings.join()).not.toContain("nửa đêm");
  });

  it("chuẩn bị 4:30 giờ HCMC → CÓ cảnh báo nửa đêm", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T09:00:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 60,
      checkinOverrideMin: 120,
    });
    // 9:00 − 120' = 7:00; − 60' = 6:00; − 90' = 4:30 giờ HCMC.
    expect(c.warnings.join()).toContain("nửa đêm");
  });

  it("dữ liệu cũ lưu dạng Z (mất offset) + originTzOffsetMin → vẫn đúng giờ địa phương", () => {
    const zed = fullFlightChain({
      departureAt: "2026-10-02T04:50:00.000Z", // = 11:50 +07 nhưng chuỗi mất offset
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 47,
      checkinOverrideMin: 150,
      originTzOffsetMin: 420,
    });
    expect(zed.warnings.join()).not.toContain("nửa đêm");
  });

  it("block đè nhau hoặc chạy lùi → trả lỗi, UI không được vẽ", () => {
    expect(
      validateChainBlocks([
        { label: "Chuẩn bị", startAt: "2026-10-02T07:10:00Z", endAt: "2026-10-02T08:40:00Z" },
        { label: "Ra sân bay", startAt: "2026-10-02T08:00:00Z", endAt: "2026-10-02T09:20:00Z" },
      ]),
    ).toContain("đè lên");
    expect(
      validateChainBlocks([
        { label: "Ra sân bay", startAt: "2026-10-02T16:10:00Z", endAt: "2026-10-02T09:20:00Z" },
      ]),
    ).toContain("kết thúc trước khi bắt đầu");
  });

  it("thiếu giờ hạ cánh → chuỗi dừng ở cất cánh, không bịa block đầu đến", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      international: true,
      prepMinutes: 90,
      travelToAirportMin: 40,
    });
    expect(c.blocks.map((b) => b.key)).toEqual(["prep", "toAirport", "checkin"]);
    expect(c.arriveAt).toBeUndefined();
  });

  it("tắt Chuẩn bị (0 phút) và tắt di chuyển sau khi đáp → block biến mất", () => {
    const c = fullFlightChain({
      departureAt: "2026-10-02T11:50:00+07:00",
      arrivalAt: "2026-10-02T13:25:00+07:00",
      international: true,
      prepMinutes: 0,
      travelToAirportMin: 40,
      travelAfterMin: 0,
    });
    expect(c.blocks.map((b) => b.key)).toEqual(["toAirport", "checkin", "flight", "arrival"]);
    expect(c.arriveAt && T(c.arriveAt)).toBe(T("2026-10-02T14:25:00+07:00"));
  });
});
