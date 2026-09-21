"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CalEvent,
  Destination,
  FeedbackEntry,
  Project,
  Task,
  TriageItem,
  Trip,
} from "@/core/types";
import { DEFAULT_PROJECTS } from "@/core/projects";

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

interface LowtechieState {
  tasks: Task[];
  triage: TriageItem[];
  projects: Project[];
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
  };

  addTask: (draft: TaskDraft) => Task;
  toggleTask: (id: string) => void;
  dropTask: (id: string) => void;
  deferTask: (id: string) => void;
  delegateTask: (id: string, person: string) => void;

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
  removeChain: (eventId: string) => void;
  reschedule: (what: string, toWhenIso: string, keepTime: boolean) => "event" | "task" | null;

  setPendingBlock: (b?: PendingBlock) => void;

  addTrip: (t: Omit<Trip, "id" | "done" | "customItems" | "removed">) => Trip;
  toggleTripItem: (tripId: string, itemId: string) => void;
  addCustomItem: (tripId: string, groupId: string, text: string) => void;
  removeTripItem: (tripId: string, itemId: string, custom: boolean) => void;
  newRound: (tripId: string) => void;

  setWalkToStation: (min: number) => void;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      events: [],
      trips: [],
      learnedItems: { tokyo: [], hcmc: [], bkk: [] },
      feedback: [],
      triageImages: {},
      pendingBlock: undefined,
      settings: { walkToStationMin: 12, defaultPrepMinutes: 90 },

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
      removeChain: (eventId) =>
        set((s) => ({ events: s.events.filter((e) => e.chainOf !== eventId) })),

      reschedule: (what, toWhenIso, keepTime) => {
        const q = what.trim().toLowerCase();
        const to = new Date(toWhenIso);
        const s = get();

        const ev = s.events.find(
          (e) => e.kind === "event" && e.title.toLowerCase().includes(q),
        );
        if (ev) {
          const oldStart = new Date(ev.startAt);
          const dur = new Date(ev.endAt).getTime() - oldStart.getTime();
          const next = new Date(to);
          if (keepTime) next.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
          set((st) => ({
            events: st.events
              // Block chuẩn bị/di chuyển cũ không còn đúng → bỏ, tạo lại sau.
              .filter((e) => e.chainOf !== ev.id)
              .map((e) =>
                e.id === ev.id
                  ? {
                      ...e,
                      startAt: next.toISOString(),
                      endAt: new Date(next.getTime() + dur).toISOString(),
                    }
                  : e,
              ),
          }));
          return "event";
        }

        const task = s.tasks.find(
          (t) => t.status !== "done" && t.title.toLowerCase().includes(q),
        );
        if (task) {
          set((st) => ({
            tasks: st.tasks.map((t) =>
              t.id === task.id
                ? { ...t, dueAt: to.toISOString(), deferCount: t.deferCount + 1 }
                : t,
            ),
          }));
          return "task";
        }
        return null;
      },

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
    }),
    {
      name: "lowtechie-v1",
      skipHydration: true,
      version: 2,
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
        return s as LowtechieState;
      },
    },
  ),
);

/** Gọi một lần ở layout: nạp state đã lưu sau khi mount (tránh lệch SSR). */
export function rehydrateStore(): void {
  void useStore.persist.rehydrate();
}
