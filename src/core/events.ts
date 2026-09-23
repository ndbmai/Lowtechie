/**
 * Gộp sự kiện từ NHIỀU tài khoản lịch (PRD §5.3.4): cùng một sự kiện
 * xuất hiện ở hai tài khoản (được mời chéo) phải được nhận ra là một,
 * không đếm trùng khi kiểm tra bận/rảnh.
 */

export interface RemoteEventLike {
  title: string;
  startAt: string;
  /** iCalUID của Google — giữ nguyên qua các lịch được mời chéo. */
  iCalUID?: string;
}

/**
 * Khử trùng theo iCalUID (chuẩn nhất, Google giữ nguyên khi mời chéo);
 * không có thì rơi về (tiêu đề + giờ bắt đầu). Giữ bản ở tài khoản
 * đứng trước trong thứ tự đã nối.
 */
export function dedupeRemoteEvents<T extends RemoteEventLike>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    const key = e.iCalUID ? `u:${e.iCalUID}` : `t:${e.title}|${e.startAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
