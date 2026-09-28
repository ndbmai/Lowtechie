import { NextResponse, type NextRequest } from "next/server";
import { isEmail } from "@/core/contacts";
import { writeAccount } from "@/lib/accounts";
import { larkTarget, targetAccount } from "@/lib/calendarTarget";
import { CAL_BASE, accessToken, type GoogleLink } from "@/lib/googleServer";
import { larkAddAttendees, larkPatchEvent, type InviteTarget } from "@/lib/larkServer";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GỬI LỜI MỜI (§5.4 v3.9) — CHỈ gọi sau bước Mai xác nhận riêng ("Gửi mời
 * cho N người"), kể cả khi Mai bật book thẳng cho loại lịch khác. Google:
 * thêm khách + sendUpdates=all (Google gửi thư mời kèm link Meet); Lark:
 * API attendees + need_notification. Lời nhắn Mai soạn nằm đầu phần mô tả.
 * Gửi lỗi / email sai → trả kết quả TỪNG NGƯỜI để app báo lại kèm tên.
 */

interface Person extends InviteTarget {
  name?: string;
}

interface PersonResult {
  email?: string;
  openId?: string;
  ok: boolean;
  error?: string;
}

const DEFAULT_MARK = "Tạo bởi Mai Lowtechie 🌼";

/** Lời nhắn mới đứng đầu, mô tả cũ (trừ dấu mặc định) giữ phía sau. */
function withMessage(message: string, existing: string | undefined): string {
  const base = (existing ?? "").replace(DEFAULT_MARK, "").trim();
  if (!base || base === message.trim()) return message.trim();
  return `${message.trim()}\n\n${base}`.slice(0, 4000);
}

function googleError(status: number, detail: string): string {
  if (status === 400) return `email không hợp lệ hoặc Google từ chối (${detail || status})`;
  if (status === 403) return "không có quyền sửa sự kiện này — chỉ người tạo mới mời thêm được";
  if (status === 404 || status === 410) return "sự kiện không còn trên Google";
  if (status === 401) return "phiên Google hết hạn — Kết nối lại";
  return `Google báo lỗi (mã ${status})`;
}

function larkError(raw: string): string {
  const code = raw.match(/lark-(\w+)/)?.[1] ?? raw;
  if (code.startsWith("99991") || code === "403")
    return `Lark chưa cho mời người — vào Kết nối bấm “Bật quyền mời người” (cần quyền “Update event” · calendar:calendar.event:update ở tab User token scopes, đã phát hành) (mã ${code})`;
  if (code === "190003" || code === "193001")
    return `email/người dùng không hợp lệ (mã ${code})`;
  return `Lark báo lỗi (mã ${code})`;
}

async function inviteGoogle(
  link: GoogleLink,
  eventId: string,
  people: Person[],
  title: string | undefined,
  message: string | undefined,
): Promise<{ results: PersonResult[]; detailsOk: boolean }> {
  const at = await accessToken(link);
  if (!at) return { results: people.map((p) => ({ email: p.email, ok: false, error: "phiên Google hết hạn — Kết nối lại" })), detailsOk: false };
  const url = `${CAL_BASE}/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const cur = await fetch(url, { headers: { authorization: `Bearer ${at}` } });
  if (!cur.ok) {
    const err = googleError(cur.status, "");
    return { results: people.map((p) => ({ email: p.email, ok: false, error: err })), detailsOk: false };
  }
  const ev = (await cur.json()) as {
    summary?: string;
    description?: string;
    attendees?: { email?: string; displayName?: string }[];
  };
  const attendees = [...(ev.attendees ?? [])];
  const has = (email: string) => attendees.some((a) => (a.email ?? "").toLowerCase() === email.toLowerCase());
  const details: Record<string, unknown> = {};
  if (title && title !== ev.summary) details.summary = title.slice(0, 200);
  if (message?.trim()) details.description = withMessage(message, ev.description);

  const patch = async (list: typeof attendees, extra: Record<string, unknown>) => {
    const res = await fetch(`${url}?sendUpdates=all`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
      body: JSON.stringify({ attendees: list, ...extra }),
    });
    const detail = res.ok
      ? ""
      : ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "";
    return { ok: res.ok, status: res.status, detail };
  };

  const toAdd = people.filter((p) => p.email && !has(p.email));
  const results: PersonResult[] = people
    .filter((p) => !p.email)
    .map((p) => ({ openId: p.openId, ok: false, error: "thiếu email" }));
  // Người đã có trong danh sách khách → coi như đã mời.
  for (const p of people) if (p.email && has(p.email)) results.push({ email: p.email, ok: true });
  if (!toAdd.length) {
    const r = Object.keys(details).length ? await patch(attendees, details) : { ok: true };
    return { results, detailsOk: r.ok };
  }

  const all = await patch(
    [...attendees, ...toAdd.map((p) => ({ email: p.email!, displayName: p.name }))],
    details,
  );
  if (all.ok) return { results: [...results, ...toAdd.map((p) => ({ email: p.email, ok: true }))], detailsOk: true };
  if (toAdd.length === 1 || all.status !== 400) {
    const err = googleError(all.status, all.detail);
    return { results: [...results, ...toAdd.map((p) => ({ email: p.email, ok: false, error: err }))], detailsOk: false };
  }
  // Một địa chỉ hỏng làm hỏng cả lần gửi → thử từng người để báo đúng tên.
  let detailsOk = false;
  for (const p of toAdd) {
    const r = await patch([...attendees, { email: p.email!, displayName: p.name }], detailsOk ? {} : details);
    if (r.ok) {
      attendees.push({ email: p.email!, displayName: p.name });
      detailsOk = true;
      results.push({ email: p.email, ok: true });
    } else {
      results.push({ email: p.email, ok: false, error: googleError(r.status, r.detail) });
    }
  }
  return { results, detailsOk };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* 400 bên dưới */
  }
  const str = (k: string, max: number) =>
    typeof body[k] === "string" ? (body[k] as string).slice(0, max) : undefined;
  const raw = Array.isArray(body.attendees) ? (body.attendees as Record<string, unknown>[]).slice(0, 30) : [];
  const people: Person[] = raw
    .map((a) => ({
      email: typeof a.email === "string" ? a.email.trim().toLowerCase() : undefined,
      openId: typeof a.openId === "string" ? a.openId.slice(0, 80) : undefined,
      name: typeof a.name === "string" ? a.name.slice(0, 80) : undefined,
    }))
    .filter((p) => p.email || p.openId);
  if (!people.length) return NextResponse.json({ error: "Chưa có ai để mời" }, { status: 400 });

  // Email sai định dạng → báo ngay theo tên, không gửi đi.
  const bad = people.filter((p) => p.email && !isEmail(p.email) && !p.openId);
  const good = people.filter((p) => !bad.includes(p));
  const badResults: PersonResult[] = bad.map((p) => ({ email: p.email, ok: false, error: "email không đúng định dạng" }));

  const target = await targetAccount(req, str("account", 64) ?? null);
  if (!target) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  const { id } = await params;
  const title = str("title", 200);
  const message = str("message", 3000);

  if (target.provider === "google") {
    // Google mời bằng email — người chỉ có open_id Lark thì cần email.
    const r = good.length
      ? await inviteGoogle(target.link as GoogleLink, id, good, title, message)
      : { results: [] as PersonResult[], detailsOk: false };
    return NextResponse.json({ results: [...r.results, ...badResults], detailsOk: r.detailsOk });
  }

  const t = await larkTarget(target, str("calendarId", 200) ?? null);
  if (!t) return NextResponse.json({ error: "not-connected" }, { status: 401 });
  let detailsOk = true;
  if (title || message?.trim()) {
    // Tên + lời nhắn trước, rồi mới thêm người (Lark gửi mời kèm nội dung mới).
    detailsOk = await larkPatchEvent(t.at, t.calendarId, id, {
      title: title || undefined,
      description: message?.trim() ? message.trim() : undefined,
    });
  }
  const results: PersonResult[] = [...badResults];
  if (good.length) {
    const all = await larkAddAttendees(t.at, t.calendarId, id, good);
    if (all.ok) results.push(...good.map((p) => ({ email: p.email, openId: p.openId, ok: true })));
    else if (good.length === 1) results.push({ email: good[0].email, openId: good[0].openId, ok: false, error: larkError(all.error) });
    else {
      for (const p of good) {
        const r = await larkAddAttendees(t.at, t.calendarId, id, [p]);
        results.push(r.ok ? { email: p.email, openId: p.openId, ok: true } : { email: p.email, openId: p.openId, ok: false, error: larkError(r.error) });
      }
    }
  }
  const res = NextResponse.json({ results, detailsOk });
  if (t.changed) await writeAccount(res, req.nextUrl.origin, target.id, "lark", t.link);
  return res;
}
