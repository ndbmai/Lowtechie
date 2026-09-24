"use client";

/**
 * Khay thông báo chung (v3.7): "Đã xong · Hoàn tác", "Đã xóa · Hoàn tác",
 * câu hỏi một chạm sau khi đóng việc. Sống ở layout nên không mất khi dòng
 * việc vừa tick biến khỏi danh sách (lỗi cũ: Hoàn tác không kịp hiện).
 */

export interface ToastAction {
  label: string;
  primary?: boolean;
  /** Trả về chuỗi → thay nội dung thông báo bằng dòng báo lại đó. */
  run: () => void | string | Promise<void | string>;
}

export interface Toast {
  id: string;
  text: string;
  actions?: ToastAction[];
  /** Tự ẩn sau bao lâu (mặc định 6 giây). */
  ttlMs?: number;
}

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();

export function showToast(t: Omit<Toast, "id">): void {
  const toast: Toast = { ...t, id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  for (const l of listeners) l(toast);
}

export function onToast(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
