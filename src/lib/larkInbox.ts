"use client";

import { groupLarkItems, larkItemToDraft, type LarkInboxItem } from "@/core/larkInbox";
import { useStore } from "@/lib/store";

/**
 * Kéo các mục bot Lark đã nhận trong group về Hộp duyệt (§5.5.1 bước 7):
 * dựng thẻ ở máy Mai (ngày giờ theo giờ thiết bị, dự án/khách theo group
 * đã gắn), mục cùng gói tóm tắt đi chung một nhóm, rồi xóa khỏi hàng đợi.
 */
export async function pullLarkInbox(): Promise<{ added: number; error?: string }> {
  let items: LarkInboxItem[] = [];
  try {
    const res = await fetch("/api/lark/inbox", { cache: "no-store" });
    const d = (await res.json().catch(() => ({}))) as { items?: LarkInboxItem[]; error?: string };
    if (!res.ok) return { added: 0, error: d.error ?? `HTTP ${res.status}` };
    items = Array.isArray(d.items) ? d.items : [];
  } catch {
    return { added: 0, error: "network" };
  }
  if (!items.length) return { added: 0 };

  const st = useStore.getState();
  const fresh = items.filter((it) => it && typeof it.id === "string" && !st.larkImported.includes(it.id));
  for (const group of groupLarkItems(fresh)) {
    const drafts = group.map((it) =>
      larkItemToDraft(it, {
        projects: st.projects,
        categories: st.categories,
        clients: st.clients,
        feedback: st.feedback,
        group: st.larkGroups[it.chatId],
      }),
    );
    st.addTriageGroup(drafts);
  }
  st.markLarkImported(fresh.map((it) => it.id));

  // Xóa khỏi hàng đợi theo lô nhỏ (kể cả mục đã nhận ở tab khác).
  const ids = items.map((it) => it.id);
  for (let i = 0; i < ids.length; i += 40) {
    await fetch(`/api/lark/inbox?ids=${encodeURIComponent(ids.slice(i, i + 40).join(","))}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }
  return { added: fresh.length };
}
