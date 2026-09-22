import { describe, expect, it } from "vitest";
import type { FlightSegment } from "../flights";
import { classifyAndGroup } from "../flights";

/** "Bây giờ" của test hồi quy PRD §5.9 6b: 22/9/2026 17:47 giờ Bangkok. */
const NOW = Date.parse("2026-09-22T17:47:00+07:00");

function seg(
  over: Partial<FlightSegment> & Pick<FlightSegment, "flightNo" | "departLocal">,
): FlightSegment {
  return { confidence: 0.9, ...over };
}

// Test hồi quy BẮT BUỘC của PRD §5.9 6b — tái hiện đúng vé OADC5J:
// chặng đi VU-130 đã bay 7/9 bị bỏ đúng, nhưng bản cũ ĐÁNH RƠI chặng về
// VU-131 ngày 2/10 (nằm trong PDF đính kèm) và vẫn vẽ chuỗi cho ngày 7/9.
describe("hồi quy OADC5J (PRD §5.9 6b)", () => {
  const oadc5j: FlightSegment[] = [
    seg({
      pnr: "OADC5J",
      flightNo: "VU-130",
      fromIata: "BKK",
      toIata: "SGN",
      departLocal: "2026-09-07T09:10:00+07:00",
      arriveLocal: "2026-09-07T10:45:00+07:00",
      subject: "Xác nhận hành trình Vietravel Airlines — OADC5J",
    }),
    seg({
      pnr: "OADC5J",
      flightNo: "VU-131",
      fromIata: "SGN",
      toIata: "BKK",
      fromTerminal: "2",
      departLocal: "2026-10-02T11:50:00+07:00",
      arriveLocal: "2026-10-02T13:25:00+07:00",
      seat: "12F",
      baggage: "15kg",
      subject: "Xác nhận hành trình Vietravel Airlines — OADC5J",
    }),
  ];

  it("chặng về VU-131 ngày 2/10 phải thành đúng MỘT ứng viên, không được bỏ sót", () => {
    const { candidates } = classifyAndGroup(oadc5j, NOW);
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.destination).toBe("bkk");
    expect(c.departAt).toBe("2026-10-02T11:50:00+07:00");
    expect(c.returnAt).toBeUndefined();
    expect(c.pnr).toBe("OADC5J");
    expect(c.route).toBe("SGN (nhà ga 2) → BKK");
    expect(c.flights).toContain("VU-131");
    expect(c.flights).toContain("11:50–13:25");
    expect(c.flights).toContain("ghế 12F");
    expect(c.flights).toContain("ký gửi 15kg");
  });

  it("VU-130 ngày 7/9 đã bay → vào Lịch sử, KHÔNG sinh chuyến/chuỗi 7/9", () => {
    const { candidates, history } = classifyAndGroup(oadc5j, NOW);
    expect(candidates.some((c) => c.departAt.startsWith("2026-09-07"))).toBe(false);
    expect(history).toHaveLength(1);
    expect(history[0]).toContain("VU-130");
    expect(history[0]).toContain("đã bay");
  });
});

describe("khử trùng chặng: PNR + số hiệu + ngày bay (6b — không bao giờ chỉ PNR)", () => {
  it("cùng chặng lặp trong nhiều email → một ứng viên, giữ bản tin cậy cao nhất", () => {
    const a = seg({
      pnr: "ABC123",
      flightNo: "VJ903",
      fromIata: "BKK",
      toIata: "SGN",
      departLocal: "2026-10-05T08:30:00+07:00",
      confidence: 0.7,
      subject: "Booking confirmation",
    });
    const b = { ...a, confidence: 0.95, subject: "Nhắc check-in VJ903" };
    const { candidates, history } = classifyAndGroup([a, b], NOW);
    expect(candidates).toHaveLength(1);
    expect(history).toHaveLength(0);
    expect(candidates[0].confidence).toBe(0.95);
    expect(candidates[0].subject).toBe("Nhắc check-in VJ903");
  });

  it("cùng số hiệu nhưng khác ngày bay → là hai chuyến, không được gộp mất", () => {
    const a = seg({ flightNo: "TG683", fromIata: "BKK", toIata: "HND", departLocal: "2026-10-10T07:00:00+07:00" });
    const b = seg({ flightNo: "TG683", fromIata: "BKK", toIata: "HND", departLocal: "2026-11-10T07:00:00+07:00" });
    expect(classifyAndGroup([a, b], NOW).candidates).toHaveLength(2);
  });
});

