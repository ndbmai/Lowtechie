import { describe, expect, it } from "vitest";
import {
  applyResponses,
  companyFromDomain,
  contactsFromClients,
  defaultInviteMessage,
  emailQuestion,
  extractInvitees,
  followUpsDue,
  inviteLanguage,
  invitePool,
  inviteeFromDraft,
  inviteStats,
  inviteStatsLine,
  matchInvitee,
  meetLinkRequest,
  mergeContacts,
  mergeInvitees,
  needsEmail,
  normalizeResponse,
  parseSaidName,
  peopleFromHeaders,
  resolveInvitee,
  splitInviteeList,
  suggestContacts,
  upsertContact,
} from "../contacts";
import { parseBotCommand } from "../botCommand";
import { matchTaskByName } from "../eventOps";
import { larkItemToDraft } from "../larkInbox";
import { parseCommand, parseWhen } from "../parse";
import { DEFAULT_CATEGORIES, DEFAULT_PROJECTS } from "../projects";
import { parseWhenEn } from "../whenEn";
import { parseWhenTh } from "../whenTh";
import type { CalEvent, Client, Contact, EventInvitee } from "../types";

// Thứ Tư 23/9/2026 10:00 giờ máy.
const NOW = new Date(2026, 8, 23, 10, 0);

const TUAN_OKR: Contact = {
  id: "ct:tuanokr",
  name: "Nguyễn Anh Tuấn",
  aliases: [],
  email: "tuan@okr.vn",
  company: "OKR",
  source: "invite",
  lastUsedAt: "2026-09-20T09:00:00.000Z",
  useCount: 3,
};
const TUAN_CIRCLE: Contact = {
  id: "ct:tuancircle",
  name: "Trần Minh Tuấn",
  aliases: [],
  email: "tuan@thecircle.co",
  company: "The Circle",
  source: "mail",
  lastUsedAt: "2026-09-10T09:00:00.000Z",
};
const TUAN_RD: Contact = {
  id: "ct:tuanrd",
  name: "Phạm Tuấn",
  aliases: [],
  email: "tuan.pham@rangdong.vn",
  source: "mail",
  lastUsedAt: "2026-08-01T09:00:00.000Z",
};
const LINH: Contact = {
  id: "ct:linh",
  name: "Lê Thùy Linh",
  aliases: ["Linh Circle"],
  email: "linh@thecircle.co",
  source: "lark_group",
  larkOpenId: "ou_linh",
};
const POOL = [TUAN_OKR, TUAN_CIRCLE, TUAN_RD, LINH];

describe("tên Mai gọi → tên lõi + danh xưng + công ty (§5.4 v3.9)", () => {
  it("“anh Tuấn bên OKR” → Tuấn · anh · OKR, gọi “anh Tuấn”, gợi ý tiếng Việt", () => {
    expect(parseSaidName("anh Tuấn bên OKR")).toEqual({
      core: "Tuấn",
      honorific: "anh",
      company: "OKR",
      call: "anh Tuấn",
      viHint: true,
    });
  });

  it("danh xưng khác: chị / Mr. / nhắn tắt “c Linh” / (công ty)", () => {
    expect(parseSaidName("chị Linh").core).toBe("Linh");
    const mr = parseSaidName("Mr. John Smith");
    expect([mr.core, mr.viHint]).toEqual(["John Smith", false]);
    expect(parseSaidName("c Linh").core).toBe("Linh");
    expect(parseSaidName("Tuan (OKR)").company).toBe("OKR");
  });

  it("tách danh sách người mời: “và”, dấu phẩy, “and”; “mọi người” không phải tên", () => {
    expect(splitInviteeList("anh Tuấn bên OKR và chị Linh, Hà")).toEqual(["anh Tuấn bên OKR", "chị Linh", "Hà"]);
    expect(splitInviteeList("Tuan and Linh")).toEqual(["Tuan", "Linh"]);
    expect(splitInviteeList("mọi người")).toEqual([]);
  });
});

