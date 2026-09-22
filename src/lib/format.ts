/** Định dạng ngày giờ kiểu Việt cho UI. */

const DAY_NAMES = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export function fmtDayTime(iso: string): string {
  return `${fmtDay(iso)}, ${fmtTime(iso)}`;
}

/** "Thứ Sáu 25/9/2026" — dạng đầy đủ để Mai kiểm tra hạn (PRD 3c). */
export function fmtDayFull(iso: string): string {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function fmtRange(startIso: string, endIso: string): string {
  return `${fmtTime(startIso)}–${fmtTime(endIso)}`;
}

/**
 * Nhãn hạn (5.2.2 v2.6 — sửa lỗi "hạn 30/10 0:00"): chỉ hiện giờ khi Mai
 * THẬT SỰ đặt giờ. Hai quy ước "chỉ ngày" của app là 9:00 (parse/nút nhanh)
 * và 0:00 (nguồn ngoài trả nửa đêm) → cả hai đều ẩn giờ.
 */
export function fmtDue(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const dateOnly = (d.getHours() === 9 || d.getHours() === 0) && d.getMinutes() === 0;
  return `${fmtRelativeDay(iso, now)}${dateOnly ? "" : ` ${fmtTime(iso)}`}`;
}

/** "hôm nay" / "ngày mai" / "Thứ Năm 24/9" — cho câu nói của Lowtechie. */
export function fmtRelativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((that.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "hôm nay";
  if (diff === 1) return "ngày mai";
  return fmtDay(iso);
}

export function isSameDay(aIso: string, b: Date): boolean {
  const a = new Date(aIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function todayLabel(now = new Date()): string {
  return `${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}`;
}
