"use client";

import { useEffect, useState } from "react";
import { onToast, type Toast } from "@/lib/toast";

/** Khay thông báo nổi phía trên tab bar — mount một lần ở layout. */
export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(
    () =>
      onToast((t) => {
        setItems((s) => [...s.slice(-2), t]);
        setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.ttlMs ?? 6000);
      }),
    [],
  );

  if (items.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span style={{ flex: 1, minWidth: 0 }}>{t.text}</span>
          {t.actions?.map((a) => (
            <button
              key={a.label}
              className={a.primary ? "btn primary small" : "btn small"}
              onClick={async () => {
                const out = await a.run();
                setItems((s) =>
                  typeof out === "string"
                    ? s.map((x) => (x.id === t.id ? { ...x, text: out, actions: [] } : x))
                    : s.filter((x) => x.id !== t.id),
                );
                if (typeof out === "string")
                  setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), 4000);
              }}
            >
              {a.label}
            </button>
          ))}
          <button
            className="btn ghost small"
            aria-label="Ẩn thông báo"
            style={{ padding: "2px 8px" }}
            onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
