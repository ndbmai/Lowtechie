import { describe, expect, it } from "vitest";
import { fmtDue } from "../format";

// 5.2.2 v2.6 — lỗi thật: "hạn Thứ Sáu 30/10 0:00". Chỉ hiện giờ khi Mai
// thật sự đặt giờ; 0:00 và 9:00 là quy ước "chỉ ngày".
describe("fmtDue — không hiện '0:00' cho hạn chỉ có ngày", () => {
  const NOW = new Date(2026, 8, 22, 8, 0);

  it("hạn nửa đêm (nguồn ngoài) → chỉ ngày, không '0:00'", () => {
    const s = fmtDue(new Date(2026, 9, 30, 0, 0).toISOString(), NOW);
    expect(s).not.toContain("0:00");
    expect(s).toContain("30/10");
  });

  it("hạn 9:00 (quy ước nút nhanh/parse) → chỉ ngày", () => {
    expect(fmtDue(new Date(2026, 8, 25, 9, 0).toISOString(), NOW)).not.toContain("9:00");
  });

  it("Mai đặt giờ thật (15:30, 19:00) → hiện giờ", () => {
    expect(fmtDue(new Date(2026, 8, 25, 15, 30).toISOString(), NOW)).toContain("15:30");
    expect(fmtDue(new Date(2026, 8, 25, 19, 0).toISOString(), NOW)).toContain("19:00");
  });

  it("hôm nay/ngày mai vẫn nói kiểu tự nhiên", () => {
    expect(fmtDue(new Date(2026, 8, 23, 9, 0).toISOString(), NOW)).toBe("ngày mai");
  });
});