describe("khớp người mời với danh bạ", () => {
  it("“anh Tuấn bên OKR” → đúng một người (lọc theo công ty)", () => {
    const m = matchInvitee("anh Tuấn bên OKR", POOL);
    expect(m.kind).toBe("one");
    expect(m.kind === "one" && m.contact.id).toBe("ct:tuanokr");
  });

  it("trùng tên “anh Tuấn” → 2 lựa chọn GẦN NHẤT, danh xưng “anh” không bị hiểu là tên đệm", () => {
    const m = matchInvitee("anh Tuấn", POOL);
    expect(m.kind).toBe("many");
    expect(m.kind === "many" && m.options.map((c) => c.id)).toEqual(["ct:tuanokr", "ct:tuancircle"]);
    // gõ không dấu cũng ra
    expect(matchInvitee("tuan", POOL).kind).toBe("many");
  });

  it("“bên Rạng Đông” khớp theo tên miền email", () => {
    const m = matchInvitee("anh Tuấn bên Rạng Đông", POOL);
    expect(m.kind === "one" && m.contact.id).toBe("ct:tuanrd");
  });

  it("tên gọi khác khớp đúng cả cụm; email khớp thẳng; tên lạ → none", () => {
    expect(matchInvitee("Linh Circle", POOL)).toEqual({ kind: "one", contact: LINH });
    expect(matchInvitee("chị Linh", POOL)).toEqual({ kind: "one", contact: LINH });
    expect(matchInvitee("tuan@okr.vn", POOL)).toEqual({ kind: "email", email: "tuan@okr.vn", contact: TUAN_OKR });
    expect(matchInvitee("x@y.com", POOL)).toEqual({ kind: "email", email: "x@y.com", contact: undefined });
    expect(matchInvitee("anh Hà", POOL)).toEqual({ kind: "none" });
  });

  it("“Anh Thư” là tên thật → khớp đúng cả cụm, không bị cắt thành “Thư”", () => {
    const anhThu: Contact = { id: "ct:anhthu", name: "Anh Thư", aliases: [], email: "thu@x.vn", source: "manual" };
    const thu: Contact = { id: "ct:thu", name: "Minh Thư", aliases: [], email: "mthu@x.vn", source: "manual" };
    const m = matchInvitee("Anh Thư", [thu, anhThu]);
    expect(m.kind === "one" && m.contact.id).toBe("ct:anhthu");
  });
});

describe("dòng người mời trên thẻ + câu hỏi đúng một lần", () => {
  it("khớp một người → sẵn email; chưa có → hỏi “Email của anh Hà là gì?”; trùng → chọn", () => {
    const ok = resolveInvitee("anh Tuấn bên OKR", POOL);
    expect([ok.status, ok.email, ok.call]).toEqual(["ready", "tuan@okr.vn", "anh Tuấn"]);
    const ask = resolveInvitee("anh Hà", POOL);
    expect(ask.status).toBe("ask_email");
    expect(emailQuestion(ask)).toBe("Email của anh Hà là gì?");
    const pick = resolveInvitee("anh Tuấn", POOL);
    expect(pick.status).toBe("pick");
    expect(pick.options).toHaveLength(2);
  });

  it("gõ thẳng email kèm tên → dùng ngay", () => {
    const d = resolveInvitee("Linh <linh.new@gmail.com>", POOL);
    expect([d.status, d.name, d.email]).toEqual(["ready", "Linh", "linh.new@gmail.com"]);
    expect(resolveInvitee("ha.tran@acme.com", POOL).name).toBe("Ha Tran");
  });

  it("thành viên group Lark chưa có email: lịch Lark mời bằng open_id, lịch Google phải hỏi email", () => {
    const noMail: Contact = { ...LINH, id: "ct:hoa", name: "Hoa", aliases: [], email: undefined, larkOpenId: "ou_hoa" };
    const d = resolveInvitee("Hoa", [noMail]);
    expect(d.larkOpenId).toBe("ou_hoa");
    expect(needsEmail(d, "lark")).toBe(false);
    expect(needsEmail(d, "google")).toBe(true);
  });

  it("gợi ý khi đang gõ: theo đầu chữ, gần đây trước", () => {
    expect(suggestContacts("tu", POOL).map((c) => c.id)).toEqual(["ct:tuanokr", "ct:tuancircle", "ct:tuanrd"]);
    expect(suggestContacts("linh@", POOL).map((c) => c.id)).toEqual(["ct:linh"]);
  });
});

