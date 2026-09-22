import type { FeedbackEntry, ProjectId, Task } from "./types";

/**
 * Phân loại thông minh 2 tầng Dự án → Category (PRD §5.2.1).
 *
 * Thứ tự tín hiệu: (1) học từ sửa đổi của Mai (classification_feedback),
 * (2) luật từ khóa/tên riêng, (3) mặc định Cá nhân với độ chắc chắn thấp
 * kèm 2 lựa chọn thay thế — không đoán bừa.
 */

export interface Classification {
  projectId: ProjectId;
  categoryId?: string;
  confidence: number;
  /** Tối đa 2 lựa chọn khác khi chưa chắc, để Mai chọn một chạm. */
  alternatives: { projectId: ProjectId; categoryId?: string }[];
}

/** Dưới ngưỡng này UI phải hiện lựa chọn thay thế (PRD §5.2.1). */
export const CONFIDENCE_THRESHOLD = 0.7;

type Rule = [RegExp, ProjectId, string?];

/**
 * Luật từ khóa — cũng là nguồn duy nhất cho detectProject của parser.
 * Thứ tự quan trọng: luật cụ thể (kèm category) đứng trước luật chung.
 */
export const RULES: Rule[] = [
  // Sorene
  [/pitch\s*deck|gọi vốn|nhà đầu tư|investor|term sheet/i, "sorene", "sorene:goivon"],
  [/cohort/i, "sorene", "sorene:tangtruong"],
  [/sorene/i, "sorene"],
  // Circle
  [/báo giá|proposal|chào giá/i, "circle", "circle:banhang"],
  [/hợp đồng|contract/i, "circle", "circle:hopdong"],
  [/đào tạo|training|học viên|workshop/i, "circle", "circle:daotao"],
  [/circle|\baio\b/i, "circle"],
  // (Favstay & Edge đã bỏ theo quyết định của Mai 22/9/2026 — dự án
  // Mai tự thêm sau này được phân loại nhờ feedback học từ sửa đổi.)
  // Học tập — dự án riêng theo quyết định của Mai (không phải category Cá nhân)
  [/tiếng thái|học tiếng/i, "hoctap", "hoctap:tiengthai"],
  // Cá nhân
  [/\bspa\b|làm tóc|nail|khám|bác sĩ|gym|yoga/i, "canhan", "canhan:suckhoe"],
  [/\bvisa\b|hộ chiếu|passport|căn cước|giấy tờ/i, "canhan", "canhan:giayto"],
  [/hành lý|checklist bay|vé máy bay|đặt phòng/i, "canhan", "canhan:chuyendi"],
  [/sửa nhà|dọn nhà|điều hòa|máy giặt/i, "canhan", "canhan:nhacua"],
  // Admin chung
  [/thuế|khai thuế|báo cáo pháp lý|gia hạn giấy phép/i, "admin", "admin:thue"],
  [/hóa đơn|invoice|thanh toán tiền/i, "admin", "admin:hoadon"],
  [/gia hạn domain|hosting|license|đăng ký tài khoản|đổi mật khẩu/i, "admin", "admin:congcu"],
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Phân loại một tiêu đề việc. `feedback` là các sửa đổi Mai đã dạy —
 * luôn thắng luật (ví dụ "Rạng Đông" → Favstay dù câu có "hợp đồng").
 */
export function classify(title: string, feedback: FeedbackEntry[] = []): Classification {
  const t = norm(title);

  // 1. Học từ sửa đổi — term dài (cụ thể) ưu tiên trước.
  const learned = feedback
    .filter((f) => f.term && t.includes(f.term))
    .sort((a, b) => b.term.length - a.term.length)[0];
  if (learned) {
    return {
      projectId: learned.projectId,
      categoryId: learned.categoryId,
      confidence: 0.95,
      alternatives: [],
    };
  }

  // 2. Luật từ khóa: khớp đầu tiên là đề xuất chính, các khớp khác
  //    (dự án khác) thành lựa chọn thay thế.
  const hits: { projectId: ProjectId; categoryId?: string }[] = [];
  for (const [re, projectId, categoryId] of RULES) {
    if (!re.test(title)) continue;
    if (!hits.some((h) => h.projectId === projectId)) hits.push({ projectId, categoryId });
  }
  if (hits.length > 0) {
    return {
      projectId: hits[0].projectId,
      categoryId: hits[0].categoryId,
      confidence: hits.length === 1 ? 0.8 : 0.65,
      alternatives: hits.slice(1, 3),
    };
  }

  // 3. Không có tín hiệu → Cá nhân, độ chắc chắn thấp, kèm 2 lựa chọn.
  return {
    projectId: "canhan",
    confidence: 0.4,
    alternatives: [{ projectId: "circle" }, { projectId: "admin" }],
  };
}

/**
 * Rút term đáng học từ tiêu đề khi Mai sửa phân loại: cụm viết hoa
 * giữa câu (tên riêng như "Rạng Đông", "OKR"), bỏ từ đầu câu.
 */
export function learnableTerms(title: string): string[] {
  const words = title.trim().split(/\s+/);
  const terms: string[] = [];
  let current: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,!?;:()"']/g, "");
    const isProper = /^[A-ZĐÀ-Ỹ]/u.test(w) && (i > 0 || /^[A-Z]{2,}$/.test(w));
    if (isProper) {
      current.push(w);
    } else {
      if (current.length) terms.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) terms.push(current.join(" "));
  return terms
    .map((s) => norm(s))
    .filter((s) => s.length >= 3)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

// ── Kiểm tra trùng trước khi lưu (PRD §5.2.1 bảng kiểm tra) ────────────

function words(s: string): Set<string> {
  return new Set(norm(s).replace(/[.,!?;:()"']/g, "").split(" ").filter(Boolean));
}

/** Hai tiêu đề có phải cùng một việc không (chứa nhau hoặc trùng ≥ 65% từ). */
export function isSimilarTitle(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na.length >= 8 && nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return true;
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  const jaccard = common / (wa.size + wb.size - common);
  return jaccard >= 0.65;
}

/** Tìm việc đang mở giống với tiêu đề mới → đề xuất gộp thay vì tạo. */
export function findDuplicate(title: string, tasks: Task[]): Task | undefined {
  return tasks.find(
    (t) => (t.status === "todo" || t.status === "doing") && isSimilarTitle(title, t.title),
  );
}
