import { describe, expect, it } from "vitest";
import { carChain, flightChain, transitChain } from "../timeback";

const at = (h: number, m: number) => new Date(2026, 8, 18, h, m).toISOString();

describe("transitChain — mặc định BTS từ Bang Na (PRD §5.4.1)", () => {
  it("hẹn 19:00: đệm 10 − đi bộ 8 − tàu 30 − cổng 5 − đi bộ 12 − rời nhà 10 − chuẩn bị 90", () => {
    const c = transitChain({
      appointmentAt: at(19, 0),
      prepMinutes: 90,
      walkToStationMin: 12,
      transitMin: 30,
      walkFromStationMin: 8,
    });
    expect(c.leaveAt).toBe(at(17, 45));
    expect(c.prepStartAt).toBe(at(16, 15));
    expect(c.totalMinutes).toBe(165);
    expect(c.blocks.map((b) => b.kind)).toEqual(["prep", "travel"]);
    // Block di chuyển kết thúc đúng giờ hẹn (đến sớm 10' nằm trong block).
    expect(c.blocks[1].endAt).toBe(at(19, 0));
  });

  it("trời mưa: +10 phút mỗi đoạn đi bộ và nhắc mang ô", () => {
    const c = transitChain({
      appointmentAt: at(19, 0),
      prepMinutes: 90,
      walkToStationMin: 12,
      transitMin: 30,
      walkFromStationMin: 8,
      rain: true,
    });
    expect(c.leaveAt).toBe(at(17, 25));
    expect(c.reminders.join(" ")).toMatch(/mang ô/);
  });
});

describe("carChain — chỉ khi Mai nói rõ", () => {
  it("hẹn 19:00, lái 25 phút → chuẩn bị từ 16:45", () => {
    const c = carChain({ appointmentAt: at(19, 0), prepMinutes: 90, driveMin: 25 });
    expect(c.leaveAt).toBe(at(18, 15));
    expect(c.prepStartAt).toBe(at(16, 45));
  });
});

describe("flightChain — chuỗi ngày bay (PRD §5.9)", () => {
  it("bay quốc tế 10:30: có mặt 8:00, rời nhà 7:05, chuẩn bị 5:35", () => {
    const c = flightChain({
      departureAt: at(10, 30),
      international: true,
      prepMinutes: 90,
      travelMin: 45,
      flightMinutes: 6 * 60,
    });
    expect(c.prepStartAt).toBe(at(5, 35));
    expect(c.leaveAt).toBe(at(7, 5));
    expect(c.blocks.map((b) => b.kind)).toEqual(["prep", "travel", "airport", "flight"]);
    expect(c.blocks[2].startAt).toBe(at(8, 0));
    expect(c.blocks[2].endAt).toBe(at(10, 30));
    expect(c.blocks[3].endAt).toBe(at(16, 30));
    expect(c.reminders[0]).toMatch(/2 tiếng 30/);
  });

  it("nội địa dùng đệm 1 tiếng 30", () => {
    const c = flightChain({
      departureAt: at(10, 30),
      international: false,
      prepMinutes: 30,
      travelMin: 45,
    });
    expect(c.blocks[2].startAt).toBe(at(9, 0));
    expect(c.reminders[0]).toMatch(/1 tiếng 30/);
  });
});