describe("danh bạ tự nhớ: không tạo trùng, học tên gọi, gộp", () => {
  it("lần đầu trả lời email → tạo liên hệ; lần sau cùng email → học tên gọi, không tạo đôi", () => {
    const a = upsertContact([], { name: "Tuấn", email: "Tuan@OKR.vn", company: "OKR", source: "invite", lang: "vi" }, {
      use: true,
      now: "2026-09-23T03:00:00.000Z",
    });
    expect(a.created).toBe(true);
    expect(a.contact).toMatchObject({ id: "ct:tuan", email: "tuan@okr.vn", company: "OKR", useCount: 1, lang: "vi" });
    const b = upsertContact(a.contacts, { name: "Nguyễn Anh Tuấn", email: "tuan@okr.vn", source: "mail" }, { use: true });
    expect(b.created).toBe(false);
    expect(b.contacts).toHaveLength(1);
    expect(b.contact.aliases).toEqual(["Nguyễn Anh Tuấn"]);
    expect(b.contact.useCount).toBe(2);
  });

  it("thành viên Lark (open_id) được bổ sung email; chọn đúng người bằng id", () => {
    const r = upsertContact([LINH], { name: "Linh", email: "linh.le@gmail.com", larkOpenId: "ou_linh", source: "invite" });
    expect(r.contacts).toHaveLength(1);
    expect(r.contact.email).toBe("linh@thecircle.co"); // email đã có giữ nguyên
    const noMail: Contact = { id: "ct:hoa", name: "Hoa", aliases: [], source: "lark_group", larkOpenId: "ou_hoa" };
    const r2 = upsertContact([noMail], { name: "Hoa", email: "hoa@thecircle.co", source: "invite" }, { id: "ct:hoa" });
    expect(r2.contact).toMatchObject({ id: "ct:hoa", email: "hoa@thecircle.co" });
  });

  it("gộp hai liên hệ trùng: giữ một, tên người kia thành tên gọi khác, cộng lượt dùng", () => {
    const merged = mergeContacts([TUAN_OKR, { ...TUAN_RD, useCount: 2 }], "ct:tuanokr", "ct:tuanrd");
    expect(merged).toHaveLength(1);
    expect(merged[0].aliases).toContain("Phạm Tuấn");
    expect(merged[0].email).toBe("tuan@okr.vn");
    expect(merged[0].useCount).toBe(5);
  });

  it("người liên hệ của khách hàng (ô liên hệ có email) mời được ngay, không trùng email", () => {
    const clients: Client[] = [
      {
        id: "dothi",
        name: "Đô Thị",
        type: "khachhang",
        aliases: ["Do Thi"],
        projectIds: ["circle"],
        status: "danglam",
        contact: "0901 234 567 · Chau@DoThi.vn",
      },
      { id: "okr", name: "OKR", type: "khachhang", aliases: [], projectIds: ["circle"], status: "danglam", contact: "tuan@okr.vn" },
    ];
    const fromClients = contactsFromClients(clients);
    expect(fromClients.map((c) => [c.id, c.email])).toEqual([
      ["client:dothi", "chau@dothi.vn"],
      ["client:okr", "tuan@okr.vn"],
    ]);
    const pool = invitePool([TUAN_OKR], clients);
    expect(pool.map((c) => c.id)).toEqual(["ct:tuanokr", "client:dothi"]);
    expect(matchInvitee("Đô Thị", pool).kind).toBe("one");
  });
});

