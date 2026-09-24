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
  | "lark"
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
  /**
   * Việc "Đặt lịch [nơi]…" gắn với sự kiện nào (§5.4.2 v3.7): tick xong →
   * sự kiện "Đã đặt"; xóa sự kiện → hỏi xóa việc này. Id "g:…" = sự kiện
   * chỉ có trên Google/Lark (trạng thái giữ ở `eventMarks`).
   */
  bookingEventId?: string;
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
  /**
   * Mai đã TRẢ LỜI "nơi này cần đặt trước bao lâu" (v3.7) — kể cả "không
   * cần": nhớ cho lần sau, không hỏi lại.
   */
  bookingDecided?: boolean;
  /**
   * Tọa độ của NƠI (không phải đường đi của Mai) — Mai bấm "lấy vị trí
   * hiện tại" khi đang đứng ở đó, để app biết đã tới/đã rời (§5.4.3).
   */
  lat?: number;
  lng?: number;
}

/**
 * Mai đang ở đâu (§5.4.3, `location_state` §8): CHỈ thành phố + nơi đã
 * lưu, không bao giờ lưu tọa độ/đường đi của Mai; hết hạn là xóa.
 */
export interface LocationState {
  city?: Destination;
  placeId?: string;
  source: "gps" | "calendar" | "manual";
  updatedAt: string;
  /** Tối đa 30 ngày (ranh giới §5.4.3). */
  expiresAt: string;
}

/** Kết quả nghiên cứu đã lưu (§5.9.1) — gắn dự án hoặc khách hàng. */
export interface ResearchNote {
  id: string;
  query: string;
  summary: string;
  details?: string;
  /** LUÔN kèm nguồn + ngày truy cập — không đoán thành sự thật. */
  sources: { title: string; url: string }[];
  /** Chỗ chưa chắc / thiếu dữ liệu, nói rõ. */
  uncertain?: string;
  accessedAt: string;
  projectId?: ProjectId;
  clientId?: string;
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
  /** id trên lịch ngoài (Google/Lark) khi block đã được ghi sang đó (§5.4). */
  gcalId?: string;
  /** Tài khoản lịch chứa sự kiện đó (§5.3.4) — để xóa/hoàn tác đúng nơi. */
  calAccount?: string;
  /** Nơi cần đặt chỗ: chưa đặt thì lịch "có thể không thành" (§5.4.2). */
  bookingStatus?: "pending" | "booked";
  placeId?: string;
  /** Link đăng ký/mua vé từ banner (v3.0) — kể cả link giải từ mã QR. */
  linkUrl?: string;
  /** Khóa blob ảnh banner gốc trong IndexedDB (src/lib/fileStore). */
  bannerImage?: string;
  /** Ghi chú của sự kiện: đơn vị tổ chức, giá vé, yêu cầu… (v3.0). */
  notes?: string;
  /** Việc mà block này được book cho (§5.2.2 v3.7 — book lịch từ việc). */
  taskId?: string;
  categoryId?: string;
  clientId?: string;
  /** Đã tới nơi hẹn — vị trí thiết bị khớp nơi đã lưu (§5.4.3). */
  arrivedAt?: string;
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
      /** Mai chỉ nói GIỜ mới ("sang 17:00") → giữ nguyên NGÀY của lịch cũ. */
      keepDate?: boolean;
      /** Ngày Mai dùng để chỉ ĐÚNG lịch ("cắt tóc thứ Sáu") — ISO. */
      day?: string;
      confidence: number;
      note?: string;
    }
  | {
      /** "book 2 tiếng cho việc pitch deck thứ Năm" (§5.2.2 v3.7). */
      kind: "book_task";
      what: string;
      durationMinutes?: number;
      /** Chỉ tìm khung trong ngày này (ISO). */
      day?: string;
      confidence: number;
    }
  | {
      /** "xóa lịch tarot" — LUÔN qua thẻ xác nhận (§5.4.0 v3.7). */
      kind: "delete_event";
      what: string;
      day?: string;
      confidence: number;
    }
  | {
      /** "Spa thứ Năm đặt rồi" — đánh dấu đã đặt chỗ + đóng việc đặt (§5.4.2). */
      kind: "booked";
      what: string;
      day?: string;
      confidence: number;
    }
  | {
      /** "chị đang ở HCMC" — Mai tự nói khi đổi chỗ (§5.4.3). */
      kind: "location";
      city: Destination;
      confidence: number;
    }
  | {
      /** "tìm giúp chị 5 công ty AI automation ở Bangkok, lưu vào Circle" (§5.9.1). */
      kind: "research";
      query: string;
      projectId?: ProjectId;
      confidence: number;
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

/** Sự kiện soạn sẵn từ ảnh banner/poster/thiệp mời (PRD §5.1.1 v3.0). */
export interface BannerEvent {
  title: string;
  /** ISO kèm offset của Mai — AI đã suy năm theo mốc thời gian thực. */
  startAt?: string;
  endAt?: string;
  location?: string;
  organizer?: string;
  /** Link đăng ký/mua vé — chữ trong ảnh hoặc mã QR client giải được. */
  registrationUrl?: string;
  price?: string;
  /** Hạn đăng ký / early bird → hạn của việc "Đăng ký / mua vé". */
  registrationDeadline?: string;
  requirements?: string;
  /** Banner nhiều khung giờ/ngày → các ISO ứng viên để Mai chọn một. */
  timeOptions?: string[];
  /** AI đoán dự án theo logo/tổ chức trên banner (v3.1) — phải sanitize. */
  projectHint?: string;
  confidence: number;
}

/** Liên hệ đọc từ ảnh danh thiếp (v3.1) — gợi ý thêm vào danh bạ khách. */
export interface BannerContact {
  name: string;
  org?: string;
  phone?: string;
  email?: string;
  confidence: number;
}

export interface ImageParseResult {
  items: ImageItem[];
  /** Loại ảnh (v3.1 — PHÂN LOẠI TRƯỚC, trích sau): banner đi kèm `event`,
   *  danh thiếp đi kèm `contact`; chat/tài liệu vẫn ra `items`. */
  kind?: "checklist" | "banner" | "chat" | "document" | "danhthiep" | "khac";
  event?: BannerEvent;
  contact?: BannerContact;
  /** Lý do đọc kém (ảnh mờ, chữ nhỏ, lóa…) — báo rõ, không trả lời cụt. */
  readNote?: string;
  question?: string;
  source: "claude";
}
