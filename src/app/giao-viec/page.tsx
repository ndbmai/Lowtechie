"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Blossom } from "@/components/Blossom";
import { BookTaskSheet } from "@/components/BookTaskSheet";
import { BookingAskCard } from "@/components/BookingAsk";
import { Bubble } from "@/components/Bubble";
import { DueEditor } from "@/components/DueEditor";
import { ResearchPanel } from "@/components/ResearchPanel";
import { SearchSelect, type PickOption } from "@/components/SearchSelect";
import { bannerNote, canAutoBookBanner, findDuplicateEvent, resolveBannerTiming } from "@/core/banner";
import { classify, findDuplicate, learnableTerms, CONFIDENCE_THRESHOLD } from "@/core/classify";
import {
  clientProjectHint,
  clientsFor,
  findClientByName,
  foldName,
  matchClient,
  matchClientDetail,
  orderClientsForPick,
  sanitizeClientId,
  withLearnedAlias,
} from "@/core/clients";
import { matchEventByName, rescheduleTarget } from "@/core/eventOps";
import { CITY_LABEL, LOCATION_TTL_MS } from "@/core/location";
import { detectProject, parseCommand, parseWhen } from "@/core/parse";
import {
  PROJECT_COLORS,
  activeProjects,
  categoriesFor,
  categoryName,
  projectById,
  sanitizeTaxonomy,
} from "@/core/projects";
import type {
  BannerContact,
  BannerEvent,
  CalEvent,
  Category,
  Client,
  DueType,
  ImageParseResult,
  ParseResult,
  ParsedAction,
  Project,
  ProjectId,
  Task,
} from "@/core/types";
import { attachBooking, type BookingAsk } from "@/lib/booking";
import {
  deleteEventEverywhere,
  gcalToCal,
  remoteMetaOf,
  saveEventEdit,
  type RemoteMeta,
} from "@/lib/calendarActions";
import { fmtDay, fmtDayFull, fmtDayTime, fmtDue, fmtRange, fmtRelativeDay, fmtTime, isSameDay } from "@/lib/format";
import { putFile } from "@/lib/fileStore";
import { compressImage, dataUrlToBlob, decodeQr } from "@/lib/image";
import { useSpeech } from "@/lib/speech";
import { useStore, type TaskDraft } from "@/lib/store";
import { showToast } from "@/lib/toast";
import {
  createGcalEvent,
  deleteGcalEvent,
  searchGcalEvents,
  useAccounts,
  useGoogleStatus,
  type GcalEvent,
} from "@/lib/useGoogle";

function taxonomyPayload(t: { projects: Project[]; categories: Category[]; clients: Client[] }) {
  return {
    projects: t.projects.map((p) => ({ id: p.id, name: p.name })),
    categories: t.categories.map((c) => ({ id: c.id, projectId: c.projectId, name: c.name })),
    // Danh bạ khách để Claude điền khách hàng theo tên/tên gọi tắt (§5.3.2).
    clients: t.clients.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      projectIds: c.projectIds,
    })),
  };
}

async function parseViaApi(
  text: string,
  taxonomy: { projects: Project[]; categories: Category[]; clients: Client[] },
): Promise<ParseResult> {
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        epochMs: Date.now(),
        tzOffsetMin: new Date().getTimezoneOffset(),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Taxonomy thật của Mai — dự án/category tự thêm cũng phân loại được.
        taxonomy: taxonomyPayload(taxonomy),
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const r = (await res.json()) as ParseResult;
    // Claude có thể trả thiếu trường — bỏ hành động không dùng được thay vì vỡ thẻ.
    return { ...r, actions: (r.actions ?? []).filter(usableAction) };
  } catch {
    // Không có API key / mất mạng → bộ luật chạy ngay trên trình duyệt,
    // đúng múi giờ của Mai.
    return parseCommand(text);
  }
}

function usableAction(a: ParsedAction): boolean {
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  switch (a.kind) {
    case "task":
    case "event":
      return str(a.title);
    case "location":
      return a.city === "bkk" || a.city === "hcmc" || a.city === "tokyo";
    case "research":
      return str(a.query);
    case "note":
      return str(a.what) && str(a.text);
    default:
      return str((a as { what?: unknown }).what);
  }
}

interface Resolved {
  projectId: ProjectId;
  categoryId?: string;
  clientId?: string;
  confidence: number;
  alternatives: { projectId: ProjectId; categoryId?: string }[];
}

type Override = { projectId: ProjectId; categoryId?: string; clientId?: string };