describe("nhập từ hộp thư: người gửi/nhận", () => {
  it("bỏ chính Mai + hộp thư máy; tên lấy từ header, công ty từ tên miền", () => {
    const people = peopleFromHeaders(
      [
        '"Nguyen Anh Tuan" <tuan@okr.vn>, linh@thecircle.co, No Reply <no-reply@google.com>',
        "Mai <mai@thecircle.co>, Tuấn <tuan@okr.vn>, info@dothi.vn",
      ],
      ["mai@thecircle.co"],
    );
    expect(people.map((p) => [p.email, p.name, p.company, p.count])).toEqual([
      ["tuan@okr.vn", "Nguyen Anh Tuan", "OKR", 2],
      ["linh@thecircle.co", "Linh", "Thecircle", 1],
    ]);
  });

  it("công ty theo tên miền; hộp thư miễn phí thì không có", () => {
    expect(companyFromDomain("okr.vn")).toBe("OKR");
    expect(companyFromDomain("mail.okr.com.vn")).toBe("OKR");
    expect(companyFromDomain("thecircle.co")).toBe("Thecircle");
    expect(companyFromDomain("gmail.com")).toBeUndefined();
  });
});

describe("thư mời: tiếng Anh với người ngoài, tiếng Việt khi liên hệ dùng tiếng Việt", () => {
  it("chọn ngôn ngữ", () => {
    expect(inviteLanguage([{ name: "Nguyễn Anh Tuấn" }])).toBe("vi");
    expect(inviteLanguage([{ name: "Linh", viHint: true }])).toBe("vi");
    expect(inviteLanguage([{ name: "Tran Tuan", email: "tuan@okr.vn" }])).toBe("vi");
    expect(inviteLanguage([{ name: "John", email: "john@acme.com" }])).toBe("en");
    expect(inviteLanguage([{ name: "Nguyễn Anh Tuấn" }, { name: "John", email: "john@acme.com" }])).toBe("en");
    expect(inviteLanguage([{ name: "John", lang: "vi" }])).toBe("vi");
    expect(inviteLanguage([])).toBe("en");
  });

  it("lời nhắn mặc định có tên sự kiện, giờ, link họp; Mai sửa được", () => {
    const ev = {
      title: "Họp OKR",
      startAt: new Date(2026, 9, 1, 14, 0).toISOString(),
      endAt: new Date(2026, 9, 1, 15, 0).toISOString(),
      meetUrl: "https://meet.google.com/abc-defg-hij",
    };
    const en = defaultInviteMessage("en", ev, [{ call: "anh Tuấn", name: "Tuấn" }]);
    expect(en).toContain("Hi Tuấn,");
    expect(en).toContain("“Họp OKR” on Thursday, Oct 1 · 14:00–15:00");
    expect(en).toContain("Join: https://meet.google.com/abc-defg-hij");
    const vi = defaultInviteMessage("vi", ev, [
      { call: "anh Tuấn", name: "Tuấn" },
      { call: "chị Linh", name: "Linh" },
    ]);
    expect(vi).toContain("Chào anh Tuấn, chị Linh,");
    expect(vi).toContain("Mai mời mọi người tham gia “Họp OKR” vào thứ Năm 1/10, 14:00–15:00");
    expect(vi).toContain("Link họp: https://meet.google.com/abc-defg-hij");
    expect(vi).not.toMatch(/\n\n\n/);
    const one = defaultInviteMessage("vi", { ...ev, meetUrl: undefined, location: "Tầng 5" }, [{ call: "anh Tuấn", name: "Tuấn" }]);
    expect(one).toContain("Mai mời anh tham gia");
    expect(one).toContain("Địa điểm: Tầng 5");
  });
});

