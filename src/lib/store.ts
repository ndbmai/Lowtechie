"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CalEvent,
  Category,
  Client,
  Destination,
  DueType,
  FeedbackEntry,
  LocationState,
  Project,
  ProjectId,
  Place,
  ResearchNote,
  Task,
  TaskNote,
  TriageItem,
  Trip,
  TripAttachment,
} from "@/core/types";
import { makeClientId } from "@/core/clients";
import type { LarkGroupSetting } from "@/core/larkInbox";
import {
  DEFAULT_PREP_TEMPLATE,
  DEFAULT_REMINDER_OFFSETS,
  completeOccurrence,
  type RecurringSeries,
} from "@/core/series";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PROJECTS,
  fallbackProjectId,
  makeCategoryId,
  makeProjectId,
} from "@/core/projects";

/**
 * Store local-first của Giai đoạn 1 (chỉ Mai dùng): Zustand + localStorage.
 * Giai đoạn 3 sẽ thay bằng Supabase + RLS — giữ mọi thao tác dữ liệu đi
 * qua các action ở đây để chỗ thay là một.
 */

export type TaskDraft = Omit<Task, "id" | "status" | "createdAt" | "deferCount">;

/** Block deep work đang chờ tìm giờ (từ Giao việc → Lịch). */
export interface PendingBlock {
  title: string;
  projectId: Project["id"];
  durationMinutes: number;
}

/** Hướng di chuyển khi Mai sắp xếp thứ tự (§5.3.1). */
export type MoveDir = "up" | "down" | "top" | "bottom";

export type LocationMode = "ondemand" | "light" | "off";

/** Một lần xóa sự kiện — giữ để Hoàn tác (§5.4.0 v3.7). */
export interface EventTrashEntry {
  id: string;
  /** Sự kiện chính + các block chuỗi đi kèm. */
  events: CalEvent[];
  /** Việc đặt chỗ đã bỏ theo (Hoàn tác thì mở lại). */
  droppedTaskIds: string[];
  deletedAt: string;
}

/** Kết quả đồng bộ lịch một tài khoản (PRD v3.2 — màn Kết nối hiển thị). */
export interface SyncStatus {
  /** ISO thời điểm đồng bộ gần nhất. */
  at: string;
  /** Số lịch con đọc được. */
  calendars: number;
  /** Số sự kiện trong khoảng đã quét (tháng đang xem). */
  events: number;
  /** Thông điệp lỗi CÓ HÀNH ĐỘNG (accountErrorAction) — trống = ổn. */
  error?: string;
  /** Chi tiết từng lịch con "Tên: N · Tên: lỗi …" (v3.2 — chẩn đoán). */
  note?: string;
}

interface LowtechieState {
  tasks: Task[];
  triage: TriageItem[];
  projects: Project[];
  /** Category 2 tầng — Mai tự thêm/sửa/xóa (PRD §5.2.1). */
  categories: Category[];
  /** Danh bạ khách hàng / đối tác theo dự án (PRD §5.3.2). */
  clients: Client[];
  /** Lịch sử đổi hạn (due_changes §8) — weekly review soi việc bị dời nhiều. */
  dueChanges: { taskId: string; oldDue?: string; newDue?: string; changedAt: string }[];
  /** Chuyến vừa xóa, giữ vài phút để Hoàn tác (§5.9 6a — xóa mềm). */
  tripTrash: { trip: Trip; events: CalEvent[]; deletedAt: string }[];
  /** Sự kiện vừa xóa (kèm chuỗi block) — Hoàn tác trong vài phút (§5.4.0 v3.7). */
  eventTrash: EventTrashEntry[];
  /**
   * Trạng thái app GẮN THÊM cho sự kiện chỉ có trên Google/Lark (id "g:…"):
   * hiện chỉ có đặt chỗ — tick việc "Đặt lịch…" là sự kiện đó "Đã đặt".
   */
  eventMarks: Record<string, { booking?: "pending" | "booked" }>;
  /** Mai đang ở đâu (§5.4.3) — chỉ thành phố + nơi đã lưu, tự xóa sau 30 ngày. */
  locationState?: LocationState;
  /** Kết quả nghiên cứu đã lưu (§5.9.1). */
  research: ResearchNote[];
  /** Số lần nghiên cứu theo tháng "YYYY-MM" — hạn mức Mai đặt. */
  researchUsage: Record<string, number>;
  /** Group Lark ↔ dự án · khách + chế độ đọc (§5.5.1 v3.7), khóa = chat_id. */
  larkGroups: Record<string, LarkGroupSetting>;
  /** id tin Lark đã dựng thẻ Hộp duyệt — chống nhận trùng khi hai tab cùng kéo. */
  larkImported: string[];
  /** Hẹn định kỳ dài hạn — gia hạn visa 3 tháng, mỗi năm (§5.4.0 v2.3). */
  series: RecurringSeries[];
  /** Nơi hay đến cần đặt chỗ trước (§5.4.2 v2.6). */
  places: Place[];
  events: CalEvent[];
  trips: Trip[];
  /** Món checklist Mai tự thêm, học cho các chuyến sau cùng điểm đến. */
  learnedItems: Record<Destination, { groupId: string; text: string }[]>;
  /** Học từ sửa phân loại (classification_feedback, PRD §5.2.1). */
  feedback: FeedbackEntry[];
  /** Ảnh nguồn của nhóm triage đang chờ; xóa khi nhóm được duyệt hết. */
  triageImages: Record<string, string>;
  pendingBlock?: PendingBlock;
  settings: {
    /** Đi bộ nhà → BTS Bang Na, đo một lần rồi lưu (PRD §5.4.1). */
    walkToStationMin: number;
    defaultPrepMinutes: number;
    /** Địa chỉ nhà — điểm xuất phát cho Google Maps (places của PRD §8). */
    homeAddress: string;
    /** Chế độ xem Lịch lần trước — app nhớ (§5.4.0 v2.3). */
    calendarView: "day" | "week" | "month" | "list";
    /** Màn chi tiết dự án nhớ cách nhóm + bộ lọc lần trước (§5.3.0 v2.9). */
    projectGroupBy: "category" | "client" | "due";
    projectFilter: "all" | "due" | "nodue" | "high" | "others" | "overdue";
    /** Lịch đích MẶC ĐỊNH theo dự án (§5.3.4): projectId → id tài khoản. */
    projectCalendar: Record<ProjectId, string>;
    /** Book THẲNG sự kiện từ banner cho dự án nào (v3.1 — Mai opt-in). */
    autoBookBanner: Record<ProjectId, boolean>;
    /** Trạng thái đồng bộ lịch TỪNG tài khoản (v3.2): id → lần gần nhất. */
    syncStatus: Record<string, SyncStatus>;
    /** Ba mức vị trí Mai chọn (§5.4.3): chỉ khi cần (mặc định) · khi app mở · không dùng. */
    locationMode: LocationMode;
    /** Hạn mức nghiên cứu mỗi tháng (§5.9.1 — tốn API, Mai tự đặt). */
    researchMonthlyLimit: number;
  };