describe("chặng hủy / lịch cũ trước khi đổi vé (6b)", () => {
  it("vé ghi hủy → Lịch sử 'đã hủy' dù giờ bay còn ở tương lai", () => {
    const s = seg({
      flightNo: "VN601",
      fromIata: "SGN",
      toIata: "BKK",
      departLocal: "2026-10-20T10:00:00+07:00",
      cancelled: true,
    });
    const r = classifyAndGroup([s], NOW);
    expect(r.candidates).toHaveLength(0);
    expect(r.history[0]).toContain("đã hủy");
  });

  it("lịch cũ bị email đổi vé thay thế → Lịch sử, chỉ bản mới thành ứng viên", () => {
    const cu = seg({
      pnr: "XYZ789",
      flightNo: "VJ822",
      fromIata: "SGN",
      toIata: "NRT",
      departLocal: "2026-10-15T01:30:00+07:00",
      superseded: true,
    });
    const moi = seg({
      pnr: "XYZ789",
      flightNo: "VJ822",
      fromIata: "SGN",
      toIata: "NRT",
      departLocal: "2026-10-18T01:30:00+07:00",
    });
    const r = classifyAndGroup([cu, moi], NOW);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].departAt).toBe("2026-10-18T01:30:00+07:00");
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toContain("lịch cũ trước khi đổi vé");
  });
});

describe("gộp chặng sắp tới theo PNR thành chuyến", () => {
  it("khứ hồi cùng PNR → một chuyến đi + về, kể cả khi trích lộn thứ tự", () => {
    const ve = seg({
      pnr: "RT456",
      flightNo: "TG557",
      fromIata: "NRT",
      toIata: "BKK",
      departLocal: "2026-11-08T17:25:00+09:00",
    });
    const di = seg({
      pnr: "RT456",
      flightNo: "TG682",
      fromIata: "BKK",
      toIata: "NRT",
      departLocal: "2026-11-03T23:50:00+07:00",
      checkinMinutes: 180,
    });
    const r = classifyAndGroup([ve, di], NOW);
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0];
    expect(c.destination).toBe("tokyo");
    expect(c.departAt).toBe("2026-11-03T23:50:00+07:00");
    expect(c.returnAt).toBe("2026-11-08T17:25:00+09:00");
    expect(c.airportBufferMin).toBe(180);
    expect(c.route).toBe("BKK → NRT");
  });

  it("không PNR → mỗi chặng một chuyến riêng", () => {
    const a = seg({ flightNo: "VJ901", fromIata: "SGN", toIata: "BKK", departLocal: "2026-10-25T08:00:00+07:00" });
    const b = seg({ flightNo: "FD902", fromIata: "DMK", toIata: "SGN", departLocal: "2026-10-28T20:00:00+07:00" });
    expect(classifyAndGroup([a, b], NOW).candidates).toHaveLength(2);
  });
});

describe("điểm đến & dữ liệu hỏng", () => {
  it("sân bay đến ngoài danh mục checklist → other kèm mã IATA", () => {
    const s = seg({ flightNo: "SQ975", fromIata: "SGN", toIata: "SIN", departLocal: "2026-10-12T14:00:00+07:00" });
    const c = classifyAndGroup([s], NOW).candidates[0];
    expect(c.destination).toBe("other");
    expect(c.destinationName).toBe("SIN");
  });

  it("chặng thiếu giờ hoặc giờ hỏng bị bỏ lặng lẽ, không làm vỡ kết quả", () => {
    const bad = seg({ flightNo: "XX000", departLocal: "không rõ" });
    const good = seg({ flightNo: "VJ903", fromIata: "BKK", toIata: "SGN", departLocal: "2026-10-05T08:30:00+07:00" });
    const r = classifyAndGroup([bad, good], NOW);
    expect(r.candidates).toHaveLength(1);
    expect(r.history).toHaveLength(0);
  });

  it("khởi hành đúng thời điểm hiện tại tính là đã bay (biên <=)", () => {
    const s = seg({ flightNo: "VJ777", fromIata: "SGN", toIata: "BKK", departLocal: "2026-09-22T17:47:00+07:00" });
    const r = classifyAndGroup([s], NOW);
    expect(r.candidates).toHaveLength(0);
    expect(r.history[0]).toContain("đã bay");
  });
});