describe("sau khi gửi: ai nhận, từ chối, chưa trả lời + nhắc follow-up", () => {
  const sent = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  const inv = (p: Partial<EventInvitee>): EventInvitee => ({ name: "Tuấn", email: "tuan@okr.vn", response: "no_reply", ...p });
  const ev = (p: Partial<CalEvent>): CalEvent => ({
    id: "e1",
    title: "Họp OKR",
    startAt: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
    endAt: new Date(NOW.getTime() + 3 * 86_400_000 + 3_600_000).toISOString(),
    kind: "event",
    ...p,
  });

  it("trạng thái Google/Lark → một kiểu chung; ghép theo email/open_id", () => {
    expect(["needsAction", "accepted", "declined", "tentative", "accept", "decline", "needs_action", "removed"].map(normalizeResponse)).toEqual([
      "no_reply",
      "accepted",
      "declined",
      "tentative",
      "accepted",
      "declined",
      "no_reply",
      "declined",
    ]);
    const out = applyResponses(
      [inv({ sentAt: sent(1) }), inv({ name: "Linh", email: undefined, larkOpenId: "ou_linh", sentAt: sent(1) })],
      [
        { email: "TUAN@okr.vn", response: "accepted" },
        { openId: "ou_linh", response: "decline" },
      ],
    );
    expect(out.map((i) => i.response)).toEqual(["accepted", "declined"]);
  });

  it("đếm + dòng tóm tắt", () => {
    const s = inviteStats([
      inv({ sentAt: sent(1), response: "accepted" }),
      inv({ sentAt: sent(1) }),
      inv({ sentAt: sent(1), response: "declined" }),
      inv({ error: "email sai" }),
      inv({}),
    ]);
    expect(s).toEqual({ accepted: 1, declined: 1, tentative: 0, noReply: 1, failed: 1, unsent: 1 });
    expect(inviteStatsLine(s)).toBe("1 nhận · 1 từ chối · 1 chưa trả lời · 1 gửi lỗi · 1 chưa gửi");
  });

  it("chưa trả lời sau 2 ngày → nhắc; mới 1 ngày thì chưa; Mai đã nhắc thì thôi; sự kiện đã qua thì thôi", () => {
    expect(followUpsDue([ev({ invitees: [inv({ sentAt: sent(3) })] })], NOW)[0].names).toEqual(["Tuấn"]);
    expect(followUpsDue([ev({ invitees: [inv({ sentAt: sent(1) })] })], NOW)).toEqual([]);
    expect(
      followUpsDue([ev({ invitees: [inv({ sentAt: sent(3) })], inviteFollowUpAt: sent(0.5) })], NOW),
    ).toEqual([]);
    expect(
      followUpsDue([ev({ startAt: sent(1), endAt: sent(0.9), invitees: [inv({ sentAt: sent(3) })] })], NOW),
    ).toEqual([]);
    expect(followUpsDue([ev({ invitees: [inv({ sentAt: sent(3), error: "bounce" })] })], NOW)).toEqual([]);
  });

  it("sự kiện trong 24 giờ tới: chưa trả lời sau 6 giờ đã nhắc", () => {
    const soon = ev({
      startAt: new Date(NOW.getTime() + 10 * 3_600_000).toISOString(),
      endAt: new Date(NOW.getTime() + 11 * 3_600_000).toISOString(),
      invitees: [inv({ sentAt: new Date(NOW.getTime() - 7 * 3_600_000).toISOString() })],
    });
    expect(followUpsDue([soon], NOW)).toHaveLength(1);
  });
});

