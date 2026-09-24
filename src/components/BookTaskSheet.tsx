"use client";

import { useMemo, useState } from "react";
import { categoryName, projectById } from "@/core/projects";
import { deadlineEnd, proposeTaskSlots, type Slot } from "@/core/slots";
import type { CalEvent, Task } from "@/core/types";
import { fmtDay, fmtDayFull, fmtDue, fmtRange, isSameDay } from "@/lib/format";
import { useStore } from "@/lib/store";
import {
  createGcalEvent,
  deleteGcalEvent,
  useAccounts,
  useGoogleEvents,
  useGoogleStatus,
} from "@/lib/useGoogle";

const DURATIONS = [30, 60, 90, 120, 180];

/**
 * Book lịch ngay từ một việc (§5.2.2 v3.7): đề xuất 3 khung trước deadline
 * (bận ở BẤT KỲ lịch nào cũng tính), Mai chọn → thẻ xem trước → Book. Sự
 * kiện lấy tên việc, gắn dự án · category · khách, và đính link về việc.
 */
export function BookTaskSheet({
  task,
  onClose,
  onBooked,
  initialDuration,
  onDay,
  z = 75,
}: {
  task: Task;
  onClose: () => void;
  onBooked?: (line: string) => void;
  initialDuration?: number;
  /** "thứ Năm" từ chat/voice → chỉ đề xuất trong ngày đó (ISO). */
  onDay?: string;
  z?: number;
}) {
  const { events, trips, projects, categories, clients, settings, addEvent, removeEvent } = useStore();
  const gs = useGoogleStatus();
  const accts = useAccounts();
  const calAccounts = accts.accounts.filter((a) => a.parts.cal);
  const [now] = useState(() => new Date());
  const [dur, setDur] = useState(initialDuration ?? task.estMinutes ?? 60);
  const horizon = Math.max(
    task.dueAt ? deadlineEnd(task.dueAt) : 0,
    onDay ? Date.parse(onDay) + 86_400_000 : 0,
    now.getTime() + 7 * 86_400_000,
  );
  const gcal = useGoogleEvents(now.getTime(), horizon, gs.connected);

  const busy = useMemo(() => {
    const localIds = new Set(events.map((e) => e.gcalId).filter(Boolean));
    return [
      ...events.filter((e) => e.kind === "event" || e.kind === "block" || e.kind === "flight"),
      ...gcal.events
        .filter((g) => !g.allDay && !localIds.has(g.gcalId))
        .map((g): CalEvent => ({ id: `g:${g.gcalId}`, title: g.title, startAt: g.startAt, endAt: g.endAt, kind: "event" })),
    ];
  }, [events, gcal.events]);

  const { slots, afterDeadline } = useMemo(
    () => proposeTaskSlots(busy, now, dur, { deadline: task.dueAt, onDay }),
    [busy, now, dur, task.dueAt, onDay],
  );

  const [picked, setPicked] = useState<Slot | null>(null);
  const [book, setBook] = useState(true);
  const [acct, setAcct] = useState(settings.projectCalendar[task.projectId] ?? "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ localId: string; gcalId?: string; account?: string; line: string } | null>(null);

  const p = projectById(projects, task.projectId);
  const client = clients.find((c) => c.id === task.clientId);
  const targetAcct = calAccounts.find((c) => c.id === acct) ?? calAccounts[0];
  const flightDay =
    picked &&
    trips.some(
      (t) =>
        isSameDay(t.departAt, new Date(picked.startAt)) ||
        (t.returnAt ? isSameDay(t.returnAt, new Date(picked.startAt)) : false),
    );

  async function confirm() {
    if (!picked) return;
    setSaving(true);
    let gcalId: string | undefined;
    let account: string | undefined;
    let remoteFail = false;
    if (book && calAccounts.length > 0) {
      const created = await createGcalEvent(
        {
          title: task.title,
          startAt: picked.startAt,
          endAt: picked.endAt,
          description: `Việc: ${task.title}\nMở trong Lowtechie: ${window.location.origin}/?task=${task.id}`,
        },
        acct || undefined,
      );
      gcalId = created?.gcalId;
      account = created?.accountId;
      remoteFail = !created;
    }
    const ev = addEvent({
      title: task.title,
      startAt: picked.startAt,
      endAt: picked.endAt,
      kind: "block",
      projectId: task.projectId,
      categoryId: task.categoryId,
      clientId: task.clientId,
      taskId: task.id,
      gcalId,
      calAccount: account,
    });
    setSaving(false);
    const line = `📅 Đã book “${task.title}” ${fmtDay(picked.startAt)} ${fmtRange(picked.startAt, picked.endAt)}${
      gcalId
        ? ` lên ${targetAcct?.provider === "lark" ? "Lark" : "Google"}`
        : remoteFail
          ? " — lịch ngoài lỗi, mới lưu trong app"
          : " trong app"
    }.`;
    setDone({ localId: ev.id, gcalId, account, line });
    onBooked?.(line);
  }

  async function undo() {
    if (!done) return;
    if (done.gcalId) await deleteGcalEvent(done.gcalId, done.account);
    removeEvent(done.localId);
    setDone(null);
    setPicked(null);
    onBooked?.(`Đã gỡ lịch vừa book cho “${task.title}”.`);
  }

  return (
    <div
      role="dialog"
      aria-label={`Book lịch cho việc: ${task.title}`}
      style={{ position: "fixed", inset: 0, background: "rgba(30,33,80,.45)", zIndex: z, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column", gap: 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{ flex: 1 }}>
            <b style={{ fontSize: 16 }}>📅 Book lịch: {task.title}</b>
            <span className="small muted" style={{ display: "block" }}>
              {task.dueAt ? `Hạn ${fmtDue(task.dueAt)}` : "Không có hạn"}
              {onDay ? ` · chỉ tìm trong ${fmtDayFull(onDay)}` : ""}
            </span>
          </span>
          <button className="btn ghost small" aria-label="Đóng book lịch" onClick={onClose}>
            ✕
          </button>
        </div>

        {done ? (
          <>
            <div className="note-box small" role="status">
              {done.line}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" onClick={onClose}>
                Xong
              </button>
              <button className="btn ghost small" onClick={() => void undo()}>
                Hoàn tác book
              </button>
            </div>
          </>
        ) : picked ? (
          <div className="parsed cal" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="k">Xem trước</div>
            <b>{task.title}</b>
            <span className="small">
              {fmtDayFull(picked.startAt)} · {fmtRange(picked.startAt, picked.endAt)} · {dur} phút
            </span>
            <span className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className="chip" style={{ background: p.color }}>
                {p.name}
              </span>
              {categoryName(categories, task.categoryId) && <span className="muted">{categoryName(categories, task.categoryId)}</span>}
              {client && <span className="muted">🤝 {client.name}</span>}
              <span className="muted">· đính link về việc</span>
            </span>
            {flightDay && (
              <span className="small" style={{ color: "var(--note-ink)", background: "var(--note)", borderRadius: 10, padding: "4px 10px" }}>
                ⚠ rơi vào ngày bay
              </span>
            )}
            {calAccounts.length > 0 && (
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <input type="checkbox" className="check" checked={book} onChange={(e) => setBook(e.target.checked)} />
                Book lên lịch
                {calAccounts.length > 1 ? (
                  <select className="btn small" aria-label="Lịch đích" value={acct || targetAcct?.id} onChange={(e) => setAcct(e.target.value)}>
                    {calAccounts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.provider === "lark" ? "Lark" : "Google"} · {c.email ?? c.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted">
                    → {targetAcct?.provider === "lark" ? "Lark" : "Google"} · {targetAcct?.email}
                  </span>
                )}
              </label>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary small" disabled={saving} onClick={() => void confirm()}>
                {saving ? "Đang book…" : "Book"}
              </button>
              <button className="btn ghost small" onClick={() => setPicked(null)}>
                Chọn khung khác
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="seg" role="radiogroup" aria-label="Thời lượng">
              {DURATIONS.map((d) => (
                <button key={d} aria-pressed={dur === d} onClick={() => setDur(d)}>
                  {d < 60 ? `${d}’` : `${d / 60}h`}
                </button>
              ))}
            </div>
            {afterDeadline && (
              <div className="note-box small">
                Trước hạn không còn khung {dur} phút trống — mình đề xuất sau hạn, Mai cân nhắc dời hạn nhé.
              </div>
            )}
            {slots.map((s, i) => (
              <div className={`slot${i === 0 ? " pick" : ""}`} key={s.startAt}>
                <div>
                  <div className="when">
                    {fmtDay(s.startAt)}, {fmtRange(s.startAt, s.endAt)}
                  </div>
                  <div className="small muted">{s.reason}</div>
                </div>
                <button className="btn primary" onClick={() => setPicked(s)}>
                  Chọn
                </button>
              </div>
            ))}
            {slots.length === 0 && (
              <div className="note-box small">
                {onDay ? `${fmtDayFull(onDay)} kín lịch` : "Mấy ngày tới kín lịch"} — chưa có khung {dur} phút trống. Mai thử thời lượng ngắn hơn nhé.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
