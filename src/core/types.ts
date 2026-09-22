/**
 * Kiểu dữ liệu lõi của Mai Lowtechie — bám mô hình dữ liệu PRD §8 (rút gọn
 * cho bản local-first Giai đoạn 1). Mọi thời điểm là chuỗi ISO 8601.
 */

/**
 * Id dự án — chuỗi mở vì Mai tự thêm/xóa dự án trong app (PRD §5.2.1).
 * Các id gốc: sorene, circle, canhan, hoctap, admin.
 */
export type ProjectId = string;

export interface Project {
  id: ProjectId;
  name: string;
  color: string;
  /** Trọng số thời gian Mai đặt, tổng ≈ 1 (PRD §5.2). */
  weight: number;
  /** Mục tiêu giờ mỗi tuần, suy từ weight × quỹ giờ tuần. */
  targetHoursPerWeek: number;
  goal?: string;
  /** Lưu trữ = ẩn khỏi Hôm nay/Dự án/review, giữ nguyên dữ liệu (§5.3.1). */
  status?: "active" | "archived";
}

/** Category cấp 2 dưới dự án (PRD §5.2.1). */
export interface Category {
  id: string;
  projectId: ProjectId;
  name: string;
}

/** Học từ sửa đổi phân loại: gặp lại term này → dự án/category này. */
export interface FeedbackEntry {
  /** Từ khóa đã chuẩn hóa lowercase, ví dụ "rạng đông". */
  term: string;
  projectId: ProjectId;
  categoryId?: string;
}

export type DueType = "hard" | "soft";
export type Energy = "deep" | "shallow";
export type TaskStatus = "todo" | "doing" | "done" | "dropped";
export type SourceChannel =
  | "app-chat"
  | "app-voice"
  | "zalo"
  | "whatsapp"
  | "telegram"
  | "email"
  | "meeting"
  | "manual";

export interface Task {
  id: string;
  title: string;
  projectId: ProjectId;
  /** Category cấp 2 (PRD §5.2.1), ví dụ "circle:hopdong". */
  categoryId?: string;
  /** Người phụ trách; mặc định "mai". */
  assignee: string;
  dueAt?: string;
  dueType?: DueType;
  status: TaskStatus;
  estMinutes?: number;
  energy?: Energy;
  /** Việc đã giao, đang chờ người khác (PRD §5.2 Waiting-on). */
  waitingOn?: { person: string; followUpAt?: string };
  /** Đang chặn người khác → được cộng điểm ưu tiên. */
  blocksOthers?: boolean;
  source: {
    channel: SourceChannel;
    /** Trích dẫn tin nhắn gốc để kiểm chứng (PRD §6.5 "luôn có nguồn"). */
    quote?: string;
    ref?: string;
  };
  /** Độ tin cậy trích xuất 0–1 (task Mai tự giao = 1). */
  confidence: number;
  createdAt: string;
  completedAt?: string;
  /** Số lần bị dời — weekly review đề xuất bỏ khi ≥ 3 (PRD §5.10). */
  deferCount: number;
}

/** Thẻ chờ duyệt trong Hộp duyệt (PRD §5.2 triage inbox). */
export interface TriageItem {
  id: string;
  draft: Omit<Task, "id" | "status" | "createdAt" | "deferCount">;
  receivedAt: string;
  /** Các dòng trích từ cùng một ảnh/nguồn đi chung một nhóm (PRD §5.1.1). */
  groupId?: string;
}

export interface CalEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  projectId?: ProjectId;
  location?: string;
  /** Block phụ trợ do chuỗi §5.4.1 sinh ra, vẽ nhạt hơn sự kiện chính. */
  kind: "event" | "prep" | "travel" | "airport" | "flight" | "block";
  /** id sự kiện chính mà block phụ thuộc vào (event_chains của PRD §8). */
  chainOf?: string;
  /** id trên Google Calendar khi block đã được ghi sang đó (PRD §5.4). */
  gcalId?: string;
}

export type Destination = "tokyo" | "hcmc" | "bkk";

export interface Trip {
  id: string;
  destination: Destination;
  /** Nhãn hiển thị, ví dụ "Tokyo 4 ngày". */
  label: string;
  departAt: string;
  returnAt?: string;
  /** Mã đặt chỗ — chống tạo trùng chuyến khi quét lại vé (§5.9). */
  pnr?: string;
  /** Hướng bay rõ ràng từ vé, ví dụ "SGN (nhà ga 2) → BKK" (§5.9 6b). */
  route?: string;
  /** Đệm sân bay theo quy định ghi trên vé (phút), thay mặc định 150. */
  airportBufferMin?: number;
  purpose?: string;
  /** Tick checklist: itemId → đã xong. */
  done: Record<string, boolean>;
  /** Món Mai tự thêm, học lại cho chuyến sau cùng điểm đến (PRD §5.9). */
  customItems: { id: string; groupId: string; text: string }[];
  /** Món mẫu Mai đã xóa cho chuyến này. */
  removed: Record<string, boolean>;
}

/** Hồ sơ chuẩn bị dùng lại (PRD §5.4.1). */
export interface PrepProfile {
  id: string;
  name: string;
  minutes: number;
  appliesTo: string;
}

/** Hành động đã tách từ một câu chat/voice (PRD §5.1). */
export type ParsedAction =
  | {
      kind: "task";
      title: string;
      projectId: ProjectId;
      categoryId?: string;
      assignee?: string;
      dueAt?: string;
      dueType?: DueType;
      confidence: number;
      note?: string;
    }
  | {
      kind: "event";
      title: string;
      startAt?: string;
      /** Cho block kiểu "book 2 tiếng deep work" chưa có giờ cụ thể. */
      durationMinutes?: number;
      location?: string;
      /** Phương tiện Mai nói rõ ("đi ô tô") — mặc định là tàu (§5.4.1). */
      mode?: "transit" | "car";
      confidence: number;
      note?: string;
    }
  | {
      kind: "reschedule";
      what: string;
      toWhen?: string;
      /** Mai chỉ nói ngày mới → giữ nguyên giờ của lịch cũ. */
      keepTime?: boolean;
      confidence: number;
      note?: string;
    };

export interface ParseResult {
  actions: ParsedAction[];
  /** Câu hỏi lại duy nhất khi thiếu thông tin quan trọng (PRD §5.0). */
  question?: string;
  source: "claude" | "rules";
}

/** Một dòng việc trích từ ảnh (PRD §5.1.1). */
export interface ImageItem {
  title: string;
  /** Nhóm/mục con trong ảnh, nếu ảnh có cấu trúc. */
  group?: string;
  /** Ô đã tick / gạch ngang trong ảnh → không tạo việc mới. */
  done?: boolean;
  assignee?: string;
  dueAt?: string;
  projectId?: ProjectId;
  categoryId?: string;
  confidence: number;
}

export interface ImageParseResult {
  items: ImageItem[];
  question?: string;
  source: "claude";
}