describe("câu lệnh mời họp (chat/voice)", () => {
  it("nhận yêu cầu link họp", () => {
    expect(meetLinkRequest("Thứ Năm 2 giờ họp với anh Tuấn, tạo link Meet")).toBe("meet");
    expect(meetLinkRequest("tạo link Lark cho buổi này")).toBe("lark");
    expect(meetLinkRequest("họp online với Linh")).toBe("any");
    expect(meetLinkRequest("gửi link Zoom cho anh Tuấn")).toBe("zoom");
    expect(meetLinkRequest("họp OKR thứ Năm")).toBeUndefined();
  });

  it("tách người mời: “họp với …”, “mời …”, “meeting with …”", () => {
    expect(extractInvitees("Thứ Năm 2 giờ họp với anh Tuấn và chị Linh, tạo link Meet").names).toEqual([
      "anh Tuấn",
      "chị Linh",
    ]);
    const m = extractInvitees("họp OKR thứ Năm 2h, mời anh Tuấn bên OKR và chị Linh");
    expect(m.names).toEqual(["anh Tuấn bên OKR", "chị Linh"]);
    expect(m.span).toContain("mời anh Tuấn bên OKR");
    expect(extractInvitees("meeting with Tuan and Linh on Friday").names).toEqual(["Tuan", "Linh"]);
    expect(extractInvitees("họp với anh Tuấn thứ Sáu").names).toEqual(["anh Tuấn"]);
    expect(extractInvitees("gặp anh Tuấn thứ Sáu").names).toEqual([]);
  });

  it("PRD: “Thứ Năm 2 giờ họp với anh Tuấn và chị Linh, tạo link Meet” → lịch 14:00 + 2 người mời + link Meet", () => {
    const r = parseCommand("Thứ Năm 2 giờ họp với anh Tuấn và chị Linh, tạo link Meet", NOW);
    expect(r.actions).toHaveLength(1);
    const a = r.actions[0];
    expect(a.kind).toBe("event");
    if (a.kind !== "event") return;
    expect(a.title).toBe("Họp với anh Tuấn và chị Linh");
    expect(a.invitees).toEqual(["anh Tuấn", "chị Linh"]);
    expect(a.meetLink).toBe("meet");
    const at = new Date(a.startAt!);
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([24, 14, 0]);
  });

  it("“họp OKR thứ Năm 2h, mời anh Tuấn bên OKR và chị Linh” → tiêu đề gọn “Họp OKR”", () => {
    const a = parseCommand("họp OKR thứ Năm 2h, mời anh Tuấn bên OKR và chị Linh", NOW).actions[0];
    expect(a.kind === "event" && [a.title, a.invitees]).toEqual(["Họp OKR", ["anh Tuấn bên OKR", "chị Linh"]]);
  });

  it("“mời anh Tuấn thứ Sáu 10h” (không chữ họp) vẫn là lịch; giờ buổi sáng giữ nguyên", () => {
    const a = parseCommand("mời anh Tuấn thứ Sáu 10h", NOW).actions[0];
    expect(a.kind).toBe("event");
    expect(a.kind === "event" && new Date(a.startAt!).getHours()).toBe(10);
  });

  it("“4 giờ sáng bay” không bị đẩy sang chiều; “11 giờ đêm” = 23:00 (biên Unicode)", () => {
    const a = parseCommand("thứ Sáu 4 giờ sáng bay đi Tokyo", NOW).actions[0];
    expect(a.kind === "event" && new Date(a.startAt!).getHours()).toBe(4);
    expect(parseWhen("nhắc chị 11 giờ đêm", NOW).at!.getHours()).toBe(23);
  });
});

describe("người mời lưu kèm sự kiện + ghép kết quả gửi", () => {
  it("dòng trên thẻ → người được mời CHƯA gửi; cách gọi + tiếng Việt giữ lại", () => {
    const d = resolveInvitee("anh Tuấn bên OKR", POOL);
    expect(inviteeFromDraft(d)).toEqual({
      name: "Nguyễn Anh Tuấn",
      call: "anh Tuấn",
      lang: "vi",
      email: "tuan@okr.vn",
      contactId: "ct:tuanokr",
      larkOpenId: undefined,
      response: "no_reply",
    });
    expect(inviteeFromDraft(resolveInvitee("john@acme.com", POOL)).lang).toBeUndefined();
  });

  it("ghép kết quả gửi theo email / open_id; người mới thêm vào cuối", () => {
    const base: EventInvitee[] = [
      { name: "Tuấn", email: "tuan@okr.vn", response: "no_reply" },
      { name: "Linh", larkOpenId: "ou_linh", response: "no_reply" },
    ];
    const out = mergeInvitees(base, [
      { name: "Tuấn", email: "TUAN@okr.vn", response: "no_reply", sentAt: "2026-09-23T03:00:00.000Z" },
      { name: "Hà", email: "ha@x.vn", response: "no_reply", error: "email không hợp lệ" },
    ]);
    expect(out.map((i) => [i.name, Boolean(i.sentAt), i.error ?? ""])).toEqual([
      ["Tuấn", true, ""],
      ["Linh", false, ""],
      ["Hà", false, "email không hợp lệ"],
    ]);
  });
});

