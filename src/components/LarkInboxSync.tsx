"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { pullLarkInbox } from "@/lib/larkInbox";
import { useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";

/**
 * Chạy nền ở layout khi có tài khoản Lark + hàng đợi bot: kéo việc từ
 * group về Hộp duyệt — 15 giây/lần khi đang ở Hộp duyệt, 1 phút ở màn
 * khác, và ngay khi Mai quay lại app. Chỉ chạy SAU khi store đã nạp
 * (kéo trước lúc nạp thì thẻ mới bị localStorage ghi đè mất).
 */
export function LarkInboxSync() {
  const path = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (useStore.persist.hasHydrated()) setHydrated(true);
    return useStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/google/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { larkInbox?: boolean }) => alive && setEnabled(Boolean(d.larkInbox)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await pullLarkInbox();
        if (r.error === "not-owner" || r.error === "not-connected") setEnabled(false);
        if (r.added > 0 && pathRef.current !== "/hop-duyet") {
          showToast({
            text: `📥 ${r.added} mục mới từ Lark đang chờ Mai duyệt`,
            ttlMs: 10_000,
            actions: [{ label: "Xem", primary: true, run: () => router.push("/hop-duyet") }],
          });
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const iv = window.setInterval(() => void tick(), path === "/hop-duyet" ? 15_000 : 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, hydrated, path, router]);

  return null;
}