  addTask: (draft: TaskDraft) => Task;
  toggleTask: (id: string) => void;
  dropTask: (id: string) => void;
  deferTask: (id: string) => void;
  delegateTask: (id: string, person: string) => void;
  /** Đổi hạn một việc, có ghi lịch sử đổi hạn (PRD 3c). */
  setTaskDue: (id: string, dueAt: string | undefined, dueType?: DueType) => void;
  /** Đóng việc — CHỈ từ tick, nút Xong, hoặc chat có xác nhận (5.2.2). */
  completeTask: (id: string, via: "tick" | "button" | "chat") => void;
  /** Mở lại việc đã xong, giữ nguyên dự án/hạn/ghi chú (5.2.2). */
  reopenTask: (id: string) => void;
  updateTaskTitle: (id: string, title: string) => void;
  setTaskPriority: (id: string, priority: "high" | undefined) => void;
  /** Gắn/gỡ khách cho một việc — gắn nhanh ở nhóm "Chưa gắn khách" (v2.9). */
  setTaskClient: (id: string, clientId: string | undefined) => void;
  addTaskNote: (taskId: string, body: string) => void;
  updateTaskNote: (taskId: string, noteId: string, body: string) => void;
  deleteTaskNote: (taskId: string, noteId: string) => void;

  addTriage: (draft: TaskDraft) => void;
  /** Thêm cả nhóm dòng trích từ một ảnh, kèm ảnh nguồn (PRD §5.1.1). */
  addTriageGroup: (drafts: TaskDraft[], image?: string) => string;
  acceptTriage: (id: string) => void;
  dismissTriage: (id: string) => void;
  acceptGroup: (groupId: string) => void;
  dismissGroup: (groupId: string) => void;
  /** Ghi lại sửa đổi phân loại để lần sau xếp đúng (PRD §5.2.1). */
  recordFeedback: (entries: FeedbackEntry[]) => void;

  addEvent: (ev: Omit<CalEvent, "id">) => CalEvent;
  addEvents: (evs: Omit<CalEvent, "id">[]) => void;
  /** Cập nhật sự kiện đã có — banner trùng tên/ngày đề xuất cập nhật (v3.0). */
  updateEvent: (id: string, patch: Partial<Omit<CalEvent, "id">>) => void;
  removeEvent: (id: string) => void;
  removeChain: (eventId: string) => void;
  /**
   * Xóa sự kiện + chuỗi block vào thùng rác (Hoàn tác vài phút, §5.4.0
   * v3.7); `dropBookingTasks` = bỏ luôn việc "Đặt lịch…" gắn với nó.
   */
  trashEvent: (id: string, opts?: { dropBookingTasks?: boolean }) => EventTrashEntry | null;
  /** Hoàn tác xóa: trả sự kiện + chuỗi về, mở lại việc đặt chỗ đã bỏ. */
  restoreTrash: (trashId: string) => CalEvent[] | null;
  /** Dấu app gắn cho sự kiện chỉ có trên Google/Lark (id "g:…"). */
  setEventMark: (id: string, mark: { booking?: "pending" | "booked" } | undefined) => void;
  /**
   * Dời hạn MỘT việc (chat "dời X sang…") — ghi lịch sử đổi hạn + đếm số lần
   * dời. Dời SỰ KIỆN đi qua saveEventEdit (lib/calendarActions) để lịch
   * ngoài + chuỗi block đi theo (v3.7).
   */
  rescheduleTask: (taskId: string, toWhenIso: string) => void;

  setPendingBlock: (b?: PendingBlock) => void;

  addTrip: (t: Omit<Trip, "id" | "done" | "customItems" | "removed">) => Trip;
  /** Cập nhật chuyến đã có (cùng PNR quét lại → sửa giờ, không tạo bản sao §5.9). */
  updateTrip: (
    tripId: string,
    patch: Partial<
      Pick<Trip, "departAt" | "arriveAt" | "returnAt" | "label" | "pnr" | "route" | "airportBufferMin">
    >,
  ) => void;
  /** Xóa chuyến (6a): vào thùng rác vài phút để Hoàn tác, gỡ block chuỗi. */
  deleteTrip: (tripId: string) => void;
  undoDeleteTrip: (tripId: string) => void;
  /** Lưu vé vào chuyến; trùng tên file → bản mới nhất, bản cũ giữ lịch sử. */
  addTripAttachment: (tripId: string, filename: string) => TripAttachment | null;
  toggleTripItem: (tripId: string, itemId: string) => void;
  addCustomItem: (tripId: string, groupId: string, text: string) => void;
  removeTripItem: (tripId: string, itemId: string, custom: boolean) => void;
  newRound: (tripId: string) => void;

  setWalkToStation: (min: number) => void;
  setHomeAddress: (address: string) => void;
  setCalendarView: (view: "day" | "week" | "month" | "list") => void;
  setProjectView: (patch: {
    groupBy?: "category" | "client" | "due";
    filter?: "all" | "due" | "nodue" | "high" | "others" | "overdue";
  }) => void;
  /** Đặt/xóa lịch đích mặc định của một dự án (§5.3.4). */
  setProjectCalendar: (projectId: ProjectId, accountId: string | undefined) => void;
  /** Bật/tắt book thẳng banner cho một dự án (v3.1). */
  setAutoBookBanner: (projectId: ProjectId, on: boolean) => void;
  /** Ghi kết quả đồng bộ lịch một tài khoản (v3.2 — màn Kết nối). */
  setSyncStatus: (accountId: string, status: SyncStatus | undefined) => void;
  setLocationMode: (mode: LocationMode) => void;
  /** Ghi "Mai đang ở đâu" — chỉ thành phố + nơi đã lưu (§5.4.3). */
  setLocationState: (state: LocationState | undefined) => void;
  addResearch: (note: Omit<ResearchNote, "id">) => ResearchNote;
  updateResearch: (id: string, patch: Partial<Pick<ResearchNote, "projectId" | "clientId">>) => void;
  deleteResearch: (id: string) => void;
  /** Đếm một lần nghiên cứu vào tháng hiện tại (hạn mức). */
  countResearch: () => void;
  setResearchLimit: (n: number) => void;
  setLarkGroup: (chatId: string, patch: Partial<LarkGroupSetting> & { name: string }) => void;
  markLarkImported: (ids: string[]) => void;