describe("bot: email / số điện thoại của người khác là RIÊNG TƯ (§5.4 v3.9)", () => {
  it("hỏi email/sđt trong group → private, không đọc ra", () => {
    for (const q of [
      "@_user_1 email của anh Tuấn là gì?",
      "cho xin sđt chị Linh",
      "what's Tuan's email?",
      "Linh's phone number please",
      "send me the contact info of Do Thi",
      "อีเมลของคุณลินห์คืออะไร",
    ]) {
      expect(parseBotCommand(q).kind, q).toBe("private");
    }
    // Ghi việc có chữ "email" vẫn là việc (lệnh đứng trước kiểm tra riêng tư).
    expect(parseBotCommand("add task: email the deck to Tuan").kind).toBe("task");
  });
});

describe("bot hiểu tiếng Thái (PRD v3.9)", () => {
  it("lệnh: เพิ่มงาน / มอบหมาย…ให้ / เตือน / บันทึกการตัดสินใจ / สรุป / งานค้าง", () => {
    expect(parseBotCommand("@_user_1 เพิ่มงาน: ส่งใบเสนอราคาวันศุกร์")).toEqual({ kind: "task", text: "ส่งใบเสนอราคาวันศุกร์" });
    expect(parseBotCommand("มอบหมายงานส่งสไลด์ให้คุณลินห์ ภายในวันพุธ")).toEqual({
      kind: "assign",
      text: "ส่งสไลด์ให้คุณลินห์ ภายในวันพุธ",
      assignee: "ลินห์",
    });
    expect(parseBotCommand("เตือนคุณลินห์ พรุ่งนี้ส่งสไลด์")).toMatchObject({ kind: "remind", assignee: "ลินห์" });
    expect(parseBotCommand("เตือนฉันโทรหา OKR พรุ่งนี้")).toEqual({ kind: "remind", text: "โทรหา OKR พรุ่งนี้" });
    expect(parseBotCommand("บันทึกการตัดสินใจ: ทดลอง 6 สัปดาห์")).toEqual({ kind: "decision", text: "ทดลอง 6 สัปดาห์" });
    expect(parseBotCommand("สรุป ๒ วันที่ผ่านมา")).toEqual({ kind: "summary", hours: 48 });
    expect(parseBotCommand("สรุปสัปดาห์นี้")).toEqual({ kind: "summary", hours: 168 });
    expect(parseBotCommand("งานค้างมีอะไรบ้าง").kind).toBe("status");
    expect(parseBotCommand("มายอยู่ที่ไหน").kind).toBe("private");
  });

  it("ngày giờ tiếng Thái", () => {
    const d = (s: string) => {
      const w = parseWhenTh(s, NOW);
      return w.at ? [w.at.getMonth() + 1, w.at.getDate(), w.at.getHours(), w.at.getMinutes()] : null;
    };
    expect(d("ส่งใบเสนอราคาวันศุกร์")).toEqual([9, 25, 9, 0]);
    expect(d("พรุ่งนี้ บ่ายสาม")).toEqual([9, 24, 15, 0]);
    expect(d("วันจันทร์หน้า 10:30")).toEqual([9, 28, 10, 30]);
    expect(d("ภายในสิ้นเดือน")).toEqual([9, 30, 9, 0]);
    expect(d("วันนี้ 15.00 น.")).toEqual([9, 23, 15, 0]);
    expect(d("3 ทุ่ม")).toEqual([9, 23, 21, 0]);
    expect(d("มะรืนนี้ 9 โมงเช้า")).toEqual([9, 25, 9, 0]);
    expect(d("วันอาทิตย์หน้า")).toEqual([10, 4, 9, 0]);
    expect(d("อาทิตย์หน้า")).toEqual([9, 28, 9, 0]);
    expect(d("ขอบคุณครับ")).toBeNull();
  });

  it("thẻ duyệt từ lệnh Thái: hạn đúng, tiêu đề sạch, người làm tách riêng", () => {
    const d = larkItemToDraft(
      { id: "om_th", kind: "assign", text: "ส่งสไลด์ให้คุณลินห์ ภายในวันพุธ", assignee: "ลินห์", chatId: "oc_x", chatType: "group", at: NOW.toISOString() },
      { projects: DEFAULT_PROJECTS, categories: DEFAULT_CATEGORIES, clients: [], feedback: [] },
    );
    expect(d.title).toBe("ส่งสไลด์");
    expect(d.assignee).toBe("ลินห์");
    const due = new Date(d.dueAt!);
    expect([due.getMonth() + 1, due.getDate(), due.getHours()]).toEqual([9, 30, 9]);
  });
});

