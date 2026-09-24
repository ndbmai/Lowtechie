"use client";

import { useEffect, useState } from "react";
import { getFile } from "@/lib/fileStore";

/**
 * Nút mở ảnh banner đính vào sự kiện (v3.0) — thẻ <a> nạp SẴN object
 * URL qua useEffect: window.open sau await bị Safari/PWA chặn (bài học
 * popup của nút "Mở" vé máy bay).
 */
export function BannerFileLink({ fileId }: { fileId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    void getFile(fileId).then((blob) => {
      if (blob) {
        obj = URL.createObjectURL(blob);
        setUrl(obj);
      }
    });
    return () => {
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [fileId]);
  if (!url) return null;
  return (
    <a
      className="btn ghost small"
      style={{ textDecoration: "none" }}
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="Mở ảnh banner của sự kiện"
      onClick={(e) => e.stopPropagation()}
    >
      🖼
    </a>
  );
}
