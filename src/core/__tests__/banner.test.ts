import { describe, expect, it } from "vitest";
import { bannerNote, canAutoBookBanner, findDuplicateEvent, resolveBannerTiming } from "../banner";

// Thứ Tư 23/9/2026 16:00 giờ Bangkok.
const NOW = Date.parse("2026-09-23T16:00:00+07:00");

describe("banner sự kiện → lịch (PRD §5.1.1 v3.0)", () => {
  it("ngày trên banner đã qua → past, không tạo lịch", () => {
    const r = resolveBannerTiming(
      { title: "Workshop AI", startAt: "2026-09-20T18:00:00+07:00", confidence: 0.9 },
      NOW,
    );
    expect(r.status).toBe("past");
  });

  it("sự kiện ĐANG diễn ra (chưa kết thúc) vẫn tạo được", () => {
    const r = resolveBannerTiming(
      {
        title: "Hội thảo",
        startAt: "2026-09-23T15:00:00+07:00",
        endAt: "2026-09-23T18:00:00+07:00",
        confidence: 0.9,
      },
      NOW,
    );
    expect(r.status).toBe("ok");
  });

  it("banner chỉ ghi ngày không ghi giờ → hỏi một câu (needs-time)", () => {
    const r = resolveBannerTiming({ title: "Triển lãm", confidence: 0.8 }, NOW);
    expect(r.status).toBe("needs-time");
    if (r.status === "needs-time") expect(r.options).toEqual([]);
  });

  it("nhiều khung giờ → đưa các ứng viên TƯƠNG LAI để Mai chọn, không tự lấy", () => {
    const r = resolveBannerTiming(
      {
        title: "Yoga cuối tuần",
        startAt: "2026-09-26T07:00:00+07:00",
        timeOptions: [
          "2026-09-19T07:00:00+07:00", // đã qua → loại
          "2026-09-26T07:00:00+07:00",
          "2026-09-27T07:00:00+07:00",
        ],
        confidence: 0.85,
      },
      NOW,
    );
    expect(r.status).toBe("needs-time");
    if (r.status === "needs-time") expect(r.options).toHaveLength(2);
  });

  it("mọi khung giờ đều đã qua → past", () => {
    const r = resolveBannerTiming(
      { title: "Đêm nhạc", timeOptions: ["2026-09-01T20:00:00+07:00"], confidence: 0.8 },
      NOW,
    );
    expect(r.status).toBe("past");
  });

  it("thiếu endAt → tự cộng 2 tiếng", () => {
    const r = resolveBannerTiming(
      { title: "Meetup", startAt: "2026-09-25T18:30:00+07:00", confidence: 0.9 },
      NOW,
    );
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(Date.parse(r.endAt) - Date.parse(r.startAt)).toBe(120 * 60_000);
    }
  });

  it("chống trùng: cùng tên (fold dấu) cùng ngày → tìm ra sự kiện cũ", () => {
    const events = [
      { id: "e1", title: "Hội Thảo AI Việt Nam", startAt: "2026-10-02T09:00:00+07:00" },
      { id: "e2", title: "Họp Circle", startAt: "2026-10-02T14:00:00+07:00" },
    ];
    expect(
      findDuplicateEvent(events, "hoi thao ai viet nam", "2026-10-02T18:00:00+07:00")?.id,
    ).toBe("e1");
    expect(findDuplicateEvent(events, "Hội Thảo AI Việt Nam", "2026-10-03T09:00:00+07:00")).toBeUndefined();
  });

  it("v3.1: book thẳng chỉ khi giờ chắc chắn + có địa điểm + không trùng", () => {
    const ok = resolveBannerTiming(
      { title: "X", startAt: "2026-09-25T18:00:00+07:00", confidence: 0.9 },
      NOW,
    );
    expect(canAutoBookBanner(ok, true, false)).toBe(true);
    expect(canAutoBookBanner(ok, false, false)).toBe(false); // thiếu địa điểm
    expect(canAutoBookBanner(ok, true, true)).toBe(false); // trùng → hỏi
    const asking = resolveBannerTiming({ title: "X", confidence: 0.9 }, NOW);
    expect(canAutoBookBanner(asking, true, false)).toBe(false); // đang hỏi giờ
  });

  it("ghi chú gộp tổ chức · giá · lưu ý, bỏ phần thiếu", () => {
    expect(
      bannerNote({
        title: "X",
        organizer: "TechHub BKK",
        price: "500 baht (early bird 350)",
        confidence: 0.9,
      }),
    ).toBe("Tổ chức: TechHub BKK · Giá vé: 500 baht (early bird 350)");
    expect(bannerNote({ title: "X", confidence: 0.9 })).toBe("");
  });
});