describe("ngày tiếng Anh: end of month (PRD v3.9)", () => {
  it("“by end of month” / “EOM” → ngày cuối tháng 9:00", () => {
    for (const s of ["send the report by end of month", "update deck EOM", "close books end of the month"]) {
      const w = parseWhenEn(s, NOW);
      expect([w.at!.getMonth() + 1, w.at!.getDate(), w.at!.getHours()], s).toEqual([9, 30, 9]);
    }
  });
});

describe("PRD v3.9 ví dụ: “đặt 2 tiếng thứ Năm cho pitch deck Sorene” → book lịch (không phải việc)", () => {
  it("thời lượng + “cho X”, ngày đứng trước → book_task 120 phút thứ Năm", () => {
    const r = parseCommand("Tuần này dời spa sang thứ Năm, và đặt 2 tiếng thứ Năm cho pitch deck Sorene", NOW);
    expect(r.actions.map((a) => a.kind)).toEqual(["reschedule", "book_task"]);
    const b = r.actions[1];
    expect(b.kind === "book_task" && [b.what, b.durationMinutes, new Date(b.day!).getDate()]).toEqual([
      "Pitch deck Sorene",
      120,
      24,
    ]);
    // Cách nói cũ vẫn chạy.
    const old = parseCommand("book 2 tiếng cho việc pitch deck thứ Năm", NOW).actions[0];
    expect(old.kind === "book_task" && old.what).toBe("Pitch deck");
  });

  it("tìm việc đang mở theo tên Mai nói — bỏ tên dự án / chữ thừa ở hai đầu", () => {
    const tasks = [
      { title: "Chuẩn bị pitch deck", status: "todo" },
      { title: "Gửi báo giá OKR", status: "done" },
      { title: "Làm báo cáo tháng", status: "doing" },
    ];
    expect(matchTaskByName(tasks, "Pitch deck Sorene")?.title).toBe("Chuẩn bị pitch deck");
    expect(matchTaskByName(tasks, "làm pitch deck")?.title).toBe("Chuẩn bị pitch deck");
    expect(matchTaskByName(tasks, "bao cao thang")?.title).toBe("Làm báo cáo tháng");
    // Việc đã xong không tính; chữ ngắn đứng một mình ("làm") không khớp bừa.
    expect(matchTaskByName(tasks, "báo giá OKR")).toBeUndefined();
    expect(matchTaskByName(tasks, "làm")).toBeUndefined();
  });
});
