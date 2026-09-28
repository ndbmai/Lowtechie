import { NextResponse, type NextRequest } from "next/server";
import { peopleFromHeaders } from "@/core/contacts";
import { accountsWith, readAccounts, writeAccount, type Account, type LarkLink } from "@/lib/accounts";
import { accessToken, type GoogleLink } from "@/lib/googleServer";
import { isBotConfigured, larkBotChats, larkChatMembers, larkMemberEmail } from "@/lib/larkBot";
import { ownerOpenId } from "@/lib/larkOwner";
import { larkMailPeople, larkTokenFor } from "@/lib/larkServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Danh bạ liên hệ tự hình thành (§5.4 v3.9): người Mai GỬI THƯ tới + người
 * gửi thư chính cho Mai (Gmail, Lark Mail) và thành viên các group Lark có
 * bot. Chỉ ĐỌC header người gửi/nhận — không đọc nội dung thư; kết quả trả
 * về máy của Mai (local-first), server không lưu gì.
 */

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

interface OutPerson {
  name: string;
  email?: string;
  company?: string;
  larkOpenId?: string;
  source: "mail" | "lark_group";
  count?: number;
}

async function gmailHeaders(at: string, q: string, max: number, names: string[]): Promise<string[]> {
  const list = await fetch(`${GMAIL}/messages?${new URLSearchParams({ q, maxResults: String(max) })}`, {
    headers: { authorization: `Bearer ${at}` },
  });
  if (!list.ok) throw new Error(`gmail-${list.status}`);
  const ids = (((await list.json()) as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
  const out: string[] = [];
  // 8 lời gọi song song một lượt — đủ nhanh mà không bị Gmail giới hạn tốc độ.
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(
      ids.slice(i, i + 8).map(async (id) => {
        const p = new URLSearchParams({ format: "metadata" });
        for (const n of names) p.append("metadataHeaders", n);
        const r = await fetch(`${GMAIL}/messages/${id}?${p}`, { headers: { authorization: `Bearer ${at}` } });
        if (!r.ok) return "";
        const d = (await r.json()) as { payload?: { headers?: { name: string; value: string }[] } };
        return (d.payload?.headers ?? []).map((h) => h.value).join(", ");
      }),
    );
    out.push(...batch.filter(Boolean));
  }
  return out;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const accounts = await readAccounts(req);
  const self = accounts.map((a) => a.email).filter((e): e is string => Boolean(e));
  const notes: string[] = [];
  const people: OutPerson[] = [];
  const rotated: { account: Account; link: LarkLink }[] = [];

  for (const a of accountsWith(accounts, "mail").slice(0, 4)) {
    const label = a.email ?? (a.provider === "lark" ? "Lark Mail" : "Gmail");
    try {
      if (a.provider === "google") {
        if (!a.gm) {
          notes.push(`${label}: chưa cấp quyền đọc Gmail — Kết nối lại để nhập liên hệ`);
          continue;
        }
        const at = await accessToken(a.link as GoogleLink);
        if (!at) throw new Error("token");
        const sent = await gmailHeaders(at, "in:sent newer_than:1y", 60, ["To", "Cc"]);
        const inbox = await gmailHeaders(at, "in:inbox category:primary newer_than:180d", 30, ["From"]);
        for (const p of peopleFromHeaders([...sent, ...inbox], self)) people.push({ ...p, source: "mail" });
      } else {
        const tokens = await larkTokenFor(a.link as LarkLink);
        if (!tokens) throw new Error("token");
        if (tokens.changed) rotated.push({ account: a, link: tokens.link });
        const mail = await larkMailPeople(tokens.at, 30);
        if ("error" in mail) {
          notes.push(`${label}: Lark Mail chưa đọc được (${mail.error}) — kiểm tra quyền Mail API`);
          continue;
        }
        for (const p of peopleFromHeaders(mail.headers, self)) people.push({ ...p, source: "mail" });
      }
    } catch (e) {
      notes.push(`${label}: chưa đọc được hộp thư (${e instanceof Error ? e.message : "lỗi"})`);
    }
  }

  // Thành viên group Lark có bot (tên + open_id; email nếu app có quyền danh bạ).
  if (isBotConfigured()) {
    try {
      const owner = await ownerOpenId();
      const members = new Map<string, string>();
      for (const chat of (await larkBotChats()).slice(0, 10)) {
        for (const [id, name] of await larkChatMembers(chat.id)) if (id !== owner) members.set(id, name);
      }
      let emailOk = true;
      let asked = 0;
      for (const [openId, name] of members) {
        let email: string | undefined;
        if (emailOk && asked < 60) {
          asked++;
          try {
            email = await larkMemberEmail(openId);
          } catch (e) {
            emailOk = false;
            notes.push(
              `Thành viên group Lark: chưa đọc được email (${e instanceof Error ? e.message : "lỗi"}) — thêm quyền contact:user.email:readonly ở tab Tenant token scopes nếu cần; mời vào lịch Lark vẫn được`,
            );
          }
        }
        people.push({ name, email: email?.toLowerCase(), larkOpenId: openId, source: "lark_group" });
      }
    } catch (e) {
      notes.push(`Group Lark: chưa đọc được thành viên (${e instanceof Error ? e.message : "lỗi"})`);
    }
  }

  const res = NextResponse.json({ people: people.slice(0, 400), notes: notes.length ? notes : undefined });
  for (const r of rotated) await writeAccount(res, req.nextUrl.origin, r.account.id, "lark", r.link);
  return res;
}