  addSeries: (
    s: Pick<RecurringSeries, "title" | "intervalUnit" | "intervalCount" | "nextDate"> &
      Partial<Pick<RecurringSeries, "projectId" | "categoryId" | "isHard">>,
  ) => void;
  updateSeries: (
    id: string,
    patch: Partial<
      Pick<RecurringSeries, "title" | "intervalUnit" | "intervalCount" | "nextDate" | "prepTemplate" | "reminderOffsets" | "prepCreatedFor">
    >,
  ) => void;
  deleteSeries: (id: string) => void;
  /** Ghi ngày làm THẬT → lần sau tính từ ngày đó (§5.4.0 v2.3). */
  completeSeries: (id: string, actualDateIso: string, notes?: string) => void;

  /** Đánh dấu khách vừa được dùng — nuôi gợi ý "gần đây/hay dùng" (v2.3). */
  touchClient: (id: string) => void;

  addPlace: (p: Omit<Place, "id">) => Place | null;
  updatePlace: (id: string, patch: Partial<Omit<Place, "id">>) => void;
  deletePlace: (id: string) => void;
  /** Đánh dấu sự kiện ở nơi cần đặt chỗ đã đặt xong/chưa (§5.4.2). */
  setEventBooking: (eventId: string, status: "pending" | "booked" | undefined) => void;

  addProject: (name: string, color: string) => Project | null;
  updateProject: (
    id: ProjectId,
    patch: Partial<Pick<Project, "name" | "color" | "status">>,
  ) => void;
  /** Xóa dự án: Mai CHỌN việc còn mở chuyển sang dự án nào (§5.3.1). */
  deleteProject: (id: ProjectId, moveTo: ProjectId) => void;
  addCategory: (projectId: ProjectId, name: string) => Category | null;
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  /** Chuyển category (và việc bên trong) sang dự án khác (§5.3.1). */
  moveCategoryToProject: (id: string, toProjectId: ProjectId) => void;

  addClient: (name: string, projectId: ProjectId, type?: Client["type"]) => Client | null;
  updateClient: (
    id: string,
    patch: Partial<Pick<Client, "name" | "type" | "aliases" | "projectIds" | "status" | "contact" | "notes">>,
  ) => void;
  deleteClient: (id: string) => void;

  /** Sắp xếp thứ tự theo ý Mai (§5.3.1) — dùng ở mọi màn và ô chọn. */
  moveProject: (id: ProjectId, dir: MoveDir) => void;
  moveCategory: (id: string, dir: MoveDir) => void;
  moveClient: (id: string, projectId: ProjectId, dir: MoveDir) => void;
  /** Khôi phục thứ tự trước đó (hoàn tác sắp xếp). */
  setOrders: (o: { projects?: string[]; categories?: string[]; clients?: string[] }) => void;
}

