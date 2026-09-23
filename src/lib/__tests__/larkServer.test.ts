import { afterEach, describe, expect, it, vi } from "vitest";
import {
  larkErrorAction,
  larkEventsAllCalendars,
  larkListCalendars,
  larkListEvents,
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
