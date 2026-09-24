"use client";

import { useMemo, useState } from "react";
import { BannerFileLink } from "@/components/BannerFileLink";
import { BookingAskCard } from "@/components/BookingAsk";
import { TaskDetail } from "@/components/TaskDetail";
import { detectBooking } from "@/core/booking";
import { diffEvent, findOverlaps, suggestMoveSlot, type EventChange } from "@/core/eventOps";
import { categoryName, projectById } from "@/core/projects";
import type { CalEvent } from "@/core/types";
import { attachBooking, type BookingAsk } from "@/lib/booking";
import {
  deleteEventEverywhere,
  duplicateEvent,
  saveEventEdit,
  type EventPatch,
  type RemoteMeta,
} from "@/lib/calendarActions";
import { fmtDay, fmtDayFull, fmtDue, fmtRange, toLocalInput } from "@/lib/format";
import { useStore } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { useAccounts } from "@/lib/useGoogle";

type Mode = "view" | "edit" | "move" | "delete" | "dup";

const mapsUrl = (q: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Dòng "trước → sau" của thẻ xem trước — chỉ phần thay đổi (§5.4). */
export function ChangeLines({ changes }: { changes: EventChange[] }) {
  const label = { title: "Tên", time: "Giờ", location: "Địa điểm", notes: "Ghi chú" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {changes.map((c) => (
        <div key={c.field} className="small">
          <b>{label[c.field]}:</b>{" "}
          {c.field === "time" ? (
            <>
              <s className="muted">
                {fmtDay(c.before!)} {fmtRange(c.before!, c.beforeEnd!)}
              </s>{" "}
              →{" "}
              <b>
                {sameDay(c.before!, c.after!) ? "" : `${fmtDay(c.after!)} `}
                {fmtRange(c.after!, c.afterEnd!)}
              </b>
            </>
          ) : (
            <>
              <s className="muted">{c.before || "(trống)"}</s> → <b>{c.after || "(bỏ trống)"}</b>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Màn chi tiết sự kiện (§5.4.0 v3.7): chạm một sự kiện là mở màn này —
 * giờ, địa điểm (Mở Maps), lịch nguồn + tài khoản, người được mời, link
 * họp, ghi chú, file, việc + chuỗi liên quan. Nút Sửa · Dời · Xóa · Chuỗi ·
 * Nhân bản; sửa/dời đi qua thẻ trước → sau; lịch chỉ xem thì nói rõ vì sao.
 */
export function EventDetail({
  event,
  remote,
  context = [],
  onClose,
  onChanged,
  onAddChain,
  onRemoveChain,
  onDeleted,
  z = 65,
}: {
  event: CalEvent;
  remote?: RemoteMeta;
  /** Sự kiện đang hiển thị (cả Google/Lark) — để xét trùng giờ. */
  context?: CalEvent[];
  onClose: () => void;
  onChanged?: () => void;
  onAddChain?: (eventId: string) => void;
  onRemoveChain?: (ev: CalEvent) => void;
  onDeleted?: (label: string, undo: () => Promise<string>) => void;
  z?: number;
}) {
  const { events, tasks, places, projects, categories, clients, eventMarks, settings, setEventBooking } =
    useStore();
  const accts = useAccounts();
  const calAccounts = accts.accounts.filter((a) => a.parts.cal);
  const live = events.find((e) => e.id === event.id) ?? event;
  const isRemoteOnly = live.id.startsWith("g:");
  const readOnly = Boolean(remote?.readOnly);
  const bookedAcct = accts.accounts.find((a) => a.id === (live.calAccount ?? "g0"));
  const providerLabel = (p?: string) => (p === "lark" ? "Lark" : "Google");
  const remoteLabel = isRemoteOnly
    ? providerLabel(remote?.provider)
    : live.gcalId
      ? providerLabel(bookedAcct?.provider)
      : "";
  const bookingStatus = isRemoteOnly ? eventMarks[live.id]?.booking : live.bookingStatus;
  const chain = events.filter((e) => e.chainOf === live.id);
  const linkedTask = live.taskId ? tasks.find((t) => t.id === live.taskId) : undefined;
  const bookingTasks = tasks.filter((t) => t.bookingEventId === live.id && t.status !== "dropped");
  const guests = remote?.attendees ?? [];

  const pool = useMemo(() => {
    const base = context.length ? context : events;
    return [...base.filter((e) => e.id !== live.id), live];
  }, [context, events, live]);
  const overlapEvents = useMemo(() => {
    const ids = findOverlaps(pool).get(live.id) ?? [];
    return pool.filter((e) => ids.includes(e.id));
  }, [pool, live.id]);
  const suggestion = useMemo(
    () => (overlapEvents.length ? suggestMoveSlot(live, pool, new Date()) : null),
    [overlapEvents.length, live, pool],
  );

  const [mode, setMode] = useState<Mode>("view");
  const [dTitle, setDTitle] = useState(live.title);
  const [dStart, setDStart] = useState(toLocalInput(live.startAt));
  const [dEnd, setDEnd] = useState(toLocalInput(live.endAt));
  const [dLoc, setDLoc] = useState(live.location ?? "");
  const [dNotes, setDNotes] = useState((isRemoteOnly ? remote?.description : live.notes) ?? "");
  const [preview, setPreview] = useState<{ patch: EventPatch; changes: EventChange[] } | null>(null);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ask, setAsk] = useState<BookingAsk | null>(null);
  const [series, setSeries] = useState(false);
  const [dropBooking, setDropBooking] = useState(true);
  const [confirmGuests, setConfirmGuests] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [dupAt, setDupAt] = useState(toLocalInput(new Date(Date.parse(live.startAt) + 7 * 86_400_000).toISOString()));
  const [dupBook, setDupBook] = useState(Boolean(live.gcalId));
  const [dupAcct, setDupAcct] = useState(
    remote?.account ?? live.calAccount ?? (live.projectId ? settings.projectCalendar[live.projectId] : undefined) ?? "",
  );

  const before = {
    title: live.title,
    startAt: live.startAt,
    endAt: live.endAt,
    location: live.location,
    notes: isRemoteOnly ? remote?.description : live.notes,
  };

  function resetDraft() {
    setDTitle(live.title);
    setDStart(toLocalInput(live.startAt));
    setDEnd(toLocalInput(live.endAt));
    setDLoc(live.location ?? "");
    setDNotes(before.notes ?? "");
    setPreview(null);
    setNotify(false);
  }

  /** Dựng thẻ trước → sau từ bản nháp; lỗi giờ thì nói rõ, không lưu. */
  function buildPreview(startIso: string, endIso: string, withFields: boolean) {
    const after = {
      title: withFields ? dTitle.trim() || live.title : live.title,
      startAt: startIso,
      endAt: endIso,
      location: withFields ? dLoc.trim() || undefined : live.location,
      notes: withFields ? dNotes.trim() || undefined : before.notes,
    };
    if (!(Date.parse(after.endAt) > Date.parse(after.startAt))) {
      setMsg("Giờ kết thúc phải sau giờ bắt đầu.");
      return;
    }
    const changes = diffEvent(before, after);
    if (changes.length === 0) {
      setMsg("Chưa có gì thay đổi.");
      return;
    }
    const patch: EventPatch = {};
    for (const c of changes) {
      if (c.field === "title") patch.title = after.title;
      if (c.field === "time") {
        patch.startAt = after.startAt;
        patch.endAt = after.endAt;
      }
      if (c.field === "location") patch.location = after.location ?? "";
      if (c.field === "notes") patch.notes = after.notes ?? "";
    }
    setMsg(null);
    setPreview({ patch, changes });
  }

  function moveBy(startMs: number) {
    const dur = Date.parse(live.endAt) - Date.parse(live.startAt);
    const s = new Date(startMs).toISOString();
    const e = new Date(startMs + dur).toISOString();
    setDStart(toLocalInput(s));
    setDEnd(toLocalInput(e));
    buildPreview(s, e, false);
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    const r = await saveEventEdit(live, preview.patch, remote, { notify });
    setBusy(false);
    setMsg(
      r.remoteOk
        ? `Đã lưu ✓${remoteLabel ? ` — đã cập nhật trên ${remoteLabel}` : ""}${chain.length && preview.patch.startAt ? " · chuỗi chuẩn bị + di chuyển dời theo" : ""}.`
        : `Đã lưu trong app, nhưng ${remoteLabel || "lịch ngoài"} báo lỗi — Mai thử lại hoặc sửa tay trên ${remoteLabel || "lịch"} giúp mình.`,
    );
    setPreview(null);
    setMode("view");
    onChanged?.();
  }

  async function doDelete(notifyGuests: boolean) {
    setBusy(true);
    const r = await deleteEventEverywhere(live, remote, {
      series,
      notify: notifyGuests,
      dropBookingTask: dropBooking,
    });
    setBusy(false);
    if (isRemoteOnly && !r.remoteOk) {
      setMsg(`${remoteLabel} chưa cho xóa (mất kết nối hoặc không có quyền) — mình giữ nguyên, chưa xóa gì.`);
      return;
    }
    const label = `Đã xóa “${live.title}”${r.remoteOk ? "" : ` trong app (${remoteLabel || "lịch ngoài"} báo lỗi, Mai xóa tay giúp mình)`}.`;
    // Hoàn tác trong vài phút (§5.4.0 v3.7) — nơi gọi không tự lo thì khay chung lo.
    if (onDeleted) onDeleted(label, r.undo);
    else
      showToast({
        text: label,
        ttlMs: 120_000,
        actions: [{ label: "Hoàn tác", primary: true, run: () => r.undo() }],
      });
    onChanged?.();
    onClose();
  }

  async function doDuplicate() {
    const startIso = new Date(dupAt).toISOString();
    if (Number.isNaN(Date.parse(startIso))) return;
    setBusy(true);
    const r = await duplicateEvent(live, startIso, {
      book: dupBook && calAccounts.length > 0,
      accountId: dupAcct || undefined,
    });
    setBusy(false);
    setMode("view");
    if (r.booking.ask) setAsk(r.booking.ask);
    setMsg(
      `Đã nhân bản sang ${fmtDay(startIso)} ${fmtRange(startIso, r.event.endAt)}${
        dupBook ? (r.remoteOk ? " · đã book" : " · book lịch ngoài lỗi, mới lưu trong app") : ""
      }.${r.booking.line ? ` ${r.booking.line}` : ""}`,
    );
    onChanged?.();
  }

  const canOfferBooking =
    bookingTasks.length === 0 &&
    bookingStatus !== "booked" &&
    live.kind === "event" &&
    detectBooking(live.title, live.location, places).kind !== "none";
  const project = live.projectId ? projectById(projects, live.projectId) : undefined;
  const clientName = live.clientId ? clients.find((c) => c.id === live.clientId)?.name : undefined;
  const seriesCanOne = remote?.provider !== "lark";

  return (
    <>
    <div
      role="dialog"
      aria-label={`Chi tiết sự kiện: ${live.title}`}
      style={{ position: "fixed", inset: 0, background: "rgba(30,33,80,.45)", zIndex: z, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <b style={{ flex: 1, fontSize: 17 }}>{live.title}</b>
          <button className="btn ghost small" aria-label="Đóng chi tiết sự kiện" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>
            🕐 <b>{fmtDayFull(live.startAt)}</b> · {remote?.allDay ? "Cả ngày" : fmtRange(live.startAt, live.endAt)}
            {live.arrivedAt ? " · ✓ đã tới" : ""}
          </span>
          {live.location && (
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              📍 {live.location}
              <a className="btn ghost small" style={{ textDecoration: "none" }} href={mapsUrl(live.location)} target="_blank" rel="noreferrer">
                Mở Maps
              </a>
            </span>
          )}
          <span className="muted">
            {isRemoteOnly
              ? `📆 ${remoteLabel}${remote?.accountEmail ? ` · ${remote.accountEmail}` : ""}${remote?.calendarName ? ` · lịch “${remote.calendarName}”` : ""}${remote?.seriesId ? " · lặp lại" : ""}`
              : `🌼 Trong app${live.gcalId ? ` · đã book lên ${remoteLabel}${bookedAcct?.email ? ` (${bookedAcct.email})` : ""}` : ""}`}
          </span>
          {(project || clientName) && (
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {project && (
                <span className="chip" style={{ background: project.color }}>
                  {project.name}
                </span>
              )}
              {categoryName(categories, live.categoryId) && <span className="muted">{categoryName(categories, live.categoryId)}</span>}
              {clientName && <span className="muted">🤝 {clientName}</span>}
            </span>
          )}
          {guests.length > 0 && (
            <span>
              👥 {guests.length} người được mời: {guests.slice(0, 5).join(", ")}
              {guests.length > 5 ? "…" : ""}
            </span>
          )}
          {(remote?.meetUrl || remote?.openUrl || live.linkUrl || live.bannerImage) && (
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {remote?.meetUrl && (
                <a className="btn ghost small" style={{ textDecoration: "none" }} href={remote.meetUrl} target="_blank" rel="noreferrer">
                  🎥 Link họp
                </a>
              )}
              {remote?.openUrl && (
                <a className="btn ghost small" style={{ textDecoration: "none" }} href={remote.openUrl} target="_blank" rel="noreferrer">
                  Mở trong {remoteLabel}
                </a>
              )}
              {live.linkUrl && (
                <a className="btn ghost small" style={{ textDecoration: "none" }} href={live.linkUrl} target="_blank" rel="noreferrer">
                  🔗 Link
                </a>
              )}
              {live.bannerImage && <BannerFileLink fileId={live.bannerImage} />}
            </span>
          )}
          {before.notes && <span className="muted">📝 {before.notes}</span>}
        </div>

        {overlapEvents.length > 0 && (
          <div className="warn small" role="alert">
            ⚠ Trùng giờ với{" "}
            {overlapEvents.map((o) => `“${o.title}” (${fmtRange(o.startAt, o.endAt)})`).join(", ")}.
            {suggestion && !readOnly && (
              <>
                {" "}
                Dời cái này sang {sameDay(suggestion.startAt, live.startAt) ? "" : `${fmtDay(suggestion.startAt)} `}
                {fmtRange(suggestion.startAt, suggestion.endAt)} nhé?{" "}
                <button
                  className="btn small"
                  onClick={() => {
                    setMode("move");
                    moveBy(Date.parse(suggestion.startAt));
                  }}
                >
                  Dời sang giờ này
                </button>
              </>
            )}
          </div>
        )}

        {bookingStatus === "pending" && (
          <div className="note-box small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            🔖 Chưa đặt chỗ
            <button className="btn small" onClick={() => setEventBooking(live.id, "booked")}>
              Đã đặt ✓
            </button>
          </div>
        )}
        {bookingStatus === "booked" && (
          <span className="small" style={{ color: "#2FA97C" }}>
            ✓ Đã đặt chỗ
          </span>
        )}
        {canOfferBooking && (
          <button
            className="btn small"
            style={{ alignSelf: "flex-start" }}
            onClick={() => {
              const o = attachBooking({ id: live.id, title: live.title, startAt: live.startAt, location: live.location });
              if (o.ask) setAsk(o.ask);
              if (o.line) setMsg(o.line);
            }}
          >
            🔖 Tạo việc đặt chỗ
          </button>
        )}
        {ask && (
          <BookingAskCard
            ask={ask}
            onDone={(line) => {
              setAsk(null);
              setMsg(line);
            }}
          />
        )}

        {(linkedTask || bookingTasks.length > 0 || chain.length > 0) && (
          <div className="small" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <b>Liên quan</b>
            {linkedTask && (
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                📋 {linkedTask.title}
                {linkedTask.status === "done" ? " ✓" : ""}
                <button className="btn ghost small" onClick={() => setOpenTask(linkedTask.id)}>
                  Mở việc
                </button>
              </span>
            )}
            {bookingTasks.map((t) => (
              <span key={t.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                🔖 {t.title}
                {t.status === "done" ? " ✓" : t.dueAt ? ` · hạn ${fmtDue(t.dueAt)}` : ""}
                <button className="btn ghost small" onClick={() => setOpenTask(t.id)}>
                  Mở việc
                </button>
              </span>
            ))}
            {chain.map((b) => (
              <span key={b.id} className="muted">
                {fmtRange(b.startAt, b.endAt)} · {b.title}
              </span>
            ))}
          </div>
        )}

        {readOnly && (
          <div className="note-box small">
            Sự kiện này thuộc {remote?.calendarName ? `lịch “${remote.calendarName}”` : "lịch"} chỉ xem hoặc do
            người khác tạo — chỉ người tạo mới sửa/xóa được.
          </div>
        )}

        {msg && (
          <div className="note-box small" role="status">
            {msg}
          </div>
        )}

        {mode === "view" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn small" disabled={readOnly} onClick={() => { resetDraft(); setMode("edit"); }}>
              Sửa
            </button>
            <button className="btn small" disabled={readOnly} onClick={() => { resetDraft(); setMode("move"); }}>
              Dời
            </button>
            <button className="btn small" disabled={readOnly} onClick={() => { setConfirmGuests(false); setMode("delete"); }}>
              Xóa
            </button>
            {live.kind === "event" &&
              (chain.length > 0
                ? onRemoveChain && (
                    <button className="btn ghost small" onClick={() => onRemoveChain(live)}>
                      Gỡ chuỗi
                    </button>
                  )
                : onAddChain && (
                    <button className="btn small" onClick={() => onAddChain(live.id)}>
                      + Chuỗi chuẩn bị + di chuyển
                    </button>
                  ))}
            <button className="btn ghost small" onClick={() => setMode("dup")}>
              Nhân bản
            </button>
          </div>
        )}

        {mode === "edit" && !preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input className="transcript" style={{ minHeight: 0, padding: 8 }} aria-label="Tên sự kiện" value={dTitle} onChange={(e) => setDTitle(e.target.value)} />
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Bắt đầu
              <input type="datetime-local" className="btn small" aria-label="Giờ bắt đầu" value={dStart} onChange={(e) => {
                const dur = Date.parse(new Date(dEnd).toISOString()) - Date.parse(new Date(dStart).toISOString());
                setDStart(e.target.value);
                // Giữ thời lượng khi đổi giờ bắt đầu.
                if (e.target.value && dur > 0) setDEnd(toLocalInput(new Date(Date.parse(new Date(e.target.value).toISOString()) + dur).toISOString()));
              }} />
            </label>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Kết thúc
              <input type="datetime-local" className="btn small" aria-label="Giờ kết thúc" value={dEnd} onChange={(e) => setDEnd(e.target.value)} />
            </label>
            <input className="transcript" style={{ minHeight: 0, padding: 8 }} placeholder="Địa điểm" aria-label="Địa điểm" value={dLoc} onChange={(e) => setDLoc(e.target.value)} />
            <input className="transcript" style={{ minHeight: 0, padding: 8 }} placeholder="Ghi chú" aria-label="Ghi chú sự kiện" value={dNotes} onChange={(e) => setDNotes(e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" onClick={() => buildPreview(new Date(dStart).toISOString(), new Date(dEnd).toISOString(), true)}>
                Xem thay đổi
              </button>
              <button className="btn ghost small" onClick={() => { setMode("view"); setMsg(null); }}>
                Thôi
              </button>
            </div>
          </div>
        )}

        {mode === "move" && !preview && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn small" onClick={() => moveBy(Date.parse(live.startAt) + 30 * 60_000)}>+30 phút</button>
              <button className="btn small" onClick={() => moveBy(Date.parse(live.startAt) + 60 * 60_000)}>+1 tiếng</button>
              <button className="btn small" onClick={() => moveBy(Date.parse(live.startAt) + 86_400_000)}>Ngày mai cùng giờ</button>
              <button className="btn small" onClick={() => moveBy(Date.parse(live.startAt) + 7 * 86_400_000)}>Tuần sau cùng giờ</button>
            </div>
            <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              Giờ mới
              <input type="datetime-local" className="btn small" aria-label="Giờ mới" value={dStart} onChange={(e) => setDStart(e.target.value)} />
              <button className="btn primary small" disabled={!dStart} onClick={() => moveBy(Date.parse(new Date(dStart).toISOString()))}>
                Xem thay đổi
              </button>
            </label>
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => { setMode("view"); setMsg(null); }}>
              Thôi
            </button>
          </div>
        )}

        {preview && (
          <div className="parsed cal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="k">Xem trước — chỉ phần thay đổi</div>
            <ChangeLines changes={preview.changes} />
            {chain.length > 0 && preview.patch.startAt && (
              <span className="small muted">Chuỗi chuẩn bị + di chuyển ({chain.length} block) dời theo.</span>
            )}
            {guests.length > 0 && (
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" className="check" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Gửi thông báo cập nhật cho {guests.length} người được mời
              </label>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" disabled={busy} onClick={() => void save()}>
                {busy ? "Đang lưu…" : remoteLabel ? `Lưu + cập nhật ${remoteLabel}` : "Lưu"}
              </button>
              <button className="btn ghost small" onClick={() => setPreview(null)}>
                Sửa tiếp
              </button>
            </div>
          </div>
        )}

        {mode === "delete" && (
          <div className="warn small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {!confirmGuests ? (
              <>
                <b>
                  Xóa “{live.title}” ({fmtDay(live.startAt)} · {fmtRange(live.startAt, live.endAt)})?
                </b>
                <span>
                  Sẽ xóa kèm:{" "}
                  {[
                    remoteLabel ? `sự kiện trên ${remoteLabel}` : "",
                    chain.length ? `${chain.length} block chuẩn bị + di chuyển` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "chỉ sự kiện này"}
                </span>
                {remote?.seriesId && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="radio" name="scope" checked={!series} disabled={!seriesCanOne} onChange={() => setSeries(false)} />
                      Chỉ lần này
                    </label>
                    <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input type="radio" name="scope" checked={series} onChange={() => setSeries(true)} />
                      Cả chuỗi lặp
                    </label>
                    {!seriesCanOne && (
                      <span className="muted">Xóa riêng một buổi của chuỗi Lark làm trong app Lark.</span>
                    )}
                  </div>
                )}
                {bookingTasks.some((t) => t.status !== "done") && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" className="check" checked={dropBooking} onChange={(e) => setDropBooking(e.target.checked)} />
                    Xóa luôn việc “{bookingTasks[0].title}”
                  </label>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn primary small"
                    disabled={busy || (Boolean(remote?.seriesId) && !seriesCanOne && !series)}
                    onClick={() => (guests.length > 0 ? setConfirmGuests(true) : void doDelete(false))}
                  >
                    {busy ? "Đang xóa…" : "Xóa"}
                  </button>
                  <button className="btn ghost small" onClick={() => setMode("view")}>
                    Thôi
                  </button>
                </div>
              </>
            ) : (
              <>
                <b>Sự kiện có {guests.length} người được mời.</b>
                <span>Xóa sẽ gửi thông báo hủy cho họ — Mai vẫn xóa chứ?</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn primary small" disabled={busy} onClick={() => void doDelete(true)}>
                    {busy ? "Đang xóa…" : `Xóa và báo hủy cho ${guests.length} người`}
                  </button>
                  <button className="btn ghost small" onClick={() => setMode("view")}>
                    Thôi, giữ lại
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {mode === "dup" && (
          <div className="note-box small" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              Bản sao lúc
              <input type="datetime-local" className="btn small" aria-label="Giờ của bản sao" value={dupAt} onChange={(e) => setDupAt(e.target.value)} />
            </label>
            {calAccounts.length > 0 && (
              <label style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input type="checkbox" className="check" checked={dupBook} onChange={(e) => setDupBook(e.target.checked)} />
                Book lên lịch
                {dupBook && calAccounts.length > 1 && (
                  <select className="btn small" aria-label="Lịch đích của bản sao" value={dupAcct} onChange={(e) => setDupAcct(e.target.value)}>
                    {calAccounts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {providerLabel(c.provider)} · {c.email ?? c.id}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" disabled={busy || !dupAt} onClick={() => void doDuplicate()}>
                {busy ? "Đang tạo…" : "Tạo bản sao"}
              </button>
              <button className="btn ghost small" onClick={() => setMode("view")}>
                Thôi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    {openTask && <TaskDetail taskId={openTask} onClose={() => setOpenTask(null)} z={z + 10} />}
    </>
  );
}
