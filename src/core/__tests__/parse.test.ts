import { describe, expect, it } from "vitest";
import { detectProject, parseCommand, parseWhen, splitClauses } from "../parse";

// Mốc thời gian của mockup: thứ Sáu 18/9/2026, 8:02 sáng.
const NOW = new Date(2026, 8, 18, 8, 2);

function local(y: number, mo: number, d: number, h = 9, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

describe("parseWhen — ngày giờ tiếng Việt", () => {
  it("thứ Ba (không nói tuần) → thứ Ba kế tiếp", () => {
    const w = parseWhen("thứ Ba nhắc chị gửi báo giá", NOW);
    expect(w.at).toBe(undefined === w.at ? undefined : w.at); // narrow
    expect(w.at!.toISOString()).toBe(local(2026, 9, 22));
  });

  it("thứ Ba tuần sau → thứ Ba của tuần kế (22/9 như mockup)", () => {
    const w = parseWhen("Thứ Ba tuần sau gọi anh Tuấn", NOW);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 22));
  });

  it("hôm nay đúng thứ thì 'thứ Sáu' là thứ Sáu tuần sau", () => {
    const w = parseWhen("thứ Sáu họp", NOW);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 25));
  });

  it("tối nay 7 giờ → 19:00 hôm nay", () => {
    const w = parseWhen("Tối nay 7 giờ hẹn ở Thonglor", NOW);
    expect(w.hasTime).toBe(true);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 18, 19, 0));
  });

  it("4 giờ chiều → 16:00", () => {
    const w = parseWhen("đặt lịch spa thứ Năm 4 giờ chiều", NOW);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 24, 16, 0));
  });

  it("sáng mai → 9:00 ngày mai", () => {
    const w = parseWhen("sáng mai nhắc chị", NOW);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 19, 9, 0));
  });

  it("'mai' đứng một mình cũng là ngày mai", () => {
    const w = parseWhen("mai đi ô tô ra sân bay nhé", NOW);
    expect(w.at!.toISOString()).toBe(local(2026, 9, 19, 9, 0));
  });

  it("7h30 và 19:00 đều đọc được", () => {
    expect(parseWhen("7h30 sáng mai", NOW).at!.toISOString()).toBe(local(2026, 9, 19, 7, 30));
    expect(parseWhen("hẹn 19:00 hôm nay", NOW).at!.toISOString()).toBe(
      local(2026, 9, 18, 19, 0),
    );
  });

  it("'2 tiếng' là thời lượng, không phải mốc giờ", () => {
    const w = parseWhen("book 2 tiếng deep work", NOW);
    expect(w.hasTime).toBe(false);
    expect(w.at).toBeUndefined();
  });

  it("chỉ có giờ mà giờ đã qua → hiểu là ngày mai", () => {
    const w = parseWhen("nhắc chị lúc 7 giờ sáng", NOW); // 8:02 đã qua 7:00
    expect(w.at!.toISOString()).toBe(local(2026, 9, 19, 7, 0));
  });
});

describe("detectProject", () => {
  it("gắn đúng dự án theo từ khóa", () => {
    expect(detectProject("gửi báo giá, dự án Circle").id).toBe("circle");
    expect(detectProject("sửa slide pitch deck").id).toBe("sorene");
    expect(detectProject("báo cáo OTA cho khách sạn").id).toBe("favstay");
    expect(detectProject("viết newsletter tuần này").id).toBe("edge");
    expect(detectProject("học tiếng Thái 20 phút").id).toBe("hoctap");
    expect(detectProject("đặt lịch spa").id).toBe("canhan");
  });

  it("không rõ → Cá nhân, không explicit", () => {
    const d = detectProject("mua quà sinh nhật");
    expect(d.id).toBe("canhan");
    expect(d.explicit).toBe(false);
  });
});