/** Dời một phần tử trong danh sách theo hướng, giữ nguyên phần còn lại. */
function moveItem<T>(list: T[], from: number, dir: MoveDir): T[] {
  const to =
    dir === "up" ? from - 1 : dir === "down" ? from + 1 : dir === "top" ? 0 : list.length - 1;
  if (from < 0 || to < 0 || to >= list.length || to === from) return list;
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** Xếp lại mảng theo dãy id cho trước; id thiếu giữ nguyên cuối mảng. */
function orderBy<T extends { id: string }>(arr: T[], ids: string[]): T[] {
  const byId = new Map(arr.map((x) => [x.id, x]));
  const picked = ids.map((id) => byId.get(id)).filter((x): x is T => Boolean(x));
  const rest = arr.filter((x) => !ids.includes(x.id));
  return [...picked, ...rest];
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Đổi trạng thái đặt chỗ của sự kiện gắn với việc "Đặt lịch…": sự kiện
 * trong app sửa thẳng, sự kiện chỉ có trên Google/Lark ("g:…") ghi vào
 * eventMarks. Không có sự kiện nào → không đổi gì.
 */
function bookingPatch(
  s: Pick<LowtechieState, "events" | "eventMarks">,
  eventId: string | undefined,
  status: "pending" | "booked",
): Partial<Pick<LowtechieState, "events" | "eventMarks">> {
  if (!eventId) return {};
  if (eventId.startsWith("g:")) {
    return { eventMarks: { ...s.eventMarks, [eventId]: { ...s.eventMarks[eventId], booking: status } } };
  }
  if (!s.events.some((e) => e.id === eventId)) return {};
  return {
    events: s.events.map((e) => (e.id === eventId ? { ...e, bookingStatus: status } : e)),
  };
}

/** Gỡ thẻ triage; nhóm nào hết thẻ thì xóa luôn ảnh nguồn (đỡ đầy localStorage). */
function removeTriage(
  s: Pick<LowtechieState, "triage" | "triageImages">,
  ids: string[],
): Pick<LowtechieState, "triage" | "triageImages"> {
  const gone = new Set(ids);
  const triage = s.triage.filter((x) => !gone.has(x.id));
  const liveGroups = new Set(triage.map((x) => x.groupId).filter(Boolean));
  const triageImages = Object.fromEntries(
    Object.entries(s.triageImages).filter(([g]) => liveGroups.has(g)),
  );
  return { triage, triageImages };
}

export const useStore = create<LowtechieState>()(
  persist(
    (set, get) => ({
      tasks: [],
      triage: [],
      projects: DEFAULT_PROJECTS,
      categories: DEFAULT_CATEGORIES,
      clients: [],
      dueChanges: [],
      tripTrash: [],
      series: [],
      places: [],
      events: [],
      trips: [],
      learnedItems: { tokyo: [], hcmc: [], bkk: [] },
      feedback: [],
      triageImages: {},
      pendingBlock: undefined,
      settings: {
        walkToStationMin: 12,
        defaultPrepMinutes: 90,
        homeAddress: "",
        calendarView: "week",
        projectGroupBy: "category",
        projectFilter: "all",
        projectCalendar: {},
        autoBookBanner: {},
        syncStatus: {},
        locationMode: "ondemand",
        researchMonthlyLimit: 30,
      },
      eventTrash: [],
      eventMarks: {},
      locationState: undefined,
      research: [],
      researchUsage: {},
      larkGroups: {},
      larkImported: [],

      addTask: (draft) => {
        const t: Task = {
          ...draft,
          id: uid(),
          status: "todo",
          createdAt: new Date().toISOString(),
          deferCount: 0,
        };
        set((s) => ({ tasks: [t, ...s.tasks] }));
        return t;
      },
      toggleTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? t.status === "done"
                ? { ...t, status: "todo", completedAt: undefined }
                : { ...t, status: "done", completedAt: new Date().toISOString() }
              : t,
          ),
        })),
      dropTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: "dropped" } : t)),
        })),
      deferTask: (id) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  deferCount: t.deferCount + 1,
                  dueAt: t.dueAt
                    ? new Date(new Date(t.dueAt).getTime() + 7 * 86_400_000).toISOString()
                    : t.dueAt,
                }
              : t,
          ),
        })),
      delegateTask: (id, person) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, waitingOn: { person }, assignee: person } : t,
          ),
        })),
      completeTask: (id, via) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          return {
            tasks: s.tasks.map((t) =>
              t.id === id
                ? { ...t, status: "done", completedAt: new Date().toISOString(), completedVia: via }
                : t,
            ),
            // Tick xong việc "Đặt lịch…" → sự kiện gắn với nó "Đã đặt" (§5.4.2 v3.7).
            ...bookingPatch(s, task?.bookingEventId, "booked"),
          };
        }),
      reopenTask: (id) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          return {
            tasks: s.tasks.map((t) =>
              t.id === id
                ? {
                    ...t,
                    status: "todo",
                    completedAt: undefined,
                    completedVia: undefined,
                    reopenedAt: new Date().toISOString(),
                  }
                : t,
            ),
            ...bookingPatch(s, task?.bookingEventId, "pending"),
          };
        }),
      updateTaskTitle: (id, title) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, title: title.trim().slice(0, 200) || t.title } : t,
          ),
        })),
      setTaskPriority: (id, priority) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, priority } : t)),
        })),
      setTaskClient: (id, clientId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, clientId } : t)),
        })),
      addTaskNote: (taskId, body) =>
        set((s) => {
          const trimmed = body.trim();
          if (!trimmed) return s;
          const note: TaskNote = { id: uid(), body: trimmed.slice(0, 2000), at: new Date().toISOString() };
          return {
            tasks: s.tasks.map((t) =>
              t.id === taskId ? { ...t, notes: [note, ...(t.notes ?? [])] } : t,
            ),
          };
        }),
      updateTaskNote: (taskId, noteId, body) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  notes: (t.notes ?? []).map((n) =>
                    n.id === noteId
                      ? { ...n, body: body.trim().slice(0, 2000) || n.body, updatedAt: new Date().toISOString() }
                      : n,
                  ),
                }
              : t,
          ),
        })),
      deleteTaskNote: (taskId, noteId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, notes: (t.notes ?? []).filter((n) => n.id !== noteId) } : t,
          ),
        })),
      setTaskDue: (id, dueAt, dueType) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task || task.dueAt === dueAt) return s;
          return {
            tasks: s.tasks.map((t) =>
              t.id === id
                ? { ...t, dueAt, dueType: dueAt ? (dueType ?? t.dueType ?? "soft") : undefined, dueSource: "mai" }
                : t,
            ),
            dueChanges: [
              ...s.dueChanges.slice(-199),
              { taskId: id, oldDue: task.dueAt, newDue: dueAt, changedAt: new Date().toISOString() },
            ],
          };
        }),

      addTriage: (draft) =>
        set((s) => ({
          triage: [...s.triage, { id: uid(), draft, receivedAt: new Date().toISOString() }],
        })),
      addTriageGroup: (drafts, image) => {
        const groupId = uid();
        const now = new Date().toISOString();
        set((s) => ({
          triage: [
            ...s.triage,
            ...drafts.map((draft) => ({ id: uid(), draft, receivedAt: now, groupId })),
          ],
          triageImages: image ? { ...s.triageImages, [groupId]: image } : s.triageImages,
        }));
        return groupId;
      },
      acceptTriage: (id) => {
        const item = get().triage.find((x) => x.id === id);
        if (!item) return;
        get().addTask(item.draft);
        set((s) => removeTriage(s, [id]));
      },
      dismissTriage: (id) => set((s) => removeTriage(s, [id])),
      acceptGroup: (groupId) => {
        const items = get().triage.filter((x) => x.groupId === groupId);
        for (const it of items) get().addTask(it.draft);
        set((s) => removeTriage(s, items.map((it) => it.id)));
      },
      dismissGroup: (groupId) =>
        set((s) =>
          removeTriage(s, s.triage.filter((x) => x.groupId === groupId).map((x) => x.id)),
        ),
      recordFeedback: (entries) =>
        set((s) => ({
          feedback: [
            // Term dạy lại sau thay term cũ.
            ...s.feedback.filter((f) => !entries.some((e) => e.term === f.term)),
            ...entries,
          ],
        })),

      addEvent: (ev) => {
        const e: CalEvent = { ...ev, id: uid() };
        set((s) => ({ events: [...s.events, e] }));
        return e;
      },
      addEvents: (evs) =>
        set((s) => ({ events: [...s.events, ...evs.map((e) => ({ ...e, id: uid() }))] })),
      updateEvent: (id, patch) =>
        set((s) => ({
          events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),
      removeEvent: (id) =>
        set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
      removeChain: (eventId) =>
        set((s) => ({ events: s.events.filter((e) => e.chainOf !== eventId) })),
      trashEvent: (id, opts) => {
        const s = get();
        const gone = s.events.filter((e) => e.id === id || e.chainOf === id);
        const isRemote = id.startsWith("g:");
        if (gone.length === 0 && !isRemote) return null;
        const dropped = opts?.dropBookingTasks
          ? s.tasks
              .filter((t) => t.bookingEventId === id && (t.status === "todo" || t.status === "doing"))
              .map((t) => t.id)
          : [];
        const now = Date.now();
        const entry: EventTrashEntry = {
          id: uid(),
          events: gone,
          droppedTaskIds: dropped,
          deletedAt: new Date(now).toISOString(),
        };
        set((st) => {
          const marks = { ...st.eventMarks };
          delete marks[id];
          return {
            events: st.events.filter((e) => e.id !== id && e.chainOf !== id),
            tasks: dropped.length
              ? st.tasks.map((t) => (dropped.includes(t.id) ? { ...t, status: "dropped" as const } : t))
              : st.tasks,
            eventMarks: marks,
            // Thùng rác chỉ giữ 10 phút / tối đa 5 lần xóa.
            eventTrash: [
              ...st.eventTrash.filter((x) => now - Date.parse(x.deletedAt) < 10 * 60_000).slice(-4),
              entry,
            ],
          };
        });
        return entry;
      },
      restoreTrash: (trashId) => {
        const entry = get().eventTrash.find((x) => x.id === trashId);
        if (!entry) return null;
        set((s) => ({
          events: [...s.events, ...entry.events.filter((e) => !s.events.some((x) => x.id === e.id))],
          tasks: s.tasks.map((t) =>
            entry.droppedTaskIds.includes(t.id) ? { ...t, status: "todo" as const } : t,
          ),
          eventTrash: s.eventTrash.filter((x) => x.id !== trashId),
        }));
        return entry.events;
      },
      setEventMark: (id, mark) =>
        set((s) => {
          const next = { ...s.eventMarks };
          if (mark) next[id] = mark;
          else delete next[id];
          return { eventMarks: next };
        }),

      rescheduleTask: (taskId, toWhenIso) =>
        set((st) => {
          const task = st.tasks.find((t) => t.id === taskId);
          if (!task) return st;
          return {
            tasks: st.tasks.map((t) =>
              t.id === taskId ? { ...t, dueAt: toWhenIso, deferCount: t.deferCount + 1 } : t,
            ),
            // Lịch sử đổi hạn (due_changes §8) cho weekly review.
            dueChanges: [
              ...st.dueChanges.slice(-199),
              { taskId, oldDue: task.dueAt, newDue: toWhenIso, changedAt: new Date().toISOString() },
            ],
          };
        }),

      setPendingBlock: (b) => set({ pendingBlock: b }),

      addTrip: (t) => {
        const learned = get().learnedItems[t.destination] ?? [];
        const trip: Trip = {
          ...t,
          id: uid(),
          done: {},
          removed: {},
          customItems: learned.map((c) => ({ id: uid(), ...c })),
        };
        set((s) => ({ trips: [trip, ...s.trips] }));
        return trip;
      },
      updateTrip: (tripId, patch) =>
        set((s) => ({
          trips: s.trips.map((t) => (t.id === tripId ? { ...t, ...patch } : t)),
        })),
      deleteTrip: (tripId) =>
        set((s) => {
          const trip = s.trips.find((t) => t.id === tripId);
          if (!trip) return s;
          const now = Date.now();
          return {
            trips: s.trips.filter((t) => t.id !== tripId),
            events: s.events.filter((e) => e.chainOf !== tripId),
            tripTrash: [
              // Thùng rác chỉ giữ 10 phút / tối đa 5 chuyến.
              ...s.tripTrash.filter((x) => now - Date.parse(x.deletedAt) < 10 * 60_000).slice(-4),
              {
                trip,
                events: s.events.filter((e) => e.chainOf === tripId),
                deletedAt: new Date(now).toISOString(),
              },
            ],
          };
        }),
      undoDeleteTrip: (tripId) =>
        set((s) => {
          const entry = s.tripTrash.find((x) => x.trip.id === tripId);
          if (!entry) return s;
          return {
            trips: [entry.trip, ...s.trips],
            events: [...s.events, ...entry.events],
            tripTrash: s.tripTrash.filter((x) => x.trip.id !== tripId),
          };
        }),
      addTripAttachment: (tripId, filename) => {
        const trip = get().trips.find((t) => t.id === tripId);
        if (!trip) return null;
        const olds = (trip.attachments ?? []).filter((a) => a.filename === filename);
        const att: TripAttachment = {
          id: uid(),
          filename,
          addedAt: new Date().toISOString(),
          isLatest: true,
          version: olds.length ? Math.max(...olds.map((a) => a.version)) + 1 : 1,
        };
        set((s) => ({
          trips: s.trips.map((t) =>
            t.id === tripId
              ? {
                  ...t,
                  attachments: [
                    att,
                    ...(t.attachments ?? []).map((a) =>
                      a.filename === filename ? { ...a, isLatest: false } : a,
                    ),
                  ],
                }
              : t,
          ),
        }));
        return att;
      },
      toggleTripItem: (tripId, itemId) =>
        set((s) => ({
          trips: s.trips.map((t) =>
            t.id === tripId ? { ...t, done: { ...t.done, [itemId]: !t.done[itemId] } } : t,
          ),
        })),
      addCustomItem: (tripId, groupId, text) =>
        set((s) => {
          const trip = s.trips.find((t) => t.id === tripId);
          if (!trip) return s;
          const item = { id: uid(), groupId, text };
          return {
            trips: s.trips.map((t) =>
              t.id === tripId ? { ...t, customItems: [...t.customItems, item] } : t,
            ),
            // Học lại cho chuyến sau cùng điểm đến (PRD §5.9).
            learnedItems: {
              ...s.learnedItems,
              [trip.destination]: [
                ...(s.learnedItems[trip.destination] ?? []),
                { groupId, text },
              ],
            },
          };
        }),
      removeTripItem: (tripId, itemId, custom) =>
        set((s) => ({
          trips: s.trips.map((t) => {
            if (t.id !== tripId) return t;
            const done = { ...t.done };
            delete done[itemId];
            return custom
              ? { ...t, done, customItems: t.customItems.filter((c) => c.id !== itemId) }
              : { ...t, done, removed: { ...t.removed, [itemId]: true } };
          }),
        })),
      newRound: (tripId) =>
        set((s) => ({
          trips: s.trips.map((t) => (t.id === tripId ? { ...t, done: {} } : t)),
        })),

      setWalkToStation: (min) =>
        set((s) => ({ settings: { ...s.settings, walkToStationMin: min } })),
      setHomeAddress: (address) =>
        set((s) => ({ settings: { ...s.settings, homeAddress: address.slice(0, 300) } })),
      setCalendarView: (view) =>
        set((s) => ({ settings: { ...s.settings, calendarView: view } })),
      setProjectView: (patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            projectGroupBy: patch.groupBy ?? s.settings.projectGroupBy,
            projectFilter: patch.filter ?? s.settings.projectFilter,
          },
        })),
      setProjectCalendar: (projectId, accountId) =>
        set((s) => {
          const next = { ...s.settings.projectCalendar };
          if (accountId) next[projectId] = accountId;
          else delete next[projectId];
          return { settings: { ...s.settings, projectCalendar: next } };
        }),
      setAutoBookBanner: (projectId, on) =>
        set((s) => ({
          settings: {
            ...s.settings,
            autoBookBanner: { ...s.settings.autoBookBanner, [projectId]: on },
          },
        })),
      setSyncStatus: (accountId, status) =>
        set((s) => {
          const next = { ...s.settings.syncStatus };
          if (status) next[accountId] = status;
          else delete next[accountId];
          return { settings: { ...s.settings, syncStatus: next } };
        }),

      addSeries: (sr) =>
        set((s) => ({
          series: [
            ...s.series,
            {
              id: uid(),
              title: sr.title.trim().slice(0, 80),
              intervalUnit: sr.intervalUnit,
              intervalCount: Math.max(1, sr.intervalCount),
              nextDate: sr.nextDate.slice(0, 10),
              reminderOffsets: DEFAULT_REMINDER_OFFSETS,
              prepTemplate: DEFAULT_PREP_TEMPLATE,
              projectId: sr.projectId ?? "canhan",
              categoryId: sr.categoryId ?? "canhan:giayto",
              isHard: sr.isHard ?? true,
              history: [],
            },
          ],
        })),
      updateSeries: (id, patch) =>
        set((s) => ({
          series: s.series.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      deleteSeries: (id) =>
        set((s) => ({ series: s.series.filter((x) => x.id !== id) })),
      completeSeries: (id, actualDateIso, notes) =>
        set((s) => ({
          series: s.series.map((x) =>
            x.id === id ? completeOccurrence(x, actualDateIso, notes) : x,
          ),
        })),

      touchClient: (id) =>
        set((s) => ({
          clients: s.clients.map((c) =>
            c.id === id
              ? { ...c, lastUsedAt: new Date().toISOString(), useCount: (c.useCount ?? 0) + 1 }
              : c,
          ),
        })),

      addPlace: (p) => {
        const name = p.name.trim().slice(0, 80);
        if (!name) return null;
        const place: Place = { ...p, name, id: uid() };
        set((s) => ({ places: [...s.places, place] }));
        return place;
      },
      updatePlace: (id, patch) =>
        set((s) => ({
          places: s.places.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      deletePlace: (id) =>
        set((s) => ({
          places: s.places.filter((p) => p.id !== id),
          events: s.events.map((e) =>
            e.placeId === id ? { ...e, placeId: undefined, bookingStatus: undefined } : e,
          ),
        })),
      setEventBooking: (eventId, status) =>
        set((s) => {
          const now = new Date().toISOString();
          // Hai chiều (§5.4.2 v3.7): đánh dấu "Đã đặt" ở lịch → việc
          // "Đặt lịch…" gắn với nó cũng xong; về "Chưa đặt" → mở lại.
          const tasks = s.tasks.map((t) => {
            if (t.bookingEventId !== eventId) return t;
            if (status === "booked" && (t.status === "todo" || t.status === "doing"))
              return { ...t, status: "done" as const, completedAt: now, completedVia: "button" as const };
            if (status === "pending" && t.status === "done")
              return { ...t, status: "todo" as const, completedAt: undefined, completedVia: undefined };
            return t;
          });
          if (eventId.startsWith("g:")) {
            const marks = { ...s.eventMarks };
            if (status) marks[eventId] = { ...marks[eventId], booking: status };
            else delete marks[eventId];
            return { tasks, eventMarks: marks };
          }
          return {
            tasks,
            events: s.events.map((e) => (e.id === eventId ? { ...e, bookingStatus: status } : e)),
          };
        }),
      setLocationMode: (mode) =>
        set((s) => ({
          settings: { ...s.settings, locationMode: mode },
          // Tắt vị trí → không giữ vị trí GPS cũ (ranh giới §5.4.3).
          locationState: mode === "off" && s.locationState?.source === "gps" ? undefined : s.locationState,
        })),
      setLocationState: (state) => set({ locationState: state }),
      addResearch: (note) => {
        const n: ResearchNote = { ...note, id: uid() };
        set((s) => ({ research: [n, ...s.research].slice(0, 200) }));
        return n;
      },
      updateResearch: (id, patch) =>
        set((s) => ({ research: s.research.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      deleteResearch: (id) => set((s) => ({ research: s.research.filter((r) => r.id !== id) })),
      countResearch: () =>
        set((s) => {
          const d = new Date();
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return { researchUsage: { ...s.researchUsage, [key]: (s.researchUsage[key] ?? 0) + 1 } };
        }),
      setResearchLimit: (n) =>
        set((s) => ({
          settings: { ...s.settings, researchMonthlyLimit: Math.max(0, Math.min(500, Math.round(n))) },
        })),
      setLarkGroup: (chatId, patch) =>
        set((s) => {
          const prev = s.larkGroups[chatId];
          return {
            larkGroups: {
              ...s.larkGroups,
              [chatId]: { ...prev, ...patch, mode: patch.mode ?? prev?.mode ?? "mention" },
            },
          };
        }),
      markLarkImported: (ids) =>
        set((s) => ({ larkImported: [...s.larkImported, ...ids.filter((id) => !s.larkImported.includes(id))].slice(-300) })),

      addProject: (name, color) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return null;
        const p: Project = {
          id: makeProjectId(trimmed, get().projects),
          name: trimmed,
          color,
        };
        // Mục mới vào CUỐI danh sách — Mai kéo lên nếu muốn (§5.3.1).
        set((s) => ({ projects: [...s.projects, p] }));
        return p;
      },
      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...patch,
                  name: (patch.name ?? p.name).trim().slice(0, 40) || p.name,
                }
              : p,
          ),
        })),
      deleteProject: (id, moveTo) =>
        set((s) => {
          if (s.projects.length <= 1) return s;
          const projects = s.projects.filter((p) => p.id !== id);
          const fb = projects.some((p) => p.id === moveTo && moveTo !== id)
            ? moveTo
            : fallbackProjectId(projects);
          const move = <T extends { projectId: ProjectId; categoryId?: string }>(x: T): T =>
            x.projectId === id ? { ...x, projectId: fb, categoryId: undefined } : x;
          return {
            projects,
            categories: s.categories.filter((c) => c.projectId !== id),
            // Khách chỉ thuộc dự án bị xóa thì rời danh bạ; thuộc nhiều thì giữ.
            clients: s.clients
              .map((c) => ({ ...c, projectIds: c.projectIds.filter((p) => p !== id) }))
              .filter((c) => c.projectIds.length > 0),
            tasks: s.tasks.map(move),
            triage: s.triage.map((t) => ({ ...t, draft: move(t.draft) })),
            feedback: s.feedback.filter((f) => f.projectId !== id),
            events: s.events.map((e) =>
              e.projectId === id ? { ...e, projectId: undefined } : e,
            ),
            pendingBlock:
              s.pendingBlock?.projectId === id
                ? { ...s.pendingBlock, projectId: fb }
                : s.pendingBlock,
          };
        }),
      addCategory: (projectId, name) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return null;
        const c: Category = {
          id: makeCategoryId(projectId, trimmed, get().categories),
          projectId,
          name: trimmed,
        };
        set((s) => ({ categories: [...s.categories, c] }));
        return c;
      },
      renameCategory: (id, name) =>
        set((s) => ({
          categories: s.categories.map((c) =>
            c.id === id ? { ...c, name: name.trim().slice(0, 40) || c.name } : c,
          ),
        })),
      deleteCategory: (id) =>
        set((s) => {
          const clear = <T extends { categoryId?: string }>(x: T): T =>
            x.categoryId === id ? { ...x, categoryId: undefined } : x;
          return {
            categories: s.categories.filter((c) => c.id !== id),
            tasks: s.tasks.map(clear),
            triage: s.triage.map((t) => ({ ...t, draft: clear(t.draft) })),
            feedback: s.feedback.map((f) =>
              f.categoryId === id ? { ...f, categoryId: undefined } : f,
            ),
          };
        }),
      moveCategoryToProject: (id, toProjectId) =>
        set((s) => {
          const cat = s.categories.find((c) => c.id === id);
          if (!cat || cat.projectId === toProjectId || !s.projects.some((p) => p.id === toProjectId))
            return s;
          const newId = makeCategoryId(toProjectId, cat.name, s.categories);
          // Việc bên trong đi theo category sang dự án mới (§5.3.1).
          const move = <T extends { projectId: ProjectId; categoryId?: string }>(x: T): T =>
            x.categoryId === id ? { ...x, projectId: toProjectId, categoryId: newId } : x;
          return {
            categories: s.categories.map((c) =>
              c.id === id ? { ...c, id: newId, projectId: toProjectId } : c,
            ),
            tasks: s.tasks.map(move),
            triage: s.triage.map((t) => ({ ...t, draft: move(t.draft) })),
            feedback: s.feedback.map((f) =>
              f.categoryId === id ? { ...f, projectId: toProjectId, categoryId: newId } : f,
            ),
          };
        }),

      addClient: (name, projectId, type) => {
        const trimmed = name.trim().slice(0, 60);
        if (!trimmed) return null;
        const c: Client = {
          id: makeClientId(trimmed, get().clients),
          name: trimmed,
          type: type ?? "khachhang",
          aliases: [],
          projectIds: [projectId],
          status: "danglam",
        };
        set((s) => ({ clients: [...s.clients, c] }));
        return c;
      },
      updateClient: (id, patch) =>
        set((s) => ({
          clients: s.clients.map((c) =>
            c.id === id
              ? {
                  ...c,
                  ...patch,
                  name: (patch.name ?? c.name).trim().slice(0, 60) || c.name,
                  aliases: (patch.aliases ?? c.aliases).map((a) => a.trim()).filter(Boolean).slice(0, 12),
                  projectIds: patch.projectIds?.length ? patch.projectIds : c.projectIds,
                }
              : c,
          ),
        })),
      deleteClient: (id) =>
        set((s) => {
          const clear = <T extends { clientId?: string }>(x: T): T =>
            x.clientId === id ? { ...x, clientId: undefined } : x;
          return {
            clients: s.clients.filter((c) => c.id !== id),
            tasks: s.tasks.map(clear),
            triage: s.triage.map((t) => ({ ...t, draft: clear(t.draft) })),
          };
        }),

      moveProject: (id, dir) =>
        set((s) => ({
          projects: moveItem(s.projects, s.projects.findIndex((p) => p.id === id), dir),
        })),
      moveCategory: (id, dir) =>
        set((s) => {
          const cat = s.categories.find((c) => c.id === id);
          if (!cat) return s;
          const sibs = s.categories.filter((c) => c.projectId === cat.projectId);
          const next = moveItem(sibs, sibs.findIndex((c) => c.id === id), dir);
          let i = 0;
          return {
            categories: s.categories.map((c) => (c.projectId === cat.projectId ? next[i++] : c)),
          };
        }),
      moveClient: (id, projectId, dir) =>
        set((s) => {
          const sibs = s.clients.filter((c) => c.projectIds.includes(projectId));
          const next = moveItem(sibs, sibs.findIndex((c) => c.id === id), dir);
          let i = 0;
          return {
            clients: s.clients.map((c) => (c.projectIds.includes(projectId) ? next[i++] : c)),
          };
        }),
      setOrders: (o) =>
        set((s) => ({
          projects: o.projects ? orderBy(s.projects, o.projects) : s.projects,
          categories: o.categories ? orderBy(s.categories, o.categories) : s.categories,
          clients: o.clients ? orderBy(s.clients, o.clients) : s.clients,
        })),
    }),
    {
      name: "lowtechie-v1",
      skipHydration: true,
      version: 16,
      migrate: (persisted, version) => {
        const s = persisted as Partial<LowtechieState>;
        if (version < 2) {
          // v2: thêm dự án Admin chung + feedback phân loại + ảnh triage.
          const existing = new Set((s.projects ?? []).map((p) => p.id));
          s.projects = [
            ...(s.projects ?? []),
            ...DEFAULT_PROJECTS.filter((p) => !existing.has(p.id)),
          ];
          s.feedback = s.feedback ?? [];
          s.triageImages = s.triageImages ?? {};
        }
        if (version < 3) {
          // v3: Học tập thành dự án riêng — category "canhan:hoctap" cũ
          // chuyển sang hoctap/hoctap:tiengthai (quyết định của Mai).
          const remap = <T extends { projectId: Task["projectId"]; categoryId?: string }>(
            x: T,
          ): T =>
            x.categoryId === "canhan:hoctap"
              ? { ...x, projectId: "hoctap", categoryId: "hoctap:tiengthai" }
              : x;
          s.tasks = (s.tasks ?? []).map(remap);
          s.triage = (s.triage ?? []).map((t) => ({ ...t, draft: remap(t.draft) }));
          s.feedback = (s.feedback ?? []).map((f) =>
            f.categoryId === "canhan:hoctap"
              ? { ...f, projectId: "hoctap", categoryId: "hoctap:tiengthai" }
              : f,
          );
        }
        if (version < 4) {
          // v4: thêm địa chỉ nhà cho Google Maps (§5.4.1).
          s.settings = {
            walkToStationMin: 12,
            defaultPrepMinutes: 90,
            homeAddress: "",
            ...(s.settings ?? {}),
            calendarView: s.settings?.calendarView ?? "week",
            projectGroupBy: s.settings?.projectGroupBy ?? "category",
            projectFilter: s.settings?.projectFilter ?? "all",
            projectCalendar: s.settings?.projectCalendar ?? {},
            autoBookBanner: s.settings?.autoBookBanner ?? {},
            syncStatus: s.settings?.syncStatus ?? {},
            locationMode: s.settings?.locationMode ?? "ondemand",
            researchMonthlyLimit: s.settings?.researchMonthlyLimit ?? 30,
          };
        }
        if (version < 5) {
          // v5: dự án/category thành dữ liệu Mai tự quản; bỏ Favstay & Edge
          // (quyết định 22/9/2026) — việc gắn vào đó chuyển về Cá nhân.
          const gone = new Set(["favstay", "edge"]);
          s.projects = (s.projects ?? DEFAULT_PROJECTS).filter((p) => !gone.has(p.id));
          if (s.projects.length === 0) s.projects = DEFAULT_PROJECTS;
          s.categories = (s.categories ?? DEFAULT_CATEGORIES).filter(
            (c) => !gone.has(c.projectId),
          );
          const fb = fallbackProjectId(s.projects);
          const move = <T extends { projectId: ProjectId; categoryId?: string }>(x: T): T =>
            gone.has(x.projectId) ? { ...x, projectId: fb, categoryId: undefined } : x;
          s.tasks = (s.tasks ?? []).map(move);
          s.triage = (s.triage ?? []).map((t) => ({ ...t, draft: move(t.draft) }));
          s.feedback = (s.feedback ?? []).filter((f) => !gone.has(f.projectId));
          s.events = (s.events ?? []).map((e) =>
            e.projectId && gone.has(e.projectId) ? { ...e, projectId: undefined } : e,
          );
        }
        if (version < 6) {
          // v6 (PRD v1.0): màu chính thức cho Học tập/Admin (chỉ đổi nếu Mai
          // chưa tự chọn màu khác) + 2 category Học tập mới.
          s.projects = (s.projects ?? []).map((p) => {
            if (p.id === "hoctap" && p.color === "#7C9A3E") return { ...p, color: "#9BC53D" };
            if (p.id === "admin" && p.color === "#7D8AA5") return { ...p, color: "#8A8FB0" };
            return p;
          });
          const have = new Set((s.categories ?? []).map((c) => c.id));
          s.categories = [
            ...(s.categories ?? []),
            ...DEFAULT_CATEGORIES.filter(
              (c) => c.projectId === "hoctap" && !have.has(c.id),
            ),
          ];
        }
        if (version < 7) {
          // v7 (PRD v1.6): danh bạ khách hàng/đối tác + lịch sử đổi hạn.
          s.clients = s.clients ?? [];
          s.dueChanges = s.dueChanges ?? [];
        }
        if (version < 8) {
          // v8 (PRD v2.0): thùng rác chuyến để hoàn tác xóa (6a).
          s.tripTrash = s.tripTrash ?? [];
        }
        if (version < 9) {
          // v9 (PRD v2.3): hẹn định kỳ dài hạn + chế độ xem Lịch đã nhớ.
          s.series = s.series ?? [];
          const prev = s.settings;
          s.settings = {
            walkToStationMin: prev?.walkToStationMin ?? 12,
            defaultPrepMinutes: prev?.defaultPrepMinutes ?? 90,
            homeAddress: prev?.homeAddress ?? "",
            calendarView: prev?.calendarView ?? "week",
            projectGroupBy: prev?.projectGroupBy ?? "category",
            projectFilter: prev?.projectFilter ?? "all",
            projectCalendar: prev?.projectCalendar ?? {},
            autoBookBanner: prev?.autoBookBanner ?? {},
            syncStatus: prev?.syncStatus ?? {},
            locationMode: prev?.locationMode ?? "ondemand",
            researchMonthlyLimit: prev?.researchMonthlyLimit ?? 30,
          };
        }
        if (version < 10) {
          // v10 (PRD v2.6): nơi cần đặt chỗ trước (§5.4.2).
          s.places = s.places ?? [];
        }
        if (version < 11) {
          // v11 (PRD v2.9): màn chi tiết dự án nhớ cách nhóm + bộ lọc.
          const prev = s.settings;
          s.settings = {
            walkToStationMin: prev?.walkToStationMin ?? 12,
            defaultPrepMinutes: prev?.defaultPrepMinutes ?? 90,
            homeAddress: prev?.homeAddress ?? "",
            calendarView: prev?.calendarView ?? "week",
            projectGroupBy: prev?.projectGroupBy ?? "category",
            projectFilter: prev?.projectFilter ?? "all",
            projectCalendar: {},
            autoBookBanner: {},
            syncStatus: {},
            locationMode: "ondemand",
            researchMonthlyLimit: 30,
          };
        }
        if (version < 12) {
          // v12 (§5.3.4): lịch đích mặc định theo dự án.
          const prev = s.settings;
          s.settings = {
            walkToStationMin: prev?.walkToStationMin ?? 12,
            defaultPrepMinutes: prev?.defaultPrepMinutes ?? 90,
            homeAddress: prev?.homeAddress ?? "",
            calendarView: prev?.calendarView ?? "week",
            projectGroupBy: prev?.projectGroupBy ?? "category",
            projectFilter: prev?.projectFilter ?? "all",
            projectCalendar: prev?.projectCalendar ?? {},
            autoBookBanner: prev?.autoBookBanner ?? {},
            syncStatus: prev?.syncStatus ?? {},
            locationMode: prev?.locationMode ?? "ondemand",
            researchMonthlyLimit: prev?.researchMonthlyLimit ?? 30,
          };
        }
        if (version < 13) {
          // v13 (PRD v3.1): cờ book thẳng banner theo dự án.
          if (s.settings && !s.settings.autoBookBanner) s.settings.autoBookBanner = {};
        }
        if (version < 14) {
          // v14 (PRD v3.2): trạng thái đồng bộ lịch từng tài khoản.
          if (s.settings && !s.settings.syncStatus) s.settings.syncStatus = {};
        }
        if (version < 15) {
          // v15 (PRD v3.7): thùng rác sự kiện, dấu sự kiện Google/Lark, vị
          // trí hiện tại, nghiên cứu + hạn mức.
          s.eventTrash = s.eventTrash ?? [];
          s.eventMarks = s.eventMarks ?? {};
          s.research = s.research ?? [];
          s.researchUsage = s.researchUsage ?? {};
          s.larkGroups = s.larkGroups ?? {};
          s.larkImported = s.larkImported ?? [];
          if (s.settings) {
            if (!s.settings.locationMode) s.settings.locationMode = "ondemand";
            if (typeof s.settings.researchMonthlyLimit !== "number") s.settings.researchMonthlyLimit = 30;
          }
        }
        if (version < 16) {
          // v16 (Mai 25/9): bỏ gợi ý deep work — dọn thẻ "Deep work: …" còn treo ở Lịch.
          if (s.pendingBlock?.title?.startsWith("Deep work:")) s.pendingBlock = undefined;
        }
        return s as LowtechieState;
      },
    },
  ),
);

/** Gọi một lần ở layout: nạp state đã lưu sau khi mount (tránh lệch SSR). */
export function rehydrateStore(): void {
  void useStore.persist.rehydrate();
}
