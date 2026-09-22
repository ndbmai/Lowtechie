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

/**
 * Khách hàng / đối tác — TRƯỜNG RIÊNG, không phải category (PRD §5.3.2):
 * category trả lời "loại việc gì", khách hàng trả lời "việc này cho ai".
 */
export interface Client {
  id: string;
  name: string;
  type: "khachhang" | "doitac" | "nhacungcap";
  /** Tên gọi tắt / cách gọi khác để nhận diện trong nội dung ("Đô thị"). */
  aliases: string[];
  /** Một khách có thể thuộc nhiều dự án. */
  projectIds: ProjectId[];
  status: "danglam" | "tiemnang" | "ketthuc";
  contact?: string;
  notes?: string;
  /** Gợi ý "vừa dùng gần đây / hay dùng nhất" trong ô chọn (v2.3). */
  lastUsedAt?: string;
  useCount?: number;
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

/** Một dòng ghi chú của Mai trong việc — nhật ký có giờ (PRD 3d v2.6). */
export interface TaskNote {
  id: string;
  body: string;
  at: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  title: string;
  projectId: ProjectId;
  /** Category cấp 2 (PRD §5.2.1), ví dụ "circle:hopdong". */
  categoryId?: string;
  /** Khách hàng / đối tác của việc (PRD §5.3.2) — id trong danh bạ. */
  clientId?: string;
  /** Người phụ trách; mặc định "mai". */
  assignee: string;
  dueAt?: string;
  dueType?: DueType;
  /** Hạn lấy từ nguồn hay Mai tự điền (PRD §5.2.1 3c). */
  dueSource?: "nguon" | "mai";
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
  /** Đóng bằng gì (5.2.2): tick đầu dòng, nút Xong, hay chat/voice. */
  completedVia?: "tick" | "button" | "chat";
  reopenedAt?: string;
  /** Mai tự đánh dấu để việc còn hạn xa vẫn lên Ưu tiên hôm nay (5.2.2). */
  priority?: "high";
  /** Nhật ký ghi chú của Mai — TÁCH RIÊNG với trích dẫn nguồn (3d). */
  notes?: TaskNote[];
  /** Số lần bị dời — weekly review đề xuất bỏ khi ≥ 3 (PRD §5.10). */
  deferCount: number;
}

/**
 * Địa điểm đã lưu (places §8): nhà ở từng thành phố, khách sạn, spa…
 * Vừa là điểm đi/đến cho chuỗi di chuyển (kèm link Google Maps), vừa là
 * nơi cần đặt chỗ trước (§5.4.2).
 */
export interface Place {
  id: string;
  name: string;
  /** Địa chỉ cho Google Maps ("Nhà ở HCM", "Nhà Bang Na"…). */
  address?: string;
  /** Thành phố — để chuỗi ngày bay chọn đúng nhà theo đầu chặng. */
  city?: Destination;
  /** Nơi ở chính tại thành phố đó → mặc định của điểm đi/đến. */
  isHome?: boolean;
  needsBooking: boolean;
  /** Đặt trước bao nhiêu ngày (spa 3, nhà hàng cuối tuần 7…). */
  bookingLeadDays: number;
  bookingMethod?: "call" | "line" | "zalo" | "whatsapp" | "web";
  /** Số điện thoại hoặc link đặt chỗ. */
  bookingContact?: string;
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
  /** Nơi cần đặt chỗ: chưa đặt thì lịch "có thể không thành" (§5.4.2). */
  bookingStatus?: "pending" | "booked";
  placeId?: string;
}

export type Destination = "tokyo" | "hcmc" | "bkk";

/** Vé/file đã lưu vào chuyến (PRD §5.9 v2.0 — tự lưu khi trích). */
export interface TripAttachment {
  /** Cũng là khóa blob trong IndexedDB (src/lib/fileStore). */
  id: string;
  filename: string;
  addedAt: string;
  /** Email đổi vé sau đó → bản mới nhất; bản cũ giữ trong lịch sử. */
  isLatest: boolean;
  version: number;
}

export interface Trip {
  id: string;
  destination: Destination;
  /** Nhãn hiển thị theo tuyến (v2.0), ví dụ "SGN → BKK · 2/10". */
  label: string;
  departAt: string;
  /** Giờ hạ cánh chặng đi — để vẽ chuỗi ngày bay hai đầu (v2.0). */
  arriveAt?: string;
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
  /** Vé PDF/ảnh đã lưu vào chuyến (metadata; blob nằm ở IndexedDB). */
  attachments?: TripAttachment[];
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
      /** Khách hàng khớp danh bạ (id); tên lạ KHÔNG đoán (PRD §5.3.2). */
      clientId?: string;
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
    }
  | {
      /** "Ghi chú cho việc X: …" — thêm vào nhật ký của việc đã có (3d). */
      kind: "note";
      what: string;
      text: string;
      confidence: number;
    }
  | {
      /** "Xong việc X rồi" — LUÔN qua thẻ xác nhận trước khi đóng (5.2.2). */
      kind: "complete";
      what: string;
      confidence: number;
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
  clientId?: string;
  confidence: number;
}

export interface ImageParseResult {
  items: ImageItem[];
  question?: string;
  source: "claude";
}
