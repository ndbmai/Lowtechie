import { afterEach, describe, expect, it, vi } from "vitest";
import {
  larkAuthUrl,
  larkErrorAction,
  larkEventsAllCalendars,
  larkExchangeCode,
  larkListCalendars,
  larkListEvents,
  larkScopeHasCalendar,
} from "../larkServer";

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ev(id: string) {
  return {
    event_id: id,
    summary: id,
    start_time: { timestamp: "1000" },
    end_time: { timestamp: "2000" },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("larkServer v3.2 — lỗi thật 23/9: lịch Lark 'trống' im lặng", () => {
  it("HTTP 200 kèm code != 0 phải NÉM lỗi, không trả danh sách rỗng", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ code: 99991663, msg: "token invalid" })));
    await expect(larkListCalendars("at")).rejects.toThrow("lark-99991663");
    await expect(larkListEvents("at", "cal1", 0, 1000)).rejects.toThrow("lark-99991663");
  });

  it("phân trang page_token đến hết — tháng dày sự kiện không bị cắt trang đầu", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (!String(url).includes("page_token")) {
        return res({ code: 0, data: { items: [ev("e1")], has_more: true, page_token: "p2" } });
      }
      return res({ code: 0, data: { items: [ev("e2")], has_more: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const got = await larkListEvents("at", "cal1", 0, 10_000_000);
    expect(got.map((e) => e.gcalId)).toEqual(["e1", "e2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("đọc MỌI lịch con (bỏ resource), khử trùng id, 1 lịch lỗi không làm rỗng cả tài khoản", async () => {
    const called: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes("/calendars?")) {
          return res({
            code: 0,
            data: {
              calendar_list: [
                { calendar_id: "c1", summary: "Chính", type: "primary" },
                { calendar_id: "c2", summary: "Nhóm The Circle", type: "shared" },
                { calendar_id: "c3", summary: "Phòng họp", type: "resource" },
                { calendar_id: "c4", summary: "Hỏng quyền", type: "shared" },
              ],
              has_more: false,
            },
          });
        }
        const cal = u.match(/calendars\/(\w+)\/events/)?.[1] ?? "?";
        called.push(cal);
        if (cal === "c1") return res({ code: 0, data: { items: [ev("e1"), ev("dup")] } });
        if (cal === "c2") return res({ code: 0, data: { items: [ev("e2"), ev("dup")] } });
        return res({ code: 1901001, msg: "no perm" });
      }),
    );
    const got = await larkEventsAllCalendars("at", 0, 10_000_000);
    expect(got.calendars).toBe(3); // c3 (resource) bị loại khỏi danh sách đọc
    expect(called).not.toContain("c3");
    expect(got.events.map((e) => e.gcalId).sort()).toEqual(["dup", "e1", "e2"]);
    // v3.2: soi được từng lịch con — lịch nào góp mấy sự kiện, lịch nào hỏng.
    expect(got.perCalendar).toEqual([
      { name: "Chính", events: 2 },
      { name: "Nhóm The Circle", events: 1 },
      { name: "Hỏng quyền", events: 0, error: "lark-1901001" },
    ]);
  });

  it("sự kiện LẶP LẠI bung thành từng buổi — cùng event_id khác giờ phải GIỮ ĐỦ (lỗi thật '6 lịch con · 0 sự kiện')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes("/calendars?")) {
          return res({
            code: 0,
            data: {
              calendar_list: [{ calendar_id: "c1", summary: "Chính", type: "primary" }],
              has_more: false,
            },
          });
        }
        expect(u).toContain("/events/instance_view?");
        return res({
          code: 0,
          data: {
            items: [
              { event_id: "r1", summary: "Họp tuần", start_time: { timestamp: "1000" }, end_time: { timestamp: "2000" } },
              { event_id: "r1", summary: "Họp tuần", start_time: { timestamp: "605800" }, end_time: { timestamp: "606800" } },
            ],
          },
        });
      }),
    );
    const got = await larkEventsAllCalendars("at", 0, 1_000_000_000);
    expect(got.events).toHaveLength(2);
    expect(got.perCalendar).toEqual([{ name: "Chính", events: 2 }]);
  });

  it("khoảng >30 ngày chia thành nhiều cửa sổ instance_view", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/calendars?")) {
        return res({
          code: 0,
          data: {
            calendar_list: [{ calendar_id: "c1", summary: "Chính", type: "primary" }],
            has_more: false,
          },
        });
      }
      return res({ code: 0, data: { items: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await larkEventsAllCalendars("at", 0, 45 * 86_400_000);
    const views = fetchMock.mock.calls.filter((c) => String(c[0]).includes("instance_view"));
    expect(views).toHaveLength(2);
  });

  it("lịch không hỗ trợ instance_view → rơi về /events, không mất lịch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes("/calendars?")) {
          return res({
            code: 0,
            data: {
              calendar_list: [{ calendar_id: "c1", summary: "Chính", type: "primary" }],
              has_more: false,
            },
          });
        }
        if (u.includes("instance_view")) return res({ code: 190403, msg: "not supported" });
        return res({ code: 0, data: { items: [ev("e1")] } });
      }),
    );
    const got = await larkEventsAllCalendars("at", 0, 1000);
    expect(got.events.map((e) => e.gcalId)).toEqual(["e1"]);
    expect(got.perCalendar).toEqual([{ name: "Chính", events: 1 }]);
  });

  it("MỌI lịch cùng lỗi → ném lỗi đầu để màn hình nói rõ, không im lặng", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("/calendars?")) {
          return res({
            code: 0,
            data: {
              calendar_list: [{ calendar_id: "c1", summary: "Chính", type: "primary" }],
              has_more: false,
            },
          });
        }
        return res({ code: 99991668, msg: "expired" });
      }),
    );
    await expect(larkEventsAllCalendars("at", 0, 1000)).rejects.toThrow("lark-99991668");
  });

  it("không có lịch con nào → lark-nocal (0 sự kiện phải có lý do)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res({ code: 0, data: { calendar_list: [], has_more: false } })),
    );
    await expect(larkEventsAllCalendars("at", 0, 1000)).rejects.toThrow("lark-nocal");
  });
});