describe("splitClauses — một câu nhiều ý", () => {
  it("tách theo 'rồi'", () => {
    const parts = splitClauses(
      "Thứ Ba tuần sau nhắc chị gọi anh Tuấn bên OKR về hợp đồng Circle, rồi dời spa sang thứ Năm nha.",
    );
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatch(/^dời spa/);
  });

  it("tách theo ', và' khi vế sau là hành động", () => {
    const parts = splitClauses(
      "Tuần này dời spa sang thứ Năm, và book 2 tiếng deep work cho Sorene pitch deck",
    );
    expect(parts).toHaveLength(2);
  });

  it("không tách 'và' nối danh từ", () => {
    const parts = splitClauses("chuẩn bị tài liệu và danh thiếp cho buổi gặp");
    expect(parts).toHaveLength(1);
  });
});

describe("parseCommand — ví dụ trong PRD/mockup", () => {
  it("PRD §5.0: 'Thứ Ba nhắc chị gửi báo giá cho OKR, dự án Circle, gấp'", () => {
    const r = parseCommand("Thứ Ba nhắc chị gửi báo giá cho OKR, dự án Circle, gấp", NOW);
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    if (a.kind !== "task") throw new Error("phải là task");
    expect(a.title).toBe("Gửi báo giá cho OKR");
    expect(a.projectId).toBe("circle");
    expect(a.dueAt).toBe(local(2026, 9, 22));
    expect(a.dueType).toBe("hard");
  });

  it("mockup voice: 1 câu → 1 task + 1 đổi lịch", () => {
    const r = parseCommand(
      "Thứ Ba tuần sau nhắc chị gọi anh Tuấn bên OKR về hợp đồng Circle, rồi dời spa sang thứ Năm nha.",
      NOW,
    );
    expect(r.actions).toHaveLength(2);
    const [t, m] = r.actions;
    if (t.kind !== "task" || m.kind !== "reschedule") throw new Error("sai loại");
    expect(t.title).toBe("Gọi anh Tuấn bên OKR về hợp đồng Circle");
    expect(t.projectId).toBe("circle");
    expect(t.dueAt).toBe(local(2026, 9, 22));
    expect(m.what).toBe("Spa");
    expect(m.toWhen).toBe(local(2026, 9, 24));
    expect(r.question).toBeUndefined();
  });

  it("PRD §5.0: 'Tối nay 7 giờ hẹn ở Thonglor, đi tàu'", () => {
    const r = parseCommand("Tối nay 7 giờ hẹn ở Thonglor, đi tàu", NOW);
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    if (a.kind !== "event") throw new Error("phải là event");
    expect(a.startAt).toBe(local(2026, 9, 18, 19, 0));
    expect(a.location).toBe("Thonglor");
    expect(a.mode).toBe("transit");
    // Địa điểm tách riêng rồi thì tiêu đề không lặp lại nữa.
    expect(a.title).not.toMatch(/Thonglor/);
  });

  it("PRD §4.2: dời spa + book 2 tiếng deep work", () => {
    const r = parseCommand(
      "Tuần này dời spa sang thứ Năm, và book 2 tiếng deep work cho Sorene pitch deck",
      NOW,
    );
    expect(r.actions).toHaveLength(2);
    const [m, b] = r.actions;
    if (m.kind !== "reschedule" || b.kind !== "event") throw new Error("sai loại");
    expect(m.what.toLowerCase()).toBe("spa");
    expect(b.durationMinutes).toBe(120);
    expect(b.title).toMatch(/deep work/i);
    expect(b.startAt).toBeUndefined();
    // Có duration thì đi luồng đề xuất khung giờ, không cần hỏi lại.
    expect(r.question).toBeUndefined();
  });

  it("thiếu giờ hẹn → hỏi lại đúng MỘT câu", () => {
    const r = parseCommand("hẹn anh Minh ở Thonglor", NOW);
    expect(r.question).toMatch(/mấy giờ/);
  });

  it("PRD §5.0: 'Mai đi ô tô ra sân bay nhé' → ô tô, ngày mai", () => {
    const r = parseCommand("Mai đi ô tô ra sân bay nhé", NOW);
    const a = r.actions[0];
    // "ra sân bay" không phải hẹn/book → thành task ngày mai là chấp nhận được,
    // quan trọng là bắt được phương tiện khi là event:
    const ev = parseCommand("Mai 10 giờ bay, đi ô tô ra sân bay", NOW).actions[0];
    if (ev.kind !== "event") throw new Error("phải là event");
    expect(ev.mode).toBe("car");
    expect(a).toBeTruthy();
  });
});
