import { describe, expect, it } from "vitest";
import { dedupeRemoteEvents } from "../events";

describe("gộp lịch nhiều tài khoản (§5.3.4)", () => {
  it("cùng iCalUID ở hai tài khoản → một sự kiện, giữ bản tài khoản đứng trước", () => {
    const merged = dedupeRemoteEvents([
      { title: "Họp Circle", startAt: "2026-09-25T03:00:00Z", iCalUID: "abc@google.com", account: "g0" },
      { title: "Họp Circle", startAt: "2026-09-25T03:00:00Z", iCalUID: "abc@google.com", account: "x1" },
      { title: "Riêng", startAt: "2026-09-25T05:00:00Z", iCalUID: "def@google.com", account: "x1" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].account).toBe("g0");
  });

  it("không có iCalUID → rơi về tiêu đề + giờ bắt đầu; khác giờ thì giữ cả hai", () => {
    const merged = dedupeRemoteEvents([
      { title: "Spa", startAt: "2026-09-26T07:00:00Z" },
      { title: "Spa", startAt: "2026-09-26T07:00:00Z" },
      { title: "Spa", startAt: "2026-09-27T07:00:00Z" },
    ]);
    expect(merged).toHaveLength(2);
  });
});