describe("larkAuthUrl — token người dùng CHỈ mang scope đã xin", () => {
  it("xin offline_access + 4 scope lịch DẠNG CON app đã khai (xin scope cha chưa khai → 20027 chặn đăng nhập)", () => {
    process.env.LARK_APP_ID = "cli_test";
    delete process.env.LARK_OAUTH_SCOPES;
    const u = new URL(larkAuthUrl("https://lowtechie.vercel.app", "st1"));
    expect(u.searchParams.get("scope")).toBe(
      "offline_access calendar:calendar:readonly calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:delete",
    );
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://lowtechie.vercel.app/api/lark/callback",
    );
    expect(u.searchParams.get("client_id")).toBe("cli_test");
  });

  it("LARK_OAUTH_SCOPES ghi đè danh sách scope — đổi khai báo console không cần deploy", () => {
    process.env.LARK_APP_ID = "cli_test";
    process.env.LARK_OAUTH_SCOPES = "offline_access calendar:calendar";
    const u = new URL(larkAuthUrl("https://lowtechie.vercel.app", "st1"));
    expect(u.searchParams.get("scope")).toBe("offline_access calendar:calendar");
    delete process.env.LARK_OAUTH_SCOPES;
  });
});

describe("scope Lark THẬT SỰ cấp — bắt ca nhớ-lần-cho-phép-cũ", () => {
  it("larkExchangeCode trả kèm scope từ phản hồi token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        res({ access_token: "at1", refresh_token: "rt1", scope: "offline_access" }),
      ),
    );
    const got = await larkExchangeCode("code1", "https://lowtechie.vercel.app");
    expect(got).toEqual({ at: "at1", rt: "rt1", scope: "offline_access" });
  });

  it("scope thiếu calendar → phát hiện; có calendar → ổn; không trả scope → không chặn oan", () => {
    expect(larkScopeHasCalendar("offline_access")).toBe(false);
    expect(larkScopeHasCalendar("offline_access calendar:calendar.event:read")).toBe(true);
    expect(larkScopeHasCalendar(undefined)).toBe(true);
  });
});

describe("larkErrorAction — lỗi phải CÓ VIỆC ĐỂ LÀM (PRD v3.2)", () => {
  it("token hết hạn → bảo Kết nối lại", () => {
    expect(larkErrorAction("token")).toContain("Kết nối lại");
  });
  it("99991xxx → nhắc admin duyệt quyền Calendar", () => {
    expect(larkErrorAction("lark-99991663")).toContain("admin");
  });
  it("190xxxx → nhắc quyền đọc lịch", () => {
    expect(larkErrorAction("lark-19010002")).toContain("quyền đọc lịch");
  });
  it("nocal → nói rõ chưa thấy lịch con", () => {
    expect(larkErrorAction("lark-nocal")).toContain("lịch con");
  });
  it("mã lạ → vẫn có hướng thử lại, không cụt lủn", () => {
    expect(larkErrorAction("lark-8888")).toContain("Đồng bộ ngay");
  });
});