export default function CapturePage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [merge, setMerge] = useState<Record<number, boolean>>({});
  const [savedLines, setSavedLines] = useState<string[] | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    tasks,
    projects,
    categories,
    clients,
    trips,
    events,
    feedback,
    addTask,
    addEvent,
    rescheduleTask,
    setEventBooking,
    setLocationState,
    setPendingBlock,
    addTriageGroup,
    recordFeedback,
    addProject,
    addCategory,
    addClient,
    touchClient,
    removeEvent,
    addTaskNote,
    completeTask,
    places,
    addTriage,
    updateEvent,
    settings,
  } = useStore();
  /** Sự kiện soạn sẵn từ ảnh banner (v3.0) — chờ Mai duyệt trên thẻ. */
  const [banner, setBanner] = useState<{
    ev: BannerEvent;
    image: string;
    projectId?: ProjectId;
  } | null>(null);
  /** Danh thiếp đọc từ ảnh (v3.1) — gợi ý thêm vào danh bạ khách. */
  const [contactCard, setContactCard] = useState<{
    contact: BannerContact;
    readNote?: string;
  } | null>(null);
  /** Ảnh không chắc loại / đọc được ít (v3.1) — hỏi một câu, không trả lời cụt. */
  const [unknown, setUnknown] = useState<{
    image: string;
    caption: string;
    readNote?: string;
    question?: string;
    readTitles: string[];
  } | null>(null);
  /** Tên khách đang gõ dở theo từng thẻ — Lưu là vào danh bạ (v2.3). */
  const [clientQ, setClientQ] = useState<Record<number, string>>({});
  /** Ghi chú Mai gõ trên từng thẻ việc (3d) — tách riêng với Nguồn. */
  const [noteEdits, setNoteEdits] = useState<Record<number, string>>({});
  const [dueEdits, setDueEdits] = useState<Record<number, { dueAt?: string; dueType?: DueType }>>({});
  const gs = useGoogleStatus();
  const accts = useAccounts();
  /** Tài khoản đang bật Lịch — chọn LỊCH ĐÍCH ở thẻ xem trước (§5.3.4). */
  const calAccounts = accts.accounts.filter((x) => x.parts.cal);
  /** Book sự kiện lên lịch ngoài sau khi xem trước (§5.4 v2.0). */
  const [book, setBook] = useState<Record<number, boolean>>({});
  const [bookAcct, setBookAcct] = useState<Record<number, string>>({});
  const [lastBooked, setLastBooked] = useState<
    { localId: string; gcalId?: string; account?: string }[] | null
  >(null);
  /** Sự kiện trên Google/Lark khớp lệnh dời/xóa/đã đặt (khi app không có bản local). */
  const [remoteHits, setRemoteHits] = useState<Record<number, GcalEvent | null>>({});
  /** Lần đầu gặp nơi cần đặt chỗ → hỏi một câu (§5.4.2 v3.7). */
  const [bookingAsk, setBookingAsk] = useState<BookingAsk | null>(null);
  /** "book 2 tiếng cho việc X thứ Năm" → tấm chọn khung giờ (§5.2.2 v3.7). */
  const [bookSheet, setBookSheet] = useState<{ task: Task; duration?: number; onDay?: string } | null>(null);
  /** "tìm giúp chị…" → thẻ nghiên cứu (§5.9.1 v3.7). */
  const [research, setResearch] = useState<{ query: string; projectId?: ProjectId } | null>(null);

  const runParse = useCallback(
    async (t: string) => {
      if (!t.trim()) return;
      setBusy(true);
      setSavedLines(null);
      setOverrides({});
      setMerge({});
      setDueEdits({});
      setBook({});
      setLastBooked(null);
      setClientQ({});
      setNoteEdits({});
      setRemoteHits({});
      setBookingAsk(null);
      const r = await parseViaApi(t.trim(), { projects, categories, clients });
      setResult(r);
      setBusy(false);
    },
    [projects, categories, clients],
  );

  const onSpeech = useCallback(
    (final: string) => {
      setText(final);
      void runParse(final);
    },
    [runParse],
  );
  const { supported, listening, processing, error: speechError, start, stop } = useSpeech(onSpeech);
  const [micHint, setMicHint] = useState(false);
  useEffect(() => {
    try {
      setMicHint(supported && !localStorage.getItem("lt-mic-ok"));
    } catch {
      /* private mode */
    }
  }, [supported]);
  useEffect(() => {
    if (!listening) return;
    try {
      localStorage.setItem("lt-mic-ok", "1");
    } catch {
      /* private mode */
    }
    setMicHint(false);
  }, [listening]);

  /** Hợp nhất đề xuất của parser/Claude + học từ sửa + override của Mai,
   *  rồi đối chiếu với taxonomy thật (dự án đã xóa → rơi về Cá nhân). */
  const resolveTask = useCallback(
    (a: Extract<ParsedAction, { kind: "task" }>, index: number): Resolved => {
      const clean = (projectId: ProjectId | undefined, categoryId?: string) =>
        sanitizeTaxonomy(projects, categories, projectId, categoryId);
      // Khách hàng: id từ Claude (đã kiểm) hoặc khớp tên trong tiêu đề với
      // danh bạ — tên lạ không đoán (§5.3.2).
      const matched = matchClient(a.title, clients);
      const baseClient = sanitizeClientId(clients, a.clientId) ?? matched?.id;
      const o = overrides[index];
      if (o) {
        return {
          ...clean(o.projectId, o.categoryId),
          clientId: "clientId" in o ? o.clientId : baseClient,
          confidence: 1,
          alternatives: [],
        };
      }
      const cls = classify(a.title, feedback);
      // Điều Mai đã dạy (feedback) thắng cả đề xuất của parser.
      if (cls.confidence >= 0.9) {
        return {
          ...clean(cls.projectId, cls.categoryId),
          clientId: baseClient,
          confidence: cls.confidence,
          alternatives: [],
        };
      }
      const categoryId =
        a.categoryId ?? (cls.projectId === a.projectId ? cls.categoryId : undefined);
      // Tín hiệu khách hàng (§5.2.1): dự án của khách được đề lên đầu.
      const hint = clientProjectHint(matched, projects);
      const rawAlts = [
        ...(hint ? [{ projectId: hint, categoryId: undefined }] : []),
        ...(cls.projectId !== a.projectId
          ? [{ projectId: cls.projectId, categoryId: cls.categoryId }, ...cls.alternatives]
          : cls.alternatives),
      ].slice(0, 3);
      const alternatives = rawAlts
        .map((alt) => clean(alt.projectId, alt.categoryId))
        .filter((alt, i, arr) => arr.findIndex((x) => x.projectId === alt.projectId) === i);
      const main = clean(a.projectId, categoryId);
      return {
        ...main,
        clientId: baseClient,
        confidence: a.confidence,
        alternatives: alternatives.filter((alt) => alt.projectId !== main.projectId).slice(0, 2),
      };
    },
    [overrides, feedback, projects, categories, clients],
  );

  const taskActions = useMemo(
    () =>
      (result?.actions ?? [])
        .map((a, i) => ({ a, i }))
        .filter((x): x is { a: Extract<ParsedAction, { kind: "task" }>; i: number } => x.a.kind === "task"),
    [result],
  );

  /** Sự kiện trong app có thể là đích của lệnh chat (không tính block chuỗi). */
  const localTargets = useMemo(
    () => events.filter((e) => e.kind === "event" || e.kind === "block"),
    [events],
  );

  /** Đích của "dời/xóa/đã đặt X": sự kiện trong app trước, rồi Google/Lark. */
  const eventTarget = useCallback(
    (
      i: number,
      a: { what: string; day?: string; kind: string },
    ): { event: CalEvent; remote?: RemoteMeta } | undefined => {
      const now = new Date();
      const pool =
        a.kind === "booked"
          ? [...localTargets.filter((e) => e.bookingStatus === "pending"), ...localTargets]
          : localTargets;
      const local = matchEventByName(pool, a.what, a.day, now);
      if (local) return { event: local };
      const g = remoteHits[i];
      if (!g) return undefined;
      return { event: gcalToCal(g), remote: remoteMetaOf(g) };
    },
    [localTargets, remoteHits],
  );

  /** Việc đang mở khớp tên Mai nói (không dấu). */
  const findOpenTask = useCallback(
    (what: string) => {
      const q = foldName(what);
      return tasks.find(
        (t) => (t.status === "todo" || t.status === "doing") && foldName(t.title).includes(q),
      );
    },
    [tasks],
  );

  // Lệnh dời/xóa/đã đặt mà app không có bản local → tìm trên Google/Lark.
  useEffect(() => {
    if (!result || !gs.connected) return;
    let alive = true;
    void (async () => {
      const next: Record<number, GcalEvent | null> = {};
      for (const [i, a] of result.actions.entries()) {
        if (a.kind !== "reschedule" && a.kind !== "delete_event" && a.kind !== "booked") continue;
        if (matchEventByName(localTargets, a.what, a.day, new Date())) continue;
        const list = await searchGcalEvents(a.what);
        next[i] = matchEventByName(list, a.what, a.day, new Date()) ?? null;
      }
      if (alive) setRemoteHits(next);
    })();
    return () => {
      alive = false;
    };
  }, [result, gs.connected, localTargets]);

  const duplicates = useMemo(() => {
    const m: Record<number, string> = {};
    for (const { a, i } of taskActions) {
      const dup = findDuplicate(a.title, tasks);
      if (dup) m[i] = dup.title;
    }
    return m;
  }, [taskActions, tasks]);

  const summary = useMemo(() => {
    if (!result) return "";
    const byProject = new Map<string, number>();
    for (const { a, i } of taskActions) {
      const r = resolveTask(a, i);
      const name = projectById(projects, r.projectId).name;
      byProject.set(name, (byProject.get(name) ?? 0) + 1);
    }
    const parts: string[] = [];
    if (taskActions.length) {
      const detail = [...byProject.entries()].map(([n, c]) => `${c} ${n}`).join(" · ");
      parts.push(`${taskActions.length} việc mới (${detail})`);
    }
    const events = result.actions.filter((a) => a.kind === "event").length;
    const moves = result.actions.filter((a) => a.kind === "reschedule").length;
    if (events) parts.push(`${events} lịch`);
    if (moves) parts.push(`${moves} đổi lịch`);
    const dupCount = Object.keys(duplicates).length;
    if (dupCount) parts.push(`${dupCount} trùng (đề xuất gộp)`);
    return parts.join(" · ");
  }, [result, taskActions, duplicates, resolveTask, projects]);

  function applyOverride(index: number, title: string, next: Override, learn = true) {
    setOverrides((s) => ({ ...s, [index]: next }));
    // Học từ sửa đổi: tên riêng trong tiêu đề → dự án/category này.
    if (!learn) return;
    const terms = learnableTerms(title);
    if (terms.length) {
      recordFeedback(
        terms.map((term) => ({ term, projectId: next.projectId, categoryId: next.categoryId })),
      );
    }
  }

  async function saveAll() {
    if (!result) return;
    const lines: string[] = [];
    const booked: { localId: string; gcalId?: string; account?: string }[] = [];
    let goCalendar = false;

    for (const [i, a] of result.actions.entries()) {
      if (a.kind === "task") {
        if (duplicates[i] && (merge[i] ?? true)) {
          lines.push(`“${a.title}” trùng với việc đang có — mình gộp, không tạo mới.`);
          continue;
        }
        const r = resolveTask(a, i);
        // Hạn: nguồn tự điền, Mai sửa trên thẻ thắng nguồn (3c).
        const due = i in dueEdits ? dueEdits[i] : { dueAt: a.dueAt, dueType: a.dueType };
        // Nhập một lần (v2.3): tên khách gõ tay chưa bấm "Tạo mới" vẫn
        // vào danh bạ; tên gần giống thì dùng lại, không tạo trùng.
        let clientId = r.clientId;
        const typed = clientQ[i]?.trim();
        if (!clientId && typed) {
          const found = findClientByName(clients, typed);
          // Cách viết mới của khách đã có → học vào tên gọi khác (v2.8).
          if (found) {
            const aliases = withLearnedAlias(found, typed);
            if (aliases) useStore.getState().updateClient(found.id, { aliases });
          }
          clientId = (found ?? addClient(typed, r.projectId))?.id;
        }
        if (clientId) touchClient(clientId);
        const noteBody = noteEdits[i]?.trim();
        addTask({
          title: a.title,
          projectId: r.projectId,
          categoryId: r.categoryId,
          clientId,
          notes: noteBody
            ? [{ id: `n-${Date.now()}-${i}`, body: noteBody, at: new Date().toISOString() }]
            : undefined,
          assignee: a.assignee ?? "mai",
          dueAt: due.dueAt,
          dueType: due.dueAt ? (due.dueType ?? "soft") : undefined,
          dueSource: due.dueAt ? (i in dueEdits ? "mai" : "nguon") : undefined,
          estMinutes: undefined,
          source: { channel: "app-chat", quote: text.trim() },
          confidence: a.confidence,
        });
        lines.push(`Đã tạo “${a.title}”${due.dueAt ? ` — hạn ${fmtRelativeDay(due.dueAt)}` : ""}.`);
      } else if (a.kind === "event") {
        if (a.startAt) {
          const start = new Date(a.startAt);
          const end = new Date(start.getTime() + (a.durationMinutes ?? 60) * 60_000);
          // Book lên lịch ngoài chỉ sau khi Mai tick ở thẻ xem trước (§5.4);
          // lịch đích chọn được trên thẻ (§5.3.4).
          let gcalId: string | null = null;
          let calAccount: string | undefined;
          if (book[i] && gs.connected) {
            const created = await createGcalEvent(
              {
                title: a.title,
                startAt: start.toISOString(),
                endAt: end.toISOString(),
                description: a.location ? `Ở ${a.location}` : undefined,
              },
              bookAcct[i] || undefined,
            );
            gcalId = created?.gcalId ?? null;
            calAccount = created?.accountId;
          }
          const ev = addEvent({
            title: a.title,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            location: a.location,
            kind: "event",
            gcalId: gcalId ?? undefined,
            calAccount,
          });
          // Nơi cần đặt chỗ (§5.4.2 v3.7): VIỆC "Đặt lịch…" vào thẳng danh
          // sách việc (không chỉ thông báo); lần đầu gặp nơi này thì hỏi một câu.
          const b = attachBooking(ev);
          if (b.line) lines.push(b.line);
          if (b.ask) setBookingAsk(b.ask);
          if (gcalId) booked.push({ localId: ev.id, gcalId, account: calAccount });
          lines.push(
            `Đã thêm “${a.title}” lúc ${fmtTime(a.startAt)} ${fmtRelativeDay(a.startAt)}${
              gcalId
                ? " · đã book lên Google Calendar ✓"
                : book[i] && gs.connected
                  ? " · book Google lỗi, mới lưu trong app"
                  : ""
            }. Vào Lịch để khóa block chuẩn bị + di chuyển${a.mode === "car" ? " (ô tô)" : " (BTS)"}.`,
          );
        } else if (a.durationMinutes) {
          setPendingBlock({
            title: a.title,
            projectId: detectProject(a.title).id,
            durationMinutes: a.durationMinutes,
          });
          lines.push(`“${a.title}” cần ${a.durationMinutes} phút — mình đề xuất khung giờ trong Lịch nhé.`);
          goCalendar = true;
        }
      } else if (a.kind === "reschedule") {
        if (!a.toWhen) continue;
        const tgt = eventTarget(i, a);
        if (tgt) {
          if (tgt.remote?.readOnly) {
            lines.push(`“${tgt.event.title}” thuộc lịch chỉ xem — chỉ người tạo mới dời được.`);
            continue;
          }
          // Dời qua cùng đường với màn chi tiết: lịch ngoài + chuỗi block đi theo.
          const newStart = rescheduleTarget(tgt.event.startAt, a.toWhen, {
            keepTime: a.keepTime,
            keepDate: a.keepDate,
          });
          const dur = Date.parse(tgt.event.endAt) - Date.parse(tgt.event.startAt);
          const r = await saveEventEdit(
            tgt.event,
            { startAt: newStart, endAt: new Date(Date.parse(newStart) + dur).toISOString() },
            tgt.remote,
          );
          lines.push(
            `Đã dời “${tgt.event.title}” sang ${fmtDay(newStart)} ${fmtRange(newStart, new Date(Date.parse(newStart) + dur).toISOString())}${r.remoteOk ? "" : " — lịch ngoài báo lỗi, mới đổi trong app"}.`,
          );
          continue;
        }
        if (matchEventByName(localTargets, a.what, undefined, new Date())) {
          lines.push(`Mình thấy lịch “${a.what}” nhưng không vào ngày Mai nói — Mai kiểm tra giúp mình nhé.`);
          continue;
        }
        const task = findOpenTask(a.what);
        if (task) {
          const due =
            task.dueAt && (a.keepTime || a.keepDate)
              ? rescheduleTarget(task.dueAt, a.toWhen, { keepTime: a.keepTime, keepDate: a.keepDate })
              : a.toWhen;
          rescheduleTask(task.id, due);
          lines.push(`Đã dời hạn “${task.title}” sang ${fmtRelativeDay(due)}.`);
        } else {
          lines.push(`Mình chưa tìm thấy “${a.what}” trong lịch hay danh sách việc — Mai kiểm tra giúp mình nhé.`);
        }
      } else if (a.kind === "delete_event") {
        // Xóa bằng chat (§5.4.0 v3.7): thẻ trên đã hiện đúng lịch khớp — bấm Lưu là xác nhận.
        const tgt = eventTarget(i, a);
        if (!tgt) {
          lines.push(`Mình chưa tìm thấy lịch “${a.what}” — Mai kiểm tra trong màn Lịch nhé.`);
          continue;
        }
        const guests = tgt.remote?.attendees?.length ?? 0;
        if (tgt.remote?.readOnly || tgt.remote?.seriesId || guests > 0) {
          lines.push(
            `“${tgt.event.title}” ${tgt.remote?.readOnly ? "thuộc lịch chỉ xem" : tgt.remote?.seriesId ? "là lịch lặp lại" : `có ${guests} người được mời`} — Mai mở nó trong màn Lịch để xác nhận riêng nhé.`,
          );
          continue;
        }
        const r = await deleteEventEverywhere(tgt.event, tgt.remote, { dropBookingTask: true });
        if (!r.remoteOk && tgt.remote) {
          lines.push(`Lịch ngoài chưa cho xóa “${tgt.event.title}” — mình giữ nguyên.`);
          continue;
        }
        lines.push(`Đã xóa “${tgt.event.title}” (${fmtDayTime(tgt.event.startAt)}).`);
        showToast({
          text: `Đã xóa “${tgt.event.title}”`,
          ttlMs: 120_000,
          actions: [{ label: "Hoàn tác", primary: true, run: () => r.undo() }],
        });
      } else if (a.kind === "booked") {
        const tgt = eventTarget(i, a);
        if (!tgt) {
          lines.push(`Mình chưa thấy lịch “${a.what}” để đánh dấu đã đặt chỗ.`);
          continue;
        }
        setEventBooking(tgt.event.id, "booked");
        lines.push(`Đã đánh dấu “${tgt.event.title}” (${fmtDayTime(tgt.event.startAt)}) đã đặt chỗ ✓ — việc đặt chỗ đi kèm cũng xong.`);
      } else if (a.kind === "book_task") {
        const task = findOpenTask(a.what);
        if (!task) {
          lines.push(`Mình chưa thấy việc “${a.what}” đang mở để book lịch.`);
          continue;
        }
        setBookSheet({ task, duration: a.durationMinutes, onDay: a.day });
        lines.push(`📅 Mình đề xuất khung giờ cho “${task.title}” bên dưới — Mai chọn một khung nhé.`);
      } else if (a.kind === "location") {
        const now = new Date();
        setLocationState({
          city: a.city,
          source: "manual",
          updatedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + LOCATION_TTL_MS).toISOString(),
        });
        lines.push(`📍 Đã ghi: Mai đang ở ${CITY_LABEL[a.city]} — chuỗi di chuyển tính từ đây, phương tiện mặc định theo thành phố.`);
      } else if (a.kind === "research") {
        const projectId = a.projectId
          ? sanitizeTaxonomy(projects, categories, a.projectId, undefined).projectId
          : undefined;
        setResearch({ query: a.query, projectId });
        lines.push(`🔎 Mình đang nghiên cứu “${a.query}” — kết quả hiện ngay bên dưới.`);
      } else if (a.kind === "note") {
        // Ghi chú vào việc đã có (3d) — thẻ ở trên đã hiện đúng việc khớp.
        const target = tasks.find(
          (t) => t.status !== "done" && t.status !== "dropped" && t.title.toLowerCase().includes(a.what.toLowerCase()),
        );
        if (target) {
          addTaskNote(target.id, a.text);
          lines.push(`Đã thêm ghi chú vào “${target.title}”.`);
        } else {
          lines.push(`Mình chưa tìm thấy việc “${a.what}” để ghi chú — Mai kiểm tra giúp mình nhé.`);
        }
      } else if (a.kind === "complete") {
        // 5.2.2: đóng qua chat LUÔN qua thẻ xác nhận — thẻ trên đã hiện
        // đúng tên việc, bấm Lưu mới đóng.
        const target = tasks.find(
          (t) => t.status !== "done" && t.status !== "dropped" && t.title.toLowerCase().includes(a.what.toLowerCase()),
        );
        if (target) {
          completeTask(target.id, "chat");
          lines.push(`Đã đóng “${target.title}” ✓ (Mở lại được trong mục Đã xong).`);
        } else {
          lines.push(`Mình chưa thấy việc “${a.what}” đang mở — có khi xong rồi?`);
        }
      }
    }

    setLastBooked(booked.length ? booked : null);
    setSavedLines(lines);
    setResult(null);
    setBook({});
    setText("");
    if (goCalendar) router.push("/lich");
  }

  /** Hoàn tác book: xóa trên lịch ngoài (đúng tài khoản) và gỡ sự kiện trong app. */
  function undoBook() {
    for (const b of lastBooked ?? []) {
      if (b.gcalId) void deleteGcalEvent(b.gcalId, b.account);
      removeEvent(b.localId);
    }
    setLastBooked(null);
    setSavedLines((s) => [...(s ?? []), "Đã gỡ sự kiện vừa book khỏi Google Calendar và lịch trong app."]);
  }

  /** Book thẳng banner (v3.1) — dự án đã bật quy tắc; LUÔN kèm Hoàn tác. */
  async function autoBookFromBanner(
    ev: BannerEvent,
    projectId: ProjectId,
    timing: { startAt: string; endAt: string },
    image: string,
  ) {
    const lines: string[] = [];
    const notes = bannerNote(ev);
    const fileId = `banner-${Date.now().toString(36)}`;
    const blob = dataUrlToBlob(image);
    const savedImg = blob ? await putFile(fileId, blob) : false;
    const created = await createGcalEvent(
      {
        title: ev.title,
        startAt: timing.startAt,
        endAt: timing.endAt,
        description: [notes, ev.registrationUrl].filter(Boolean).join(" · ") || undefined,
      },
      settings.projectCalendar[projectId],
    );
    const local = addEvent({
      title: ev.title,
      startAt: timing.startAt,
      endAt: timing.endAt,
      location: ev.location,
      kind: "event",
      projectId,
      gcalId: created?.gcalId,
      calAccount: created?.accountId,
      linkUrl: ev.registrationUrl,
      notes: notes || undefined,
      bannerImage: savedImg ? fileId : undefined,
    });
    lines.push(
      `⚡ Đã book thẳng "${ev.title}" — ${fmtDayTime(timing.startAt)}${created ? "" : " (lịch ngoài lỗi, mới lưu trong app)"} theo quy tắc của dự án ${projectById(projects, projectId).name}.`,
    );
    if (ev.registrationUrl || ev.registrationDeadline) {
      const deadline =
        ev.registrationDeadline && !Number.isNaN(Date.parse(ev.registrationDeadline))
          ? ev.registrationDeadline
          : undefined;
      addTriage({
        title: `Đăng ký / mua vé: ${ev.title}`,
        projectId,
        assignee: "mai",
        dueAt: deadline,
        dueType: deadline ? "hard" : undefined,
        dueSource: deadline ? "nguon" : undefined,
        source: {
          channel: "app-chat",
          quote: `Từ banner "${ev.title}"${ev.price ? ` — ${ev.price}` : ""}${ev.registrationUrl ? ` — ${ev.registrationUrl}` : ""}`,
        },
        confidence: ev.confidence,
      });
      lines.push(
        `Việc "Đăng ký / mua vé" đã vào Hộp duyệt${deadline ? ` (hạn ${fmtDayFull(deadline)})` : ""}.`,
      );
    }
    setLastBooked([{ localId: local.id, gcalId: created?.gcalId, account: created?.accountId }]);
    setSavedLines(lines);
  }

  async function pickImages(files: FileList | null) {
    if (!files?.length) return;
    setImgError(null);
    const out: string[] = [];
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        out.push(await compressImage(f));
      } catch {
        setImgError("Có ảnh không đọc được, mình bỏ qua ảnh đó.");
      }
    }
    setImages((s) => [...s, ...out].slice(0, 4));
  }

  async function runImageParse() {
    if (!images.length) return;
    setImgBusy(true);
    setImgError(null);
    try {
      // Mã QR trên banner giải ngay trên máy (AI không đọc được QR).
      const qrUrls = (await Promise.all(images.map((i) => decodeQr(i)))).filter(
        (x): x is string => Boolean(x),
      );
      const res = await fetch("/api/parse-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images,
          caption: text.trim(),
          qrUrls,
          epochMs: Date.now(),
          tzOffsetMin: new Date().getTimezoneOffset(),
          taxonomy: taxonomyPayload({ projects, categories, clients }),
        }),
      });
      if (res.status === 501) {
        setImgError(
          "Đọc ảnh cần Claude API — Mai thêm ANTHROPIC_API_KEY vào server (Vercel → Settings → Environment Variables), Redeploy, rồi thử lại nhé. Phần chat/voice vẫn chạy không cần key.",
        );
        return;
      }
      if (res.status === 413) {
        setImgError("Ảnh nặng quá cho server — Mai bỏ bớt, gửi 1–2 ảnh một lần nhé.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        setImgError(
          `Đọc ảnh không thành công (mã ${res.status}${body?.detail ? ` — ${body.detail}` : ""}). Mai chụp màn hình lỗi này gửi mình là mình biết đường sửa.`,
        );
        return;
      }
      const data = (await res.json()) as ImageParseResult;

      // Ảnh là banner sự kiện (v3.0/v3.1): dự án đoán theo logo/tổ chức;
      // dự án đã bật "book thẳng" + đủ giờ/địa điểm/không trùng → book luôn,
      // báo sau kèm Hoàn tác; còn lại vào thẻ xem trước.
      if (data.kind === "banner" && data.event) {
        const ev = data.event;
        const hinted = ev.projectHint
          ? sanitizeTaxonomy(projects, categories, ev.projectHint, undefined).projectId
          : undefined;
        const guessed =
          hinted ??
          sanitizeTaxonomy(
            projects,
            categories,
            classify(`${ev.title} ${ev.organizer ?? ""}`, feedback).projectId,
            undefined,
          ).projectId;
        const timing = resolveBannerTiming(ev, Date.now());
        const dup =
          timing.status === "ok"
            ? findDuplicateEvent(
                events.filter((e) => e.kind === "event"),
                ev.title,
                timing.startAt,
              )
            : undefined;
        if (
          settings.autoBookBanner[guessed] &&
          gs.connected &&
          timing.status === "ok" &&
          canAutoBookBanner(timing, Boolean(ev.location), Boolean(dup))
        ) {
          await autoBookFromBanner(ev, guessed, timing, images[0]);
        } else {
          setBanner({ ev, image: images[0], projectId: guessed });
        }
        setImages([]);
        setText("");
        return;
      }

      // Danh thiếp (v3.1) → gợi ý thêm vào danh bạ khách, Mai duyệt.
      if (data.kind === "danhthiep" && data.contact) {
        setContactCard({ contact: data.contact, readNote: data.readNote });
        setImages([]);
        return;
      }

      const caption = text.trim();

      // Không chắc loại ảnh (v3.1) → hỏi một câu, KỂ CẢ khi đọc lõm bõm
      // được vài dòng — không âm thầm đẩy dòng mù mờ vào Hộp duyệt.
      if (data.kind === "khac") {
        setUnknown({
          image: images[0],
          caption,
          readNote: data.readNote,
          question: data.question,
          readTitles: data.items.map((it) => it.title).slice(0, 5),
        });
        setImages([]);
        return;
      }

      const capProject = caption ? detectProject(caption) : { id: "canhan" as ProjectId, explicit: false };
      const capWhen = caption ? parseWhen(caption, new Date()) : { at: undefined, hasTime: false, spans: [] };
      const active = data.items.filter((it) => !it.done);
      const skipped = data.items.length - active.length;

      const drafts: TaskDraft[] = active.map((it) => {
        const cls = classify(it.title, feedback);
        const rawProject = capProject.explicit ? capProject.id : (it.projectId ?? cls.projectId);
        const rawCategory =
          it.categoryId ?? (cls.projectId === rawProject ? cls.categoryId : undefined);
        const { projectId, categoryId } = sanitizeTaxonomy(
          projects,
          categories,
          rawProject,
          rawCategory,
        );
        const dueAt = it.dueAt ?? capWhen.at?.toISOString();
        return {
          title: it.title,
          projectId,
          categoryId,
          // Khách hàng: id Claude trả (đã kiểm) hoặc khớp tên với danh bạ.
          clientId:
            sanitizeClientId(clients, it.clientId) ??
            matchClient(`${it.title} ${caption}`, clients)?.id,
          assignee: it.assignee ?? "mai",
          dueAt,
          dueType: dueAt ? "soft" : undefined,
          dueSource: dueAt ? "nguon" : undefined,
          estMinutes: undefined,
          source: {
            channel: "app-chat",
            quote: `Từ ảnh${it.group ? ` · mục "${it.group}"` : ""}${caption ? ` — "${caption}"` : ""}`,
          },
          confidence: it.confidence,
        };
      });

      if (drafts.length === 0) {
        if (skipped > 0) {
          // Câu trả lời ĐÚNG, không phải trả lời cụt: mọi mục đã tick xong.
          setImgError(`Cả ${skipped} mục trong ảnh đều đã tick xong — không có việc mới.`);
          return;
        }
        // KHÔNG trả lời cụt (v3.1): hiện những gì đọc được + hỏi một câu
        // + nút tạo thủ công; ảnh mờ/nhỏ/lóa thì nêu rõ lý do.
        setUnknown({
          image: images[0],
          caption,
          readNote: data.readNote,
          question: data.question,
          readTitles: data.items.map((it) => it.title).slice(0, 5),
        });
        setImages([]);
        return;
      }

      addTriageGroup(drafts, images[0]);
      setImages([]);
      setText("");
      setSavedLines([
        `${drafts.length} việc từ ảnh đã vào Hộp duyệt${skipped ? ` (bỏ qua ${skipped} mục đã tick)` : ""}.`,
        ...(data.readNote ? [`📷 ${data.readNote} — nếu thiếu dòng nào, Mai gửi ảnh gốc hoặc chụp gần hơn nhé.`] : []),
      ]);
      router.push("/hop-duyet");
    } catch {
      setImgError("Không gửi được ảnh lên server (mạng chập chờn?) — Mai thử lại giúp mình nhé.");
    } finally {
      setImgBusy(false);
    }
  }

  /** Thẻ xác nhận cho lệnh dời/xóa/đã đặt/book việc/vị trí/nghiên cứu (v3.7). */
  function renderActionCard(a: ParsedAction, i: number) {
    if (a.kind === "reschedule") {
      const tgt = eventTarget(i, a);
      if (tgt && a.toWhen) {
        const ns = rescheduleTarget(tgt.event.startAt, a.toWhen, { keepTime: a.keepTime, keepDate: a.keepDate });
        const ne = new Date(Date.parse(ns) + Date.parse(tgt.event.endAt) - Date.parse(tgt.event.startAt)).toISOString();
        return (
          <div className="parsed cal">
            <div className="k">Dời lịch — xem trước</div>
            <b>{tgt.event.title}</b>
            <div className="small">
              <s className="muted">
                {fmtDay(tgt.event.startAt)} {fmtRange(tgt.event.startAt, tgt.event.endAt)}
              </s>{" "}
              → <b>{fmtDay(ns)} {fmtRange(ns, ne)}</b>
            </div>
            {tgt.remote && (
              <div className="small muted">
                trên {tgt.remote.provider === "lark" ? "Lark" : "Google"}
                {tgt.remote.readOnly ? " · lịch chỉ xem, không dời được" : ""}
              </div>
            )}
          </div>
        );
      }
      const task = findOpenTask(a.what);
      return (
        <div className="parsed cal">
          <div className="k">{task ? "Dời hạn việc" : "Đổi lịch"}</div>
          <b>{task ? task.title : a.what}</b>
          <div className="small muted">
            {task?.dueAt ? `${fmtDue(task.dueAt)} → ` : ""}
            {a.toWhen ? (a.keepTime ? fmtRelativeDay(a.toWhen) : fmtDayTime(a.toWhen)) : "…?"}
            {!task && !tgt ? " · chưa thấy lịch/việc khớp tên" : ""}
          </div>
        </div>
      );
    }
    if (a.kind === "delete_event" || a.kind === "booked") {
      const tgt = eventTarget(i, a);
      const chain = tgt ? events.filter((e) => e.chainOf === tgt.event.id).length : 0;
      const bookingTask = tgt
        ? tasks.find((t) => t.bookingEventId === tgt.event.id && (t.status === "todo" || t.status === "doing"))
        : undefined;
      return (
        <div className="parsed cal">
          <div className="k">{a.kind === "delete_event" ? "Xóa lịch — xác nhận" : "Đã đặt chỗ"}</div>
          <b>{tgt ? tgt.event.title : `“${a.what}”`}</b>
          <div className="small muted">
            {tgt
              ? `${fmtDay(tgt.event.startAt)} ${fmtRange(tgt.event.startAt, tgt.event.endAt)}${tgt.remote ? ` · trên ${tgt.remote.provider === "lark" ? "Lark" : "Google"}` : ""}`
              : "Chưa thấy lịch khớp tên — Mai kiểm tra lại nhé."}
          </div>
          {tgt && a.kind === "delete_event" && (
            <div className="small">
              {tgt.remote?.readOnly || tgt.remote?.seriesId || (tgt.remote?.attendees?.length ?? 0) > 0
                ? "Lịch này cần xác nhận riêng trong màn Lịch (chỉ xem / lặp lại / có người được mời)."
                : `Bấm Lưu là xóa${chain ? ` kèm ${chain} block chuẩn bị + di chuyển` : ""}${bookingTask ? ` và việc “${bookingTask.title}”` : ""} — có Hoàn tác.`}
            </div>
          )}
          {tgt && a.kind === "booked" && bookingTask && (
            <div className="small">Việc “{bookingTask.title}” cũng sẽ đóng.</div>
          )}
        </div>
      );
    }
    if (a.kind === "book_task") {
      const task = findOpenTask(a.what);
      return (
        <div className="parsed cal">
          <div className="k">Book lịch cho việc</div>
          <b>{task ? task.title : `“${a.what}”`}</b>
          <div className="small muted">
            {a.durationMinutes ? `${a.durationMinutes} phút` : "thời lượng chọn sau"}
            {a.day ? ` · ${fmtDayFull(a.day)}` : task?.dueAt ? ` · trước hạn ${fmtDue(task.dueAt)}` : ""}
            {task ? " · bấm Lưu để xem 3 khung đề xuất" : " · chưa thấy việc đang mở khớp tên"}
          </div>
        </div>
      );
    }
    if (a.kind === "location") {
      return (
        <div className="parsed cal">
          <div className="k">Vị trí</div>
          <b>Mai đang ở {CITY_LABEL[a.city]}</b>
          <div className="small muted">Chuỗi di chuyển + phương tiện mặc định tính theo thành phố này.</div>
        </div>
      );
    }
    if (a.kind === "research") {
      const d = new Date();
      const used = useStore.getState().researchUsage[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`] ?? 0;
      const projectName = a.projectId
        ? projects.find((p) => p.id === sanitizeTaxonomy(projects, categories, a.projectId, undefined).projectId)?.name
        : undefined;
      return (
        <div className="parsed cal">
          <div className="k">Nghiên cứu · nhanh</div>
          <b>{a.query}</b>
          <div className="small muted">
            Tìm web 3–5 nguồn, kèm nguồn + ngày truy cập{projectName ? ` · lưu vào ${projectName}` : ""} · lượt {used + 1}/
            {settings.researchMonthlyLimit} tháng này. Bấm Lưu để bắt đầu.
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <main className="screen-body">
      <div className="hdr">
        <h1>Mai nói đi</h1>
        <span className="muted small">VI · gõ, nói hoặc gửi ảnh</span>
      </div>

      <textarea
        ref={inputRef}
        className="transcript"
        placeholder='Ví dụ: "Thứ Ba tuần sau nhắc chị gọi anh Tuấn bên OKR về hợp đồng Circle, rồi dời spa sang thứ Năm nha." — hoặc chọn ảnh rồi ghi chú "việc của Circle, hạn thứ Sáu".'
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn primary"
          style={{ flex: 1, padding: "11px" }}
          disabled={busy || !text.trim()}
          onClick={() => void runParse(text)}
        >
          {busy ? "Đang hiểu…" : "Tách việc"}
        </button>
        <button
          className="btn"
          style={{ padding: "11px 13px" }}
          onClick={() => fileRef.current?.click()}
          aria-label="Gửi ảnh checklist"
        >
          📷 Ảnh
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void pickImages(e.target.files);
            e.target.value = "";
          }}
        />
        {supported ? (
          <button
            className={`blossom-btn${listening ? " listening" : ""}`}
            style={{ margin: 0, flex: "0 0 58px" }}
            onPointerDown={start}
            onPointerUp={stop}
            onPointerLeave={stop}
            aria-pressed={listening}
            aria-label={listening ? "Đang nghe — thả để dừng" : "Giữ để nói"}
          >
            <Blossom size={40} />
          </button>
        ) : null}
      </div>
      {micHint && !listening && (
        <p className="muted small">Lần đầu bấm nói, trình duyệt sẽ xin quyền micro.</p>
      )}
      {listening && <div className="muted small">🌼 Đang nghe… thả tay để mình tách việc.</div>}
      {processing && <div className="muted small">🌼 Đang chuyển giọng nói thành chữ…</div>}
      {speechError && <div className="note-box">{speechError}</div>}

      {images.length > 0 && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {images.map((src, i) => (
              <span key={i} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Ảnh ${i + 1}`}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10 }}
                />
                <button
                  className="btn small"
                  style={{ position: "absolute", top: -6, right: -6, padding: "0 7px" }}
                  aria-label="Bỏ ảnh"
                  onClick={() => setImages((s) => s.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <button className="btn primary" disabled={imgBusy} onClick={() => void runImageParse()}>
            {imgBusy ? "Đang đọc ảnh…" : `Đọc ${images.length} ảnh — việc hoặc sự kiện`}
          </button>
        </div>
      )}
      {imgError && <div className="note-box">{imgError}</div>}

      {banner && (
        <BannerCard
          ev={banner.ev}
          image={banner.image}
          initialProject={banner.projectId}
          onDone={(lines) => {
            setBanner(null);
            if (lines.length) setSavedLines(lines);
          }}
        />
      )}

      {contactCard && (
        <ContactCard
          contact={contactCard.contact}
          readNote={contactCard.readNote}
          onDone={(lines) => {
            setContactCard(null);
            if (lines.length) setSavedLines(lines);
          }}
        />
      )}

      {unknown && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {unknown.readNote && (
            <div className="note-box small">
              📷 {unknown.readNote} — Mai gửi ảnh gốc hoặc chụp gần hơn giúp mình nhé.
            </div>
          )}
          {unknown.readTitles.length > 0 && (
            <span className="small muted">
              Mình mới đọc được: {unknown.readTitles.join(" · ")}
            </span>
          )}
          <b className="small">
            {unknown.question ?? "Ảnh này là sự kiện, danh sách việc, hay ghi chú?"}
          </b>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn small"
              onClick={() => {
                setBanner({
                  ev: { title: unknown.caption || "", confidence: 0.3 },
                  image: unknown.image,
                });
                setUnknown(null);
              }}
            >
              🗓 Tạo sự kiện thủ công
            </button>
            <button
              className="btn small"
              onClick={() => {
                setUnknown(null);
                inputRef.current?.focus();
              }}
            >
              ✍️ Gõ việc thủ công
            </button>
            <button className="btn ghost small" onClick={() => setUnknown(null)}>
              Đóng
            </button>
          </div>
        </div>
      )}

      {bookingAsk && (
        <BookingAskCard
          ask={bookingAsk}
          onDone={(line) => {
            setBookingAsk(null);
            setSavedLines((sl) => [...(sl ?? []), line]);
          }}
        />
      )}
      {research && (
        <ResearchPanel
          query={research.query}
          projectId={research.projectId}
          onDone={(line) => {
            setResearch(null);
            if (line) setSavedLines((sl) => [...(sl ?? []), line]);
          }}
        />
      )}
      {bookSheet && (
        <BookTaskSheet
          task={bookSheet.task}
          initialDuration={bookSheet.duration}
          onDay={bookSheet.onDay}
          onClose={() => setBookSheet(null)}
          onBooked={(line) => setSavedLines((sl) => [...(sl ?? []), line])}
        />
      )}

      {result && (
        <>
          {summary && <div className="muted small">{summary}:</div>}
          {result.actions.map((a, i) => {
            if (a.kind !== "task") {
              // Cảnh báo trên thẻ xem trước (§5.4): trùng giờ, ngày bay.
              const evStart = a.kind === "event" && a.startAt ? Date.parse(a.startAt) : NaN;
              const evEnd = evStart + ((a.kind === "event" ? a.durationMinutes : 60) ?? 60) * 60_000;
              const evWarn: string[] = [];
              if (Number.isFinite(evStart)) {
                if (events.some((e) => Date.parse(e.startAt) < evEnd && Date.parse(e.endAt) > evStart))
                  evWarn.push("trùng giờ với lịch đang có");
                if (
                  trips.some(
                    (t) =>
                      isSameDay(t.departAt, new Date(evStart)) ||
                      (t.returnAt && isSameDay(t.returnAt, new Date(evStart))),
                  )
                )
                  evWarn.push("rơi vào ngày bay");
              }
              return a.kind === "event" ? (
                <div className="parsed cal" key={i}>
                  <div className="k">{a.durationMinutes && !a.startAt ? "Block cần tìm giờ" : "Lịch mới"}</div>
                  <b>{a.title}</b>
                  <div className="small muted">
                    {a.startAt ? fmtDayTime(a.startAt) : `${a.durationMinutes ?? "?"} phút, chưa chốt giờ`}
                    {a.startAt ? ` · ${a.durationMinutes ?? 60} phút` : ""}
                    {a.location ? ` · ở ${a.location}` : ""}
                    {a.mode ? (a.mode === "car" ? " · đi ô tô" : " · đi tàu") : ""}
                  </div>
                  {evWarn.length > 0 && (
                    <div className="small" style={{ marginTop: 4, color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "4px 10px" }}>
                      ⚠ {evWarn.join(" · ")}
                    </div>
                  )}
                  {a.startAt && gs.connected && (
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          className="check"
                          checked={book[i] ?? false}
                          onChange={(e) => setBook((s) => ({ ...s, [i]: e.target.checked }))}
                        />
                        Book lên lịch
                        {calAccounts.length <= 1 && gs.email ? ` (${gs.email})` : ""}
                      </label>
                      {/* Lịch đích hiện rõ và đổi được ngay trên thẻ (§5.3.4). */}
                      {(book[i] ?? false) && calAccounts.length > 1 && (
                        <select
                          className="btn small"
                          value={bookAcct[i] ?? ""}
                          aria-label="Lịch đích"
                          onChange={(e) => setBookAcct((s) => ({ ...s, [i]: e.target.value }))}
                        >
                          {calAccounts.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.provider === "lark" ? "Lark" : "Google"} · {c.email ?? c.id}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  )}
                </div>
              ) : a.kind === "note" || a.kind === "complete" ? (
                (() => {
                  // Thẻ xác nhận: hiện ĐÚNG việc khớp trước khi ghi/đóng (5.2.2).
                  const target = tasks.find(
                    (t) =>
                      t.status !== "done" &&
                      t.status !== "dropped" &&
                      t.title.toLowerCase().includes(a.what.toLowerCase()),
                  );
                  return (
                    <div className="parsed cal" key={i}>
                      <div className="k">{a.kind === "note" ? "Ghi chú vào việc" : "Đóng việc — xác nhận"}</div>
                      <b>{target ? target.title : `“${a.what}”`}</b>
                      <div className="small muted">
                        {a.kind === "note"
                          ? a.text
                          : target
                            ? "Bấm Lưu là mình đóng đúng việc này."
                            : "Chưa thấy việc đang mở khớp tên — Mai kiểm tra lại nhé."}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div key={i}>{renderActionCard(a, i)}</div>
              );
            }

            const r = resolveTask(a, i);
            const p = projectById(projects, r.projectId);
            const client = clients.find((c) => c.id === r.clientId);
            // Cho Mai biết ô khách tự điền nhận ra từ đâu (§5.3.2 v2.8).
            const clientHit = client ? matchClientDetail(a.title, [client]) : undefined;
            const due = i in dueEdits ? dueEdits[i] : { dueAt: a.dueAt, dueType: a.dueType };
            return (
              <div className="parsed" style={{ borderLeftColor: p.color }} key={i}>
                <div className="k">Việc mới</div>
                <b>{a.title}</b>
                {a.note && <div className="small muted">{a.note}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                  {r.confidence < CONFIDENCE_THRESHOLD && (
                    <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 999, padding: "1px 8px" }}>
                      chưa chắc
                    </span>
                  )}
                  {r.alternatives.map((alt) => {
                    const ap = projectById(projects, alt.projectId);
                    return (
                      <button
                        key={alt.projectId + (alt.categoryId ?? "")}
                        className="btn small"
                        style={{ padding: "3px 10px" }}
                        onClick={() => applyOverride(i, a.title, { ...alt, clientId: r.clientId })}
                      >
                        → {ap.name}
                        {categoryName(categories, alt.categoryId)
                          ? ` · ${categoryName(categories, alt.categoryId)}`
                          : ""}
                      </button>
                    );
                  })}
                </div>
                {clientHit && (
                  <div className="small muted" style={{ marginTop: 4 }}>
                    🤝 {client!.name} — nhận từ &ldquo;{clientHit.term}&rdquo;
                  </div>
                )}
                {/* 3 trường riêng + Deadline, sửa và tạo mới tại chỗ (3b, 3c). */}
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                  <SearchSelect
                    label="Dự án"
                    value={r.projectId}
                    options={activeProjects(projects).map((pr) => ({ id: pr.id, label: pr.name, color: pr.color }))}
                    onPick={(id) => {
                      if (!id) return;
                      applyOverride(i, a.title, { projectId: id, categoryId: undefined, clientId: r.clientId });
                    }}
                    onCreate={(name) => {
                      const pr = addProject(name, PROJECT_COLORS[projects.length % PROJECT_COLORS.length]);
                      if (pr) applyOverride(i, a.title, { projectId: pr.id, categoryId: undefined, clientId: r.clientId });
                    }}
                  />
                  <SearchSelect
                    label="Category"
                    value={r.categoryId}
                    options={categoriesFor(categories, r.projectId).map((c) => ({ id: c.id, label: c.name }))}
                    emptyLabel="Không có"
                    onPick={(id) =>
                      applyOverride(i, a.title, { projectId: r.projectId, categoryId: id, clientId: r.clientId })
                    }
                    onCreate={(name) => {
                      const c = addCategory(r.projectId, name);
                      if (c) applyOverride(i, a.title, { projectId: r.projectId, categoryId: c.id, clientId: r.clientId });
                    }}
                  />
                  <SearchSelect
                    label="Khách hàng / đối tác"
                    value={client?.id}
                    options={orderClientsForPick(clientsFor(clients, r.projectId)).map((c) => ({
                      id: c.id,
                      label: c.name,
                    }))}
                    emptyLabel="Không có"
                    onPick={(id) =>
                      applyOverride(
                        i,
                        a.title,
                        { projectId: r.projectId, categoryId: r.categoryId, clientId: id },
                        false,
                      )
                    }
                    onQueryChange={(q) => setClientQ((s) => ({ ...s, [i]: q }))}
                    onCreate={(name) => {
                      const existing = findClientByName(clients, name);
                      if (existing) {
                        const aliases = withLearnedAlias(existing, name);
                        if (aliases) useStore.getState().updateClient(existing.id, { aliases });
                      }
                      const c = existing ?? addClient(name, r.projectId);
                      if (c)
                        applyOverride(
                          i,
                          a.title,
                          { projectId: r.projectId, categoryId: r.categoryId, clientId: c.id },
                          false,
                        );
                    }}
                  />
                  <DueEditor
                    value={due.dueAt}
                    dueType={due.dueType}
                    quote={!(i in dueEdits) && a.dueAt ? text.trim() : undefined}
                    onChange={(dueAt, dueType) => setDueEdits((s) => ({ ...s, [i]: { dueAt, dueType } }))}
                    trips={trips}
                    events={events}
                  />
                  <input
                    className="transcript"
                    style={{ minHeight: 0, padding: "6px 10px" }}
                    placeholder="Ghi chú (tùy chọn)…"
                    aria-label={`Ghi chú cho ${a.title}`}
                    value={noteEdits[i] ?? ""}
                    onChange={(e) => setNoteEdits((s) => ({ ...s, [i]: e.target.value }))}
                  />
                </div>
                {duplicates[i] && (
                  <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "6px 10px" }}>
                    <input
                      type="checkbox"
                      className="check"
                      checked={merge[i] ?? true}
                      onChange={(e) => setMerge((s) => ({ ...s, [i]: e.target.checked }))}
                    />
                    Giống việc đang có: “{duplicates[i]}” — gộp, không tạo mới
                  </label>
                )}
              </div>
            );
          })}
          {result.question && (
            <Bubble>
              {result.question}
              <div className="small muted" style={{ marginTop: 4 }}>
                Mai sửa lại câu ở trên hoặc cứ lưu, chỉnh sau cũng được.
              </div>
            </Bubble>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => void saveAll()}>
              {result.actions.length > 1 ? `Lưu cả ${result.actions.length}` : "Lưu"}
            </button>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => {
                setResult(null);
                inputRef.current?.focus();
              }}
            >
              Sửa câu
            </button>
          </div>
        </>
      )}

      {savedLines && (
        <Bubble>
          {savedLines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          {lastBooked && (
            <button className="btn small" style={{ marginTop: 4 }} onClick={undoBook}>
              Hoàn tác book
            </button>
          )}
        </Bubble>
      )}

      {!supported && (
        <p className="muted small">Trình duyệt này chưa hỗ trợ voice — Mai gõ hoặc gửi ảnh nhé.</p>
      )}
    </main>
  );
}

/**
 * Thẻ xem trước sự kiện từ ảnh banner/thiệp mời (PRD §5.1.1 v3.0):
 * AI soạn sẵn, Mai duyệt — chỉ tạo lịch/book khi Mai bấm. Thiếu giờ →
 * hỏi đúng MỘT câu; trùng tên + ngày → đề xuất cập nhật thay vì tạo mới.
 */
function BannerCard({
  ev,
  image,
  initialProject,
  onDone,
}: {
  ev: BannerEvent;
  image: string;
  /** Dự án đoán sẵn (logo/tổ chức) — v3.1; thiếu thì tự classify. */
  initialProject?: ProjectId;
  onDone: (lines: string[]) => void;
}) {
  const { events, projects, categories, feedback, settings, addEvent, updateEvent, addTriage } =
    useStore();
  const gs = useGoogleStatus();
  const accts = useAccounts();
  const calAccounts = accts.accounts.filter((x) => x.parts.cal);

  const guessed = useMemo(() => {
    const cls = classify(`${ev.title} ${ev.organizer ?? ""}`, feedback);
    return sanitizeTaxonomy(projects, categories, cls.projectId, undefined).projectId;
  }, [ev, feedback, projects, categories]);

  const [title, setTitle] = useState(ev.title);
  const [projectId, setProjectId] = useState<ProjectId>(initialProject ?? guessed);
  const [startAt, setStartAt] = useState(ev.startAt);
  const [endAt] = useState(ev.endAt);
  /** Mai đã tự chọn giờ → thôi hỏi, dù banner có nhiều khung giờ. */
  const [picked, setPicked] = useState(false);
  const [book, setBook] = useState(false);
  // Lịch đích HIỆN SẴN theo dự án (v3.1); Mai tự đổi thì giữ lựa chọn đó.
  const [bookAcct, setBookAcct] = useState(
    settings.projectCalendar[initialProject ?? guessed] ?? "",
  );
  const [acctTouched, setAcctTouched] = useState(false);
  const [makeTask, setMakeTask] = useState(
    Boolean(ev.registrationUrl || ev.registrationDeadline),
  );
  const [busy, setBusy] = useState(false);

  const timing = resolveBannerTiming(
    { ...ev, startAt, endAt, timeOptions: picked ? undefined : ev.timeOptions },
    Date.now(),
  );
  const dup =
    timing.status === "ok"
      ? findDuplicateEvent(
          events.filter((e) => e.kind === "event"),
          title,
          timing.startAt,
        )
      : undefined;

  if (timing.status === "past") {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <b>🎪 {ev.title}</b>
        <div className="warn">Sự kiện này đã diễn ra — ngày trên banner đã qua, mình không tạo lịch.</div>
        <button className="btn" onClick={() => onDone([])}>
          Đóng
        </button>
      </div>
    );
  }

  async function save(mode: "create" | "update") {
    if (timing.status !== "ok") return;
    setBusy(true);
    const lines: string[] = [];
    const notes = bannerNote(ev);
    const linkUrl = ev.registrationUrl;
    // Ảnh banner gốc đính vào sự kiện — blob nằm ở IndexedDB.
    const fileId = `banner-${Date.now().toString(36)}`;
    const blob = dataUrlToBlob(image);
    const savedImg = blob ? await putFile(fileId, blob) : false;

    let gcalId: string | undefined;
    let calAccount: string | undefined;
    if (mode === "create" && book && gs.connected) {
      const created = await createGcalEvent(
        {
          title,
          startAt: timing.startAt,
          endAt: timing.endAt,
          description: [notes, linkUrl].filter(Boolean).join(" · ") || undefined,
        },
        bookAcct || settings.projectCalendar[projectId],
      );
      gcalId = created?.gcalId;
      calAccount = created?.accountId;
      lines.push(gcalId ? "Đã book lên lịch ngoài ✓" : "Book lịch ngoài lỗi — mới lưu trong app.");
    }

    if (mode === "update" && dup) {
      updateEvent(dup.id, {
        title,
        startAt: timing.startAt,
        endAt: timing.endAt,
        location: ev.location ?? dup.location,
        projectId,
        linkUrl: linkUrl ?? dup.linkUrl,
        notes: notes || dup.notes,
        bannerImage: savedImg ? fileId : dup.bannerImage,
      });
      lines.unshift(`Đã cập nhật sự kiện "${title}" — ${fmtDayFull(timing.startAt)} (không tạo trùng).`);
    } else {
      addEvent({
        title,
        startAt: timing.startAt,
        endAt: timing.endAt,
        location: ev.location,
        kind: "event",
        projectId,
        gcalId,
        calAccount,
        linkUrl,
        notes: notes || undefined,
        bannerImage: savedImg ? fileId : undefined,
      });
      lines.unshift(`Đã tạo sự kiện "${title}" — ${fmtDayFull(timing.startAt)}.`);
    }

    // Việc đi kèm tự đề xuất, vẫn qua Hộp duyệt (nguyên tắc số 1).
    if (makeTask) {
      const deadline =
        ev.registrationDeadline && !Number.isNaN(Date.parse(ev.registrationDeadline))
          ? ev.registrationDeadline
          : undefined;
      addTriage({
        title: `Đăng ký / mua vé: ${title}`,
        projectId,
        assignee: "mai",
        dueAt: deadline,
        dueType: deadline ? "hard" : undefined,
        dueSource: deadline ? "nguon" : undefined,
        source: {
          channel: "app-chat",
          quote: `Từ banner "${title}"${ev.price ? ` — ${ev.price}` : ""}${linkUrl ? ` — ${linkUrl}` : ""}`,
        },
        confidence: ev.confidence,
      });
      lines.push(
        `Việc "Đăng ký / mua vé" đã vào Hộp duyệt${deadline ? ` (hạn ${fmtDayFull(deadline)})` : ""}.`,
      );
    }
    setBusy(false);
    onDone(lines);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="Ảnh banner sự kiện"
          style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 12, flex: "0 0 84px" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
          <div className="k">Sự kiện từ ảnh banner</div>
          <input
            className="transcript"
            style={{ minHeight: 0, padding: "6px 10px", fontWeight: 700 }}
            value={title}
            aria-label="Tên sự kiện"
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="small">
            {timing.status === "ok" ? (
              <>
                🗓 <b>{fmtDayTime(timing.startAt)}</b> – {fmtTime(timing.endAt)}
              </>
            ) : (
              <span className="muted">🗓 chưa có giờ</span>
            )}
          </span>
        </div>
      </div>

      {timing.status === "needs-time" && (
        <div className="note-box small" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          Sự kiện diễn ra lúc nào?
          {timing.options.map((o) => (
            <button
              key={o}
              className="btn small"
              onClick={() => {
                setStartAt(o);
                setPicked(true);
              }}
            >
              {fmtDayTime(o)}
            </button>
          ))}
          <input
            type="datetime-local"
            className="btn small"
            aria-label="Chọn giờ sự kiện"
            onChange={(e) => {
              if (e.target.value) {
                setStartAt(new Date(e.target.value).toISOString());
                setPicked(true);
              }
            }}
          />
        </div>
      )}

      <div className="small" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {ev.location && (
          <span>
            📍 {ev.location}{" "}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`}
              target="_blank"
              rel="noreferrer"
            >
              Mở Maps
            </a>
          </span>
        )}
        {bannerNote(ev) && <span className="muted">{bannerNote(ev)}</span>}
        {ev.registrationDeadline && !Number.isNaN(Date.parse(ev.registrationDeadline)) && (
          <span>⏳ Hạn đăng ký: <b>{fmtDayFull(ev.registrationDeadline)}</b></span>
        )}
        {ev.registrationUrl && (
          <span>
            🔗{" "}
            <a href={ev.registrationUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
              {ev.registrationUrl}
            </a>
          </span>
        )}
      </div>

      <SearchSelect
        label="Dự án"
        value={projectId}
        options={activeProjects(projects).map((p) => ({ id: p.id, label: p.name, color: p.color }))}
        onPick={(id) => {
          if (!id) return;
          setProjectId(id);
          // Đổi dự án → lịch đích đổi theo (trừ khi Mai đã tự chọn tay).
          if (!acctTouched) setBookAcct(settings.projectCalendar[id] ?? "");
        }}
      />

      {gs.connected && (
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              className="check"
              checked={book}
              onChange={(e) => setBook(e.target.checked)}
            />
            Book lên lịch
          </label>
          {book && calAccounts.length > 1 ? (
            <select
              className="btn small"
              value={bookAcct}
              aria-label="Lịch đích"
              onChange={(e) => {
                setBookAcct(e.target.value);
                setAcctTouched(true);
              }}
            >
              <option value="">Lịch mặc định</option>
              {calAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider === "lark" ? "Lark" : "Google"} · {c.email ?? c.id}
                </option>
              ))}
            </select>
          ) : book ? (
            <span className="small muted">
              →{" "}
              {(() => {
                const t = calAccounts.find((c) => c.id === (bookAcct || settings.projectCalendar[projectId]));
                return t ? `${t.provider === "lark" ? "Lark" : "Google"} · ${t.email ?? t.id}` : "lịch mặc định";
              })()}
            </span>
          ) : null}
        </span>
      )}

      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          className="check"
          checked={makeTask}
          onChange={(e) => setMakeTask(e.target.checked)}
        />
        Thêm việc “Đăng ký / mua vé” vào Hộp duyệt
      </label>

      {dup && <span className="small muted">Đã có “{dup.title}” cùng ngày trong lịch.</span>}
      <div style={{ display: "flex", gap: 8 }}>
        {dup ? (
          <>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy} onClick={() => void save("update")}>
              Cập nhật sự kiện đã có
            </button>
            <button className="btn" disabled={busy} onClick={() => void save("create")}>
              Tạo bản mới
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            style={{ flex: 1 }}
            disabled={busy || timing.status !== "ok"}
            onClick={() => void save("create")}
          >
            Tạo sự kiện
          </button>
        )}
        <button className="btn ghost" onClick={() => onDone([])}>
          Bỏ
        </button>
      </div>
    </div>
  );
}

/**
 * Danh thiếp từ ảnh (v3.1): gợi ý thêm liên hệ vào danh bạ khách của
 * một dự án — Mai duyệt; tên trùng danh bạ thì cập nhật, không tạo đôi.
 */
function ContactCard({
  contact,
  readNote,
  onDone,
}: {
  contact: BannerContact;
  readNote?: string;
  onDone: (lines: string[]) => void;
}) {
  const { projects, clients, addClient, updateClient, touchClient } = useStore();
  const live = activeProjects(projects);
  const [name, setName] = useState(contact.name);
  const [projectId, setProjectId] = useState<ProjectId>(live[0]?.id ?? "canhan");
  const [type, setType] = useState<Client["type"]>("khachhang");

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = findClientByName(clients, trimmed);
    const c = existing ?? addClient(trimmed, projectId, type);
    if (!c) return;
    const contactStr = [contact.phone, contact.email].filter(Boolean).join(" · ");
    updateClient(c.id, {
      contact: contactStr || c.contact,
      notes: contact.org ?? c.notes,
      projectIds: c.projectIds.includes(projectId) ? c.projectIds : [...c.projectIds, projectId],
    });
    touchClient(c.id);
    onDone([
      existing
        ? `"${c.name}" đã có trong danh bạ — mình cập nhật liên hệ từ danh thiếp.`
        : `Đã thêm "${c.name}" vào danh bạ ${projectById(projects, projectId).name}.`,
    ]);
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="k">Danh thiếp — thêm vào danh bạ?</div>
      {readNote && <div className="note-box small">📷 {readNote}</div>}
      <input
        className="transcript"
        style={{ minHeight: 0, padding: "6px 10px", fontWeight: 700 }}
        value={name}
        aria-label="Tên liên hệ"
        onChange={(e) => setName(e.target.value)}
      />
      <span className="small muted">
        {[contact.org, contact.phone, contact.email].filter(Boolean).join(" · ") ||
          "(không đọc được thêm chi tiết)"}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select
          className="btn small"
          value={projectId}
          aria-label="Thuộc dự án"
          onChange={(e) => setProjectId(e.target.value)}
        >
          {live.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="btn small"
          value={type}
          aria-label="Loại liên hệ"
          onChange={(e) => setType(e.target.value as Client["type"])}
        >
          <option value="khachhang">khách hàng</option>
          <option value="doitac">đối tác</option>
          <option value="nhacungcap">nhà cung cấp</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" style={{ flex: 1 }} disabled={!name.trim()} onClick={save}>
          Thêm vào danh bạ
        </button>
        <button className="btn ghost" onClick={() => onDone([])}>
          Bỏ
        </button>
      </div>
    </div>
  );
}
